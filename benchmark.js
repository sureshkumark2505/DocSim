const crypto = require("crypto");
const { connectToDatabase, closeDatabase, getDb } = require("./src/config/db");
const documentService = require("./src/services/documentService");
const preprocessingService = require("./src/services/preprocessingService");
const hashingService = require("./src/services/hashingService");
const similarityService = require("./src/services/similarityService");
const { generateShingles, createShingleSet } = require("./src/algorithms/shingling");
const { generateMinHashSignature } = require("./src/algorithms/minhash");
const { calculateJaccardSimilarity } = require("./src/algorithms/jaccard");
const candidateService = require("./src/services/candidateService");

/**
 * Deterministic synthetic document generator with controllable similarity profiles:
 * - Identical documents (exact duplicates)
 * - Near duplicates (80-95% similarity)
 * - Moderately similar documents (40-60% similarity)
 * - Unrelated documents (0-15% similarity)
 */
function generateSyntheticDocuments(count) {
  const topicVocabulary = {
    distributed: [
      "distributed systems rely on message queues worker threads horizontal scaling and eventual consistency",
      "microservices architecture coordinates async jobs through redis bullmq background workers and event buses",
      "cluster computing balances workload across compute nodes using partitions replication and fault tolerance"
    ],
    database: [
      "relational database engines optimize query execution plans using b tree indexes and foreign key constraints",
      "nosql document stores provide high write throughput flexible json schemas and replica sets",
      "transaction isolation levels prevent dirty reads non repeatable reads and phantom rows in concurrent workloads"
    ],
    frontend: [
      "modern web interfaces render dynamic component trees with virtual dom diffing and reactive state hooks",
      "responsive css design leverages flexbox css grid media queries and smooth micro animations",
      "client side routing handles single page application navigation with browser history pushstate"
    ],
    security: [
      "cryptographic hashing algorithms like sha256 produce deterministic fixed length digital fingerprints",
      "public key cryptography secures communications via asymmetric key pairs digital certificates and tls handshake",
      "authentication protocols use json web tokens oauth2 authorization flows and salted password hashes"
    ],
    science: [
      "bioinformatics algorithms analyze nucleotide sequences protein tertiary structures and genetic variants",
      "quantum mechanics describes particle wave duality superposition states and probabilistic wavefunctions",
      "astrophysical models simulate stellar nucleosynthesis gravitational waves and galactic cluster dynamics"
    ]
  };

  const topics = Object.keys(topicVocabulary);
  const docs = [];

  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length];
    const baseSentences = topicVocabulary[topic];
    const baseIndex = i % baseSentences.length;
    let text = "";
    let category = "unrelated";

    if (i > 0 && i % 10 === 0) {
      // 10% Exact Duplicates (identical to previous doc)
      text = docs[i - 1].text;
      category = "exact_duplicate";
    } else if (i > 1 && i % 5 === 0) {
      // 20% Near Duplicates (slight alteration of a prior doc in same topic)
      const parent = docs[i - 2].text;
      text = `${parent} altered variation parameter step ${i}.`;
      category = "near_duplicate";
    } else if (i > 2 && i % 3 === 0) {
      // Moderately Similar (combines topic sentences with small salt)
      text = `${baseSentences[baseIndex]} furthermore ${baseSentences[(baseIndex + 1) % baseSentences.length]} index ${i}.`;
      category = "moderately_similar";
    } else {
      // Distinct / Unrelated
      text = `${baseSentences[baseIndex]} unique specific content domain token sequence id_${i}_${(i * 31) % 997}.`;
      category = "distinct";
    }

    docs.push({
      documentId: `doc_${i}`,
      filename: `synthetic_${category}_${i}.txt`,
      text,
      size: Buffer.byteLength(text),
      category
    });
  }

  return docs;
}

/**
 * Runs comparative benchmark for a given document count N:
 * Compares Level 1 (All-Pairs Exact Jaccard) vs Level 2 (MinHash + LSH + Exact Jaccard).
 * Measures candidate reduction, exact comparisons reduction, execution times, memory, and recall/false negatives.
 */
async function runComparativeBenchmark(count) {
  console.log(`\n======================================================================`);
  console.log(`BENCHMARK FOR N = ${count} SYNTHETIC DOCUMENTS (LEVEL 1 vs LEVEL 2)`);
  console.log(`======================================================================`);

  const db = getDb();
  const scanIdL1 = `bm_l1_${count}_${Date.now()}`;
  const scanIdL2 = `bm_l2_${count}_${Date.now()}`;

  const docs = generateSyntheticDocuments(count);
  const totalPossiblePairs = (count * (count - 1)) / 2;

  // -------------------------------------------------------------------------
  // LEVEL 1: All-Pairs Exact Jaccard Baseline
  // -------------------------------------------------------------------------
  console.log("\n[LEVEL 1] Running All-Pairs Exact Jaccard Baseline...");
  const startL1 = performance.now();

  // 1. Level 1 Preprocessing & SHA-256 Hashing
  const l1Docs = [];
  const l1ShingleMap = new Map();

  for (const doc of docs) {
    const hash = hashingService.calculateContentHash(doc.text);
    const tokens = preprocessingService.tokenize(doc.text);
    const shingleSet = createShingleSet(tokens, 5);
    l1ShingleMap.set(doc.documentId, shingleSet);

    l1Docs.push({
      documentId: doc.documentId,
      filename: doc.filename,
      sha256Hash: hash
    });
  }

  // 2. Level 1 All-Pairs Comparison Loop
  let l1ExactComparisons = 0;
  let l1ExactDuplicates = 0;
  const l1Results = [];
  const l1HighSimilarityPairs = new Map(); // key -> score (for recall validation)

  for (let i = 0; i < count; i++) {
    const docA = l1Docs[i];
    const setA = l1ShingleMap.get(docA.documentId);

    for (let j = i + 1; j < count; j++) {
      const docB = l1Docs[j];
      const setB = l1ShingleMap.get(docB.documentId);
      const pairKey = `${docA.documentId}::${docB.documentId}`;

      let similarityScore = 0.0;
      if (docA.sha256Hash === docB.sha256Hash) {
        similarityScore = 1.0;
        l1ExactDuplicates++;
      } else {
        similarityScore = calculateJaccardSimilarity(setA, setB);
        l1ExactComparisons++;
      }

      if (similarityScore >= 0.50) {
        l1HighSimilarityPairs.set(pairKey, similarityScore);
      }

      l1Results.push({
        scanId: scanIdL1,
        documentAId: docA.documentId,
        documentBId: docB.documentId,
        similarityScore,
        algorithm: "jaccard"
      });
    }
  }

  // Level 1 Batch DB Insert
  const startL1Db = performance.now();
  if (l1Results.length > 0) {
    for (let i = 0; i < l1Results.length; i += 1000) {
      await db.collection("similarity_results").insertMany(l1Results.slice(i, i + 1000));
    }
  }
  const l1DbTime = performance.now() - startL1Db;
  const endL1 = performance.now();
  const totalL1Time = endL1 - startL1;
  const l1MemoryMB = process.memoryUsage().heapUsed / 1024 / 1024;

  // Clean up L1 results
  await db.collection("similarity_results").deleteMany({ scanId: scanIdL1 });

  // -------------------------------------------------------------------------
  // LEVEL 2: MinHash + LSH + Exact Jaccard
  // -------------------------------------------------------------------------
  console.log("[LEVEL 2] Running MinHash + LSH Candidate Filtering + Exact Jaccard...");
  const startL2 = performance.now();

  // 1. Feature Extraction: Tokenize, k-Shingling (k=5), MinHash Signature (128 perms)
  const l2Docs = [];
  const l2ShingleMap = new Map();

  for (const doc of docs) {
    const hash = hashingService.calculateContentHash(doc.text);
    const tokens = preprocessingService.tokenize(doc.text);
    const shingleSet = createShingleSet(tokens, 5);
    const minhashSignature = generateMinHashSignature(shingleSet, 128);

    l2ShingleMap.set(doc.documentId, shingleSet);

    l2Docs.push({
      documentId: doc.documentId,
      filename: doc.filename,
      sha256Hash: hash,
      minhashSignature
    });
  }

  // 2. Candidate Generation using LSH (32 bands x 4 rows)
  const candidateResult = candidateService.generateCandidates(l2Docs, { bands: 32, rows: 4 });

  // 3. Exact Jaccard Verification on Candidate Pairs only
  let l2ExactComparisons = 0;
  let l2ExactDuplicates = 0;
  const l2Results = [];
  const l2FoundPairs = new Map();

  for (const candidate of candidateResult.candidatePairs) {
    const pairKey = `${candidate.docA.documentId}::${candidate.docB.documentId}`;
    let similarityScore = 0.0;

    if (candidate.isExactDuplicate) {
      similarityScore = 1.0;
      l2ExactDuplicates++;
    } else {
      const setA = l2ShingleMap.get(candidate.docA.documentId);
      const setB = l2ShingleMap.get(candidate.docB.documentId);
      similarityScore = calculateJaccardSimilarity(setA, setB);
      l2ExactComparisons++;
    }

    if (similarityScore >= 0.50) {
      l2FoundPairs.set(pairKey, similarityScore);
    }

    l2Results.push({
      scanId: scanIdL2,
      documentAId: candidate.docA.documentId,
      documentBId: candidate.docB.documentId,
      similarityScore,
      algorithm: "minhash-lsh-jaccard"
    });
  }

  // Level 2 Batch DB Insert
  const startL2Db = performance.now();
  if (l2Results.length > 0) {
    for (let i = 0; i < l2Results.length; i += 1000) {
      await db.collection("similarity_results").insertMany(l2Results.slice(i, i + 1000));
    }
  }
  const l2DbTime = performance.now() - startL2Db;
  const endL2 = performance.now();
  const totalL2Time = endL2 - startL2;
  const l2MemoryMB = process.memoryUsage().heapUsed / 1024 / 1024;

  // Clean up L2 results
  await db.collection("similarity_results").deleteMany({ scanId: scanIdL2 });

  // -------------------------------------------------------------------------
  // RECALL & ACCURACY VALIDATION
  // -------------------------------------------------------------------------
  let truePositives = 0;
  let falseNegatives = 0;

  for (const [key, score] of l1HighSimilarityPairs) {
    if (l2FoundPairs.has(key)) {
      truePositives++;
    } else {
      falseNegatives++;
    }
  }

  const groundTruthCount = l1HighSimilarityPairs.size;
  const recallPercent = groundTruthCount > 0
    ? Number(((truePositives / groundTruthCount) * 100).toFixed(2))
    : 100.0;

  const candidateReduction = totalPossiblePairs > 0
    ? Number((((totalPossiblePairs - candidateResult.candidateCount) / totalPossiblePairs) * 100).toFixed(2))
    : 0;

  const comparisonReduction = l1ExactComparisons > 0
    ? Number((((l1ExactComparisons - l2ExactComparisons) / l1ExactComparisons) * 100).toFixed(2))
    : 0;

  // Print Detailed Metrics
  console.log(`\nMetrics Summary for N = ${count}:`);
  console.log(`- Total Possible Pairs:          ${totalPossiblePairs.toLocaleString()}`);
  console.log(`- Level 1 Exact Comparisons:     ${l1ExactComparisons.toLocaleString()}`);
  console.log(`- Level 2 Candidate Pairs:       ${candidateResult.candidateCount.toLocaleString()}`);
  console.log(`- Level 2 Exact Comparisons:     ${l2ExactComparisons.toLocaleString()}`);
  console.log(`- Candidate Reduction:           ${candidateReduction}%`);
  console.log(`- Exact Comparison Reduction:    ${comparisonReduction}%`);
  console.log(`- High Similarity Pairs (>=0.5): ${groundTruthCount}`);
  console.log(`- Level 2 Identified Pairs:      ${truePositives}`);
  console.log(`- False Negatives (Missed):      ${falseNegatives}`);
  console.log(`- Recall Rate:                   ${recallPercent}%`);
  console.log(`- Level 1 Total Time:            ${totalL1Time.toFixed(2)} ms (DB: ${l1DbTime.toFixed(2)} ms)`);
  console.log(`- Level 2 Total Time:            ${totalL2Time.toFixed(2)} ms (DB: ${l2DbTime.toFixed(2)} ms)`);

  return {
    N: count,
    possiblePairs: totalPossiblePairs,
    l1ExactComps: l1ExactComparisons,
    l2CandidatePairs: candidateResult.candidateCount,
    l2ExactComps: l2ExactComparisons,
    candidateReductionPct: `${candidateReduction}%`,
    compReductionPct: `${comparisonReduction}%`,
    groundTruthPairs: groundTruthCount,
    recallPct: `${recallPercent}%`,
    falseNegatives,
    l1TimeMs: Math.round(totalL1Time),
    l2TimeMs: Math.round(totalL2Time),
    speedup: Number((totalL1Time / (totalL2Time || 1)).toFixed(2)) + "x"
  };
}

async function runAllBenchmarks() {
  try {
    await connectToDatabase();

    const counts = [100, 250, 500, 1000];
    const results = [];

    for (const N of counts) {
      const res = await runComparativeBenchmark(N);
      results.push(res);
    }

    console.log(`\n======================================================================`);
    console.log(`FINAL COMPARATIVE BENCHMARK SUMMARY (LEVEL 1 vs LEVEL 2)`);
    console.log(`======================================================================`);
    console.table(results);

  } catch (error) {
    console.error("Benchmark execution failed:", error);
  } finally {
    await closeDatabase();
  }
}

runAllBenchmarks();
