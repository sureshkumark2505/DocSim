/**
 * BullMQ Comparison Worker.
 * Evaluates candidate pairs using Exact Jaccard similarity (or SHA-256 duplicate bypass),
 * batch writes results to MongoDB, and handles temporary file cleanup upon scan completion.
 */

const { Worker } = require("bullmq");
const { getRedisConnectionOptions } = require("../queue/connection");
const { getDb } = require("../config/db");
const { calculateJaccardSimilarity } = require("../algorithms/jaccard");
const documentService = require("../services/documentService");
const cleanupService = require("../services/cleanupService");
const featureService = require("../services/featureService");

const COMPARISON_WORKER_CONCURRENCY = Number(process.env.COMPARISON_WORKER_CONCURRENCY) || 4;

/**
 * Job processor function for a batch of candidate pairs.
 * @param {object} job BullMQ job
 */
async function processComparisonJob(job) {
  const { scanId, batchIndex, totalBatches, pairs } = job.data;
  const db = getDb();

  // Load document map for fallback file paths if needed
  const documents = await documentService.getDocumentsByScan(scanId);
  const docMap = new Map();
  for (const doc of documents) {
    docMap.set(doc.documentId, doc);
  }

  const results = [];
  let exactDuplicates = 0;
  let exactComparisons = 0;

  for (const pair of pairs) {
    let similarityScore = 0.0;

    if (pair.isExactDuplicate) {
      similarityScore = 1.0;
      exactDuplicates++;
    } else {
      const docA = docMap.get(pair.docAId) || { documentId: pair.docAId, filename: pair.filenameA };
      const docB = docMap.get(pair.docBId) || { documentId: pair.docBId, filename: pair.filenameB };

      const setA = await featureService.getFeature(scanId, docA);
      const setB = await featureService.getFeature(scanId, docB);

      const jaccard = calculateJaccardSimilarity(setA, setB);
      similarityScore = Number((jaccard * 100).toFixed(2)) / 100;
      exactComparisons++;
    }

    results.push({
      scanId,
      documentAId: pair.docAId,
      documentBId: pair.docBId,
      fileName1: pair.filenameA,
      fileName2: pair.filenameB,
      similarityScore,
      algorithm: "minhash-lsh-jaccard",
      createdAt: new Date()
    });
  }

  // Idempotent bulk insertion into similarity_results using bulkWrite
  if (results.length > 0) {
    const bulkOps = results.map((res) => ({
      updateOne: {
        filter: {
          scanId: res.scanId,
          documentAId: res.documentAId,
          documentBId: res.documentBId
        },
        update: {
          $setOnInsert: res
        },
        upsert: true
      }
    }));

    await db.collection("similarity_results").bulkWrite(bulkOps, { ordered: false });
  }

  // Atomically increment progress counters
  const updatedScan = await db.collection("scans").findOneAndUpdate(
    { scanId },
    {
      $inc: {
        completedComparisons: pairs.length,
        exactComparisons: exactComparisons,
        completedBatches: 1
      }
    },
    { returnDocument: "after" }
  );

  // Check if all comparison batches are completed
  const completedBatches = updatedScan?.completedBatches || 0;
  if (completedBatches >= totalBatches) {
    const startedAt = updatedScan?.startedAt ? new Date(updatedScan.startedAt).getTime() : Date.now();
    const processingTimeMs = Math.round(Date.now() - startedAt);

    await documentService.updateScan(scanId, {
      status: "completed",
      current_stage: "completed",
      completed_at: new Date(),
      processing_time_ms: processingTimeMs
    });

    // Clean up temporary uploads directory and local in-memory feature cache
    await cleanupService.deleteScanDirectory(scanId);
    featureService.clearScanFeatures(scanId);
  }

  return {
    success: true,
    batchIndex,
    pairsProcessed: pairs.length,
    exactComparisons,
    exactDuplicates
  };
}

/**
 * Creates and starts the Comparison Worker.
 * @returns {Worker}
 */
function createComparisonWorker() {
  const connection = getRedisConnectionOptions();
  const worker = new Worker("similarity-comparison", processComparisonJob, {
    connection,
    concurrency: COMPARISON_WORKER_CONCURRENCY
  });

  worker.on("failed", async (job, err) => {
    console.error(`[comparisonWorker] Job ${job?.id} failed on scan ${job?.data?.scanId}:`, err.message);
    if (job?.attemptsMade >= (job?.opts?.attempts || 3)) {
      if (job?.data?.scanId) {
        await documentService.updateScan(job.data.scanId, {
          status: "failed",
          current_stage: "failed",
          error_message: `Comparison batch ${job.data.batchIndex} failed: ${err.message}`,
          completed_at: new Date()
        });
      }
    }
  });

  return worker;
}

module.exports = {
  createComparisonWorker,
  processComparisonJob
};
