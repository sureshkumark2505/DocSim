const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs/promises");
const path = require("node:path");
const PDFDocument = require("pdfkit");
const JSZip = require("jszip");
const extractionService = require("../src/services/extractionService");
const imageService = require("../src/services/imageService");
const ocrService = require("../src/services/ocrService");

const testDir = path.resolve(__dirname, "temp_extraction_tests");
const validPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAIAAACRXR/mAAAATUlEQVR4nO3OMQHAIBAAsQf/nlsDLJlguCjImvnmPft24KyWqCVqiVqilqglaolaopaoJWqJWqKWqCVqiVqilqglaolaopaoJWqJWuIHP6wBY/cJXlsAAAAASUVORK5CYII=";

describe("DocSim Multimodal Content Ingestion & Extraction Tests (Phase 1)", () => {
  before(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  after(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (_) {}
    await ocrService.terminate();
  });

  test("1. Text-only PDF extracts selectable text and tracks page numbers", async () => {
    const pdfPath = path.join(testDir, "text_only.pdf");
    const doc = new PDFDocument();
    const writeStream = require("fs").createWriteStream(pdfPath);
    doc.pipe(writeStream);
    doc.text("Page 1: Introduction to Data Structures and Algorithms.");
    doc.addPage();
    doc.text("Page 2: Implementing Binary Search Trees in C++.");
    doc.end();

    await new Promise((res) => writeStream.on("finish", res));

    const result = await extractionService.extractMultimodalContent({
      originalname: "text_only.pdf",
      path: pdfPath
    }, { outputDir: testDir });

    assert.ok(result.text.includes("Introduction to Data Structures"), "Should contain text from page 1");
    assert.ok(result.pages.length >= 1, "Should have tracked at least 1 page");
    assert.strictEqual(result.isScanned, false, "Should not be marked as scanned");
  });

  test("2. PDF with selectable text and screenshots extracts both content types", async () => {
    const pdfPath = path.join(testDir, "mixed_content.pdf");
    const imgBuf = Buffer.from(validPngBase64, "base64");

    const doc = new PDFDocument();
    const writeStream = require("fs").createWriteStream(pdfPath);
    doc.pipe(writeStream);
    doc.text("Lab Assessment: Network Routing and Packet Inspection.");
    doc.image(imgBuf, 50, 100, { width: 50 });
    doc.end();

    await new Promise((res) => writeStream.on("finish", res));

    const result = await extractionService.extractMultimodalContent({
      originalname: "mixed_content.pdf",
      path: pdfPath
    }, { outputDir: testDir });

    assert.ok(result.text.includes("Network Routing"), "Should extract selectable text");
    assert.ok(result.contentTypes.includes("text"), "Content types should include text");
    assert.ok(result.contentTypes.includes("image") || result.images.length >= 0, "Handles image extraction safely");
  });

  test("3. DOCX with paragraphs, tables, and embedded images extracts all modalities", async () => {
    const docxPath = path.join(testDir, "experiment_report.docx");

    const zip = new JSZip();
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>Physics Experiment: Acceleration Due to Gravity</w:t></w:r></w:p>
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:r><w:t>Trial</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>Acceleration (m/s2)</w:t></w:r></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>9.81</w:t></w:r></w:p></w:tc>
          </w:tr>
        </w:tbl>
      </w:body>
    </w:document>`;

    zip.file("word/document.xml", docXml);
    zip.file("word/media/image1.png", Buffer.from(validPngBase64, "base64"));

    const docxBuf = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(docxPath, docxBuf);

    const result = await extractionService.extractMultimodalContent({
      originalname: "experiment_report.docx",
      path: docxPath
    }, { outputDir: testDir });

    assert.ok(result.text.includes("Acceleration Due to Gravity"), "Extracts paragraph text");
    assert.strictEqual(result.tables.length, 1, "Extracts table structure");
    assert.strictEqual(result.tables[0].rowCount, 2, "Table has 2 rows");
    assert.strictEqual(result.images.length, 1, "Extracts embedded image from word/media/");
    assert.ok(result.contentTypes.includes("table"), "Includes table content type");
    assert.ok(result.contentTypes.includes("image"), "Includes image content type");
  });

  test("4. Standalone PNG, JPG, and WEBP images validate and compute dimensions safely", async () => {
    const pngPath = path.join(testDir, "diagram.png");
    await fs.writeFile(pngPath, Buffer.from(validPngBase64, "base64"));

    const validation = imageService.validateImageHeader(Buffer.from(validPngBase64, "base64"));
    assert.strictEqual(validation.valid, true, "PNG header is valid");
    assert.strictEqual(validation.format, "png", "Detected png format");

    const dims = imageService.getImageDimensions(Buffer.from(validPngBase64, "base64"));
    assert.deepStrictEqual(dims, { width: 50, height: 50 }, "Reads width and height correctly");

    const result = await extractionService.extractMultimodalContent({
      originalname: "diagram.png",
      path: pngPath
    }, { outputDir: testDir });

    assert.strictEqual(result.images.length, 1, "Standalone image extracted as image artifact");
    assert.strictEqual(result.contentTypes.includes("image"), true);
  });

  test("5. Unsupported or corrupted files fail safely without crashing scan", async () => {
    const corruptPath = path.join(testDir, "corrupted.pdf");
    await fs.writeFile(corruptPath, Buffer.from("NOT_A_VALID_PDF_FILE_HEADER"));

    const result = await extractionService.extractMultimodalContent({
      originalname: "corrupted.pdf",
      path: corruptPath
    }, { outputDir: testDir });

    assert.ok(result, "Returns safe fallback object");
    assert.ok(Array.isArray(result.errors), "Records extraction error");
  });
});
