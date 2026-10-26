const Tesseract = require("tesseract.js");
const fs = require("fs/promises");

let globalWorker = null;
let isInitializing = false;
let initPromise = null;

/**
 * Service to execute OCR on images, screenshots, and scanned document pages.
 */
const ocrService = {
  /**
   * Initializes or reuses a shared Tesseract worker.
   * @returns {Promise<any>}
   */
  async getWorker() {
    if (globalWorker) return globalWorker;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        globalWorker = await Tesseract.createWorker("eng");
        return globalWorker;
      } catch (err) {
        console.error("Failed to initialize Tesseract worker:", err.message);
        globalWorker = null;
        throw err;
      } finally {
        initPromise = null;
      }
    })();

    return initPromise;
  },

  /**
   * Performs OCR on an image file path or buffer.
   * 
   * @param {string|Buffer} imageInput 
   * @param {object} [options]
   * @param {number} [options.minConfidence=30]
   * @returns {Promise<{ text: string, confidence: number, success: boolean, wordCount: number, error?: string }>}
   */
  async extractText(imageInput, options = {}) {
    const minConfidence = options.minConfidence !== undefined ? options.minConfidence : 30;

    try {
      const worker = await this.getWorker();
      const res = await worker.recognize(imageInput);
      const data = res?.data || {};

      const rawText = data.text ? data.text.trim() : "";
      const confidence = typeof data.confidence === "number" ? Math.round(data.confidence) : 0;

      // Normalize OCR text
      const normalized = rawText
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+/g, " ")
        .trim();

      const words = normalized.split(/\s+/).filter(w => w.length > 0);

      // Check if confidence is acceptable or text is empty
      if (confidence < minConfidence && words.length < 5) {
        return {
          text: "",
          confidence,
          success: true,
          wordCount: 0,
          rawLength: rawText.length,
          note: "Low confidence / no readable text detected"
        };
      }

      return {
        text: normalized,
        confidence,
        success: true,
        wordCount: words.length,
        rawLength: normalized.length
      };
    } catch (error) {
      console.warn("OCR recognition error:", error.message);
      return {
        text: "",
        confidence: 0,
        success: false,
        wordCount: 0,
        error: error.message
      };
    }
  },

  /**
   * Safely terminates the shared Tesseract worker to free memory.
   */
  async terminate() {
    if (globalWorker) {
      try {
        await globalWorker.terminate();
      } catch (_) {}
      globalWorker = null;
    }
  }
};

module.exports = ocrService;
