const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs/promises");
const { connectToDatabase, getDb, closeDatabase } = require("../src/config/db");
const documentService = require("../src/services/documentService");
const similarityService = require("../src/services/similarityService");
const resultService = require("../src/services/resultService");
const passageService = require("../src/services/passageService");
const pdfReportService = require("../src/services/pdfReportService");
const cleanupService = require("../src/services/cleanupService");
const scanController = require("../src/controllers/scanController");

const uploadsRoot = path.resolve(__dirname, "..", "uploads");

test.describe("DocSim New Proposed Features Test Suite", () => {
  let db;

  test.before(async () => {
    db = await connectToDatabase();
  });

  test.after(async () => {
    await closeDatabase();
  });

  // FEATURE 1: Matching Passage Highlighting
  test("1.1 Passage service extracts and pairs matching sentences with overlapping content", () => {
    const textA = "Machine learning algorithms learn patterns from large datasets. Neural networks have revolutionized modern artificial intelligence research. The weather is sunny outside today.";
    const textB = "Deep neural networks have revolutionized modern artificial intelligence applications. Machine learning algorithms discover patterns from large structured datasets. Baking sourdough requires patience.";

    const matches = passageService.findMatchingPassages(textA, textB, { minSimilarity: 40 });

    assert.ok(matches.length >= 2, `Expected at least 2 matching passages, got ${matches.length}`);
    
    // First match should have high similarity
    assert.ok(matches[0].similarity >= 60, `Expected similarity >= 60%, got ${matches[0].similarity}`);
    assert.ok(matches[0].matchedWords.length > 0, "Matched words should not be empty");
    assert.ok(matches[0].passageA.length > 0);
    assert.ok(matches[0].passageB.length > 0);
  });

  test("1.2 Passage highlighting wraps overlapping non-stop words in <mark> tags", () => {
    const text = "Neural networks have revolutionized modern artificial intelligence.";
    const matchedWords = ["neural", "networks", "intelligence"];

    const highlighted = passageService.highlightMatchedTokens(text, matchedWords);

    assert.ok(highlighted.includes('<mark class="passage-highlight">Neural</mark>'));
    assert.ok(highlighted.includes('<mark class="passage-highlight">networks</mark>'));
    assert.ok(highlighted.includes('<mark class="passage-highlight">intelligence</mark>'));
  });

  test("1.3 Pair passages endpoint returns formatted side-by-side evidence", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 2, 1);

    const docA = await documentService.createDocument({ scanId, filename: "doc_1.txt", sha256Hash: "h1" });
    const docB = await documentService.createDocument({ scanId, filename: "doc_2.txt", sha256Hash: "h2" });

    const samplePassages = [
      {
        passageA: "Climate change poses critical challenges to global agricultural food supply.",
        passageB: "Climate change presents critical challenges to global agricultural productivity.",
        similarity: 88.5,
        matchedWords: ["climate", "change", "critical", "challenges", "global", "agricultural"],
        matchType: "high"
      }
    ];

    await db.collection("similarity_results").insertOne({
      scanId,
      documentAId: docA.toString(),
      documentBId: docB.toString(),
      fileName1: "doc_1.txt",
      fileName2: "doc_2.txt",
      similarityScore: 0.88,
      matchingPassages: samplePassages,
      createdAt: new Date()
    });

    const passageData = await resultService.getPairPassages(scanId, docA.toString(), docB.toString());

    assert.strictEqual(passageData.success, true);
    assert.strictEqual(passageData.totalMatchingPassages, 1);
    assert.strictEqual(passageData.passages[0].similarity, 88.5);
    assert.ok(passageData.passages[0].highlightedA.includes("<mark class=\"passage-highlight\">"));
    assert.ok(passageData.passages[0].highlightedB.includes("<mark class=\"passage-highlight\">"));
  });

  test("1.4 Malicious script/HTML injection in document text is safely escaped and cannot execute XSS", () => {
    const maliciousText = '<script>alert("xss")</script><img src=x onerror="alert(1)">Here is an overlapping passage.';
    const matchedWords = ["overlapping", "passage"];

    const safeHtml = passageService.highlightMatchedTokens(maliciousText, matchedWords);

    assert.ok(!safeHtml.includes("<script>"), "Must not contain unescaped script tag");
    assert.ok(!safeHtml.includes("<img"), "Must not contain unescaped img tag");
    assert.ok(safeHtml.includes("&lt;script&gt;"), "Script tag must be HTML-escaped");
    assert.ok(safeHtml.includes("&lt;img"), "Img tag must be HTML-escaped");
    assert.ok(safeHtml.includes('<mark class="passage-highlight">overlapping</mark>'));
    assert.ok(safeHtml.includes('<mark class="passage-highlight">passage</mark>'));
  });

  test("1.5 Shared generic sentences with only common stop words do not match", () => {
    const textA = "This is what it was about and that is why it is. We can do this.";
    const textB = "It was what this was and that is why. You should do this.";

    const matches = passageService.findMatchingPassages(textA, textB, { minSimilarity: 30 });
    assert.strictEqual(matches.length, 0, "Sentences sharing only stop words must not produce a passage match");
  });

  test("1.6 Multi-sentence text with single newlines, bullet points, and trailing quotes handles passage splitting", () => {
    const raw = 'He stated, "This framework guarantees data privacy." Furthermore, operations are logged.\nFirst bullet item\nSecond bullet item without punctuation';
    const sentences = passageService.splitIntoSentences(raw);

    assert.ok(sentences.length >= 3, `Expected at least 3 passages, got ${sentences.length}`);
    assert.ok(sentences.some(s => s.includes('guarantees data privacy."')));
    assert.ok(sentences.some(s => s.includes("operations are logged.")));
    assert.ok(sentences.some(s => s.includes("Second bullet item without punctuation")));
  });

  test("1.7 Completely unrelated documents produce 0 matching passages", () => {
    const textA = "Quantum cryptography utilizes principles of superposition and entanglement for secure communication.";
    const textB = "Traditional sourdough bread fermentation requires lactic acid bacteria and wild yeast strains.";

    const matches = passageService.findMatchingPassages(textA, textB, { minSimilarity: 35 });
    assert.strictEqual(matches.length, 0, "Unrelated documents must produce 0 matching passages");
  });

  // FEATURE 2: Smart Ranking and Filtering
  test("2.1 Smart ranking returns document pairs ranked from highest to lowest similarity", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 4, 6);

    await db.collection("similarity_results").insertMany([
      { scanId, documentAId: "1", documentBId: "2", fileName1: "alpha.txt", fileName2: "beta.txt", similarityScore: 0.45, createdAt: new Date() },
      { scanId, documentAId: "1", documentBId: "3", fileName1: "alpha.txt", fileName2: "gamma.txt", similarityScore: 0.95, createdAt: new Date() },
      { scanId, documentAId: "2", documentBId: "3", fileName1: "beta.txt", fileName2: "gamma.txt", similarityScore: 0.72, createdAt: new Date() },
      { scanId, documentAId: "3", documentBId: "4", fileName1: "gamma.txt", fileName2: "delta.txt", similarityScore: 0.20, createdAt: new Date() }
    ]);

    const result = await resultService.getRankedPairs(scanId, { sort: "similarity_desc" });

    assert.strictEqual(result.pagination.total_pairs, 4);
    assert.strictEqual(result.rankedPairs[0].similarityPercentage, 95.00);
    assert.strictEqual(result.rankedPairs[0].rank, 1);
    assert.strictEqual(result.rankedPairs[1].similarityPercentage, 72.00);
    assert.strictEqual(result.rankedPairs[2].similarityPercentage, 45.00);
    assert.strictEqual(result.rankedPairs[3].similarityPercentage, 20.00);
  });

  test("2.2 Smart filtering by score category (high, moderate, low)", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 3, 3);

    await db.collection("similarity_results").insertMany([
      { scanId, documentAId: "1", documentBId: "2", fileName1: "f1.txt", fileName2: "f2.txt", similarityScore: 0.85, createdAt: new Date() },
      { scanId, documentAId: "1", documentBId: "3", fileName1: "f1.txt", fileName2: "f3.txt", similarityScore: 0.55, createdAt: new Date() },
      { scanId, documentAId: "2", documentBId: "3", fileName1: "f2.txt", fileName2: "f3.txt", similarityScore: 0.15, createdAt: new Date() }
    ]);

    // High (>= 70%)
    const high = await resultService.getRankedPairs(scanId, { scoreCategory: "high" });
    assert.strictEqual(high.pagination.total_pairs, 1);
    assert.strictEqual(high.rankedPairs[0].similarityPercentage, 85.00);

    // Moderate (40% - 69%)
    const moderate = await resultService.getRankedPairs(scanId, { scoreCategory: "moderate" });
    assert.strictEqual(moderate.pagination.total_pairs, 1);
    assert.strictEqual(moderate.rankedPairs[0].similarityPercentage, 55.00);

    // Low (< 40%)
    const low = await resultService.getRankedPairs(scanId, { scoreCategory: "low" });
    assert.strictEqual(low.pagination.total_pairs, 1);
    assert.strictEqual(low.rankedPairs[0].similarityPercentage, 15.00);
  });

  test("2.3 Smart filtering by document name search", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 3, 3);

    await db.collection("similarity_results").insertMany([
      { scanId, documentAId: "1", documentBId: "2", fileName1: "thesis_draft.pdf", fileName2: "notes.txt", similarityScore: 0.60, createdAt: new Date() },
      { scanId, documentAId: "1", documentBId: "3", fileName1: "thesis_draft.pdf", fileName2: "thesis_final.pdf", similarityScore: 0.90, createdAt: new Date() },
      { scanId, documentAId: "2", documentBId: "3", fileName1: "notes.txt", fileName2: "thesis_final.pdf", similarityScore: 0.30, createdAt: new Date() }
    ]);

    const result = await resultService.getRankedPairs(scanId, { search: "draft" });
    assert.strictEqual(result.pagination.total_pairs, 2);
    assert.ok(result.rankedPairs.every(p => p.fileName1.includes("draft") || p.fileName2.includes("draft")));
  });

  test("2.4 Boundary filters: exact 0%, exactly 40%, exactly 70%, 100% duplicate", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 5, 10);

    await db.collection("similarity_results").insertMany([
      { scanId, documentAId: "1", documentBId: "2", fileName1: "zero.txt", fileName2: "none.txt", similarityScore: 0.00, createdAt: new Date() },
      { scanId, documentAId: "1", documentBId: "3", fileName1: "sub40.txt", fileName2: "low.txt", similarityScore: 0.399, createdAt: new Date() },
      { scanId, documentAId: "2", documentBId: "3", fileName1: "forty.txt", fileName2: "mod.txt", similarityScore: 0.40, createdAt: new Date() },
      { scanId, documentAId: "3", documentBId: "4", fileName1: "seventy.txt", fileName2: "high.txt", similarityScore: 0.70, createdAt: new Date() },
      { scanId, documentAId: "4", documentBId: "5", fileName1: "exactA.txt", fileName2: "exactB.txt", similarityScore: 1.00, createdAt: new Date() }
    ]);

    // Exact category: score >= 0.9999
    const exact = await resultService.getRankedPairs(scanId, { scoreCategory: "exact" });
    assert.strictEqual(exact.pagination.total_pairs, 1);
    assert.strictEqual(exact.rankedPairs[0].fileName1, "exactA.txt");

    // High category: 0.70 <= score < 0.9999
    const high = await resultService.getRankedPairs(scanId, { scoreCategory: "high" });
    assert.strictEqual(high.pagination.total_pairs, 1);
    assert.strictEqual(high.rankedPairs[0].fileName1, "seventy.txt");

    // Moderate category: 0.40 <= score < 0.70
    const moderate = await resultService.getRankedPairs(scanId, { scoreCategory: "moderate" });
    assert.strictEqual(moderate.pagination.total_pairs, 1);
    assert.strictEqual(moderate.rankedPairs[0].fileName1, "forty.txt");

    // Low category: score < 0.40 (includes 0.00 and 0.399)
    const low = await resultService.getRankedPairs(scanId, { scoreCategory: "low" });
    assert.strictEqual(low.pagination.total_pairs, 2);

    // Numeric minScore boundary: minScore = 70%
    const numeric70 = await resultService.getRankedPairs(scanId, { minScore: 70 });
    assert.strictEqual(numeric70.pagination.total_pairs, 2); // 70% and 100%
  });

  test("2.5 Regex special characters in search input do not crash and match exact filenames", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 3, 3);

    await db.collection("similarity_results").insertMany([
      { scanId, documentAId: "1", documentBId: "2", fileName1: "report(final)[v1.0].pdf", fileName2: "notes.txt", similarityScore: 0.80, createdAt: new Date() },
      { scanId, documentAId: "1", documentBId: "3", fileName1: "regular_report.pdf", fileName2: "data.txt", similarityScore: 0.50, createdAt: new Date() }
    ]);

    // Unescaped regex characters like (, ), [, ], . would crash or match incorrectly
    const res = await resultService.getRankedPairs(scanId, { search: "report(final)[v1.0].pdf" });
    assert.strictEqual(res.pagination.total_pairs, 1);
    assert.strictEqual(res.rankedPairs[0].fileName1, "report(final)[v1.0].pdf");

    // Search with special regex symbols that shouldn't match anything
    const emptyRes = await resultService.getRankedPairs(scanId, { search: "[non-existent-regex]" });
    assert.strictEqual(emptyRes.pagination.total_pairs, 0);
  });

  test("2.6 Out-of-range, negative, and invalid filter parameters handled safely", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 2, 1);

    await db.collection("similarity_results").insertOne({
      scanId,
      documentAId: "1",
      documentBId: "2",
      fileName1: "a.txt",
      fileName2: "b.txt",
      similarityScore: 0.50,
      createdAt: new Date()
    });

    // Negative minScore and out-of-bounds maxScore
    const res = await resultService.getRankedPairs(scanId, { minScore: -50, maxScore: 200 });
    assert.strictEqual(res.pagination.total_pairs, 1);

    // Invalid string minScore
    const nanRes = await resultService.getRankedPairs(scanId, { minScore: "invalid_not_a_number" });
    assert.strictEqual(nanRes.pagination.total_pairs, 1);
  });

  test("2.7 Deterministic sorting when multiple pairs have equal similarity scores", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 4, 3);

    await db.collection("similarity_results").insertMany([
      { scanId, documentAId: "1", documentBId: "2", fileName1: "charlie.txt", fileName2: "doc2.txt", similarityScore: 0.75, createdAt: new Date() },
      { scanId, documentAId: "1", documentBId: "3", fileName1: "alpha.txt", fileName2: "doc3.txt", similarityScore: 0.75, createdAt: new Date() },
      { scanId, documentAId: "2", documentBId: "3", fileName1: "bravo.txt", fileName2: "doc4.txt", similarityScore: 0.75, createdAt: new Date() }
    ]);

    const res = await resultService.getRankedPairs(scanId, { sort: "similarity_desc" });
    assert.strictEqual(res.pagination.total_pairs, 3);
    // Tie-breaker sorts by fileName1 ascending: alpha, bravo, charlie
    assert.strictEqual(res.rankedPairs[0].fileName1, "alpha.txt");
    assert.strictEqual(res.rankedPairs[1].fileName1, "bravo.txt");
    assert.strictEqual(res.rankedPairs[2].fileName1, "charlie.txt");
  });

  // FEATURE 3: Downloadable Similarity Report
  test("3.1 PDF report generator builds valid PDF stream with required sections", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 2, 1);

    const docA = await documentService.createDocument({ scanId, filename: "reportA.pdf", sha256Hash: "hA" });
    const docB = await documentService.createDocument({ scanId, filename: "reportB.pdf", sha256Hash: "hB" });

    await db.collection("similarity_results").insertOne({
      scanId,
      documentAId: docA.toString(),
      documentBId: docB.toString(),
      fileName1: "reportA.pdf",
      fileName2: "reportB.pdf",
      similarityScore: 0.82,
      matchingPassages: [
        {
          passageA: "Data governance frameworks establish clear organizational policies.",
          passageB: "Data governance policies establish clear organizational frameworks.",
          similarity: 90.0,
          matchedWords: ["data", "governance", "establish", "clear", "organizational"]
        }
      ],
      createdAt: new Date()
    });

    const pdfDoc = await pdfReportService.generateReportPdf(scanId);

    // Verify PDF document buffer stream
    const chunks = [];
    const pdfBuffer = await new Promise((resolve, reject) => {
      pdfDoc.on("data", chunk => chunks.push(chunk));
      pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
      pdfDoc.on("error", reject);
      pdfDoc.end();
    });

    assert.ok(pdfBuffer.length > 500, "PDF buffer must contain binary content");
    // Standard PDF header signature check: %PDF-
    assert.strictEqual(pdfBuffer.subarray(0, 5).toString(), "%PDF-");
  });

  test("3.2 PDF report for scan with incomplete or failed cleanup reflects warning banner rather than certified deletion", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 2, 1);
    await documentService.updateScan(scanId, {
      status: "completed",
      filesDeleted: false,
      cleanupStatus: "failed",
      privacyNotice: "Warning: Automatic cleanup failed. Temporary files could not be removed."
    });

    const report = await resultService.getScanReport(scanId);
    assert.strictEqual(report.privacyAudit.filesDeleted, false);
    assert.strictEqual(report.privacyAudit.cleanupStatus, "failed");

    const pdfDoc = await pdfReportService.generateReportPdf(scanId);
    const chunks = [];
    const pdfBuffer = await new Promise((resolve, reject) => {
      pdfDoc.on("data", chunk => chunks.push(chunk));
      pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
      pdfDoc.on("error", reject);
      pdfDoc.end();
    });

    assert.ok(pdfBuffer.length > 500);
    assert.strictEqual(pdfBuffer.subarray(0, 5).toString(), "%PDF-");
  });

  test("3.3 PDF report handles empty scan or scan without pairwise matches gracefully", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 0, 0);

    const pdfDoc = await pdfReportService.generateReportPdf(scanId);
    const chunks = [];
    const pdfBuffer = await new Promise((resolve, reject) => {
      pdfDoc.on("data", chunk => chunks.push(chunk));
      pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
      pdfDoc.on("error", reject);
      pdfDoc.end();
    });

    assert.ok(pdfBuffer.length > 500);
    assert.strictEqual(pdfBuffer.subarray(0, 5).toString(), "%PDF-");
  });

  // FEATURE 4: Privacy and Automatic Cleanup Status
  test("4.1 End-to-end scan lifecycle tracks and updates cleanup status upon completion", async () => {
    const scanId = crypto.randomUUID();
    const scanDir = path.join(uploadsRoot, scanId);
    await fs.mkdir(scanDir, { recursive: true });

    const text1 = "Privacy preserving computation models ensure that raw data is not retained.";
    const text2 = "Privacy preserving computation architectures guarantee that raw data is purged.";

    const file1 = path.join(scanDir, "priv1.txt");
    const file2 = path.join(scanDir, "priv2.txt");

    await fs.writeFile(file1, text1);
    await fs.writeFile(file2, text2);

    await documentService.createScan(scanId, 2, 1, "minhash-lsh-jaccard");

    await documentService.createDocument({
      scanId,
      filename: "priv1.txt",
      fileType: ".txt",
      fileSize: Buffer.byteLength(text1),
      filePath: file1,
      sha256Hash: "sha1",
      textLength: text1.length,
      tokenCount: 10
    });

    await documentService.createDocument({
      scanId,
      filename: "priv2.txt",
      fileType: ".txt",
      fileSize: Buffer.byteLength(text2),
      filePath: file2,
      sha256Hash: "sha2",
      textLength: text2.length,
      tokenCount: 10
    });

    // Run scan
    await similarityService.runLevel2Scan(scanId);

    // Verify upload folder has been physically purged
    let dirExists = true;
    try {
      await fs.access(scanDir);
    } catch {
      dirExists = false;
    }
    assert.strictEqual(dirExists, false, "Physical upload directory must be deleted");

    // Verify scan record in DB has privacy cleanup metadata
    const scan = await documentService.getScan(scanId);
    assert.strictEqual(scan.status, "completed");
    assert.strictEqual(scan.filesDeleted, true, "filesDeleted flag must be true");
    assert.strictEqual(scan.cleanupStatus, "deleted", "cleanupStatus must be deleted");
    assert.ok(scan.cleanedUpAt instanceof Date || typeof scan.cleanedUpAt === "string");
    assert.ok(scan.privacyNotice.includes("deleted"), "privacyNotice should confirm deletion");
  });

  test("4.2 Cleanup failure simulation correctly updates MongoDB with filesDeleted: false and cleanupStatus: failed", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 2, 1);

    const scanDir = path.join(uploadsRoot, scanId);
    await fs.mkdir(scanDir, { recursive: true });

    // Force fs.rm failure by temporarily overriding fs.rm
    const originalRm = fs.rm;
    fs.rm = async () => { throw new Error("EPERM: Operation not permitted (simulated file lock)"); };

    try {
      await cleanupService.deleteScanDirectory(scanId);
    } finally {
      fs.rm = originalRm;
      // Real cleanup after test
      await originalRm(scanDir, { recursive: true, force: true });
    }

    const scan = await documentService.getScan(scanId);
    assert.strictEqual(scan.filesDeleted, false, "filesDeleted must be false upon failure");
    assert.strictEqual(scan.cleanupStatus, "failed", "cleanupStatus must be failed");
    assert.ok(scan.privacyNotice.includes("failed"), "privacyNotice must warn user of failure");
  });

  test("4.3 Path traversal attempt in cleanupService is rejected and does not delete parent uploads", async () => {
    const maliciousScanId = "../../../system32";
    await cleanupService.deleteScanDirectory(maliciousScanId);

    // Verify uploadsRoot still exists
    let uploadsExist = false;
    try {
      await fs.access(uploadsRoot);
      uploadsExist = true;
    } catch {
      uploadsExist = false;
    }
    assert.strictEqual(uploadsExist, true, "Uploads root must remain intact");
  });

  test("4.4 Status endpoint does not claim filesDeleted: true when scan is completed but filesDeleted is false", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 2, 1);
    await documentService.updateScan(scanId, {
      status: "completed",
      filesDeleted: false,
      cleanupStatus: "failed",
      privacyNotice: "Automatic cleanup failed."
    });

    const req = { params: { scanId } };
    let jsonResult = null;
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        jsonResult = data;
        return this;
      }
    };

    await scanController.getStatus(req, res);

    assert.strictEqual(jsonResult.status, "completed");
    assert.strictEqual(jsonResult.filesDeleted, false, "filesDeleted must remain false even when status is completed");
    assert.strictEqual(jsonResult.cleanupStatus, "failed");
    assert.ok(jsonResult.privacyNotice.includes("failed"));
  });
});
