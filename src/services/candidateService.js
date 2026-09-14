/**
 * Service to generate and deduplicate candidate document pairs via LSH bucketing and SHA-256 duplicate detection.
 */

const { bucketDocuments, DEFAULT_LSH_BANDS, DEFAULT_LSH_ROWS } = require("../algorithms/lsh");

const candidateService = {
  /**
   * Generates unique candidate pairs from a collection of documents with MinHash signatures.
   * 
   * Rules:
   * 1. Only generate A-B where docAId < docBId (lexicographical order)
   * 2. Deduplicate pairs across all bucket collisions
   * 3. Group SHA-256 duplicates to avoid redundant Jaccard calculations
   * 4. Bound memory overhead for large document scans
   * 
   * @param {Array<object>} documents List of document objects { documentId, filename, sha256Hash, minhashSignature, filePath }
   * @param {object} [options]
   * @param {number} [options.bands=DEFAULT_LSH_BANDS]
   * @param {number} [options.rows=DEFAULT_LSH_ROWS]
   * @returns {{
   *   totalDocuments: number,
   *   totalPossiblePairs: number,
   *   candidatePairs: Array<{ docA: object, docB: object, isExactDuplicate: boolean }>,
   *   candidateCount: number,
   *   exactDuplicateCount: number,
   *   jaccardCandidateCount: number,
   *   candidateReductionPercent: number
   * }}
   */
  generateCandidates(documents, options = {}) {
    const bands = options.bands || DEFAULT_LSH_BANDS;
    const rows = options.rows || DEFAULT_LSH_ROWS;
    const N = documents.length;
    const totalPossiblePairs = (N * (N - 1)) / 2;

    if (N < 2) {
      return {
        totalDocuments: N,
        totalPossiblePairs: 0,
        candidatePairs: [],
        candidateCount: 0,
        exactDuplicateCount: 0,
        jaccardCandidateCount: 0,
        candidateReductionPercent: 0
      };
    }

    // Index documents by documentId for quick lookup
    const docMap = new Map();
    for (const doc of documents) {
      docMap.set(doc.documentId, doc);
    }

    // Also index documents by SHA-256 hash to immediately find all exact duplicates
    const sha256Groups = new Map();
    for (const doc of documents) {
      if (doc.sha256Hash) {
        let group = sha256Groups.get(doc.sha256Hash);
        if (!group) {
          group = [];
          sha256Groups.set(doc.sha256Hash, group);
        }
        group.push(doc.documentId);
      }
    }

    // Track unique candidate pairs using a Set of "idA::idB" strings
    const uniquePairKeys = new Set();
    const candidatePairs = [];
    let exactDuplicateCount = 0;

    // 1. Add all SHA-256 exact duplicates as candidate pairs
    for (const [, group] of sha256Groups) {
      if (group.length > 1) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const idA = group[i] < group[j] ? group[i] : group[j];
            const idB = group[i] < group[j] ? group[j] : group[i];
            const pairKey = `${idA}::${idB}`;

            if (!uniquePairKeys.has(pairKey)) {
              uniquePairKeys.add(pairKey);
              candidatePairs.push({
                docA: docMap.get(idA),
                docB: docMap.get(idB),
                isExactDuplicate: true
              });
              exactDuplicateCount++;
            }
          }
        }
      }
    }

    // 2. Perform LSH Bucketing
    const buckets = bucketDocuments(documents, bands, rows);

    // 3. Extract candidate pairs from buckets with >= 2 documents
    for (const [, docIds] of buckets) {
      const bucketSize = docIds.length;
      if (bucketSize < 2) continue;

      for (let i = 0; i < bucketSize; i++) {
        for (let j = i + 1; j < bucketSize; j++) {
          const rawA = docIds[i];
          const rawB = docIds[j];

          // Skip self-pairs
          if (rawA === rawB) continue;

          // Enforce canonical ordering A < B
          const idA = rawA < rawB ? rawA : rawB;
          const idB = rawA < rawB ? rawB : rawA;
          const pairKey = `${idA}::${idB}`;

          if (!uniquePairKeys.has(pairKey)) {
            uniquePairKeys.add(pairKey);
            const docA = docMap.get(idA);
            const docB = docMap.get(idB);
            const isExact = docA?.sha256Hash && docB?.sha256Hash && docA.sha256Hash === docB.sha256Hash;

            candidatePairs.push({
              docA,
              docB,
              isExactDuplicate: !!isExact
            });

            if (isExact) {
              exactDuplicateCount++;
            }
          }
        }
      }
    }

    const candidateCount = candidatePairs.length;
    const jaccardCandidateCount = candidateCount - exactDuplicateCount;
    const candidateReductionPercent = totalPossiblePairs > 0
      ? Number((((totalPossiblePairs - candidateCount) / totalPossiblePairs) * 100).toFixed(2))
      : 0;

    return {
      totalDocuments: N,
      totalPossiblePairs,
      candidatePairs,
      candidateCount,
      exactDuplicateCount,
      jaccardCandidateCount,
      candidateReductionPercent
    };
  }
};

module.exports = candidateService;
