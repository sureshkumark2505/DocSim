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
const passageService = require("./passageService");
const imageService = require("./imageService");
const ocrService = require("./ocrService");
const codeService = require("./codeService");
const tableService = require("./tableService");
const scoringService = require("./scoringService");
const { testRedisConnection } = require("../queue/connection");
const jobs = require("../queue/jobs");

const PYTHON_ENGINE_URL = process.env.PYTHON_ENGINE_URL || "http://127.0.0.1:8000";

/**
 * Checks if the high-performance Python acceleration microservice is online and responsive.
 */
async function isPythonEngineAvailable() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600);
    const res = await fetch(`${PYTHON_ENGINE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      return data.status === "online";
    }
  } catch (err) {
    // Python engine offline or unreachable
  }
  return false;
}

/**
 * Service to execute document comparisons and manage similarity results in MongoDB.
 * Supports Level 1, Level 2, and Python SIMD Acceleration Engine.
 */
const similarityService = {
  isPythonEngineAvailable,

  /**
   * Main dispatch entrypoint for running a scan job asynchronously.
   * Prioritizes high-throughput Python SIMD Engine if available;
   * otherwise falls back to BullMQ Redis workers or in-process Node.js Level 1/2 engines.
   * 
   * @param {string} scanId 
   */
  async runScanComparisons(scanId) {
    const scan = await documentService.getScan(scanId);
    const algorithm = scan?.algorithm || "minhash-lsh-jaccard";

    const pyAvailable = await isPythonEngineAvailable();
    if (pyAvailable) {
      try {
        await this.runWithPythonEngine(scanId, algorithm);
        return;
      } catch (pyErr) {
        console.warn(`Python engine encountered an issue for scan ${scanId}, falling back to Node pipeline:`, pyErr.message);
      }
    }

    if (algorithm === "jaccard") {
      return this.runLevel1Scan(scanId);
    }

    return this.runLevel2Scan(scanId);
  },

  /**
   * PYTHON ENGINE — High-Throughput SIMD Vectorized MinHash + LSH + Sparse Jaccard Acceleration.
   * Handles 1,000+ to 10,000+ files with extreme throughput.
   * 
   * @param {string} scanId 
   * @param {string} algorithm 
   */
  async runWithPythonEngine(scanId, algorithm = "minhash-lsh-jaccard") {
    const startOverallTime = performance.now();
    let documents = [];

    try {
      await documentService.updateScan(scanId, {
        status: "processing",
        current_stage: "python_simd_processing",
        algorithm,
        started_at: new Date()
      });

      documents = await documentService.getDocumentsByScan(scanId);
      const N = documents.length;

      if (N < 2) {
        throw new Error("Scan must contain at least 2 processed documents.");
      }

      const payload = {
        scan_id: scanId,
        documents: documents.map(d => ({
          documentId: d.documentId,
          filePath: d.filePath,
          filename: d.filename
        })),
        algorithm
      };

      const response = await fetch(`${PYTHON_ENGINE_URL}/api/v1/scan/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Python engine error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const db = getDb();

      // 1. Bulk update document signatures if returned
      if (data.document_signatures) {
        const docUpdates = Object.entries(data.document_signatures).map(([docId, info]) => ({
          updateOne: {
            filter: { scanId, documentId: docId },
            update: {
              $set: {
                tokenCount: info.tokenCount,
                shingleCount: info.shingleCount,
                minhashSignature: info.minhashSignature,
                status: "processed"
              }
            }
          }
        }));
        if (docUpdates.length > 0) {
          await db.collection("documents").bulkWrite(docUpdates, { ordered: false });
        }
      }

      // 2. Extract matching passages for top pairs and insert pairwise results into MongoDB in batches
      if (data.results && data.results.length > 0) {
        for (const r of data.results) {
          if (!r.matchingPassages && r.similarityScore >= 0.15) {
            try {
              const docA = documents.find(d => d.documentId === r.documentAId);
              const docB = documents.find(d => d.documentId === r.documentBId);
              if (docA && docB && docA.filePath && docB.filePath) {
                const textA = await extractionService.extractText({ originalname: docA.filename, path: docA.filePath });
                const textB = await extractionService.extractText({ originalname: docB.filename, path: docB.filePath });
                r.matchingPassages = passageService.findMatchingPassages(textA, textB, { minSimilarity: 35, maxPassages: 10 });
              } else {
                r.matchingPassages = [];
              }
            } catch (_) {
              r.matchingPassages = [];
            }
          } else if (!r.matchingPassages) {
            r.matchingPassages = [];
          }
        }

        const batchSize = Number(process.env.DB_BATCH_SIZE) || 2000;
        for (let i = 0; i < data.results.length; i += batchSize) {
          const chunk = data.results.slice(i, i + batchSize).map(r => ({
            ...r,
            createdAt: new Date()
          }));
          await this.insertResultsBatch(chunk);
        }
      }

      const totalProcessingTime = performance.now() - startOverallTime;

      // 3. Mark scan as completed
      await documentService.updateScan(scanId, {
        status: "completed",
        current_stage: "completed",
        completed_comparisons: data.total_possible_pairs,
        processed_documents: N,
        candidate_pairs: data.candidate_pairs,
        candidate_reduction_percent: data.candidate_reduction_percent || 0.0,
        exact_comparisons: data.exact_comparisons,
        high_similarity_pairs: data.high_similarity_pairs,
        processing_time_ms: Math.round(totalProcessingTime),
        completed_at: new Date()
      });

    } catch (error) {
      console.error(`Python accelerated scan job ${scanId} failed:`, error);
      throw error;
    } finally {
      await documentService.updateScan(scanId, { current_stage: "cleaning_up" });
      await cleanupService.deleteScanDirectory(scanId);
      featureService.clearScanFeatures(scanId);
      await ocrService.terminate();
    }
  },

  /**
   * Helper to perform multimodal whole-document comparison between a document pair.
   * Produces exactly ONE overall similarity score.
   */
  async compareMultimodalPair(docA, docB, multiA, multiB, baseTextSim, matchingPassages = []) {
    const isExactHash = Boolean(docA.sha256Hash && docB.sha256Hash && docA.sha256Hash === docB.sha256Hash);
    const hasOtherModalities = Boolean(
      (multiA?.images?.length || 0) > 0 || (multiB?.images?.length || 0) > 0 ||
      (multiA?.tables?.length || 0) > 0 || (multiB?.tables?.length || 0) > 0
    );

    const isNormalizedExact = Boolean(
      multiA?.text && multiB?.text && preprocessingService.areNormalizedTextsIdentical(multiA.text, multiB.text)
    );

    if (isExactHash || (isNormalizedExact && !hasOtherModalities)) {
      if (!matchingPassages || matchingPassages.length === 0) {
        matchingPassages = passageService.findMatchingPassages(multiA?.text || "", multiA?.text || "", { minSimilarity: 35, maxPassages: 10 });
      }
      const exactImages = (multiA?.images || []).map((img, idx) => ({
        imageAId: img.imageId,
        imageBId: multiB?.images?.[idx]?.imageId || img.imageId,
        pageA: img.pageNumber || 1,
        pageB: multiB?.images?.[idx]?.pageNumber || 1,
        similarity: 1.0,
        isExact: true,
        comparisonMethod: isExactHash ? "exact_sha256" : "exact_normalized_content"
      }));

      return {
        similarityScore: 1.0,
        similarityPercentage: 100.0,
        isExactDuplicate: true,
        matchingPassages,
        evidence: { passages: matchingPassages, images: exactImages, code: [], tables: [] }
      };
    }

    const evidence = {
      passages: matchingPassages || [],
      images: [],
      code: [],
      tables: []
    };

    // 1. Text Similarity (if text is normalized identical, text similarity is 1.0)
    const textSimilarity = isNormalizedExact ? 1.0 : baseTextSim;

    // 2. Image Similarity
    let imageSimilarity = 0;
    if (multiA?.images?.length > 0 && multiB?.images?.length > 0) {
      for (const imgA of multiA.images) {
        for (const imgB of multiB.images) {
          if (imgA.path && imgB.path) {
            const comp = await imageService.compareImagesDetailed(imgA.path, imgB.path);
            if (comp.similarity >= 0.50) {
              evidence.images.push({
                imageAId: imgA.imageId,
                imageBId: imgB.imageId,
                pageA: imgA.pageNumber || 1,
                pageB: imgB.pageNumber || 1,
                similarity: comp.similarity,
                isExact: comp.isExact,
                comparisonMethod: comp.comparisonMethod
              });
              if (comp.similarity > imageSimilarity) {
                imageSimilarity = comp.similarity;
              }
            }
          }
        }
      }
    }

    // 3. Code Similarity (Native and OCR cross-matching)
    let codeSimilarity = 0;
    let codeFromImage = false;
    if (multiA?.codeSnippets?.length > 0 && multiB?.codeSnippets?.length > 0) {
      const codeA = multiA.codeSnippets.map(c => c.code).join("\n");
      const codeB = multiB.codeSnippets.map(c => c.code).join("\n");
      const compCode = codeService.compareCode(codeA, codeB);
      codeSimilarity = compCode.similarity;
      evidence.code = compCode.matchingLines;
      codeFromImage = multiA.codeSnippets.some(c => c.isFromOcr) || multiB.codeSnippets.some(c => c.isFromOcr);
    }

    // 4. Table Similarity
    let tableSimilarity = 0;
    if (multiA?.tables?.length > 0 && multiB?.tables?.length > 0) {
      const compTable = tableService.compareAllTables(multiA.tables, multiB.tables);
      tableSimilarity = compTable.similarity;
      evidence.tables = compTable.tableMatches;
    }

    // 5. Overall Unified Score (Single percentage!)
    const overall = scoringService.computeOverallScore({
      isExactFileMatch: false,
      textSimilarity,
      textTokenCountA: multiA?.text ? multiA.text.split(/\s+/).length : 0,
      textTokenCountB: multiB?.text ? multiB.text.split(/\s+/).length : 0,
      imageSimilarity,
      imageCountA: multiA?.images?.length || 0,
      imageCountB: multiB?.images?.length || 0,
      codeSimilarity,
      codeTokenCountA: multiA?.codeSnippets?.reduce((acc, c) => acc + (c.code.match(/\w+/g) || []).length, 0) || 0,
      codeTokenCountB: multiB?.codeSnippets?.reduce((acc, c) => acc + (c.code.match(/\w+/g) || []).length, 0) || 0,
      tableSimilarity,
      tableCellCountA: multiA?.tables?.reduce((acc, t) => acc + (t.rowCount * t.colCount), 0) || 0,
      tableCellCountB: multiB?.tables?.reduce((acc, t) => acc + (t.rowCount * t.colCount), 0) || 0,
      codeExtractedFromImage: codeFromImage
    });

    return {
      similarityScore: overall.similarityScore,
      similarityPercentage: overall.similarityPercentage,
      matchingPassages: evidence.passages,
      evidence
    };
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
      const textsMap = new Map();
      const multimodalMap = new Map();
      
      for (const doc of documents) {
        const multi = await extractionService.extractMultimodalContent({
          originalname: doc.filename,
          path: doc.filePath
        }, { scanId });

        const text = multi.text || "";
        multimodalMap.set(doc.documentId, multi);
        textsMap.set(doc.documentId, text);
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
          let similarityScore = 0.0;
          let matchingPassages = [];
          let evidence = { passages: [], images: [], code: [], tables: [] };

          const textA = textsMap.get(docA.documentId) || "";
          const textB = textsMap.get(docB.documentId) || "";
          const isExactHash = Boolean(docA.sha256Hash && docB.sha256Hash && docA.sha256Hash === docB.sha256Hash);
          const isNormalizedExact = !isExactHash && Boolean(textA && textB && preprocessingService.areNormalizedTextsIdentical(textA, textB));

          const multiA = multimodalMap.get(docA.documentId);
          const multiB = multimodalMap.get(docB.documentId);
          const hasOtherModalities = Boolean(
            (multiA?.images?.length || 0) > 0 || (multiB?.images?.length || 0) > 0 ||
            (multiA?.tables?.length || 0) > 0 || (multiB?.tables?.length || 0) > 0
          );

          if (isExactHash || (isNormalizedExact && !hasOtherModalities)) {
            similarityScore = 1.0;
            similarityPercentage = 100.00;
            exactDuplicates++;
            matchingPassages = passageService.findMatchingPassages(textA, textA, { minSimilarity: 40, maxPassages: 10 });
            evidence.passages = matchingPassages;
          } else {
            const jaccard = calculateJaccardSimilarity(setA, setB);
            exactComparisons++;

            let containment = 0;
            if (setA && setB && setA.size > 0 && setB.size > 0) {
              const [smaller, larger] = setA.size < setB.size ? [setA, setB] : [setB, setA];
              let inter = 0;
              for (const s of smaller) {
                if (larger.has(s)) inter++;
              }
              containment = inter / smaller.size;
            }

            const multiA = multimodalMap.get(docA.documentId);
            const multiB = multimodalMap.get(docB.documentId);
            const pagesA = multiA?.pages || [];
            const pagesB = multiB?.pages || [];

            if (jaccard > 0 || (textA && textB)) {
              matchingPassages = passageService.findMatchingPassages(textA, textB, {
                minSimilarity: 35,
                maxPassages: 10,
                pagesA,
                pagesB
              });
            }

            let baseTextSim = jaccard;
            if (matchingPassages.length > 0) {
              const coverage = passageService.computePassageCoverage(textA, textB, matchingPassages);
              if (containment >= 0.85) {
                baseTextSim = Math.max(jaccard, containment * 0.65 + coverage.avgCoverage * 0.35);
              } else if (coverage.maxCoverage >= 0.40) {
                baseTextSim = Math.max(jaccard, jaccard * 0.45 + coverage.maxCoverage * 0.35 + containment * 0.20);
              } else {
                baseTextSim = Math.max(jaccard, jaccard * 0.70 + coverage.avgCoverage * 0.20 + containment * 0.10);
              }
            }
            baseTextSim = Number(Math.max(0, Math.min(1.0, baseTextSim)).toFixed(4));

            const mmResult = await this.compareMultimodalPair(docA, docB, multiA, multiB, baseTextSim, matchingPassages);

            similarityScore = mmResult.similarityScore;
            similarityPercentage = mmResult.similarityPercentage;
            matchingPassages = mmResult.matchingPassages;
            evidence = mmResult.evidence;
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
            similarityScore,
            matchingPassages,
            evidence,
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
      await documentService.updateScan(scanId, { current_stage: "cleaning_up" });
      await cleanupService.deleteScanDirectory(scanId);
      await ocrService.terminate();
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
      await ocrService.terminate();
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
    const textsMap = new Map();
    const multimodalMap = new Map();
    for (const doc of documents) {
      const multi = await extractionService.extractMultimodalContent({
        originalname: doc.filename,
        path: doc.filePath
      }, { scanId });

      multimodalMap.set(doc.documentId, multi);
      const text = multi.text || "";
      textsMap.set(doc.documentId, text);
      const tokens = preprocessingService.tokenize(text);
      const shingleSet = createShingleSet(tokens);
      const minhashSignature = generateMinHashSignature(shingleSet);

      featureService.setFeature(scanId, doc.documentId, shingleSet);
      featureService.setText(scanId, doc.documentId, text);

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
        let matchingPassages = [];
        let baseTextSim = 0.0;

        const textA = textsMap.get(docA.documentId) || await featureService.getText(scanId, docA) || "";
        const textB = textsMap.get(docB.documentId) || await featureService.getText(scanId, docB) || "";
        const isNormalizedExact = Boolean(textA && textB && preprocessingService.areNormalizedTextsIdentical(textA, textB));

        const multiA = multimodalMap.get(docA.documentId);
        const multiB = multimodalMap.get(docB.documentId);
        const hasOtherModalities = Boolean(
          (multiA?.images?.length || 0) > 0 || (multiB?.images?.length || 0) > 0 ||
          (multiA?.tables?.length || 0) > 0 || (multiB?.tables?.length || 0) > 0
        );

        if (candidate?.isExactDuplicate || (isNormalizedExact && !hasOtherModalities)) {
          baseTextSim = 1.0;
          exactDuplicates++;
          matchingPassages = passageService.findMatchingPassages(textA, textA, { minSimilarity: 40, maxPassages: 10 });
        } else if (candidate) {
          const setA = await featureService.getFeature(scanId, candidate.docA);
          const setB = await featureService.getFeature(scanId, candidate.docB);
          const jaccard = calculateJaccardSimilarity(setA, setB);
          exactComparisons++;

          const pagesA = multiA?.pages || [];
          const pagesB = multiB?.pages || [];

          if (jaccard > 0 || (textA && textB)) {
            matchingPassages = passageService.findMatchingPassages(textA, textB, {
              minSimilarity: 35,
              maxPassages: 10,
              pagesA,
              pagesB
            });
          }

          let containment = 0;
          if (setA && setB && setA.size > 0 && setB.size > 0) {
            const [smaller, larger] = setA.size < setB.size ? [setA, setB] : [setB, setA];
            let inter = 0;
            for (const s of smaller) {
              if (larger.has(s)) inter++;
            }
            containment = inter / smaller.size;
          }

          baseTextSim = jaccard;
          if (matchingPassages.length > 0) {
            const coverage = passageService.computePassageCoverage(textA, textB, matchingPassages);
            if (containment >= 0.85) {
              baseTextSim = Math.max(jaccard, containment * 0.65 + coverage.avgCoverage * 0.35);
            } else if (coverage.maxCoverage >= 0.40) {
              baseTextSim = Math.max(jaccard, jaccard * 0.45 + coverage.maxCoverage * 0.35 + containment * 0.20);
            } else {
              baseTextSim = Math.max(jaccard, jaccard * 0.70 + coverage.avgCoverage * 0.20 + containment * 0.10);
            }
          }
          baseTextSim = Number(Math.max(0, Math.min(1.0, baseTextSim)).toFixed(4));
        } else {
          // Fast MinHash similarity estimation for non-candidate pairs
          const estimated = estimateMinHashSimilarity(docA.minhashSignature, docB.minhashSignature);
          baseTextSim = Number((estimated * 100).toFixed(2)) / 100;

          if (baseTextSim >= 0.15) {
            matchingPassages = passageService.findMatchingPassages(textA, textB, { minSimilarity: 35, maxPassages: 10 });
          }
        }

        const mmResult = await this.compareMultimodalPair(docA, docB, multiA, multiB, baseTextSim, matchingPassages);

        similarityScore = mmResult.similarityScore;
        matchingPassages = mmResult.matchingPassages;
        const evidence = mmResult.evidence;

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
          matchingPassages,
          evidence,
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
    await documentService.updateScan(scanId, { current_stage: "cleaning_up" });
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
