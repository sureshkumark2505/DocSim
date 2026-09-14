const crypto = require("crypto");
const { getDb } = require("../config/db");

/**
 * Service to manage scans and documents records in MongoDB.
 */
const documentService = {
  /**
   * Creates a new scan job entry.
   * @param {string} scanId 
   * @param {number} totalDocuments 
   * @param {number} totalComparisons 
   */
  async createScan(scanId, totalDocuments, totalComparisons, algorithm = "minhash-lsh-jaccard") {
    const db = getDb();
    await db.collection("scans").insertOne({
      scanId,
      status: "queued",
      currentStage: "uploading",
      algorithm,
      totalDocuments,
      totalPossiblePairs: totalComparisons,
      candidatePairs: 0,
      exactComparisons: 0,
      completedComparisons: 0,
      completedBatches: 0,
      candidateReductionPercent: 0,
      highSimilarityPairs: 0,
      processingTimeMs: 0,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      errorMessage: null
    });
  },

  /**
   * Updates scan progress and metrics.
   * @param {string} scanId 
   * @param {object} updates Fields to update
   */
  async updateScan(scanId, updates) {
    const db = getDb();
    
    // Map backend snake_case parameters to camelCase document keys where applicable
    const mappedUpdates = {};
    const fieldMapping = {
      status: "status",
      current_stage: "currentStage",
      algorithm: "algorithm",
      total_documents: "totalDocuments",
      processed_documents: "processedDocuments",
      total_comparisons: "totalPossiblePairs",
      completed_comparisons: "completedComparisons",
      completed_batches: "completedBatches",
      started_at: "startedAt",
      completed_at: "completedAt",
      error_message: "errorMessage",
      candidate_pairs: "candidatePairs",
      exact_comparisons: "exactComparisons",
      candidate_reduction_percent: "candidateReductionPercent",
      high_similarity_pairs: "highSimilarityPairs",
      processing_time_ms: "processingTimeMs"
    };

    for (const key of Object.keys(updates)) {
      const dbKey = fieldMapping[key] || key;
      mappedUpdates[dbKey] = updates[key];
    }

    await db.collection("scans").updateOne(
      { scanId },
      { $set: mappedUpdates }
    );
  },

  /**
   * Retrieves scan status details.
   * @param {string} scanId 
   * @returns {Promise<object>}
   */
  async getScan(scanId) {
    const db = getDb();
    return db.collection("scans").findOne({ scanId });
  },

  /**
   * Inserts metadata for an uploaded document.
   * @param {object} doc 
   * @returns {Promise<string>} Inserted document identifier
   */
  async createDocument({ scanId, filename, fileType, fileSize, filePath, sha256Hash, contentHash, textLength, tokenCount }) {
    const db = getDb();
    const documentId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);

    await db.collection("documents").insertOne({
      scanId,
      documentId,
      filename,
      fileType,
      fileSize,
      filePath,
      sha256Hash: sha256Hash || contentHash,
      textLength,
      tokenCount,
      status: "processed",
      createdAt: new Date()
    });

    return documentId;
  },

  /**
   * Retrieves all documents associated with a scan.
   * @param {string} scanId 
   * @returns {Promise<object[]>}
   */
  async getDocumentsByScan(scanId) {
    const db = getDb();
    return db.collection("documents").find({ scanId }).toArray();
  },

  /**
   * Retrieves scan history (recent scans).
   * @returns {Promise<object[]>}
   */
  async getRecentScans() {
    const db = getDb();
    return db.collection("scans")
      .find({})
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
  }
};

module.exports = documentService;
