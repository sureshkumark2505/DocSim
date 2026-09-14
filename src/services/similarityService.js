const { getDb } = require("../config/db");
const { calculateJaccardSimilarity } = require("../algorithms/jaccard");
const { createShingleSet } = require("../algorithms/shingling");
const { generateMinHashSignature, estimateMinHashSimilarity } = require("../algorithms/minhash");
const candidateService = require("./candidateService");
const documentService = require("./documentService");
const cleanupService = require("./cleanupService");
const extractionService = require("./extractionService");
const preprocessingService = require("./preprocessingService");
const featureService = require("./featureService");
const { testRedisConnection } = require("../queue/connection");
const jobs = require("../queue/jobs");

/**
 * Service to execute document comparisons and manage similarity results in MongoDB.
 * Supports both Level 1 (All-Pairs Exact Jaccard baseline) and Level 2 (MinHash + LSH + Exact Jaccard).
 */
const similarityService = {
  /**
   * Main dispatch entrypoint for running a scan job asynchronously.
   * Dispatches to Level 1 or Level 2 based on the scan's configured algorithm.
   * 
   * @param {string} scanId 
   */
  async runScanComparisons(scanId) {
    const scan = await documentService.getScan(scanId);
    const algorithm = scan?.algorithm || "minhash-lsh-jaccard";

    if (algorithm === "jaccard") {
      return this.runLevel1Scan(scanId);
    }

    return this.runLevel2Scan(scanId);
  },

  /**
   * LEVEL 1 ENGINE — All-Pairs Exact Jaccard Baseline (Preserved)
   * 
   * @param {string} scanId 
   */
  async runLevel1Scan(scanId) {
    const startOverallTime = performance.now();
    let documents = [];
    
    try {
      await documentService.updateScan(scanId, {
        status: "processing",
        current_stage: "extracting",
        algorithm: "jaccard",
        started_at: new Date()
      });

      documents = await documentService.getDocumentsByScan(scanId);
      const N = documents.length;

      if (N < 2) {
        throw new Error("Scan must contain at least 2 processed documents.");
      }

      const totalPossiblePairs = (N * (N - 1)) / 2;

      await documentService.updateScan(scanId, {
        current_stage: "preprocessing"
      });

      const representations = new Map();
      
      for (const doc of documents) {
        const text = await extractionService.extractText({
          originalname: doc.filename,
          path: doc.filePath
        });

        const prep = preprocessingService.process(text);
        representations.set(doc.documentId, prep.shingleSet);
      }

      await documentService.updateScan(scanId, {
        current_stage: "comparing"
      });

      const batchSize = Number(process.env.DB_BATCH_SIZE) || 1000;
      let completedComparisons = 0;
      let lastProgressUpdate = Date.now();
      let pendingResults = [];
      let exactComparisons = 0;
      let exactDuplicates = 0;
      let highSimilarityPairs = 0;

      for (let i = 0; i < N; i++) {
        const docA = documents[i];
        const setA = representations.get(docA.documentId);

        for (let j = i + 1; j < N; j++) {
          const docB = documents[j];
          const setB = representations.get(docB.documentId);

          let similarityPercentage = 0.0;

          if (docA.sha256Hash === docB.sha256Hash) {
            similarityPercentage = 100.00;
            exactDuplicates++;
          } else {
            const jaccard = calculateJaccardSimilarity(setA, setB);
            similarityPercentage = Number((jaccard * 100).toFixed(2));
            exactComparisons++;
          }

          completedComparisons++;

          if (similarityPercentage >= 80.0) {
            highSimilarityPairs++;
          }

          pendingResults.push({
            scanId,
            documentAId: docA.documentId,
            documentBId: docB.documentId,
            fileName1: docA.filename,
            fileName2: docB.filename,
            similarityScore: Number((similarityPercentage / 100).toFixed(4)),
            algorithm: "jaccard",
            createdAt: new Date()
          });

          if (pendingResults.length >= batchSize) {
            await this.insertResultsBatch(pendingResults);
            pendingResults = [];
          }

          const now = Date.now();
          if (completedComparisons % 1000 === 0 || now - lastProgressUpdate > 1500) {
            await documentService.updateScan(scanId, {
              completed_comparisons: completedComparisons,
              processed_documents: Math.min(Math.floor((completedComparisons / totalPossiblePairs) * N), N),
              high_similarity_pairs: highSimilarityPairs
            });
            lastProgressUpdate = now;
          }
        }
      }

      if (pendingResults.length > 0) {
        await this.insertResultsBatch(pendingResults);
        pendingResults = [];
      }

      const totalProcessingTime = performance.now() - startOverallTime;

      await documentService.updateScan(scanId, {
        status: "completed",
        current_stage: "completed",
        completed_comparisons: totalPossiblePairs,
        processed_documents: N,
        candidate_pairs: totalPossiblePairs,
        exact_comparisons: exactComparisons,
        high_similarity_pairs: highSimilarityPairs,
        processing_time_ms: Math.round(totalProcessingTime),
        completed_at: new Date()
      });

    } catch (error) {
      console.error(`Level 1 scan job ${scanId} failed:`, error);
      await documentService.updateScan(scanId, {
        status: "failed",
        current_stage: "failed",
        completed_at: new Date(),
        error_message: error.message
      });
    } finally {
      await cleanupService.deleteScanDirectory(scanId);
    }
  },

  /**
   * LEVEL 2 ENGINE — Distributed MinHash + LSH Candidate Filtering + Exact Jaccard Verification
   * 
   * @param {string} scanId 
   */
  async runLevel2Scan(scanId) {
    const startOverallTime = performance.now();
    let documents = [];

    try {
      await documentService.updateScan(scanId, {
        status: "processing",
        current_stage: "extracting",
        algorithm: "minhash-lsh-jaccard",
        started_at: new Date()
      });

      documents = await documentService.getDocumentsByScan(scanId);
      const N = documents.length;

      if (N < 2) {
        throw new Error("Scan must contain at least 2 processed documents.");
      }

      const totalPossiblePairs = (N * (N - 1)) / 2;
      await documentService.updateScan(scanId, {
        total_comparisons: totalPossiblePairs
      });

      // Check if Redis is accessible for BullMQ distributed processing
      const isRedisAvailable = await testRedisConnection();

      if (isRedisAvailable) {
        // Enqueue document processing jobs to BullMQ
        await jobs.enqueueDocumentJobs(scanId, documents);
        return; // BullMQ workers will take over and complete the pipeline asynchronously
      }

      // In-process fallback pipeline (for environments without active Redis daemon)
      await this.runLevel2DirectPipeline(scanId, documents, startOverallTime);

    } catch (error) {
      console.error(`Level 2 scan job ${scanId} failed:`, error);
      await documentService.updateScan(scanId, {
        status: "failed",
        current_stage: "failed",
        completed_at: new Date(),
        error_message: error.message
      });
      await cleanupService.deleteScanDirectory(scanId);
      featureService.clearScanFeatures(scanId);
    }
  },

  /**
   * Level 2 In-process execution pipeline (MinHash + LSH + Jaccard).
   * Used for direct benchmark runs, offline environments, or tests.
   * 
   * @param {string} scanId 
   * @param {Array<object>} documents 
   * @param {number} startOverallTime 
   */
  async runLevel2DirectPipeline(scanId, documents, startOverallTime = performance.now()) {
    const db = getDb();
    const N = documents.length;

    // 1. Feature generation: Extract, Shingle (k=5), MinHash (128)
    await documentService.updateScan(scanId, { current_stage: "fingerprinting" });

    const preparedDocs = [];
    for (const doc of documents) {
      const text = await extractionService.extractText({
        originalname: doc.filename,
        path: doc.filePath
      });

      const tokens = preprocessingService.tokenize(text);
      const shingleSet = createShingleSet(tokens);
      const minhashSignature = generateMinHashSignature(shingleSet);

      featureService.setFeature(scanId, doc.documentId, shingleSet);

      await db.collection("documents").updateOne(
        { scanId, documentId: doc.documentId },
        {
          $set: {
            tokenCount: tokens.length,
            shingleCount: shingleSet.size,
            minhashSignature,
            status: "processed"
          }
        }
      );

      preparedDocs.push({
        ...doc,
        tokenCount: tokens.length,
        shingleCount: shingleSet.size,
        minhashSignature
      });
    }

    await documentService.updateScan(scanId, {
      processed_documents: N,
      current_stage: "candidate_generation"
    });

    // 2. LSH Candidate Generation
    const candidateResult = candidateService.generateCandidates(preparedDocs);

    await documentService.updateScan(scanId, {
      total_comparisons: candidateResult.totalPossiblePairs,
      candidate_pairs: candidateResult.candidateCount,
      candidate_reduction_percent: candidateResult.candidateReductionPercent,
      current_stage: "comparing"
    });

    // 3. Exact Jaccard verification on candidate pairs and MinHash similarity for all other pairs
    const batchSize = Number(process.env.DB_BATCH_SIZE) || 1000;
    let pendingResults = [];
    let exactComparisons = 0;
    let exactDuplicates = 0;
    let highSimilarityPairs = 0;

    // Index candidate pairs for fast O(1) candidate lookup
    const candidateMap = new Map();
    for (const c of candidateResult.candidatePairs) {
      const idA = c.docA.documentId < c.docB.documentId ? c.docA.documentId : c.docB.documentId;
      const idB = c.docA.documentId < c.docB.documentId ? c.docB.documentId : c.docA.documentId;
      candidateMap.set(`${idA}::${idB}`, c);
    }

    const totalPossiblePairs = (N * (N - 1)) / 2;

    for (let i = 0; i < N; i++) {
      const docA = preparedDocs[i];
      for (let j = i + 1; j < N; j++) {
        const docB = preparedDocs[j];
        const idA = docA.documentId < docB.documentId ? docA.documentId : docB.documentId;
        const idB = docA.documentId < docB.documentId ? docB.documentId : docA.documentId;
        const pairKey = `${idA}::${idB}`;
        const candidate = candidateMap.get(pairKey);

        let similarityScore = 0.0;

        if (candidate) {
          if (candidate.isExactDuplicate) {
            similarityScore = 1.0;
            exactDuplicates++;
          } else {
            const setA = await featureService.getFeature(scanId, candidate.docA);
            const setB = await featureService.getFeature(scanId, candidate.docB);
            const jaccard = calculateJaccardSimilarity(setA, setB);
            similarityScore = Number((jaccard * 100).toFixed(2)) / 100;
            exactComparisons++;
          }
        } else {
          // Fast MinHash similarity estimation for non-candidate pairs
          const estimated = estimateMinHashSimilarity(docA.minhashSignature, docB.minhashSignature);
          similarityScore = Number((estimated * 100).toFixed(2)) / 100;
        }

        if (similarityScore >= 0.80) {
          highSimilarityPairs++;
        }

        pendingResults.push({
          scanId,
          documentAId: docA.documentId,
          documentBId: docB.documentId,
          fileName1: docA.filename,
          fileName2: docB.filename,
          similarityScore,
          algorithm: "minhash-lsh-jaccard",
          createdAt: new Date()
        });

        if (pendingResults.length >= batchSize) {
          await this.insertResultsBatch(pendingResults);
          pendingResults = [];
        }
      }
    }

    if (pendingResults.length > 0) {
      await this.insertResultsBatch(pendingResults);
      pendingResults = [];
    }

    const totalProcessingTime = performance.now() - startOverallTime;

    // 4. Mark Completed
    await documentService.updateScan(scanId, {
      status: "completed",
      current_stage: "completed",
      completed_comparisons: totalPossiblePairs,
      processed_documents: N,
      candidate_pairs: candidateResult.candidateCount,
      exact_comparisons: exactComparisons,
      high_similarity_pairs: highSimilarityPairs,
      processing_time_ms: Math.round(totalProcessingTime),
      completed_at: new Date()
    });

    // Clean up temporary files
    await cleanupService.deleteScanDirectory(scanId);
    featureService.clearScanFeatures(scanId);
  },

  /**
   * Helper to write similarity results to MongoDB Atlas in batches.
   * Uses idempotent update/insert to prevent duplicate records on retries.
   * 
   * @param {object[]} results 
   */
  async insertResultsBatch(results) {
    if (results.length === 0) return;
    const db = getDb();
    
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
};

module.exports = similarityService;
