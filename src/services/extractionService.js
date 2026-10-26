const path = require("path");
const fs = require("fs/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");
const JSZip = require("jszip");
const pdfParseModule = require("pdf-parse");
const mammoth = require("mammoth");
const storageService = require("./storageService");
const imageService = require("./imageService");
const ocrService = require("./ocrService");
const tableService = require("./tableService");
const codeService = require("./codeService");

const execFileAsync = promisify(execFile);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/**
 * Service for extracting multimodal content (text, images, code, tables, OCR) from documents.
 */
const extractionService = {
  /**
   * Extracts raw text from a document. Preserves backward compatibility.
   * Also supports standalone images via OCR.
   * 
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

    if (IMAGE_EXTENSIONS.has(extension)) {
      const ocrResult = await ocrService.extractText(filePath);
      return ocrResult.text || "";
    }

    throw new Error(`Unsupported file extension: ${extension}`);
  },

  /**
   * Performs whole-document multimodal extraction for PDF, DOCX, and standalone images.
   * Extracts: selectable text, page tracking, embedded images, tables, code blocks, and OCR.
   * 
   * @param {object} file 
   * @param {object} [options]
   * @param {string} [options.scanId]
   * @param {string} [options.outputDir] Temporary directory for extracted image artifacts
   * @returns {Promise<object>} Extracted multimodal content object
   */
  async extractMultimodalContent(file, options = {}) {
    const filename = file.originalname || file.filename;
    const extension = path.extname(filename).toLowerCase();
    const filePath = file.path;
    const outDir = options.outputDir || path.dirname(filePath);

    const result = {
      filename,
      extension,
      filePath,
      text: "",
      pages: [],
      images: [],
      tables: [],
      codeSnippets: [],
      hasOcr: false,
      isScanned: false,
      contentTypes: ["text"],
      errors: []
    };

    try {
      // 1. Text files (.txt)
      if (extension === ".txt") {
        const rawText = await storageService.readToString(filePath);
        result.text = rawText;
        result.pages.push({ pageNumber: 1, text: rawText });

        const codeDetect = codeService.detectCode(rawText);
        if (codeDetect.isCode) {
          result.codeSnippets.push({ code: rawText, isFromOcr: false, pageNumber: 1 });
          result.contentTypes.push("code");
        }
        return result;
      }

      // 2. PDF Documents (.pdf)
      if (extension === ".pdf") {
        await this._extractPdfMultimodal(filePath, outDir, result);
        return result;
      }

      // 3. Word Documents (.docx)
      if (extension === ".docx") {
        await this._extractDocxMultimodal(filePath, outDir, result);
        return result;
      }

      // 4. Standalone Images (.png, .jpg, .jpeg, .webp)
      if (IMAGE_EXTENSIONS.has(extension)) {
        await this._extractStandaloneImage(filePath, filename, result);
        return result;
      }

      throw new Error(`Unsupported file extension: ${extension}`);
    } catch (err) {
      result.errors.push(err.message);
      // Fallback: try raw text extraction if possible
      try {
        result.text = await this.extractText(file);
      } catch (_) {}
      return result;
    }
  },

  /**
   * Internal helper for PDF multimodal extraction.
   */
  async _extractPdfMultimodal(filePath, outDir, result) {
    const docName = path.parse(filePath).name;
    const imagesDir = path.join(outDir, `${docName}_pdf_images`);
    await fs.mkdir(imagesDir, { recursive: true });

    // Attempt high-accuracy Python pypdf extractor
    let pyExtracted = false;
    try {
      const scriptPath = path.resolve(__dirname, "../../python-engine/pdf_extractor.py");
      const { stdout } = await execFileAsync("python", [scriptPath, filePath, imagesDir], { timeout: 8000 });
      const parsed = JSON.parse(stdout.trim());
      if (parsed.success) {
        result.text = parsed.fullText || "";
        result.pages = parsed.pages || [];
        result.images = parsed.images || [];
        result.isScanned = !!parsed.isScanned;
        pyExtracted = true;
      }
    } catch (_) {
      // Fallback to pdf-parse in Node
    }

    if (!pyExtracted) {
      const buffer = await storageService.readToBuffer(filePath);
      if (pdfParseModule && typeof pdfParseModule.PDFParse === "function") {
        const parser = new pdfParseModule.PDFParse({ data: buffer });
        try {
          const parsed = await parser.getText();
          if (parsed && Array.isArray(parsed.pages)) {
            result.pages = parsed.pages.map(p => ({ pageNumber: p.num || 1, text: p.text || "" }));
            result.text = parsed.text || result.pages.map(p => p.text).join("\n\n");
          } else {
            const raw = typeof parsed === "string" ? parsed : (parsed?.text || "");
            result.text = raw;
            result.pages.push({ pageNumber: 1, text: raw });
          }
        } finally {
          try { await parser.destroy(); } catch (_) {}
        }
      } else if (typeof pdfParseModule === "function") {
        const parsed = await pdfParseModule(buffer);
        result.text = parsed.text || "";
        result.pages.push({ pageNumber: 1, text: result.text });
      }
    }

    // Check if pages are scanned (low native text, embedded images present)
    if (result.pages.length > 0 && result.text.trim().length < 50 && result.images.length > 0) {
      result.isScanned = true;
    }

    // Run OCR selectively on embedded images or scanned pages
    if (result.images.length > 0) {
      result.contentTypes.push("image");
      for (const img of result.images) {
        // Run OCR if image is large enough to contain readable text
        if (img.width >= 120 && img.height >= 40) {
          const ocrRes = await ocrService.extractText(img.path);
          if (ocrRes.text && ocrRes.text.length > 15) {
            img.ocrText = ocrRes.text;
            result.hasOcr = true;

            // Check if OCR text is code
            const codeDetect = codeService.detectCode(ocrRes.text);
            if (codeDetect.isCode) {
              result.codeSnippets.push({
                code: ocrRes.text,
                isFromOcr: true,
                sourceImageId: img.imageId,
                pageNumber: img.pageNumber
              });
              result.contentTypes.push("code");
            }

            // Append OCR text to full text if it adds novel content (avoiding double-counting)
            if (!result.text.includes(ocrRes.text.substring(0, 30))) {
              result.text += `\n\n[OCR from Screenshot Page ${img.pageNumber}]:\n${ocrRes.text}`;
            }
          }
        }
      }
    }

    // Detect code in native selectable text
    const nativeCodeDetect = codeService.detectCode(result.text);
    if (nativeCodeDetect.isCode) {
      result.codeSnippets.push({
        code: result.text,
        isFromOcr: false,
        pageNumber: 1
      });
      if (!result.contentTypes.includes("code")) {
        result.contentTypes.push("code");
      }
    }
  },

  /**
   * Internal helper for DOCX multimodal extraction.
   */
  async _extractDocxMultimodal(filePath, outDir, result) {
    const resolvedPath = storageService.resolvePath(filePath);
    const buffer = await fs.readFile(resolvedPath);

    // 1. Extract paragraphs via mammoth
    try {
      const parsed = await mammoth.extractRawText({ buffer });
      result.text = parsed.value || "";
    } catch (_) {
      result.text = "";
    }

    // 2. Open DOCX as ZIP archive to extract tables, embedded images, and fallback text
    try {
      const zip = await JSZip.loadAsync(buffer);

      // Extract tables and fallback paragraphs from word/document.xml
      const docXmlFile = zip.file("word/document.xml");
      if (docXmlFile) {
        const xmlContent = await docXmlFile.async("string");
        
        // If mammoth returned empty, extract text directly from XML
        if (!result.text || result.text.trim().length === 0) {
          const paragraphs = (xmlContent.match(/<w:p[\s\S]*?<\/w:p>/g) || []).map(p => {
            const textParts = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
            return textParts.map(t => t.replace(/<[^>]+>/g, "")).join(" ").trim();
          }).filter(Boolean);
          result.text = paragraphs.join("\n\n");
        }

        const extractedTables = tableService.extractTablesFromDocxXml(xmlContent);
        if (extractedTables.length > 0) {
          result.tables = extractedTables;
          result.contentTypes.push("table");
          // Add table content to searchable text
          const tableText = extractedTables
            .map(t => t.rows.map(r => r.join(" ")).join("\n"))
            .join("\n\n");
          result.text += `\n\n[Table Data]:\n${tableText}`;
        }
      }

      // Extract embedded images from word/media/
      const mediaFiles = [];
      zip.folder("word/media")?.forEach((relPath, file) => {
        const ext = path.extname(relPath).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          mediaFiles.push({ name: relPath, file, ext });
        }
      });

      if (mediaFiles.length > 0) {
        result.contentTypes.push("image");
        const docName = path.parse(filePath).name;
        const docxImgDir = path.join(outDir, `${docName}_docx_images`);
        await fs.mkdir(docxImgDir, { recursive: true });

        for (let i = 0; i < mediaFiles.length; i++) {
          const item = mediaFiles[i];
          const imgBuf = await item.file.async("nodebuffer");
          const imgId = `docx_img_${i + 1}`;
          const imgFilename = `${imgId}${item.ext}`;
          const imgPath = path.join(docxImgDir, imgFilename);

          await fs.writeFile(imgPath, imgBuf);

          const fp = await imageService.fingerprintImage(imgPath);
          const imageObj = {
            imageId: imgId,
            pageNumber: 1,
            filename: imgFilename,
            path: imgPath,
            width: fp.width,
            height: fp.height,
            sha256: fp.sha256,
            dhash: fp.dhash
          };

          // OCR on embedded screenshot
          if (fp.width >= 100 && fp.height >= 40) {
            const ocrRes = await ocrService.extractText(imgPath);
            if (ocrRes.text && ocrRes.text.length > 15) {
              imageObj.ocrText = ocrRes.text;
              result.hasOcr = true;

              const codeDetect = codeService.detectCode(ocrRes.text);
              if (codeDetect.isCode) {
                result.codeSnippets.push({
                  code: ocrRes.text,
                  isFromOcr: true,
                  sourceImageId: imgId,
                  pageNumber: 1
                });
                if (!result.contentTypes.includes("code")) {
                  result.contentTypes.push("code");
                }
              }

              if (!result.text.includes(ocrRes.text.substring(0, 30))) {
                result.text += `\n\n[OCR from Screenshot]:\n${ocrRes.text}`;
              }
            }
          }

          result.images.push(imageObj);
        }
      }
    } catch (zipErr) {
      result.errors.push(`DOCX XML archive parsing error: ${zipErr.message}`);
    }

    // Detect code in native text
    const nativeCodeDetect = codeService.detectCode(result.text);
    if (nativeCodeDetect.isCode) {
      result.codeSnippets.push({
        code: result.text,
        isFromOcr: false,
        pageNumber: 1
      });
      if (!result.contentTypes.includes("code")) {
        result.contentTypes.push("code");
      }
    }
  },

  /**
   * Internal helper for standalone image files.
   */
  async _extractStandaloneImage(filePath, filename, result) {
    result.contentTypes = ["image"];

    const fp = await imageService.fingerprintImage(filePath);
    const imgId = `standalone_${path.basename(filename, path.extname(filename))}`;

    const imageObj = {
      imageId: imgId,
      pageNumber: 1,
      filename,
      path: filePath,
      width: fp.width,
      height: fp.height,
      sha256: fp.sha256,
      dhash: fp.dhash
    };

    // Run OCR safely to extract any text in image
    try {
      const ocrRes = await ocrService.extractText(filePath);
      if (ocrRes.text) {
        imageObj.ocrText = ocrRes.text;
        result.text = ocrRes.text;
        result.hasOcr = true;
        result.contentTypes.push("text");

        const codeDetect = codeService.detectCode(ocrRes.text);
        if (codeDetect.isCode) {
          result.codeSnippets.push({
            code: ocrRes.text,
            isFromOcr: true,
            sourceImageId: imgId,
            pageNumber: 1
          });
          result.contentTypes.push("code");
        }
      } else {
        result.text = `[Image Document: ${filename}]`;
      }
    } catch (_) {
      result.text = `[Image Document: ${filename}]`;
    }

    result.pages.push({ pageNumber: 1, text: result.text });
    result.images.push(imageObj);
  }
};

module.exports = extractionService;
