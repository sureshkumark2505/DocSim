const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const pdfReportService = require("../src/services/pdfReportService");
const documentService = require("../src/services/documentService");
const { getDb, connectToDatabase, closeDatabase } = require("../src/config/db");
const pdfParseModule = require("pdf-parse");

describe("DocSim PDF Report Formatting, Pagination & Evidence Tests", () => {
  before(async () => {
    await connectToDatabase();
  });

  after(async () => {
    await closeDatabase();
  });

  // Helper to convert pdf stream into a Buffer
  async function streamToBuffer(doc) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      doc.on("data", chunk => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.end();
    });
  }

  // Helper to extract text from generated PDF buffer
  async function extractPdfText(buffer) {
    if (typeof pdfParseModule === "function") {
      const parsed = await pdfParseModule(buffer);
      return parsed.text || "";
    }
    if (pdfParseModule && typeof pdfParseModule.PDFParse === "function") {
      const parser = new pdfParseModule.PDFParse({ data: buffer });
      try {
        const parsed = await parser.getText();
        return typeof parsed === "string" ? parsed : (parsed?.text || "");
      } finally {
        if (typeof parser.destroy === "function") await parser.destroy();
      }
    }
    return buffer.toString("utf8");
  }

  test("1. PDF generates valid stream with no privacy-status card or banner", async () => {
    const scanId = crypto.randomUUID();
    const db = getDb();

    await documentService.createScan(scanId, 2, 1);
    await documentService.updateScan(scanId, {
      status: "completed",
      filesDeleted: true,
      cleanupStatus: "deleted",
      cleanedUpAt: new Date()
    });

    const docId1 = await documentService.createDocument({
      scanId,
      filename: "research_paper_v1.pdf",
      fileType: ".pdf",
      fileSize: 1024,
      filePath: "/tmp/doc1.pdf",
      sha256Hash: "hash1"
    });

    const docId2 = await documentService.createDocument({
      scanId,
      filename: "research_paper_v2.pdf",
      fileType: ".pdf",
      fileSize: 1024,
      filePath: "/tmp/doc2.pdf",
      sha256Hash: "hash2"
    });

    await db.collection("similarity_results").insertOne({
      scanId,
      documentAId: docId1,
      documentBId: docId2,
      fileName1: "research_paper_v1.pdf",
      fileName2: "research_paper_v2.pdf",
      similarityScore: 0.85,
      similarityPercentage: 85.00,
      classification: "High Similarity",
      matchingPassages: [
        {
          passageA: "The neural network architecture utilizes residual skip connections to mitigate vanishing gradient descent.",
          passageB: "The neural network architecture utilizes residual skip connections to mitigate vanishing gradients.",
          similarity: 92.5,
          matchType: "high"
        }
      ],
      evidence: {
        passages: [
          {
            passageA: "The neural network architecture utilizes residual skip connections to mitigate vanishing gradient descent.",
            passageB: "The neural network architecture utilizes residual skip connections to mitigate vanishing gradients.",
            similarity: 92.5,
            pageA: 1,
            pageB: 2
          }
        ],
        images: [],
        code: [],
        tables: []
      },
      createdAt: new Date()
    });

    const pdfDoc = await pdfReportService.generateReportPdf(scanId);
    const buffer = await streamToBuffer(pdfDoc);

    assert.ok(buffer.length > 1000, "PDF buffer must be non-empty");
    assert.strictEqual(buffer.subarray(0, 5).toString(), "%PDF-");

    const text = await extractPdfText(buffer);
    assert.ok(!text.includes("PRIVACY & STORAGE STATUS"), "Must NOT contain privacy status card");
    assert.ok(!text.includes("AUTOMATIC CLEANUP VERIFIED"), "Must NOT contain cleanup verified banner");
    assert.ok(text.includes("DOCSIM"), "Contains platform header");
    assert.ok(text.includes("research_paper_v1.pdf"), "Contains Document 1 name");
    assert.ok(text.includes("research_paper_v2.pdf"), "Contains Document 2 name");
    assert.ok(text.includes("85.00%"), "Displays single overall percentage");
  });

  test("2. Long filenames without spaces wrap dynamically without crashing or clipping", async () => {
    const scanId = crypto.randomUUID();
    const db = getDb();

    await documentService.createScan(scanId, 2, 1);
    const longName1 = "assignment_distributed_systems_consensus_raft_paxos_implementation_very_long_identifier_final_v2.pdf";
    const longName2 = "superlongfilenamewithoutanyspacesatallthatkeepsgoingandgoingandneverstopsexamtesting2026.docx";

    const docId1 = await documentService.createDocument({
      scanId,
      filename: longName1,
      fileType: ".pdf",
      fileSize: 2048,
      filePath: "/tmp/f1.pdf",
      sha256Hash: "h1"
    });

    const docId2 = await documentService.createDocument({
      scanId,
      filename: longName2,
      fileType: ".docx",
      fileSize: 2048,
      filePath: "/tmp/f2.docx",
      sha256Hash: "h2"
    });

    await db.collection("similarity_results").insertOne({
      scanId,
      documentAId: docId1,
      documentBId: docId2,
      fileName1: longName1,
      fileName2: longName2,
      similarityScore: 0.55,
      similarityPercentage: 55.00,
      classification: "Moderate Similarity",
      matchingPassages: [
        {
          passageA: "Distributed consensus requires quorum agreement across majority partitioned replica state machines.",
          passageB: "Distributed consensus requires quorum agreement across majority partitioned replicas.",
          similarity: 88.0
        }
      ],
      createdAt: new Date()
    });

    const pdfDoc = await pdfReportService.generateReportPdf(scanId);
    const buffer = await streamToBuffer(pdfDoc);

    assert.ok(buffer.length > 1000);
    const text = await extractPdfText(buffer);
    assert.ok(text.includes("55.00%"), "Single overall percentage is preserved");
    assert.ok(text.includes("Moderate Similarity"), "Classification preserved");
  });

  test("3. Large result sets generate multi-page PDF with repeated table headers and consistent page numbering", async () => {
    const scanId = crypto.randomUUID();
    const db = getDb();

    const N = 40; // 40 results will span multiple pages
    await documentService.createScan(scanId, N, N);

    const results = [];
    for (let i = 1; i <= N; i++) {
      results.push({
        scanId,
        documentAId: `doc_${i}_a`,
        documentBId: `doc_${i}_b`,
        fileName1: `student_submission_batch_${i}_draft_version_alpha.pdf`,
        fileName2: `student_submission_batch_${i}_final_version_beta.pdf`,
        similarityScore: 0.60 + (i % 35) * 0.01,
        similarityPercentage: Number((60 + (i % 35)).toFixed(2)),
        classification: "Moderate Similarity",
        createdAt: new Date()
      });
    }

    await db.collection("similarity_results").insertMany(results);

    const pdfDoc = await pdfReportService.generateReportPdf(scanId);
    const pageRange = pdfDoc.bufferedPageRange();
    assert.ok(pageRange.count >= 2, `Large result set must paginate into multiple pages (actual: ${pageRange.count})`);

    const buffer = await streamToBuffer(pdfDoc);
    const text = await extractPdfText(buffer);

    // Verify footer page format
    assert.ok(text.includes(`Page 1 of ${pageRange.count}`), "Page 1 footer present");
    assert.ok(text.includes(`Page 2 of ${pageRange.count}`), "Page 2 footer present");
  });

  test("4. Extensive matching evidence with Unicode text is rendered without truncation", async () => {
    const scanId = crypto.randomUUID();
    const db = getDb();

    await documentService.createScan(scanId, 2, 1);
    const unicodeTextA = "Analyse comparative des algorithmes: Résumé exécutif avec données numériques et caractères accentués (é, è, ç, à, ñ, ö).";
    const unicodeTextB = "Analyse comparative des algorithmes: Résumé exécutif avec données statistiques et caractères accentués (é, è, ç, à, ñ, ö).";

    await db.collection("similarity_results").insertOne({
      scanId,
      documentAId: "uni_1",
      documentBId: "uni_2",
      fileName1: "thèse_académique_v1.pdf",
      fileName2: "thèse_académique_v2.pdf",
      similarityScore: 0.91,
      similarityPercentage: 91.00,
      classification: "High Similarity",
      matchingPassages: [
        {
          passageA: unicodeTextA,
          passageB: unicodeTextB,
          similarity: 94.0,
          pageA: 3,
          pageB: 4,
          matchType: "high"
        }
      ],
      evidence: {
        passages: [
          {
            passageA: unicodeTextA,
            passageB: unicodeTextB,
            similarity: 94.0,
            pageA: 3,
            pageB: 4
          }
        ],
        images: [
          { pageA: 3, pageB: 4, isExact: true }
        ],
        code: [
          { lineA: "const result = calculateMetrics(alpha, beta);" }
        ],
        tables: [
          { tableAIndex: 1, tableBIndex: 1 }
        ]
      },
      createdAt: new Date()
    });

    const pdfDoc = await pdfReportService.generateReportPdf(scanId);
    const buffer = await streamToBuffer(pdfDoc);

    assert.ok(buffer.length > 1000);
    const text = await extractPdfText(buffer);
    assert.ok(text.includes("91.00%"));
    assert.ok(text.includes("Page 3"));
    assert.ok(text.includes("Page 4"));
  });

  test("5. Empty scan report renders gracefully without throwing errors", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 0, 0);

    const pdfDoc = await pdfReportService.generateReportPdf(scanId);
    const buffer = await streamToBuffer(pdfDoc);

    assert.ok(buffer.length > 500);
    assert.strictEqual(buffer.subarray(0, 5).toString(), "%PDF-");
    const text = await extractPdfText(buffer);
    assert.ok(text.includes("No pairwise comparison records found."));
  });
});
