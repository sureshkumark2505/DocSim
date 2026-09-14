const { getDb } = require("../config/db");

/**
 * Disjoint Set Union (DSU) / Union-Find data structure for connected component grouping.
 */
class DisjointSet {
  constructor() {
    this.parent = new Map();
    this.rank = new Map();
  }

  makeSet(item) {
    if (!this.parent.has(item)) {
      this.parent.set(item, item);
      this.rank.set(item, 0);
    }
  }

  find(item) {
    if (!this.parent.has(item)) {
      this.makeSet(item);
      return item;
    }
    if (this.parent.get(item) !== item) {
      this.parent.set(item, this.find(this.parent.get(item)));
    }
    return this.parent.get(item);
  }

  union(itemA, itemB) {
    this.makeSet(itemA);
    this.makeSet(itemB);

    const rootA = this.find(itemA);
    const rootB = this.find(itemB);
    if (rootA === rootB) return;

    const rankA = this.rank.get(rootA) || 0;
    const rankB = this.rank.get(rootB) || 0;

    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }
  }
}

/**
 * Normalizes and checks if a score indicates an exact 100% duplicate.
 * Handles decimal (0.9999 - 1.0001), percentage (99.99 - 100.01), and string forms.
 * 
 * @param {number|string|null|undefined} score 
 * @returns {boolean}
 */
function isExactDuplicateScore(score) {
  if (score === null || score === undefined) return false;
  const num = typeof score === "string" ? parseFloat(score) : Number(score);
  if (isNaN(num)) return false;
  if (num >= 0.9999 && num <= 1.0001) return true;
  if (num >= 99.99 && num <= 100.01) return true;
  return false;
}

/**
 * Helper to get display classification for similarity percentage.
 * @param {number|null} avg 
 * @returns {string}
 */
function getDisplayClassification(avg) {
  if (avg === null || avg === undefined) {
    return "No Data";
  }
  if (avg >= 70.0) {
    return "High Similarity";
  }
  if (avg >= 40.0) {
    return "Moderate Similarity";
  }
  return "Low Similarity";
}

/**
 * Internal core aggregation function used as single source of truth
 * for both getDashboardResults and getScanReport.
 * 
 * @param {string} scanId 
 * @returns {Promise<object>}
 */
async function aggregateScanData(scanId) {
  const db = getDb();

  // 1. Fetch all documents registered under this scan
  const allDocs = await db.collection("documents").find({ scanId }).toArray();
  const totalDocuments = allDocs.length;

  if (totalDocuments === 0) {
    return {
      totalDocuments: 0,
      flatDuplicateFiles: [],
      duplicateDocIds: new Set(),
      allProcessedDocs: []
    };
  }

  // 2. Initialize DSU for all documents
  const dsu = new DisjointSet();
  const docMap = new Map();
  for (const doc of allDocs) {
    dsu.makeSet(doc.documentId);
    docMap.set(doc.documentId, doc);
  }

  // 3. Connect SHA-256 identical documents
  const shaMap = new Map();
  for (const doc of allDocs) {
    if (doc.sha256Hash) {
      if (!shaMap.has(doc.sha256Hash)) {
        shaMap.set(doc.sha256Hash, []);
      }
      shaMap.get(doc.sha256Hash).push(doc.documentId);
    }
  }
  for (const [, group] of shaMap) {
    if (group.length > 1) {
      for (let i = 1; i < group.length; i++) {
        dsu.union(group[0], group[i]);
      }
    }
  }

  // 4. Query exact 100% similarity comparison pairs from similarity_results
  const exactPairs = await db.collection("similarity_results").find({
    scanId,
    similarityScore: { $gte: 0.9999 }
  }).toArray();

  for (const pair of exactPairs) {
    dsu.union(pair.documentAId, pair.documentBId);
  }

  // 5. Group documents by DSU connected component root
  const groupsByRoot = new Map();
  for (const doc of allDocs) {
    const root = dsu.find(doc.documentId);
    if (!groupsByRoot.has(root)) {
      groupsByRoot.set(root, []);
    }
    groupsByRoot.get(root).push(doc);
  }

  const duplicateDocIds = new Set();
  const flatDuplicateFiles = [];

  for (const [, group] of groupsByRoot) {
    if (group.length >= 2) {
      for (const doc of group) {
        duplicateDocIds.add(doc.documentId);
        flatDuplicateFiles.push({
          documentId: doc.documentId,
          filename: doc.filename,
          fileSize: doc.fileSize || 0,
          fileType: doc.fileType || "",
          similarityPercentage: 100.0
        });
      }
    }
  }

  // Deterministically sort flat duplicate files by filename
  flatDuplicateFiles.sort((a, b) => (a.filename || "").localeCompare(b.filename || ""));

  // 6. Aggregate pairwise similarity strictly excluding 100% duplicate relationships
  // Matches all non-100% comparisons (both candidate exact Jaccard and non-candidate MinHash estimates)
  // Two parallel direct stream aggregations (on docA and docB) avoid memory-heavy $unwind stages on 500k+ pairs.
  const [statsA, statsB] = await Promise.all([
    db.collection("similarity_results").aggregate([
      {
        $match: {
          scanId,
          similarityScore: { $lt: 0.9999 }
        }
      },
      {
        $group: {
          _id: "$documentAId",
          totalSimilarity: { $sum: "$similarityScore" },
          comparisonCount: { $sum: 1 },
          maxSimilarity: { $max: "$similarityScore" }
        }
      }
    ], { allowDiskUse: true }).toArray(),

    db.collection("similarity_results").aggregate([
      {
        $match: {
          scanId,
          similarityScore: { $lt: 0.9999 }
        }
      },
      {
        $group: {
          _id: "$documentBId",
          totalSimilarity: { $sum: "$similarityScore" },
          comparisonCount: { $sum: 1 },
          maxSimilarity: { $max: "$similarityScore" }
        }
      }
    ], { allowDiskUse: true }).toArray()
  ]);

  const statsMap = new Map();
  for (const a of statsA) {
    statsMap.set(a._id, {
      totalSimilarity: a.totalSimilarity,
      comparisonCount: a.comparisonCount,
      maxSimilarity: a.maxSimilarity
    });
  }
  for (const b of statsB) {
    if (statsMap.has(b._id)) {
      const existing = statsMap.get(b._id);
      existing.totalSimilarity += b.totalSimilarity;
      existing.comparisonCount += b.comparisonCount;
      existing.maxSimilarity = Math.max(existing.maxSimilarity, b.maxSimilarity);
    } else {
      statsMap.set(b._id, {
        totalSimilarity: b.totalSimilarity,
        comparisonCount: b.comparisonCount,
        maxSimilarity: b.maxSimilarity
      });
    }
  }

  // 7. Construct document records for ALL N uploaded files
  const allProcessedDocs = allDocs.map(doc => {
    const stat = statsMap.get(doc.documentId);
    const isDuplicate = duplicateDocIds.has(doc.documentId);
    const hasComparisons = stat && stat.comparisonCount > 0;
    const avg = hasComparisons
      ? Number(((stat.totalSimilarity / stat.comparisonCount) * 100).toFixed(2))
      : null;
    const max = hasComparisons
      ? Number((stat.maxSimilarity * 100).toFixed(2))
      : null;
    const count = hasComparisons ? stat.comparisonCount : 0;

    return {
      documentId: doc.documentId,
      filename: doc.filename,
      fileType: doc.fileType || "",
      fileSize: doc.fileSize || 0,
      isDuplicate,
      duplicateTag: isDuplicate ? "Exact Duplicate" : null,
      averageSimilarity: avg,
      maxSimilarity: max,
      comparisonCount: count,
      classification: getDisplayClassification(avg)
    };
  });

  return {
    totalDocuments,
    flatDuplicateFiles,
    duplicateDocIds,
    allProcessedDocs
  };
}

/**
 * Service to handle aggregated dashboard presentation and paginated results retrieval in MongoDB.
 */
const resultService = {
  isExactDuplicateScore,
  getDisplayClassification,

  /**
   * Generates the two-section Dashboard Analysis:
   * 1. Exact Duplicates in ONE flat list (100% identical).
   * 2. All File Similarity for ALL N uploaded files (with [Exact Duplicate] badges,
   *    and average similarity calculated strictly from non-duplicate comparisons < 100%).
   * 
   * @param {string} scanId 
   * @param {object} options 
   * @param {number} [options.page=1]
   * @param {number} [options.limit=24]
   * @param {string} [options.sort="avg_desc"] - "avg_desc", "avg_asc", "name_asc", "name_desc"
   * @param {string} [options.search=""]
   * @returns {Promise<object>}
   */
  async getDashboardResults(scanId, { page = 1, limit = 24, sort = "avg_desc", search = "" } = {}) {
    const {
      totalDocuments,
      flatDuplicateFiles,
      allProcessedDocs
    } = await aggregateScanData(scanId);

    const emptyPagination = {
      total_documents: 0,
      total_pages: 1,
      current_page: 1,
      limit: parseInt(limit, 10) || 24,
      has_next: false,
      has_prev: false
    };

    if (totalDocuments === 0) {
      return {
        success: true,
        scan_id: scanId,
        summary: {
          totalDocuments: 0,
          duplicateFiles: 0,
          nonDuplicateFiles: 0
        },
        duplicates: {
          count: 0,
          files: []
        },
        fileSimilarities: {
          pagination: emptyPagination,
          documents: []
        },
        nonDuplicates: {
          pagination: emptyPagination,
          documents: []
        }
      };
    }

    let filteredDocs = [...allProcessedDocs];

    // Optional search filter across all documents
    if (search && search.trim() !== "") {
      const q = search.trim().toLowerCase();
      filteredDocs = filteredDocs.filter(d => (d.filename || "").toLowerCase().includes(q));
    }

    // Sort documents
    if (sort === "avg_asc") {
      filteredDocs.sort((a, b) => {
        if (a.averageSimilarity === null && b.averageSimilarity === null) return (a.filename || "").localeCompare(b.filename || "");
        if (a.averageSimilarity === null) return 1;
        if (b.averageSimilarity === null) return -1;
        if (a.averageSimilarity !== b.averageSimilarity) return a.averageSimilarity - b.averageSimilarity;
        return (a.filename || "").localeCompare(b.filename || "");
      });
    } else if (sort === "name_asc") {
      filteredDocs.sort((a, b) => (a.filename || "").localeCompare(b.filename || ""));
    } else if (sort === "name_desc") {
      filteredDocs.sort((a, b) => (b.filename || "").localeCompare(a.filename || ""));
    } else {
      // Default: "avg_desc" (Average Similarity High to Low; null averages at the end)
      filteredDocs.sort((a, b) => {
        if (a.averageSimilarity === null && b.averageSimilarity === null) return (a.filename || "").localeCompare(b.filename || "");
        if (a.averageSimilarity === null) return 1;
        if (b.averageSimilarity === null) return -1;
        if (b.averageSimilarity !== a.averageSimilarity) return b.averageSimilarity - a.averageSimilarity;
        return (a.filename || "").localeCompare(b.filename || "");
      });
    }

    // Document-level Pagination across all documents
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 24));
    const totalFilteredCount = filteredDocs.length;
    const totalPages = Math.max(1, Math.ceil(totalFilteredCount / parsedLimit));
    const skip = (parsedPage - 1) * parsedLimit;
    const paginatedDocs = filteredDocs.slice(skip, skip + parsedLimit);

    const paginationData = {
      total_documents: totalFilteredCount,
      total_pages: totalPages,
      current_page: parsedPage,
      limit: parsedLimit,
      has_next: parsedPage < totalPages,
      has_prev: parsedPage > 1
    };

    const duplicateCount = flatDuplicateFiles.length;

    return {
      success: true,
      scan_id: scanId,
      summary: {
        totalDocuments,
        duplicateFiles: duplicateCount,
        nonDuplicateFiles: totalDocuments - duplicateCount
      },
      duplicates: {
        count: duplicateCount,
        files: flatDuplicateFiles
      },
      fileSimilarities: {
        pagination: paginationData,
        documents: paginatedDocs
      },
      // Backward compatibility property mapped to fileSimilarities
      nonDuplicates: {
        pagination: paginationData,
        documents: paginatedDocs
      }
    };
  },

  /**
   * Generates a lightweight executive Scan Report for printing / saving as PDF.
   * Uses the exact same aggregation source as getDashboardResults.
   * 
   * @param {string} scanId 
   * @returns {Promise<object>}
   */
  async getScanReport(scanId) {
    const db = getDb();
    const scanRecord = await db.collection("scans").findOne({ scanId });

    const {
      totalDocuments,
      flatDuplicateFiles,
      allProcessedDocs
    } = await aggregateScanData(scanId);

    const docsWithAvg = allProcessedDocs.filter(d => d.averageSimilarity !== null);
    let overallAvg = null;
    let highestAvg = null;
    let lowestAvg = null;

    if (docsWithAvg.length > 0) {
      const sum = docsWithAvg.reduce((acc, d) => acc + d.averageSimilarity, 0);
      overallAvg = Number((sum / docsWithAvg.length).toFixed(2));
      highestAvg = Math.max(...docsWithAvg.map(d => d.averageSimilarity));
      lowestAvg = Math.min(...docsWithAvg.map(d => d.averageSimilarity));
    }

    // Sort report document records deterministically: highest similarity first, then alphabetical
    const sortedAllFiles = [...allProcessedDocs].sort((a, b) => {
      if (a.averageSimilarity === null && b.averageSimilarity === null) return (a.filename || "").localeCompare(b.filename || "");
      if (a.averageSimilarity === null) return 1;
      if (b.averageSimilarity === null) return -1;
      if (b.averageSimilarity !== a.averageSimilarity) return b.averageSimilarity - a.averageSimilarity;
      return (a.filename || "").localeCompare(b.filename || "");
    });

    return {
      success: true,
      scan_id: scanId,
      scan: {
        scanId,
        algorithm: scanRecord?.algorithm || "minhash-lsh-jaccard",
        status: scanRecord?.status || "completed",
        startedAt: scanRecord?.startedAt || scanRecord?.createdAt,
        completedAt: scanRecord?.completedAt || new Date()
      },
      summary: {
        documentsAnalyzed: totalDocuments,
        duplicateFilesCount: flatDuplicateFiles.length,
        filesWithSimilarityCount: docsWithAvg.length,
        overallAverageSimilarity: overallAvg,
        highestAverageSimilarity: highestAvg,
        lowestAverageSimilarity: lowestAvg
      },
      duplicateFiles: flatDuplicateFiles,
      allFiles: sortedAllFiles
    };
  },

  /**
   * Retrieves detailed pairwise comparisons for a specific document against other documents (excluding 100% duplicate pairs).
   * 
   * @param {string} scanId 
   * @param {string} documentId 
   * @returns {Promise<object>}
   */
  async getDocumentSimilarities(scanId, documentId) {
    const db = getDb();

    // 1. Fetch document metadata
    const targetDoc = await db.collection("documents").findOne({ scanId, documentId });
    if (!targetDoc) {
      throw new Error(`Document ${documentId} not found in scan ${scanId}.`);
    }

    // 2. Fetch duplicate mapping to determine if targetDoc is an exact duplicate
    const { duplicateDocIds } = await aggregateScanData(scanId);
    const isDuplicate = duplicateDocIds.has(documentId);

    // 3. Fetch pairwise comparisons involving targetDoc with similarityScore < 0.9999
    const pairs = await db.collection("similarity_results").find({
      scanId,
      similarityScore: { $lt: 0.9999 },
      $or: [
        { documentAId: documentId },
        { documentBId: documentId }
      ]
    }).sort({ similarityScore: -1 }).toArray();

    const comparisons = pairs.map(p => {
      const isDocA = p.documentAId === documentId;
      return {
        comparedWithId: isDocA ? p.documentBId : p.documentAId,
        comparedWithName: isDocA ? p.fileName2 : p.fileName1,
        similarityScore: p.similarityScore,
        similarityPercentage: Number((p.similarityScore * 100).toFixed(2))
      };
    });

    const avgScore = comparisons.length > 0
      ? Number(((comparisons.reduce((acc, c) => acc + c.similarityPercentage, 0) / comparisons.length)).toFixed(2))
      : null;

    return {
      success: true,
      scan_id: scanId,
      document: {
        documentId: targetDoc.documentId,
        filename: targetDoc.filename,
        fileType: targetDoc.fileType || "",
        fileSize: targetDoc.fileSize || 0,
        isDuplicate,
        duplicateTag: isDuplicate ? "Exact Duplicate" : null,
        averageSimilarity: avgScore,
        totalComparisons: comparisons.length,
        classification: getDisplayClassification(avgScore)
      },
      comparisons
    };
  },

  /**
   * Get raw paginated pairwise results for backward compatibility.
   * 
   * @param {string} scanId 
   * @param {object} options 
   * @returns {Promise<object>}
   */
  async getScanResults(scanId, { page = 1, limit = 50, threshold, sort = "similarity_desc" } = {}) {
    const db = getDb();
    
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(1000, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (parsedPage - 1) * parsedLimit;

    const filterQuery = { scanId };
    if (threshold !== undefined && threshold !== null && threshold !== "" && Number(threshold) > 0) {
      filterQuery.similarityScore = { $gte: Number(threshold) };
    }

    let sortQuery = { similarityScore: -1 };
    if (sort === "similarity_asc") {
      sortQuery = { similarityScore: 1 };
    } else if (sort === "filename_1") {
      sortQuery = { fileName1: 1 };
    } else if (sort === "filename_2") {
      sortQuery = { fileName2: 1 };
    }

    const totalResults = await db.collection("similarity_results").countDocuments(filterQuery);

    const results = await db.collection("similarity_results")
      .find(filterQuery)
      .sort(sortQuery)
      .skip(skip)
      .limit(parsedLimit)
      .toArray();

    const mappedResults = results.map(row => ({
      id: row._id.toString(),
      scan_id: row.scanId,
      document_a_id: row.documentAId,
      document_b_id: row.documentBId,
      file_name_1: row.fileName1,
      file_name_2: row.fileName2,
      similarity_percentage: Number((row.similarityScore * 100).toFixed(2)),
      algorithm: row.algorithm || "jaccard",
      created_at: row.createdAt
    }));

    const totalPages = Math.ceil(totalResults / parsedLimit) || 1;

    return {
      success: true,
      scan_id: scanId,
      pagination: {
        total_results: totalResults,
        total_pages: totalPages,
        current_page: parsedPage,
        limit: parsedLimit,
        has_next: parsedPage < totalPages,
        has_prev: parsedPage > 1
      },
      results: mappedResults
    };
  }
};

module.exports = resultService;
