const express = require("express");
const uploadMiddleware = require("../middleware/uploadMiddleware");
const scanController = require("../controllers/scanController");

const router = express.Router();

// New API endpoints under /api/scans
router.post("/", scanController.createScan);
router.post("/:scanId/documents", uploadMiddleware, scanController.uploadDocuments);
router.post("/:scanId/start", scanController.startScan);
router.get("/:scanId/status", scanController.getStatus);
router.get("/:scanId/dashboard", scanController.getDashboard);
router.get("/:scanId/report", scanController.getReport);
router.get("/:scanId/documents/:documentId/similarities", scanController.getDocumentSimilarities);
router.get("/:scanId/results", scanController.getResults);
router.get("/history", scanController.getHistory);

// Legacy Compatibility API endpoints under /api/scan
router.post("/compare", uploadMiddleware, scanController.compareDocumentsLegacy);

module.exports = router;
