/**
 * Service to manage temporary in-memory / file-backed document feature representations (shingle sets)
 * during scan processing without persisting full texts or large tokens to MongoDB.
 */

const extractionService = require("./extractionService");
const preprocessingService = require("./preprocessingService");
const { createShingleSet } = require("../algorithms/shingling");

// In-memory LRU / Map for active scan representations: scanId -> Map<documentId, Set<string>>
const activeFeatureCache = new Map();

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

    const text = await extractionService.extractText({
      originalname: doc.filename,
      path: doc.filePath
    });
    const tokens = preprocessingService.tokenize(text);
    const shingleSet = createShingleSet(tokens);

    this.setFeature(scanId, doc.documentId, shingleSet);
    return shingleSet;
  },

  /**
   * Clears cached features for a completed or failed scan.
   * @param {string} scanId 
   */
  clearScanFeatures(scanId) {
    activeFeatureCache.delete(scanId);
  }
};

module.exports = featureService;
