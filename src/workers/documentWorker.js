/**
 * BullMQ Document Processing Worker.
 * Extracts text, tokenizes, creates word-level k-shingles, generates MinHash signatures,
 * and triggers LSH candidate pair generation once all scan documents are prepared.
 */

const { Worker } = require("bullmq");
const { getRedisConnectionOptions } = require("../queue/connection");
const { getDb } = require("../config/db");
const extractionService = require("../services/extractionService");
const preprocessingService = require("../services/preprocessingService");
const { createShingleSet } = require("../algorithms/shingling");
const { generateMinHashSignature } = require("../algorithms/minhash");
const candidateService = require("../services/candidateService");
const documentService = require("../services/documentService");
const cleanupService = require("../services/cleanupService");
const featureService = require("../services/featureService");
const jobs = require("../queue/jobs");

const DOCUMENT_WORKER_CONCURRENCY = Number(process.env.DOCUMENT_WORKER_CONCURRENCY) || 4;

/**
 * Job processor function for a single document.
 * @param {object} job BullMQ job
 */
async function processDocumentJob(job) {
  const { scanId, documentId, filePath, filename, sha256Hash } = job.data;

  // 1. Extract text
  const text = await extractionService.extractText({
    originalname: filename,
    path: filePath
  });

  // 2. Tokenize
  const tokens = preprocessingService.tokenize(text);

  // 3. Generate k-shingles
  const shingleSet = createShingleSet(tokens);

  // 4. Generate MinHash signature (128 integers)
  const minhashSignature = generateMinHashSignature(shingleSet);

  // 5. Cache shingle set in local worker memory for fast Jaccard verification
  featureService.setFeature(scanId, documentId, shingleSet);

  // 6. Update document record in MongoDB with compact metadata (NO full text or token arrays)
  const db = getDb();
  await db.collection("documents").updateOne(
    { scanId, documentId },
    {
      $set: {
        tokenCount: tokens.length,
        shingleCount: shingleSet.size,
        minhashSignature,
        status: "processed",
        updatedAt: new Date()
      }
    }
  );

  // 7. Check if all documents for the scan are processed
  const totalDocsCount = await db.collection("documents").countDocuments({ scanId });
  const processedDocsCount = await db.collection("documents").countDocuments({
    scanId,
    minhashSignature: { $exists: true, $ne: null }
  });

  await documentService.updateScan(scanId, {
    processed_documents: processedDocsCount,
    current_stage: "fingerprinting"
  });

  if (processedDocsCount >= totalDocsCount && totalDocsCount >= 2) {
    // Atomic state transition to prevent duplicate candidate generation across concurrent workers
    const transitionResult = await db.collection("scans").findOneAndUpdate(
      {
        scanId,
        currentStage: { $in: ["uploading", "extracting", "preprocessing", "fingerprinting"] }
      },
      {
        $set: { currentStage: "candidate_generation" }
      },
      { returnDocument: "after" }
    );

    // If this worker won the transition lock, perform candidate generation & enqueuing
    if (transitionResult && transitionResult.currentStage === "candidate_generation") {
      const allDocs = await documentService.getDocumentsByScan(scanId);
      const candidateResult = candidateService.generateCandidates(allDocs);

      await documentService.updateScan(scanId, {
        total_comparisons: candidateResult.totalPossiblePairs,
        candidate_pairs: candidateResult.candidateCount,
        candidate_reduction_percent: candidateResult.candidateReductionPercent,
        current_stage: "comparing"
      });

      if (candidateResult.candidateCount === 0) {
        // No candidate pairs generated (all unrelated)
        await documentService.updateScan(scanId, {
          status: "completed",
          current_stage: "completed",
          completed_at: new Date(),
          completed_comparisons: 0,
          exact_comparisons: 0
        });
        await cleanupService.deleteScanDirectory(scanId);
        featureService.clearScanFeatures(scanId);
      } else {
        // Partition candidate pairs into manageable comparison batches (500 pairs per batch)
        const batchSize = 500;
        const batches = [];
        for (let i = 0; i < candidateResult.candidatePairs.length; i += batchSize) {
          batches.push(candidateResult.candidatePairs.slice(i, i + batchSize));
        }

        await jobs.enqueueComparisonBatches(scanId, batches);
      }
    }
  }

  return {
    success: true,
    documentId,
    tokenCount: tokens.length,
    shingleCount: shingleSet.size
  };
}

/**
 * Creates and starts the Document Worker.
 * @returns {Worker}
 */
function createDocumentWorker() {
  const connection = getRedisConnectionOptions();
  const worker = new Worker("document-processing", processDocumentJob, {
    connection,
    concurrency: DOCUMENT_WORKER_CONCURRENCY
  });

  worker.on("failed", async (job, err) => {
    console.error(`[documentWorker] Job ${job?.id} failed on scan ${job?.data?.scanId}:`, err.message);
    if (job?.attemptsMade >= (job?.opts?.attempts || 3)) {
      if (job?.data?.scanId) {
        await documentService.updateScan(job.data.scanId, {
          status: "failed",
          current_stage: "failed",
          error_message: `Document processing failed for ${job.data.filename}: ${err.message}`,
          completed_at: new Date()
        });
      }
    }
  });

  return worker;
}

module.exports = {
  createDocumentWorker,
  processDocumentJob
};
