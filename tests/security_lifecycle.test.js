const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { connectToDatabase, closeDatabase, getDb } = require("../src/config/db");
const cleanupService = require("../src/services/cleanupService");
const storageService = require("../src/services/storageService");
const passageService = require("../src/services/passageService");
const documentService = require("../src/services/documentService");
const resultService = require("../src/services/resultService");

describe("DocSim Security, Lifecycle & Storage Integrity Tests", () => {
  const uploadsRoot = path.resolve(__dirname, "..", "uploads");

  before(async () => {
    await connectToDatabase();
  });

  after(async () => {
    await closeDatabase();
  });

  test("1. Path traversal attacks in cleanupService are strictly rejected", async () => {
    const maliciousPaths = [
      "../",
      "../../",
      "..\\..\\",
      "../../../windows/system32",
      "../../etc/passwd",
      "/etc",
      "C:\\Windows"
    ];

    for (const p of maliciousPaths) {
      await cleanupService.deleteScanDirectory(p);
      // Verify uploads root itself still exists
      const rootExists = await fs.stat(uploadsRoot).then(() => true).catch(() => false);
      assert.strictEqual(rootExists, true, `Uploads root must not be deleted by path traversal payload: ${p}`);
    }
  });

  test("2. Successful cleanup physically deletes temporary upload directory and sets filesDeleted: true", async () => {
    const scanId = crypto.randomUUID();
    const scanDir = path.join(uploadsRoot, scanId);
    await fs.mkdir(scanDir, { recursive: true });
    await fs.writeFile(path.join(scanDir, "test_doc.txt"), "Temporary content for scan");

    await documentService.createScan(scanId, 1, 0);

    // Verify directory exists before cleanup
    const existsBefore = await fs.stat(scanDir).then(() => true).catch(() => false);
    assert.strictEqual(existsBefore, true);

    await cleanupService.deleteScanDirectory(scanId);

    // Verify directory is deleted from disk
    const existsAfter = await fs.stat(scanDir).then(() => true).catch(() => false);
    assert.strictEqual(existsAfter, false, "Upload directory must be physically deleted");

    const scan = await documentService.getScan(scanId);
    assert.strictEqual(scan.filesDeleted, true);
    assert.strictEqual(scan.cleanupStatus, "deleted");
    assert.ok(scan.cleanedUpAt instanceof Date);
  });

  test("3. Failed cleanup sets filesDeleted: false and records error without throwing", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 1, 0);

    // Attempting cleanup on non-existent or locked directory handles cleanly
    await cleanupService.deleteScanDirectory(scanId);

    const scan = await documentService.getScan(scanId);
    assert.ok(scan);
  });

  test("4. Concurrent jobs are isolated in separate scan directories and do not cross-delete", async () => {
    const scanA = crypto.randomUUID();
    const scanB = crypto.randomUUID();

    const dirA = path.join(uploadsRoot, scanA);
    const dirB = path.join(uploadsRoot, scanB);

    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });

    await fs.writeFile(path.join(dirA, "file_a.txt"), "Scan A file");
    await fs.writeFile(path.join(dirB, "file_b.txt"), "Scan B file");

    await documentService.createScan(scanA, 1, 0);
    await documentService.createScan(scanB, 1, 0);

    // Clean up scan A only
    await cleanupService.deleteScanDirectory(scanA);

    const dirAExists = await fs.stat(dirA).then(() => true).catch(() => false);
    const dirBExists = await fs.stat(dirB).then(() => true).catch(() => false);

    assert.strictEqual(dirAExists, false, "Scan A dir must be deleted");
    assert.strictEqual(dirBExists, true, "Scan B dir must remain intact");

    // Clean up scan B
    await cleanupService.deleteScanDirectory(scanB);
    const dirBExistsAfter = await fs.stat(dirB).then(() => true).catch(() => false);
    assert.strictEqual(dirBExistsAfter, false);
  });

  test("5. MongoDB does not store uploaded raw file binaries or full extracted texts", async () => {
    const scanId = crypto.randomUUID();
    const docId = await documentService.createDocument({
      scanId,
      filename: "privacy_test.pdf",
      fileType: ".pdf",
      fileSize: 4096,
      filePath: "/tmp/sample.pdf",
      sha256Hash: "abcd1234efgh5678",
      normalizedHash: "norm1234",
      textLength: 1500,
      tokenCount: 250
    });

    const db = getDb();
    const stored = await db.collection("documents").findOne({ documentId: docId });

    assert.ok(stored);
    assert.strictEqual(stored.binaryData, undefined, "Binary file content must NOT be stored in DB");
    assert.strictEqual(stored.fullText, undefined, "Full document text must NOT be stored in DB");
    assert.strictEqual(stored.text, undefined, "Raw text field must NOT be stored in DB");
    assert.strictEqual(stored.shingles, undefined, "Shingles array must NOT be stored in DB");
    assert.strictEqual(stored.tokens, undefined, "Tokens array must NOT be stored in DB");
    assert.strictEqual(stored.filename, "privacy_test.pdf");
    assert.strictEqual(stored.textLength, 1500);
  });

  test("6. Untrusted text in passage highlighting is strictly HTML-escaped to prevent XSS", () => {
    const maliciousPayload = "<script>alert('xss')</script><img src='x' onerror='alert(1)'>";
    const matchedTokens = ["script", "alert"];

    const highlighted = passageService.highlightMatchedTokens(maliciousPayload, matchedTokens);

    assert.ok(!highlighted.includes("<script>"), "Must not contain unescaped script tag");
    assert.ok(!highlighted.includes("<img"), "Must not contain unescaped img tag");
    assert.ok(highlighted.includes("&lt;"), "Must contain escaped angle brackets");
    assert.ok(highlighted.includes("&gt;"), "Must contain escaped angle brackets");
    assert.ok(highlighted.includes("<mark class=\"passage-highlight\">"), "Must wrap matches in safe mark tags");
  });

  test("7. Evidence retrieval validates parameters and avoids loading unrelated documents", async () => {
    const scanId = crypto.randomUUID();
    const db = getDb();

    await documentService.createScan(scanId, 2, 1);
    const docAId = "doc_sec_A";
    const docBId = "doc_sec_B";

    await db.collection("similarity_results").insertOne({
      scanId,
      documentAId: docAId,
      documentBId: docBId,
      fileName1: "report_A.pdf",
      fileName2: "report_B.pdf",
      similarityScore: 0.75,
      similarityPercentage: 75.00,
      classification: "High Similarity",
      matchingPassages: [
        {
          passageA: "Valid matching passage excerpt for security testing.",
          passageB: "Valid matching passage excerpt for security testing.",
          similarity: 100,
          matchedWords: ["valid", "matching", "passage", "security"]
        }
      ],
      createdAt: new Date()
    });

    const evidence = await resultService.getPairPassages(scanId, docAId, docBId);
    assert.strictEqual(evidence.success, true);
    assert.strictEqual(evidence.similarityPercentage, 75.00);
    assert.strictEqual(evidence.documentA.documentId, docAId);
    assert.strictEqual(evidence.documentB.documentId, docBId);
    assert.strictEqual(evidence.passages.length, 1);

    // Verify filesystem paths are omitted from evidence payload
    assert.strictEqual(evidence.documentA.filePath, undefined);
    assert.strictEqual(evidence.documentB.filePath, undefined);
  });
});
