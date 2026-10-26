/**
 * Service to manage temporary in-memory / file-backed document feature representations (shingle sets)
 * during scan processing without persisting full texts or large tokens to MongoDB.
 */

const extractionService = require("./extractionService");
const preprocessingService = require("./preprocessingService");
const { createShingleSet } = require("../algorithms/shingling");

// In-memory LRU / Map for active scan representations: scanId -> Map<documentId, Set<string>>
const activeFeatureCache = new Map();
// In-memory temporary cache for raw document text during active scan only
const activeTextCache = new Map();

const featureService = {
  /**
   * Caches the shingle set for a document in memory.
   * @param {string} scanId 
   * @param {string} documentId 
   * @param {Set<string>} shingleSet 
   */
  setFeature(scanId, documentId, shingleSet) {
    let scanMap = activeFeatureCache.get(scanId);
    if (!scanMap) {
      scanMap = new Map();
      activeFeatureCache.set(scanId, scanMap);
    }
    scanMap.set(documentId, shingleSet);
  },

  /**
   * Caches raw extracted text temporarily in memory during scan analysis.
   * @param {string} scanId 
   * @param {string} documentId 
   * @param {string} text 
   */
  setText(scanId, documentId, text) {
    let scanMap = activeTextCache.get(scanId);
    if (!scanMap) {
      scanMap = new Map();
      activeTextCache.set(scanId, scanMap);
    }
    scanMap.set(documentId, text);
  },

  /**
   * Retrieves raw extracted text for a document from memory or file.
   * @param {string} scanId 
   * @param {object} doc 
   * @returns {Promise<string>}
   */
  async getText(scanId, doc) {
    const scanMap = activeTextCache.get(scanId);
    if (scanMap && scanMap.has(doc.documentId)) {
      return scanMap.get(doc.documentId);
    }
    if (!doc.filePath) return "";
    try {
      const text = await extractionService.extractText({
        originalname: doc.filename,
        path: doc.filePath
      });
      this.setText(scanId, doc.documentId, text);
      return text;
    } catch (e) {
      return "";
    }
  },

  /**
   * Retrieves the shingle set for a document. If not cached in memory, re-extracts from file.
   * @param {string} scanId 
   * @param {object} doc { documentId, filename, filePath }
   * @returns {Promise<Set<string>>}
   */
  async getFeature(scanId, doc) {
    const scanMap = activeFeatureCache.get(scanId);
    if (scanMap && scanMap.has(doc.documentId)) {
      return scanMap.get(doc.documentId);
    }

    // Fallback: extract and shingle from file
    if (!doc.filePath) {
      return new Set();
    }

    const text = await this.getText(scanId, doc);
    const tokens = preprocessingService.tokenize(text);
    const shingleSet = createShingleSet(tokens);

    this.setFeature(scanId, doc.documentId, shingleSet);
    return shingleSet;
  },

  /**
   * Clears cached features and temporary text for a completed or failed scan.
   * @param {string} scanId 
   */
  clearScanFeatures(scanId) {
    activeFeatureCache.delete(scanId);
    activeTextCache.delete(scanId);
  }
};

module.exports = featureService;
