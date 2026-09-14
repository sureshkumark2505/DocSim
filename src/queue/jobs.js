/**
 * Job enqueuing helpers with lightweight payloads (references only).
 * No full text, tokens, shingles, or binary payloads inside Redis.
 */

const { getDocumentQueue, getComparisonQueue } = require("./queues");

const jobs = {
  /**
   * Enqueues document processing jobs for a scan.
   * 
   * @param {string} scanId 
   * @param {Array<{ documentId: string, filePath: string, filename: string, sha256Hash: string }>} documents 
   * @returns {Promise<number>} Number of enqueued jobs
   */
  async enqueueDocumentJobs(scanId, documents) {
    const queue = getDocumentQueue();
    const bulkJobs = documents.map((doc) => ({
      name: "process-document",
      data: {
        scanId,
        documentId: doc.documentId,
        filePath: doc.filePath,
        filename: doc.filename,
        sha256Hash: doc.sha256Hash
      },
      opts: {
        jobId: `doc-${scanId}-${doc.documentId}` // Deterministic jobId ensures idempotency on retries
      }
    }));

    await queue.addBulk(bulkJobs);
    return bulkJobs.length;
  },

  /**
   * Enqueues candidate pair comparison batch jobs.
   * 
   * @param {string} scanId 
   * @param {Array<Array<{ docAId: string, docBId: string, filenameA: string, filenameB: string, isExactDuplicate: boolean }>>} pairBatches 
   * @returns {Promise<number>} Number of enqueued batch jobs
   */
  async enqueueComparisonBatches(scanId, pairBatches) {
    const queue = getComparisonQueue();
    const bulkJobs = pairBatches.map((batch, batchIndex) => ({
      name: "compare-candidate-batch",
      data: {
        scanId,
        batchIndex,
        totalBatches: pairBatches.length,
        pairs: batch.map(p => ({
          docAId: p.docA.documentId || p.docAId,
          docBId: p.docB.documentId || p.docBId,
          filenameA: p.docA.filename || p.filenameA,
          filenameB: p.docB.filename || p.filenameB,
          isExactDuplicate: !!p.isExactDuplicate
        }))
      },
      opts: {
        jobId: `comp-${scanId}-${batchIndex}` // Deterministic jobId ensures idempotency
      }
    }));

    if (bulkJobs.length > 0) {
      await queue.addBulk(bulkJobs);
    }
    return bulkJobs.length;
  }
};

module.exports = jobs;
