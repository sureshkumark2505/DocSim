const path = require("path");
const pdfParseModule = require("pdf-parse");
const mammoth = require("mammoth");
const storageService = require("./storageService");

/**
 * Service for extracting raw text from files.
 */
const extractionService = {
  /**
   * Extracts raw text from a document.
   * @param {object} file Multer file object (or custom metadata containing path/filename)
   * @returns {Promise<string>}
   */
  async extractText(file) {
    const filename = file.originalname || file.filename;
    const extension = path.extname(filename).toLowerCase();
    const filePath = file.path;

    if (extension === ".txt") {
      return storageService.readToString(filePath);
    }

    if (extension === ".pdf") {
      const buffer = await storageService.readToBuffer(filePath);
      
      if (typeof pdfParseModule === "function") {
        const parsed = await pdfParseModule(buffer);
        return parsed.text || "";
      }

      if (pdfParseModule && typeof pdfParseModule.PDFParse === "function") {
        const parser = new pdfParseModule.PDFParse({ data: buffer });
        try {
          const parsed = await parser.getText();
          if (typeof parsed === "string") {
            return parsed;
          }
          return parsed?.text || "";
        } finally {
          if (typeof parser.destroy === "function") {
            await parser.destroy();
          }
        }
      }

      throw new Error("Unsupported pdf-parse API version.");
    }

    if (extension === ".docx") {
      const parsed = await mammoth.extractRawText({ path: storageService.resolvePath(filePath) });
      return parsed.value || "";
    }

    throw new Error(`Unsupported file extension: ${extension}`);
  }
};

module.exports = extractionService;
