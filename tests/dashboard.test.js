const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const { connectToDatabase, getDb, closeDatabase } = require("../src/config/db");
const documentService = require("../src/services/documentService");
const resultService = require("../src/services/resultService");

test.describe("DocSim Comprehensive Dashboard & Aggregation Test Suite", () => {
  let db;

  test.before(async () => {
    db = await connectToDatabase();
  });

  test.after(async () => {
    await closeDatabase();
  });

  test("1. Internal Union-Find correctly connects transitive duplicates (A-B=100%, B-C=100% => {A, B, C})", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 3, 3);

    const docA = await documentService.createDocument({ scanId, filename: "doc_A.pdf", sha256Hash: "hA" });
    const docB = await documentService.createDocument({ scanId, filename: "doc_B.pdf", sha256Hash: "hB" });
    const docC = await documentService.createDocument({ scanId, filename: "doc_C.pdf", sha256Hash: "hC" });

    await db.collection("similarity_results").insertMany([
      { scanId, documentAId: docA.toString(), documentBId: docB.toString(), fileName1: "doc_A.pdf", fileName2: "doc_B.pdf", similarityScore: 1.0, createdAt: new Date() },
      { scanId, documentAId: docB.toString(), documentBId: docC.toString(), fileName1: "doc_B.pdf", fileName2: "doc_C.pdf", similarityScore: 1.0, createdAt: new Date() }
    ]);

    const dashboard = await resultService.getDashboardResults(scanId);

    assert.strictEqual(dashboard.summary.totalDocuments, 3);
    assert.strictEqual(dashboard.summary.duplicateFiles, 3);
    assert.strictEqual(dashboard.duplicates.count, 3);
    assert.strictEqual(dashboard.duplicates.files.length, 3);
  });

  test("2. UI/result payload exposes ONE flat duplicate collection (duplicates.files), no Group 1/2/3 labels", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 2, 1);

    const docA = await documentService.createDocument({ scanId, filename: "file_1.txt", sha256Hash: "same_hash" });
    const docB = await documentService.createDocument({ scanId, filename: "file_2.txt", sha256Hash: "same_hash" });

    const dashboard = await resultService.getDashboardResults(scanId);

    assert.ok(Array.isArray(dashboard.duplicates.files), "duplicates.files must be a flat array");
    assert.strictEqual(dashboard.duplicates.files.length, 2);
    // Ensure no groupName / groupId structure is exposed in flat files
    assert.strictEqual(dashboard.duplicates.files[0].groupName, undefined);
    assert.strictEqual(dashboard.duplicates.files[0].groupId, undefined);
  });

  test("3. Multiple duplicate pairs (A-B=100%, D-E=100%) all appear in the single flat duplicate collection", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 5, 10);

    const docA = await documentService.createDocument({ scanId, filename: "A.pdf", sha256Hash: "h1" });
    const docB = await documentService.createDocument({ scanId, filename: "B.pdf", sha256Hash: "h1" });
    const docC = await documentService.createDocument({ scanId, filename: "C.pdf", sha256Hash: "h3" });
    const docD = await documentService.createDocument({ scanId, filename: "D.pdf", sha256Hash: "h4" });
    const docE = await documentService.createDocument({ scanId, filename: "E.pdf", sha256Hash: "h5" });

    // D-E 100% via similarity_results
    await db.collection("similarity_results").insertOne({
      scanId,
      documentAId: docD.toString(),
      documentBId: docE.toString(),
      fileName1: "D.pdf",
      fileName2: "E.pdf",
      similarityScore: 1.0,
      createdAt: new Date()
    });

    const dashboard = await resultService.getDashboardResults(scanId);

    assert.strictEqual(dashboard.summary.duplicateFiles, 4);
    assert.strictEqual(dashboard.duplicates.files.length, 4);
    const filenames = dashboard.duplicates.files.map(f => f.filename).sort();
    assert.deepStrictEqual(filenames, ["A.pdf", "B.pdf", "D.pdf", "E.pdf"]);
  });

  test("4. SHA-256 match alone identifies duplicates without needing pairwise similarity records", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 2, 1);

    await documentService.createDocument({ scanId, filename: "doc1.txt", sha256Hash: "matching_sha256" });
    await documentService.createDocument({ scanId, filename: "doc2.txt", sha256Hash: "matching_sha256" });

    const dashboard = await resultService.getDashboardResults(scanId);

    assert.strictEqual(dashboard.duplicates.count, 2);
    assert.strictEqual(dashboard.duplicates.files.length, 2);
    assert.strictEqual(dashboard.fileSimilarities.documents[0].isDuplicate, true);
    assert.strictEqual(dashboard.fileSimilarities.documents[1].isDuplicate, true);
  });

  test("5. Average calculation: A-B=100%, A-C=80%, A-D=60% => A's non-duplicate average is (80+60)/2 = 70%", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 4, 6);

    const docA = await documentService.createDocument({ scanId, filename: "A.pdf", sha256Hash: "hA" });
    const docB = await documentService.createDocument({ scanId, filename: "B.pdf", sha256Hash: "hB" });
    const docC = await documentService.createDocument({ scanId, filename: "C.pdf", sha256Hash: "hC" });
    const docD = await documentService.createDocument({ scanId, filename: "D.pdf", sha256Hash: "hD" });

    await db.collection("similarity_results").insertMany([
      { scanId, documentAId: docA.toString(), documentBId: docB.toString(), fileName1: "A.pdf", fileName2: "B.pdf", similarityScore: 1.0, createdAt: new Date() },
      { scanId, documentAId: docA.toString(), documentBId: docC.toString(), fileName1: "A.pdf", fileName2: "C.pdf", similarityScore: 0.80, createdAt: new Date() },
      { scanId, documentAId: docA.toString(), documentBId: docD.toString(), fileName1: "A.pdf", fileName2: "D.pdf", similarityScore: 0.60, createdAt: new Date() },
      { scanId, documentAId: docB.toString(), documentBId: docC.toString(), fileName1: "B.pdf", fileName2: "C.pdf", similarityScore: 0.50, createdAt: new Date() }
    ]);

    const dashboard = await resultService.getDashboardResults(scanId);

    const recordA = dashboard.fileSimilarities.documents.find(d => d.filename === "A.pdf");
    assert.ok(recordA);
    assert.strictEqual(recordA.averageSimilarity, 70.00);
    assert.strictEqual(recordA.comparisonCount, 2);
    assert.strictEqual(recordA.isDuplicate, true);
  });

  test("6. 100% duplicate relationship is excluded from both A's and B's average similarity", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 3, 3);

    const docA = await documentService.createDocument({ scanId, filename: "A.pdf", sha256Hash: "hA" });
    const docB = await documentService.createDocument({ scanId, filename: "B.pdf", sha256Hash: "hB" });
    const docC = await documentService.createDocument({ scanId, filename: "C.pdf", sha256Hash: "hC" });

    await db.collection("similarity_results").insertMany([
      { scanId, documentAId: docA.toString(), documentBId: docB.toString(), fileName1: "A.pdf", fileName2: "B.pdf", similarityScore: 1.0, createdAt: new Date() },
      { scanId, documentAId: docA.toString(), documentBId: docC.toString(), fileName1: "A.pdf", fileName2: "C.pdf", similarityScore: 0.60, createdAt: new Date() },
      { scanId, documentAId: docB.toString(), documentBId: docC.toString(), fileName1: "B.pdf", fileName2: "C.pdf", similarityScore: 0.40, createdAt: new Date() }
    ]);

    const dashboard = await resultService.getDashboardResults(scanId);

    const recordA = dashboard.fileSimilarities.documents.find(d => d.filename === "A.pdf");
    const recordB = dashboard.fileSimilarities.documents.find(d => d.filename === "B.pdf");

    assert.strictEqual(recordA.averageSimilarity, 60.00);
    assert.strictEqual(recordA.comparisonCount, 1);
    assert.strictEqual(recordB.averageSimilarity, 40.00);
    assert.strictEqual(recordB.comparisonCount, 1);
  });

  test("7. Every uploaded document receives one document-level result (N uploaded files = N records in All File Similarity)", async () => {
    const scanId = crypto.randomUUID();
    const N = 6;
    await documentService.createScan(scanId, N, 15);

    for (let i = 1; i <= N; i++) {
      await documentService.createDocument({ scanId, filename: `file_${i}.txt`, sha256Hash: `hash_${i}` });
    }

    const dashboard = await resultService.getDashboardResults(scanId, { limit: 100 });

    assert.strictEqual(dashboard.summary.totalDocuments, N);
    assert.strictEqual(dashboard.fileSimilarities.pagination.total_documents, N);
    assert.strictEqual(dashboard.fileSimilarities.documents.length, N);
  });

  test("8. Document with only 100% duplicate relationships gets averageSimilarity: null, classification: 'No Data'", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 2, 1);

    const docA = await documentService.createDocument({ scanId, filename: "docA.txt", sha256Hash: "h" });
    const docB = await documentService.createDocument({ scanId, filename: "docB.txt", sha256Hash: "h" });

    const dashboard = await resultService.getDashboardResults(scanId);

    const recordA = dashboard.fileSimilarities.documents.find(d => d.filename === "docA.txt");
    assert.ok(recordA);
    assert.strictEqual(recordA.averageSimilarity, null);
    assert.strictEqual(recordA.maxSimilarity, null);
    assert.strictEqual(recordA.comparisonCount, 0);
    assert.strictEqual(recordA.classification, "No Data");
    assert.strictEqual(recordA.isDuplicate, true);
    assert.strictEqual(recordA.duplicateTag, "Exact Duplicate");
  });

  test("9. Duplicate documents have isDuplicate: true and duplicateTag: 'Exact Duplicate'", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 2, 1);

    await documentService.createDocument({ scanId, filename: "d1.pdf", sha256Hash: "same" });
    await documentService.createDocument({ scanId, filename: "d2.pdf", sha256Hash: "same" });

    const dashboard = await resultService.getDashboardResults(scanId);

    dashboard.fileSimilarities.documents.forEach(doc => {
      assert.strictEqual(doc.isDuplicate, true);
      assert.strictEqual(doc.duplicateTag, "Exact Duplicate");
    });
  });

  test("10. Non-duplicate documents have isDuplicate: false and duplicateTag: null", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 2, 1);

    const docA = await documentService.createDocument({ scanId, filename: "unique1.pdf", sha256Hash: "u1" });
    const docB = await documentService.createDocument({ scanId, filename: "unique2.pdf", sha256Hash: "u2" });

    await db.collection("similarity_results").insertOne({
      scanId,
      documentAId: docA.toString(),
      documentBId: docB.toString(),
      fileName1: "unique1.pdf",
      fileName2: "unique2.pdf",
      similarityScore: 0.45,
      createdAt: new Date()
    });

    const dashboard = await resultService.getDashboardResults(scanId);

    dashboard.fileSimilarities.documents.forEach(doc => {
      assert.strictEqual(doc.isDuplicate, false);
      assert.strictEqual(doc.duplicateTag, null);
    });
  });

  test("11. Document pagination operates on all N documents", async () => {
    const scanId = crypto.randomUUID();
    const N = 10;
    await documentService.createScan(scanId, N, 45);

    for (let i = 1; i <= N; i++) {
      await documentService.createDocument({ scanId, filename: `page_doc_${i.toString().padStart(2, '0')}.txt`, sha256Hash: `h_${i}` });
    }

    const page1 = await resultService.getDashboardResults(scanId, { page: 1, limit: 4 });
    assert.strictEqual(page1.fileSimilarities.pagination.total_documents, 10);
    assert.strictEqual(page1.fileSimilarities.pagination.total_pages, 3);
    assert.strictEqual(page1.fileSimilarities.pagination.current_page, 1);
    assert.strictEqual(page1.fileSimilarities.documents.length, 4);

    const page2 = await resultService.getDashboardResults(scanId, { page: 2, limit: 4 });
    assert.strictEqual(page2.fileSimilarities.pagination.current_page, 2);
    assert.strictEqual(page2.fileSimilarities.documents.length, 4);

    const page3 = await resultService.getDashboardResults(scanId, { page: 3, limit: 4 });
    assert.strictEqual(page3.fileSimilarities.pagination.current_page, 3);
    assert.strictEqual(page3.fileSimilarities.documents.length, 2);
  });

  test("12. Search filter works across all documents", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 4, 6);

    await documentService.createDocument({ scanId, filename: "report_financial_2024.pdf", sha256Hash: "h1" });
    await documentService.createDocument({ scanId, filename: "report_medical_2024.pdf", sha256Hash: "h2" });
    await documentService.createDocument({ scanId, filename: "thesis_final.docx", sha256Hash: "h3" });
    await documentService.createDocument({ scanId, filename: "dataset_sample.txt", sha256Hash: "h4" });

    const searchResults = await resultService.getDashboardResults(scanId, { search: "report" });
    assert.strictEqual(searchResults.fileSimilarities.pagination.total_documents, 2);
    assert.strictEqual(searchResults.fileSimilarities.documents.length, 2);
    assert.ok(searchResults.fileSimilarities.documents.every(d => d.filename.includes("report")));
  });

  test("13. Sorting works properly (avg_desc, avg_asc, name_asc, name_desc)", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 3, 3);

    const docA = await documentService.createDocument({ scanId, filename: "alpha.pdf", sha256Hash: "ha" });
    const docB = await documentService.createDocument({ scanId, filename: "beta.pdf", sha256Hash: "hb" });
    const docC = await documentService.createDocument({ scanId, filename: "gamma.pdf", sha256Hash: "hc" });

    await db.collection("similarity_results").insertMany([
      { scanId, documentAId: docA.toString(), documentBId: docB.toString(), fileName1: "alpha.pdf", fileName2: "beta.pdf", similarityScore: 0.90, createdAt: new Date() },
      { scanId, documentAId: docA.toString(), documentBId: docC.toString(), fileName1: "alpha.pdf", fileName2: "gamma.pdf", similarityScore: 0.70, createdAt: new Date() },
      { scanId, documentAId: docB.toString(), documentBId: docC.toString(), fileName1: "beta.pdf", fileName2: "gamma.pdf", similarityScore: 0.30, createdAt: new Date() }
    ]);

    // alpha avg: (90 + 70)/2 = 80%
    // beta avg: (90 + 30)/2 = 60%
    // gamma avg: (70 + 30)/2 = 50%

    const sortDesc = await resultService.getDashboardResults(scanId, { sort: "avg_desc" });
    assert.strictEqual(sortDesc.fileSimilarities.documents[0].filename, "alpha.pdf");
    assert.strictEqual(sortDesc.fileSimilarities.documents[2].filename, "gamma.pdf");

    const sortAsc = await resultService.getDashboardResults(scanId, { sort: "avg_asc" });
    assert.strictEqual(sortAsc.fileSimilarities.documents[0].filename, "gamma.pdf");
    assert.strictEqual(sortAsc.fileSimilarities.documents[2].filename, "alpha.pdf");

    const sortNameAsc = await resultService.getDashboardResults(scanId, { sort: "name_asc" });
    assert.strictEqual(sortNameAsc.fileSimilarities.documents[0].filename, "alpha.pdf");
    assert.strictEqual(sortNameAsc.fileSimilarities.documents[2].filename, "gamma.pdf");

    const sortNameDesc = await resultService.getDashboardResults(scanId, { sort: "name_desc" });
    assert.strictEqual(sortNameDesc.fileSimilarities.documents[0].filename, "gamma.pdf");
    assert.strictEqual(sortNameDesc.fileSimilarities.documents[2].filename, "alpha.pdf");
  });

  test("14. Report endpoint returns identical aggregated values as the dashboard (Single Source of Truth)", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 3, 3);

    const docA = await documentService.createDocument({ scanId, filename: "A.pdf", sha256Hash: "h1" });
    const docB = await documentService.createDocument({ scanId, filename: "B.pdf", sha256Hash: "h1" });
    const docC = await documentService.createDocument({ scanId, filename: "C.pdf", sha256Hash: "h2" });

    await db.collection("similarity_results").insertOne({
      scanId,
      documentAId: docA.toString(),
      documentBId: docC.toString(),
      fileName1: "A.pdf",
      fileName2: "C.pdf",
      similarityScore: 0.75,
      createdAt: new Date()
    });

    const dashboard = await resultService.getDashboardResults(scanId);
    const report = await resultService.getScanReport(scanId);

    assert.strictEqual(dashboard.summary.totalDocuments, report.summary.documentsAnalyzed);
    assert.strictEqual(dashboard.summary.duplicateFiles, report.summary.duplicateFilesCount);
    assert.strictEqual(dashboard.duplicates.files.length, report.duplicateFiles.length);
  });

  test("15. Report contains all uploaded documents", async () => {
    const scanId = crypto.randomUUID();
    const N = 5;
    await documentService.createScan(scanId, N, 10);

    for (let i = 1; i <= N; i++) {
      await documentService.createDocument({ scanId, filename: `rep_doc_${i}.txt`, sha256Hash: `hash_${i}` });
    }

    const report = await resultService.getScanReport(scanId);

    assert.strictEqual(report.allFiles.length, N);
  });

  test("16. Report contains all exact duplicate files", async () => {
    const scanId = crypto.randomUUID();
    await documentService.createScan(scanId, 4, 6);

    await documentService.createDocument({ scanId, filename: "dup_1.pdf", sha256Hash: "dup_hash_common" });
    await documentService.createDocument({ scanId, filename: "dup_2.pdf", sha256Hash: "dup_hash_common" });
    await documentService.createDocument({ scanId, filename: "dup_3.pdf", sha256Hash: "dup_hash_common" });
    await documentService.createDocument({ scanId, filename: "unique_1.pdf", sha256Hash: "unique_hash" });

    const report = await resultService.getScanReport(scanId);

    assert.strictEqual(report.duplicateFiles.length, 3);
    const filenames = report.duplicateFiles.map(f => f.filename).sort();
    assert.deepStrictEqual(filenames, ["dup_1.pdf", "dup_2.pdf", "dup_3.pdf"]);
  });
});
