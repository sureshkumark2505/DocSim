const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs/promises");
const { connectToDatabase, getDb, closeDatabase } = require("../src/config/db");
const documentService = require("../src/services/documentService");
const similarityService = require("../src/services/similarityService");
const preprocessingService = require("../src/services/preprocessingService");
const hashingService = require("../src/services/hashingService");
const resultService = require("../src/services/resultService");
const cleanupService = require("../src/services/cleanupService");

const uploadsRoot = path.resolve(__dirname, "..", "uploads");

test.describe("DocSim Level 1 MongoDB Migration & Storage Lifecycle Tests", () => {
  let db;
  let scanId;
  let docIdA;
  let docIdB;

  test.before(async () => {
    // Connect to database (Atlas)
    db = await connectToDatabase();
  });

  test("1. Preprocessing, tokenization, and hashing functions work correctly", () => {
    const text = "The quick brown fox jumps over the lazy dog! The quick brown fox.";
    const prep = preprocessingService.process(text);

    assert.ok(prep.tokenCount > 0);
    assert.ok(prep.shingleCount > 0);
    assert.deepEqual(prep.tokens[0], "the");

    const hash = hashingService.calculateContentHash(text);
    assert.strictEqual(hash.length, 64);
  });

  test("2. Scan and Document Metadata are stored in MongoDB, and binaries/full-texts are omitted", async () => {
    scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 2, 1);

    const scanRecord = await db.collection("scans").findOne({ scanId });
    assert.ok(scanRecord);
    assert.strictEqual(scanRecord.status, "queued");

    const textContent = "Simple dummy text for database documents check.";
    const hash = hashingService.calculateContentHash(textContent);
    
    // Create scan directory dynamically to simulate Multer path structure
    const scanDir = path.join(uploadsRoot, scanId);
    await fs.mkdir(scanDir, { recursive: true });
    
    const filePath = path.join(scanDir, "test_doc.txt");
    await fs.writeFile(filePath, textContent);

    docIdA = await documentService.createDocument({
      scanId,
      filename: "test_doc.txt",
      fileType: ".txt",
      fileSize: Buffer.byteLength(textContent),
      filePath: filePath,
      sha256Hash: hash,
      textLength: textContent.length,
      tokenCount: 5
    });

    const docRecord = await db.collection("documents").findOne({ scanId, documentId: docIdA });
    assert.ok(docRecord);
    assert.strictEqual(docRecord.filename, "test_doc.txt");
    
    // Verify strict storage compliance: NO text or binary is saved in MongoDB
    assert.strictEqual(docRecord.fileBinary, undefined);
    assert.strictEqual(docRecord.extractedText, undefined);
    assert.strictEqual(docRecord.tokens, undefined);
    assert.strictEqual(docRecord.shingles, undefined);
  });

  test("3. Exact duplicates (matching SHA-256) are calculated as 1.0 (100%) Jaccard similarity", async () => {
    const textB = "Simple dummy text for database documents check."; // Exact duplicate of docA
    const hashB = hashingService.calculateContentHash(textB);
    
    const scanDir = path.join(uploadsRoot, scanId);
    const filePathB = path.join(scanDir, "test_doc_dup.txt");
    await fs.writeFile(filePathB, textB);

    docIdB = await documentService.createDocument({
      scanId,
      filename: "test_doc_dup.txt",
      fileType: ".txt",
      fileSize: Buffer.byteLength(textB),
      filePath: filePathB,
      sha256Hash: hashB,
      textLength: textB.length,
      tokenCount: 5
    });

    // Run similarity comparisons (this should trigger calculations, save, and clean up directory)
    await similarityService.runScanComparisons(scanId);

    const response = await resultService.getScanResults(scanId, { threshold: 0 });
    const results = response.results;

    assert.strictEqual(results.length, 1);
    
    // Exact duplicate score is 1.0 (expressed as 100.00% in returned results)
    assert.strictEqual(Number(results[0].similarity_percentage), 100.00);
  });

  test("4. Safe storage directory cleanup deletes scan upload folder upon terminal completion", async () => {
    const scanDir = path.join(uploadsRoot, scanId);
    
    try {
      await fs.access(scanDir);
      assert.fail("Upload scan directory should have been cleaned up and deleted.");
    } catch (error) {
      assert.strictEqual(error.code, "ENOENT");
    }
  });

  test("5. Active scanning directories are protected from cleanupService", async () => {
    const activeScanId = crypto.randomUUID();
    
    // 1. Create active scan metadata
    await documentService.createScan(activeScanId, 1, 0);
    await documentService.updateScan(activeScanId, { status: "processing" });

    // 2. Create directory and dummy file
    const activeScanDir = path.join(uploadsRoot, activeScanId);
    await fs.mkdir(activeScanDir, { recursive: true });
    await fs.writeFile(path.join(activeScanDir, "active_doc.txt"), "active file content");

    // 3. Attempt cleanup of files older than 0 hours to force processing
    process.env.TEMP_FILE_RETENTION_HOURS = "0";
    await cleanupService.cleanupOldTempFiles();

    // 4. Verify active scan directory STILL exists (protected)
    let exists = false;
    try {
      await fs.access(activeScanDir);
      exists = true;
    } catch (e) {
      exists = false;
    }

    assert.ok(exists, "Active scanning directories must be preserved during cleanup.");

    // Clean up active scan tests metadata and folder
    await db.collection("scans").deleteOne({ scanId: activeScanId });
    await fs.rm(activeScanDir, { recursive: true, force: true });
  });

  test("6. Results pagination limits work correctly", async () => {
    const testScanId = crypto.randomUUID();
    await documentService.createScan(testScanId, 3, 3);

    // Insert dummy results directly
    await db.collection("similarity_results").insertMany([
      { scanId: testScanId, documentAId: "1", documentBId: "2", fileName1: "a.txt", fileName2: "b.txt", similarityScore: 0.95, createdAt: new Date() },
      { scanId: testScanId, documentAId: "1", documentBId: "3", fileName1: "a.txt", fileName2: "c.txt", similarityScore: 0.85, createdAt: new Date() },
      { scanId: testScanId, documentAId: "2", documentBId: "3", fileName1: "b.txt", fileName2: "c.txt", similarityScore: 0.45, createdAt: new Date() }
    ]);

    // Paginate: Page 1, limit 2
    const response = await resultService.getScanResults(testScanId, {
      page: 1,
      limit: 2
    });

    assert.strictEqual(response.results.length, 2);
    assert.strictEqual(response.pagination.total_results, 3); 
    assert.strictEqual(response.pagination.has_next, true);

    // Clean up pagination test
    await db.collection("scans").deleteOne({ scanId: testScanId });
    await db.collection("similarity_results").deleteMany({ scanId: testScanId });
  });

  test.after(async () => {
    // Delete database test entries
    if (scanId) {
      await db.collection("scans").deleteOne({ scanId });
      await db.collection("documents").deleteMany({ scanId });
      await db.collection("similarity_results").deleteMany({ scanId });
      await db.collection("scan_results").deleteMany({ file_name_1: "test_doc.txt" });
    }
    await closeDatabase();
  });
});
