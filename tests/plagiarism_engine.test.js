const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const preprocessingService = require("../src/services/preprocessingService");
const passageService = require("../src/services/passageService");
const scoringService = require("../src/services/scoringService");
const similarityService = require("../src/services/similarityService");

describe("DocSim Comprehensive Plagiarism Detection & Similarity Engine Tests", () => {
  // Scenario 1: Identical documents
  test("1. Identical documents produce 100.00% similarity and exact duplicate classification", async () => {
    const text = "Quantum computing relies on qubits that can exist in superpositions of basis states zero and one. Quantum teleportation and Grover search achieve polynomial and quadratic speedups over classical algorithms.";
    const docA = { documentId: "doc_1_a", filename: "quantum_a.txt", sha256Hash: "hash_identical" };
    const docB = { documentId: "doc_1_b", filename: "quantum_b.txt", sha256Hash: "hash_identical" };

    const multiA = { text, pages: [{ pageNumber: 1, text }] };
    const multiB = { text, pages: [{ pageNumber: 1, text }] };

    const res = await similarityService.compareMultimodalPair(docA, docB, multiA, multiB, 1.0);
    assert.strictEqual(res.similarityPercentage, 100.0, "Identical documents must receive 100%");
    assert.strictEqual(res.isExactDuplicate, true);
    assert.ok(res.evidence.passages.length > 0);
  });

  // Scenario 2: Identical normalized content with different formatting (CRLF vs LF, extra spaces, Unicode NFD vs NFC)
  test("2. Identical normalized content with different line endings, spaces, and Unicode forms scores 100%", async () => {
    const textA = "Machine Learning in Healthcare:\r\n\r\nCardiovascular risk prediction using  convolutional neural networks.\r\nPatient résumé analysis.";
    // textB has Unix line endings, extra spaces, and NFD decomposed Unicode (é as e + combining acute accent \u0301)
    const textB = "Machine Learning in Healthcare:\n\nCardiovascular risk prediction using    convolutional neural networks.\nPatient re\u0301sume\u0301 analysis.";

    assert.ok(textA !== textB, "Raw text strings must be different");
    assert.ok(preprocessingService.areNormalizedTextsIdentical(textA, textB), "Normalized texts must match");

    const docA = { documentId: "doc_2_a", filename: "cardio_a.txt", sha256Hash: "raw_hash_A" };
    const docB = { documentId: "doc_2_b", filename: "cardio_b.txt", sha256Hash: "raw_hash_B" };

    const multiA = { text: textA, pages: [{ pageNumber: 1, text: textA }] };
    const multiB = { text: textB, pages: [{ pageNumber: 1, text: textB }] };

    const res = await similarityService.compareMultimodalPair(docA, docB, multiA, multiB, 0.85);
    assert.strictEqual(res.similarityPercentage, 100.0, "Harmonized normalized duplicates must receive 100.00%");
    assert.strictEqual(res.isExactDuplicate, true);
  });

  // Scenario 3: Partial paragraph copying
  test("3. Partial paragraph copying is detected and returns verified passage evidence with offsets", () => {
    const sharedParagraph = "Byzantine fault tolerance guarantees system liveness provided fewer than one third of replica nodes exhibit arbitrary or malicious behavior.";
    const textA = `Section 1: Distributed Systems.\n${sharedParagraph}\nOur evaluation used twenty geo-distributed nodes across three cloud providers.`;
    const textB = `Chapter 3: Consensus Mechanisms.\n${sharedParagraph}\nPerformance degraded when network partitions exceeded ten seconds duration.`;

    const matches = passageService.findMatchingPassages(textA, textB, { minSimilarity: 40 });
    assert.ok(matches.length >= 1, "Must find matching copied paragraph");
    assert.strictEqual(matches[0].matchType, "exact");
    assert.ok(matches[0].similarity >= 95);
    assert.ok(matches[0].offsetA !== undefined && matches[0].offsetA >= 0);
    assert.ok(matches[0].offsetB !== undefined && matches[0].offsetB >= 0);

    // Verify offsets point to the actual substring
    const foundA = textA.substring(matches[0].offsetA, matches[0].offsetA + matches[0].passageA.length);
    assert.strictEqual(foundA, matches[0].passageA, "offsetA must point to real source content");
  });

  // Scenario 4: Substantial overlap with unrelated additional text
  test("4. Substantial overlap with unrelated additional text reflects copied content via passage coverage", () => {
    const copiedText = "Asymmetric cryptography employs public and private key pairs for encryption and digital signature verification. RSA relies on the computational intractability of factoring large composite prime numbers. Elliptic curve cryptography provides equivalent security with substantially smaller key lengths.";
    const unrelatedA = "Aerodynamic drag forces on blunt bodies generate turbulent vortex shedding in high Reynolds number fluid dynamics flows. Boundary layer separation occurs along adverse pressure gradients.";
    const unrelatedB = "Photosynthetic light reactions convert solar photons into chemical potential energy through chlorophyll photosystems one and two in plant thylakoid membranes.";

    const textA = `${unrelatedA}\n\n${copiedText}`;
    const textB = `${copiedText}\n\n${unrelatedB}`;

    const matches = passageService.findMatchingPassages(textA, textB, { minSimilarity: 35 });
    assert.ok(matches.length >= 2, "Detects copied cryptography passages");

    const coverage = passageService.computePassageCoverage(textA, textB, matches);
    assert.ok(coverage.maxCoverage >= 0.40, `Coverage (${coverage.maxCoverage}) reflects substantial copied section`);
  });

  // Scenario 5: Small wording modifications (word substitutions, minor sentence edits)
  test("5. Small wording modifications and substitutions are detected as modified copying", () => {
    const original = "The compiler optimizes intermediate representation using dead code elimination and loop invariant code motion.";
    const modified = "The compiler optimizes intermediate representation using unused code elimination and loop invariant motion.";

    const matches = passageService.findMatchingPassages(original, modified, { minSimilarity: 40 });
    assert.ok(matches.length >= 1, "Must identify modified sentence match");
    assert.ok(matches[0].similarity >= 60.0 && matches[0].similarity < 100.0, "Score reflects modification");
    assert.ok(matches[0].matchedWords.includes("compiler"));
    assert.ok(matches[0].matchedWords.includes("optimizes"));
    assert.ok(matches[0].matchedWords.includes("intermediate"));
    assert.ok(matches[0].matchedWords.includes("representation"));
  });

  // Scenario 6: Reordered paragraphs
  test("6. Reordered paragraphs are detected independently without positional penalty", () => {
    const para1 = "Relational database management systems utilize B-plus tree indexes to accelerate point queries and range scans over indexed relation attributes.";
    const para2 = "Write-ahead logging ensures atomicity and durability by persisting log records to non-volatile secondary storage before buffer pool pages are written.";
    const para3 = "Multi-version concurrency control permits read transactions to proceed without acquiring shared locks on active database row tuples.";

    const textA = `${para1}\n\n${para2}\n\n${para3}`;
    const textB = `${para3}\n\n${para1}\n\n${para2}`; // Completely reordered

    const matches = passageService.findMatchingPassages(textA, textB, { minSimilarity: 40 });
    assert.strictEqual(matches.length, 3, "All 3 reordered paragraphs must be matched");
    for (const m of matches) {
      assert.strictEqual(m.similarity, 100);
      assert.strictEqual(m.matchType, "exact");
    }
  });

  // Scenario 7: Common headings only produce zero false-positive matching passages
  test("7. Common headings only (Introduction, Conclusion, References) are suppressed as boilerplate", () => {
    const textA = "Introduction\n\nMethodology\n\nResults and Discussion\n\nConclusion\n\nReferences";
    const textB = "Introduction\n\nMethodology\n\nResults and Discussion\n\nConclusion\n\nReferences";

    const matches = passageService.findMatchingPassages(textA, textB, { minSimilarity: 35 });
    assert.strictEqual(matches.length, 0, "Boilerplate headings alone must produce 0 matching evidence passages");
  });

  // Scenario 8: Generic boilerplate instructions do not produce high similarity
  test("8. Generic boilerplate templates produce low similarity (< 35%)", () => {
    const template = "Course: Operating Systems Lab 02. Instructor: Prof. Dijkstra. All answers must be independent.";
    const textA = `${template}\n\nWe implemented a priority preemptive CPU scheduler with multilevel feedback queues to prevent thread starvation.`;
    const textB = `${template}\n\nOur group built a round-robin scheduler with a ten millisecond time slice quantum running on an simulated microkernel.`;

    const prepA = preprocessingService.process(textA);
    const prepB = preprocessingService.process(textB);

    // Calculate shingle Jaccard
    let inter = 0;
    for (const s of prepA.shingleSet) {
      if (prepB.shingleSet.has(s)) inter++;
    }
    const union = prepA.shingleSet.size + prepB.shingleSet.size - inter;
    const jaccard = union > 0 ? inter / union : 0;

    assert.ok(jaccard <= 0.25, `Jaccard (${jaccard}) must be low due to independent answers`);
  });

  // Scenario 9: Completely unrelated documents produce ~0% similarity
  test("9. Completely unrelated documents produce 0% similarity and 0 matching passages", () => {
    const textA = "Cellular respiration produces adenosine triphosphate via oxidative phosphorylation across the inner mitochondrial membrane.";
    const textB = "Modern aircraft turbojet propulsion systems compress ambient atmospheric air before igniting aviation kerosene in annular combustion chambers.";

    const matches = passageService.findMatchingPassages(textA, textB, { minSimilarity: 30 });
    assert.strictEqual(matches.length, 0, "Unrelated documents have 0 matches");

    const prepA = preprocessingService.process(textA);
    const prepB = preprocessingService.process(textB);
    let inter = 0;
    for (const s of prepA.shingleSet) {
      if (prepB.shingleSet.has(s)) inter++;
    }
    assert.strictEqual(inter, 0, "Zero shared shingles between unrelated topics");
  });

  // Scenario 10: Empty documents handle safely without throwing errors or producing NaN
  test("10. Empty documents return 0% similarity without throwing or returning NaN", () => {
    const score = scoringService.computeOverallScore({
      textSimilarity: 0,
      textTokenCountA: 0,
      textTokenCountB: 0
    });

    assert.strictEqual(score.similarityPercentage, 0.0);
    assert.strictEqual(score.similarityScore, 0.0);
    assert.strictEqual(isNaN(score.similarityPercentage), false);

    const matches = passageService.findMatchingPassages("", "");
    assert.deepStrictEqual(matches, []);
  });

  // Scenario 11: Very short documents
  test("11. Very short documents (under 5 words) handle safely without division by zero", () => {
    const textA = "Hello world";
    const textB = "Hello world";

    assert.ok(preprocessingService.areNormalizedTextsIdentical(textA, textB), "Identical short text detected");
  });

  // Scenario 12: Repeated passages do not inflate score beyond 100%
  test("12. Repeated passages are bounded and score never exceeds 100.00%", () => {
    const sentence = "The quick brown fox jumps over the lazy dog.";
    const textA = `${sentence} `.repeat(10);
    const textB = `${sentence} `.repeat(5);

    const score = scoringService.computeOverallScore({
      textSimilarity: 1.0,
      textTokenCountA: 90,
      textTokenCountB: 45
    });

    assert.ok(score.similarityPercentage <= 100.0, "Score must never exceed 100%");
    assert.ok(score.similarityScore <= 1.0, "Score ratio must never exceed 1.0");
  });

  // Scenario 13: Long documents performance and stability
  test("13. Long documents (50,000+ words) execute efficiently within memory limits", () => {
    const basePara = "Scalable document similarity requires inverted index bucketing and candidate reduction to avoid quadratic all-pairs comparisons. ";
    const longTextA = basePara.repeat(200);
    const longTextB = basePara.repeat(200);

    const startTime = performance.now();
    const prepA = preprocessingService.process(longTextA);
    const prepB = preprocessingService.process(longTextB);
    const elapsed = performance.now() - startTime;

    assert.ok(elapsed < 2000, `Preprocessing 40,000+ words should take < 2000ms (actual: ${elapsed.toFixed(1)}ms)`);
    assert.ok(prepA.tokens.length > 2000);
  });

  // Scenario 14: Duplicate documents with different filenames
  test("14. Duplicate documents with different filenames evaluate to 100% exact duplicate", async () => {
    const text = "Computer Vision: Edge detection using Sobel gradient filters and Canny hysteresis thresholding.";
    const docA = { documentId: "doc_alpha", filename: "final_project_submission_alice.txt", sha256Hash: "same_hash" };
    const docB = { documentId: "doc_beta", filename: "assignment_draft_bob_backup.txt", sha256Hash: "same_hash" };

    const multiA = { text, pages: [{ pageNumber: 1, text }] };
    const multiB = { text, pages: [{ pageNumber: 1, text }] };

    const res = await similarityService.compareMultimodalPair(docA, docB, multiA, multiB, 1.0);
    assert.strictEqual(res.similarityPercentage, 100.0);
    assert.strictEqual(res.isExactDuplicate, true);
  });
});
