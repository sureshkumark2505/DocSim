const crypto = require("crypto");
const path = require("path");
const { getDb } = require("../config/db");
const documentService = require("../services/documentService");
const extractionService = require("../services/extractionService");
const preprocessingService = require("../services/preprocessingService");
const hashingService = require("../services/hashingService");
const similarityService = require("../services/similarityService");
const resultService = require("../services/resultService");
const storageService = require("../services/storageService");

/**
 * Controller for scan operations using MongoDB.
 */
const scanController = {
  /**
   * POST /api/scans
   * Create/initialize a new scan session.
   */
  async createScan(req, res) {
    try {
      const scanId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
      const algorithm = req.body?.algorithm || req.query?.algorithm || "minhash-lsh-jaccard";
      await documentService.createScan(scanId, 0, 0, algorithm);

      res.status(201).json({
        success: true,
        scan_id: scanId,
        algorithm,
        status: "queued",
        current_stage: "uploading"
      });
    } catch (error) {
      console.error("Failed to create scan:", error);
      res.status(500).json({ success: false, message: "Failed to initialize scan", error: error.message });
    }
  },

  /**
   * POST /api/scans/:scanId/documents
   * Upload and process documents for a scan.
   */
  async uploadDocuments(req, res) {
    const { scanId } = req.params;
    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded." });
    }

    try {
      await documentService.updateScan(scanId, { current_stage: "extracting" });

      const processedDocs = [];
      const skippedFiles = [];

      for (const file of files) {
        try {
          // Compute file hash
          const hash = await hashingService.calculateFileHash(file.path);
          
          // Extract text temporarily to count tokens
          const text = await extractionService.extractText({
            originalname: file.originalname,
            path: file.path
          });
          const textLength = text.length;

          // Tokenize to find token count (no shingle storing in DB)
          const tokens = preprocessingService.tokenize(text);

          // Save document metadata only
          const documentId = await documentService.createDocument({
            scanId,
            filename: file.originalname,
            fileType: path.extname(file.originalname).toLowerCase(),
            fileSize: file.size,
            filePath: file.path,
            sha256Hash: hash,
            textLength,
            tokenCount: tokens.length
          });

          // Update file record inside the Multer folder with the new document ID
          // The file is kept on the filesystem at file.path until final comparisons cleanup
          processedDocs.push({
            id: documentId,
            filename: file.originalname,
            size: file.size
          });
        } catch (error) {
          skippedFiles.push({
            file: file.originalname,
            reason: error.message
          });
          // Clean up the failed file
          await storageService.deleteFile(file.path);
        }
      }

      // Update scan total documents and comparisons count
      const existingDocs = await documentService.getDocumentsByScan(scanId);
      const totalDocs = existingDocs.length;
      const totalPossiblePairs = (totalDocs * (totalDocs - 1)) / 2;

      await documentService.updateScan(scanId, {
        total_documents: totalDocs,
        total_comparisons: totalPossiblePairs,
        current_stage: "preprocessing"
      });

      res.status(200).json({
        success: true,
        scan_id: scanId,
        total_uploaded: files.length,
        processed_count: processedDocs.length,
        skipped_count: skippedFiles.length,
        skipped_files: skippedFiles,
        total_documents: totalDocs
      });
    } catch (error) {
      console.error("Error uploading documents:", error);
      res.status(500).json({ success: false, message: "Error processing documents", error: error.message });
    }
  },

  /**
   * POST /api/scans/:scanId/start
   * Start pairwise comparison asynchronously.
   */
  async startScan(req, res) {
    const { scanId } = req.params;
    const algorithm = req.body?.algorithm || req.query?.algorithm;

    try {
      const scan = await documentService.getScan(scanId);
      if (!scan) {
        return res.status(404).json({ success: false, message: `Scan ${scanId} not found.` });
      }

      if (scan.totalDocuments < 2) {
        return res.status(400).json({ success: false, message: "A scan requires at least 2 documents." });
      }

      if (algorithm) {
        await documentService.updateScan(scanId, { algorithm });
      }

      // Start processing asynchronously
      similarityService.runScanComparisons(scanId).catch(err => {
        console.error(`Asynchronous scan job ${scanId} failed:`, err);
      });

      res.status(200).json({
        success: true,
        scan_id: scanId,
        algorithm: algorithm || scan.algorithm || "minhash-lsh-jaccard",
        status: "processing",
        current_stage: "comparing",
        total_documents: scan.totalDocuments,
        total_comparisons: scan.totalPossiblePairs
      });
    } catch (error) {
      console.error("Error starting scan:", error);
      res.status(500).json({ success: false, message: "Failed to start scan", error: error.message });
    }
  },

  /**
   * GET /api/scans/:scanId/status
   * Get the real-time status of the scan.
   */
  async getStatus(req, res) {
    const { scanId } = req.params;

    try {
      const scan = await documentService.getScan(scanId);
      if (!scan) {
        return res.status(404).json({ success: false, message: `Scan ${scanId} not found.` });
      }

      const denominator = scan.candidatePairs > 0 ? scan.candidatePairs : (scan.totalPossiblePairs > 0 ? scan.totalPossiblePairs : 1);
      const percentage = scan.status === "completed" 
        ? 100 
        : Number(((scan.completedComparisons / denominator) * 100).toFixed(1));

      res.status(200).json({
        scanId: scan.scanId,
        status: scan.status,
        currentStage: scan.currentStage,
        algorithm: scan.algorithm || "minhash-lsh-jaccard",
        totalDocuments: scan.totalDocuments,
        processedDocuments: scan.processedDocuments || 0,
        totalPossiblePairs: scan.totalPossiblePairs || 0,
        candidatePairs: scan.candidatePairs || 0,
        exactComparisons: scan.exactComparisons || 0,
        completedComparisons: scan.completedComparisons || 0,
        candidateReductionPercent: scan.candidateReductionPercent || 0,
        highSimilarityPairs: scan.highSimilarityPairs || 0,
        processingTimeMs: scan.processingTimeMs || 0,
        percentage,
        startedAt: scan.startedAt,
        completedAt: scan.completedAt,
        error: scan.errorMessage
      });
    } catch (error) {
      console.error("Error fetching status:", error);
      res.status(500).json({ success: false, message: "Failed to fetch status", error: error.message });
    }
  },

  /**
   * GET /api/scans/:scanId/dashboard
   * Get two-section aggregated dashboard (Duplicate Groups + Non-Duplicate Documents).
   */
  async getDashboard(req, res) {
    const { scanId } = req.params;
    const { page, limit, sort, search } = req.query;

    try {
      const dashboard = await resultService.getDashboardResults(scanId, { page, limit, sort, search });
      res.status(200).json(dashboard);
    } catch (error) {
      console.error("Error generating dashboard:", error);
      res.status(500).json({ success: false, message: "Failed to generate similarity dashboard", error: error.message });
    }
  },

  /**
   * GET /api/scans/:scanId/report
   * Get single source-of-truth document-level executive report for print/PDF export.
   */
  async getReport(req, res) {
    const { scanId } = req.params;

    try {
      const report = await resultService.getScanReport(scanId);
      res.status(200).json(report);
    } catch (error) {
      console.error("Error generating scan report:", error);
      res.status(500).json({ success: false, message: "Failed to generate scan report", error: error.message });
    }
  },

  /**
   * GET /api/scans/:scanId/documents/:documentId/similarities
   * Get detailed pairwise similarity breakdown for an individual non-duplicate document.
   */
  async getDocumentSimilarities(req, res) {
    const { scanId, documentId } = req.params;

    try {
      const details = await resultService.getDocumentSimilarities(scanId, documentId);
      res.status(200).json(details);
    } catch (error) {
      console.error("Error fetching document similarities:", error);
      res.status(500).json({ success: false, message: "Failed to fetch document similarities", error: error.message });
    }
  },

  /**
   * GET /api/scans/:scanId/results
   * Get paginated results for a scan (legacy / raw pairwise endpoint).
   */
  async getResults(req, res) {
    const { scanId } = req.params;
    const { page, limit, threshold, sort } = req.query;

    try {
      const results = await resultService.getScanResults(scanId, { page, limit, threshold, sort });
      res.status(200).json(results);
    } catch (error) {
      console.error("Error fetching results:", error);
      res.status(500).json({ success: false, message: "Failed to fetch results", error: error.message });
    }
  },

  /**
   * GET /api/scans/history and GET /api/scan/history
   * Get historical scan comparisons repository.
   */
  async getHistory(req, res) {
    try {
      const db = getDb();
      const recentScans = await db.collection("scans")
        .find({ status: "completed" })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();

      const history = [];

      for (const scan of recentScans) {
        const docs = await db.collection("documents").find({ scanId: scan.scanId }).toArray();
        const topResult = await db.collection("similarity_results")
          .findOne({ scanId: scan.scanId }, { sort: { similarityScore: -1 } });

        let file_name_1 = "";
        let file_name_2 = "";
        let similarity = 0.0;

        if (docs.length === 2) {
          file_name_1 = docs[0].filename;
          file_name_2 = docs[1].filename;
        } else if (docs.length > 2) {
          file_name_1 = docs[0].filename;
          file_name_2 = `${docs[1].filename} & ${docs.length - 2} others`;
        } else if (docs.length === 1) {
          file_name_1 = docs[0].filename;
          file_name_2 = "None (Single Document)";
        } else {
          file_name_1 = "No documents";
          file_name_2 = "No documents";
        }

        if (topResult) {
          if (docs.length > 2) {
            file_name_1 = topResult.fileName1;
            file_name_2 = topResult.fileName2;
          }
          similarity = Number((topResult.similarityScore * 100).toFixed(2));
        }

        history.push({
          id: scan.scanId,
          file_name_1,
          file_name_2,
          similarity,
          created_at: scan.completedAt || scan.createdAt
        });
      }

      res.status(200).json({
        success: true,
        count: history.length,
        history
      });
    } catch (error) {
      console.error("Error fetching history:", error);
      res.status(500).json({ success: false, message: "Failed to fetch history", error: error.message });
    }
  },

  /**
   * POST /api/scan/compare (LEGACY Compatibility Endpoint - Asynchronous Adapter)
   */
  async compareDocumentsLegacy(req, res) {
    const files = req.files || [];
    
    if (files.length < 2) {
      return res.status(400).json({ success: false, message: "Please upload at least 2 files." });
    }

    try {
      // 1. Create a scan matching the uploaded file directory path
      const scanId = req.tempScanId || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2));
      await documentService.createScan(scanId, files.length, 0);

      // 2. Register files metadata
      for (const file of files) {
        const hash = await hashingService.calculateFileHash(file.path);
        const text = await extractionService.extractText({
          originalname: file.originalname,
          path: file.path
        });
        const tokens = preprocessingService.tokenize(text);

        await documentService.createDocument({
          scanId,
          filename: file.originalname,
          fileType: path.extname(file.originalname).toLowerCase(),
          fileSize: file.size,
          filePath: file.path,
          sha256Hash: hash,
          textLength: text.length,
          tokenCount: tokens.length
        });
      }

      const existingDocs = await documentService.getDocumentsByScan(scanId);
      const totalDocs = existingDocs.length;
      const totalPossiblePairs = (totalDocs * (totalDocs - 1)) / 2;

      await documentService.updateScan(scanId, {
        total_documents: totalDocs,
        total_comparisons: totalPossiblePairs
      });

      // 3. Trigger similarity execution asynchronously
      similarityService.runScanComparisons(scanId).catch(err => {
        console.error(`Legacy adapter async run failed for ${scanId}:`, err);
      });

      // 4. Return immediately matching response parameters or status details
      res.status(202).json({
        success: true,
        scan_id: scanId,
        status: "processing",
        message: "Scan initiated asynchronously. Poll status to fetch results.",
        total_files: totalDocs,
        total_pairs: totalPossiblePairs
      });

    } catch (error) {
      console.error("Legacy compare execution failed:", error);
      res.status(500).json({ success: false, message: "Failed to process legacy scan adapter.", error: error.message });
    }
  }
};

module.exports = scanController;
