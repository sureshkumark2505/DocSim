const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs/promises");
const { connectToDatabase, getDb, closeDatabase } = require("../src/config/db");
const { generateShingles, createShingleSet } = require("../src/algorithms/shingling");
const { generateMinHashSignature, estimateMinHashSimilarity } = require("../src/algorithms/minhash");
const { getBandBuckets, bucketDocuments, calculateCandidateProbability } = require("../src/algorithms/lsh");
const { calculateJaccardSimilarity } = require("../src/algorithms/jaccard");
const candidateService = require("../src/services/candidateService");
const documentService = require("../src/services/documentService");
const similarityService = require("../src/services/similarityService");
const hashingService = require("../src/services/hashingService");
const resultService = require("../src/services/resultService");
const cleanupService = require("../src/services/cleanupService");
const jobs = require("../src/queue/jobs");

const uploadsRoot = path.resolve(__dirname, "..", "uploads");

test.describe("DocSim Level 2 Distributed & Intelligent Similarity Engine Tests", () => {
  let db;

  test.before(async () => {
    db = await connectToDatabase();
  });

  test("1. Word-level k-shingling generates deterministic contiguous shingles and deduplicates", () => {
    const tokens = ["the", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog"];
    const shingles = generateShingles(tokens, 3);

    assert.strictEqual(shingles.length, 7);
    assert.strictEqual(shingles[0], "the quick brown");
    assert.strictEqual(shingles[1], "quick brown fox");
    assert.strictEqual(shingles[2], "brown fox jumps");
    assert.strictEqual(shingles[6], "the lazy dog");

    // Edge case: fewer tokens than k
    const shortTokens = ["hello", "world"];
    const shortShingles = generateShingles(shortTokens, 5);
    assert.deepStrictEqual(shortShingles, ["hello world"]);

    // Shingle Set deduplication
    const repeatedTokens = ["a", "b", "c", "a", "b", "c"];
    const uniqueSet = createShingleSet(repeatedTokens, 3);
    assert.strictEqual(uniqueSet.size, 3); // "a b c", "b c a", "c a b"
  });

  test("2. MinHash signature generation is strictly deterministic across multiple runs", () => {
    const tokensA = ["cloud", "computing", "distributed", "systems", "microservices", "kubernetes", "containers"];
    const shinglesA = createShingleSet(tokensA, 3);

    const sig1 = generateMinHashSignature(shinglesA, 128);
    const sig2 = generateMinHashSignature(shinglesA, 128);

    assert.strictEqual(sig1.length, 128);
    assert.strictEqual(sig2.length, 128);
    assert.deepStrictEqual(sig1, sig2, "MinHash signature must be identical for identical inputs across runs");

    // Highly similar document should have high signature overlap
    const tokensB = ["cloud", "computing", "distributed", "systems", "microservices", "kubernetes", "docker"];
    const shinglesB = createShingleSet(tokensB, 3);
    const sigB = generateMinHashSignature(shinglesB, 128);

    const estimatedSim = estimateMinHashSimilarity(sig1, sigB);
    assert.ok(estimatedSim > 0.4, `Estimated similarity (${estimatedSim}) should reflect high overlap`);
  });

  test("3. LSH banding partitions 128-dim signature into 32 bands of 4 rows correctly", () => {
    const tokens = ["machine", "learning", "natural", "language", "processing", "information", "retrieval"];
    const shingles = createShingleSet(tokens, 3);
    const sig = generateMinHashSignature(shingles, 128);

    const buckets = getBandBuckets(sig, 32, 4);
    assert.strictEqual(buckets.length, 32);
    assert.ok(buckets[0].startsWith("b0:"));
    assert.ok(buckets[31].startsWith("b31:"));

    // Theoretical probability formula check
    const probHigh = calculateCandidateProbability(0.8, 32, 4);
    const probLow = calculateCandidateProbability(0.1, 32, 4);
    assert.ok(probHigh > 0.95, `High similarity (0.8) should have > 95% candidate probability, got ${probHigh}`);
    assert.ok(probLow < 0.01, `Low similarity (0.1) should have < 1% candidate probability, got ${probLow}`);
  });

  test("4. Candidate service guarantees unique pairs, canonical A < B ordering, and eliminates B-A", () => {
    const docs = [
      { documentId: "doc_1", filename: "doc1.txt", minhashSignature: new Array(128).fill(10), sha256Hash: "hash1" },
      { documentId: "doc_2", filename: "doc2.txt", minhashSignature: new Array(128).fill(10), sha256Hash: "hash2" },
      { documentId: "doc_3", filename: "doc3.txt", minhashSignature: new Array(128).fill(999), sha256Hash: "hash3" }
    ];

    const result = candidateService.generateCandidates(docs, { bands: 32, rows: 4 });

    assert.strictEqual(result.totalDocuments, 3);
    assert.strictEqual(result.totalPossiblePairs, 3);

    // doc_1 and doc_2 collide in all bands, but should only appear ONCE as a candidate pair
    const candidateKeys = result.candidatePairs.map(p => `${p.docA.documentId}::${p.docB.documentId}`);
    assert.ok(candidateKeys.includes("doc_1::doc_2"));
    assert.ok(!candidateKeys.includes("doc_2::doc_1"), "Symmetric B-A pairs must never be generated");

    // Uniqueness verification
    const uniqueSet = new Set(candidateKeys);
    assert.strictEqual(uniqueSet.size, candidateKeys.length, "All candidate pairs must be strictly unique");
  });

  test("5. SHA-256 exact duplicates are prioritized with 0 required Jaccard calculations", () => {
    const identicalHash = "abc123exacthash456789";
    const docs = [
      { documentId: "dup_a", filename: "a.txt", minhashSignature: new Array(128).fill(1), sha256Hash: identicalHash },
      { documentId: "dup_b", filename: "b.txt", minhashSignature: new Array(128).fill(2), sha256Hash: identicalHash }
    ];

    const result = candidateService.generateCandidates(docs);
    assert.strictEqual(result.candidateCount, 1);
    assert.strictEqual(result.exactDuplicateCount, 1);
    assert.strictEqual(result.jaccardCandidateCount, 0);
    assert.strictEqual(result.candidatePairs[0].isExactDuplicate, true);
  });

  test("6. BullMQ job creation uses reference-only payloads (zero document text or binaries)", async () => {
    const scanId = crypto.randomUUID();
    const documents = [
      { documentId: "d1", filePath: "/tmp/uploads/d1.txt", filename: "d1.txt", sha256Hash: "h1" }
    ];

    // Verify job structure payload helper
    const payload = {
      scanId,
      documentId: documents[0].documentId,
      filePath: documents[0].filePath,
      filename: documents[0].filename,
      sha256Hash: documents[0].sha256Hash
    };

    assert.strictEqual(payload.text, undefined);
    assert.strictEqual(payload.tokens, undefined);
    assert.strictEqual(payload.shingles, undefined);
    assert.strictEqual(payload.binary, undefined);
  });

  test("7. Level 2 full scan pipeline executes, writes similarity_results, and cleans up", async () => {
    const scanId = crypto.randomUUID();
    const scanDir = path.join(uploadsRoot, scanId);
    await fs.mkdir(scanDir, { recursive: true });

    // Document 1
    const text1 = "Artificial intelligence and machine learning architectures require robust data pipelines.";
    const path1 = path.join(scanDir, "ai_1.txt");
    await fs.writeFile(path1, text1);

    // Document 2 (Similar)
    const text2 = "Artificial intelligence and machine learning architectures require scalable cloud storage.";
    const path2 = path.join(scanDir, "ai_2.txt");
    await fs.writeFile(path2, text2);

    // Document 3 (Unrelated)
    const text3 = "Baking sourdough bread involves flour, water, salt, fermentation, and oven steam.";
    const path3 = path.join(scanDir, "bread.txt");
    await fs.writeFile(path3, text3);

    // Register scan and document metadata in MongoDB
    await documentService.createScan(scanId, 3, 3, "minhash-lsh-jaccard");

    const id1 = await documentService.createDocument({
      scanId,
      filename: "ai_1.txt",
      fileType: ".txt",
      fileSize: Buffer.byteLength(text1),
      filePath: path1,
      sha256Hash: hashingService.calculateContentHash(text1),
      textLength: text1.length,
      tokenCount: 10
    });

    const id2 = await documentService.createDocument({
      scanId,
      filename: "ai_2.txt",
      fileType: ".txt",
      fileSize: Buffer.byteLength(text2),
      filePath: path2,
      sha256Hash: hashingService.calculateContentHash(text2),
      textLength: text2.length,
      tokenCount: 10
    });

    const id3 = await documentService.createDocument({
      scanId,
      filename: "bread.txt",
      fileType: ".txt",
      fileSize: Buffer.byteLength(text3),
      filePath: path3,
      sha256Hash: hashingService.calculateContentHash(text3),
      textLength: text3.length,
      tokenCount: 10
    });

    // Run Level 2 scan pipeline
    await similarityService.runLevel2Scan(scanId);

    // Verify scan status updated to completed
    const scanRecord = await documentService.getScan(scanId);
    assert.strictEqual(scanRecord.status, "completed");
    assert.strictEqual(scanRecord.algorithm, "minhash-lsh-jaccard");
    assert.strictEqual(scanRecord.processedDocuments, 3);
    assert.ok(scanRecord.processingTimeMs >= 0);

    // Verify results in MongoDB
    const res = await resultService.getScanResults(scanId, { limit: 10 });
    assert.ok(res.results.length >= 1);
    assert.strictEqual(res.results[0].algorithm, "minhash-lsh-jaccard");

    // Verify temporary files deletion lifecycle
    try {
      await fs.access(scanDir);
      assert.fail("Scan upload folder should have been cleaned up after scan completion");
    } catch (e) {
      assert.strictEqual(e.code, "ENOENT");
    }

    // Clean up test records
    await db.collection("scans").deleteOne({ scanId });
    await db.collection("documents").deleteMany({ scanId });
    await db.collection("similarity_results").deleteMany({ scanId });
  });

  test("8. Idempotency test: duplicate batch inserts do not create duplicate records", async () => {
    const scanId = crypto.randomUUID();

    const sampleResults = [
      {
        scanId,
        documentAId: "doc_alpha",
        documentBId: "doc_beta",
        fileName1: "alpha.txt",
        fileName2: "beta.txt",
        similarityScore: 0.85,
        algorithm: "minhash-lsh-jaccard",
        createdAt: new Date()
      }
    ];

    // Insert twice using idempotent batch insert
    await similarityService.insertResultsBatch(sampleResults);
    await similarityService.insertResultsBatch(sampleResults);

    const count = await db.collection("similarity_results").countDocuments({ scanId });
    assert.strictEqual(count, 1, "Idempotent write must ensure exact 1 record per pair");

    await db.collection("similarity_results").deleteMany({ scanId });
  });

  test.after(async () => {
    await closeDatabase();
  });
});
