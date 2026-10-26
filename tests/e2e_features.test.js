const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs/promises");
const { connectToDatabase, getDb, closeDatabase } = require("../src/config/db");
const documentService = require("../src/services/documentService");
const hashingService = require("../src/services/hashingService");
const similarityService = require("../src/services/similarityService");
const resultService = require("../src/services/resultService");
const pdfReportService = require("../src/services/pdfReportService");

const uploadsRoot = path.resolve(__dirname, "..", "uploads");

test.describe("DocSim End-to-End Synthetic Integration Verification (Phase 6)", () => {
  let db;

  test.before(async () => {
    db = await connectToDatabase();
  });

  test.after(async () => {
    await closeDatabase();
  });

  test("Complete E2E workflow: upload synthetic docs -> compare -> passages -> ranking -> PDF -> verified file deletion", async () => {
    // 1. Initialize Scan
    const scanId = crypto.randomUUID();
    const scanDir = path.join(uploadsRoot, scanId);
    await fs.mkdir(scanDir, { recursive: true });

    // 2. Synthetic Documents with known overlap
    const textAlpha = "Neural network architectures model complex relationships in multidimensional datasets. Deep learning has accelerated breakthroughs in computational biology and natural language processing. Transformers leverage self-attention mechanisms to dynamically weight contextual importance across entire sequence inputs. The weather in spring is mild, breezy, and pleasant for outdoor walking.";
    const textBeta = "Neural network architectures model complex relationships in multidimensional datasets. Deep learning has accelerated breakthroughs in computational biology and natural language processing. Transformers leverage self-attention mechanisms to dynamically weight contextual importance across entire sequence inputs. Traditional sourdough baking techniques require consistent oven heat and high moisture.";
    const textGamma = "Culinary fermentation relies on precise control of ambient temperature, moisture, and beneficial microbial strains. Sourdough starters require wild yeast culture and lactobacillus to develop acidity. Pure sourdough bread has a distinctive tangy flavor profile.";

    const fileAlpha = path.join(scanDir, "doc_alpha.txt");
    const fileBeta = path.join(scanDir, "doc_beta.txt");
    const fileGamma = path.join(scanDir, "doc_gamma.txt");

    await fs.writeFile(fileAlpha, textAlpha);
    await fs.writeFile(fileBeta, textBeta);
    await fs.writeFile(fileGamma, textGamma);

    const hashAlpha = await hashingService.calculateFileHash(fileAlpha);
    const hashBeta = await hashingService.calculateFileHash(fileBeta);
    const hashGamma = await hashingService.calculateFileHash(fileGamma);

    await documentService.createScan(scanId, 3, 3, "minhash-lsh-jaccard");

    const docA = await documentService.createDocument({
      scanId,
      filename: "doc_alpha.txt",
      fileType: ".txt",
      fileSize: Buffer.byteLength(textAlpha),
      filePath: fileAlpha,
      sha256Hash: hashAlpha,
      textLength: textAlpha.length,
      tokenCount: 28
    });

    const docB = await documentService.createDocument({
      scanId,
      filename: "doc_beta.txt",
      fileType: ".txt",
      fileSize: Buffer.byteLength(textBeta),
      filePath: fileBeta,
      sha256Hash: hashBeta,
      textLength: textBeta.length,
      tokenCount: 29
    });

    const docC = await documentService.createDocument({
      scanId,
      filename: "doc_gamma.txt",
      fileType: ".txt",
      fileSize: Buffer.byteLength(textGamma),
      filePath: fileGamma,
      sha256Hash: hashGamma,
      textLength: textGamma.length,
      tokenCount: 24
    });

    // 3. Process the Scan
    await similarityService.runScanComparisons(scanId);

    // 4. Verify Physical File Deletion from Disk
    let dirExists = true;
    try {
      await fs.access(scanDir);
    } catch {
      dirExists = false;
    }
    assert.strictEqual(dirExists, false, "Physical upload directory MUST be deleted from disk");

    // 5. Verify Database Cleanup and Privacy State
    const scan = await documentService.getScan(scanId);
    assert.strictEqual(scan.status, "completed");
    assert.strictEqual(scan.filesDeleted, true, "filesDeleted in MongoDB must be true");
    assert.strictEqual(scan.cleanupStatus, "deleted", "cleanupStatus in MongoDB must be 'deleted'");
    assert.ok(scan.cleanedUpAt, "cleanedUpAt timestamp must be recorded");

    // 6. Verify Ranked Pairs (Feature 2)
    const rankedData = await resultService.getRankedPairs(scanId, { sort: "similarity_desc" });
    assert.strictEqual(rankedData.success, true);
    assert.strictEqual(rankedData.pagination.total_pairs, 3, "Should have 3 pairwise comparisons for 3 docs");

    // Top match must be doc_alpha vs doc_beta
    const topPair = rankedData.rankedPairs[0];
    const topNames = [topPair.fileName1, topPair.fileName2];
    assert.ok(topNames.includes("doc_alpha.txt") && topNames.includes("doc_beta.txt"), "Top match must be Alpha vs Beta");
    assert.ok(topPair.similarityPercentage > 40, `Alpha vs Beta similarity must be > 40%, got ${topPair.similarityPercentage}%`);
    assert.strictEqual(topPair.rank, 1);

    // Unrelated matches with Gamma must have lower similarity
    const secondPair = rankedData.rankedPairs[1];
    const thirdPair = rankedData.rankedPairs[2];
    assert.ok(secondPair.similarityPercentage < topPair.similarityPercentage);
    assert.ok(thirdPair.similarityPercentage < topPair.similarityPercentage);

    // 7. Verify Matching Passage Highlighting (Feature 1)
    const passages = await resultService.getPairPassages(scanId, docA.toString(), docB.toString());
    assert.strictEqual(passages.success, true);
    assert.ok(passages.totalMatchingPassages >= 1, "Must extract overlapping passage between Alpha and Beta");
    assert.ok(passages.passages[0].similarity >= 50, "Passage similarity must be >= 50%");
    assert.ok(passages.passages[0].highlightedA.includes("<mark class=\"passage-highlight\">"), "Highlight tag must be present");
    assert.ok(passages.passages[0].highlightedB.includes("<mark class=\"passage-highlight\">"), "Highlight tag must be present");

    // 8. Verify Downloadable PDF Report (Feature 3)
    const pdfDoc = await pdfReportService.generateReportPdf(scanId);
    const chunks = [];
    const pdfBuffer = await new Promise((resolve, reject) => {
      pdfDoc.on("data", chunk => chunks.push(chunk));
      pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
      pdfDoc.on("error", reject);
      pdfDoc.end();
    });

    assert.ok(pdfBuffer.length > 1000, `PDF size must be substantial, got ${pdfBuffer.length} bytes`);
    assert.strictEqual(pdfBuffer.subarray(0, 5).toString(), "%PDF-", "Valid PDF header");

    // 9. Verify Report Data Consistency
    const reportData = await resultService.getScanReport(scanId);
    assert.strictEqual(reportData.privacyAudit.filesDeleted, true);
    assert.strictEqual(reportData.privacyAudit.cleanupStatus, "deleted");
    assert.strictEqual(reportData.summary.documentsAnalyzed, 3);
    assert.strictEqual(reportData.rankedMatches.length, 3);
    assert.strictEqual(reportData.allFiles.length, 3);
  });
});
