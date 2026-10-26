const { test, describe } = require("node:test");
const assert = require("node:assert");
const scoringService = require("../src/services/scoringService");

describe("DocSim Unified Whole-Document Scoring & Fusion Tests (Phase 8 & Phase 13)", () => {
  test("1. Returns exactly ONE overall similarity percentage without individual modality sub-percentages", () => {
    const result = scoringService.computeOverallScore({
      textSimilarity: 0.85,
      textTokenCountA: 500,
      textTokenCountB: 500,
      imageSimilarity: 0.90,
      imageCountA: 2,
      imageCountB: 2,
      codeSimilarity: 0.75,
      codeTokenCountA: 200,
      codeTokenCountB: 200,
      tableSimilarity: 0.80,
      tableCellCountA: 20,
      tableCellCountB: 20
    });

    assert.ok(typeof result.similarityPercentage === "number", "Includes single similarityPercentage");
    assert.ok(typeof result.similarityScore === "number", "Includes single similarityScore");
    assert.strictEqual(typeof result.isExactDuplicate, "boolean");

    // Strictly verify no individual modality sub-percentages exist
    assert.strictEqual(result.textSimilarity, undefined, "Must NOT expose separate text similarity");
    assert.strictEqual(result.textPercentage, undefined, "Must NOT expose separate text percentage");
    assert.strictEqual(result.codeSimilarity, undefined, "Must NOT expose separate code similarity");
    assert.strictEqual(result.codePercentage, undefined, "Must NOT expose separate code percentage");
    assert.strictEqual(result.imageSimilarity, undefined, "Must NOT expose separate image similarity");
    assert.strictEqual(result.imagePercentage, undefined, "Must NOT expose separate image percentage");
    assert.strictEqual(result.tableSimilarity, undefined, "Must NOT expose separate table similarity");
    assert.strictEqual(result.tablePercentage, undefined, "Must NOT expose separate table percentage");
  });

  test("2. Exact file hash override guarantees 100.00% regardless of sub-metrics", () => {
    const result = scoringService.computeOverallScore({
      isExactFileMatch: true,
      textSimilarity: 0.50,
      imageSimilarity: 0.0
    });

    assert.strictEqual(result.similarityPercentage, 100.0);
    assert.strictEqual(result.similarityScore, 1.0);
    assert.strictEqual(result.isExactDuplicate, true);
  });

  test("3. Mass-weighting dynamically balances according to content composition", () => {
    // Case A: Text-heavy assignment with 1 tiny irrelevant image
    // Text: 2000 tokens (mass 2000) at 90% similarity
    // Image: 1 image (mass 150) at 10% similarity
    const textDominant = scoringService.computeOverallScore({
      textSimilarity: 0.90,
      textTokenCountA: 2000,
      textTokenCountB: 2000,
      imageSimilarity: 0.10,
      imageCountA: 1,
      imageCountB: 1
    });
    // Expected: dominated by 90% text -> > 80%
    assert.ok(textDominant.similarityPercentage >= 80.0, `Text-dominant assignment should be high (${textDominant.similarityPercentage}%)`);

    // Case B: Screenshot/Lab-heavy assignment with only brief headings
    // Text: 20 tokens (mass 20) at 10% similarity
    // Images: 4 screenshots (mass 600) at 95% similarity
    const imageDominant = scoringService.computeOverallScore({
      textSimilarity: 0.10,
      textTokenCountA: 20,
      textTokenCountB: 20,
      imageSimilarity: 0.95,
      imageCountA: 4,
      imageCountB: 4
    });
    // Expected: dominated by 95% images -> > 85%
    assert.ok(imageDominant.similarityPercentage >= 85.0, `Image-dominant assignment should be high (${imageDominant.similarityPercentage}%)`);
  });

  test("4. Anti-double-counting prevents inflating score when code is extracted from images", () => {
    // Both code and image similarity match identical snippet
    const withSafeguard = scoringService.computeOverallScore({
      textSimilarity: 0.50,
      textTokenCountA: 200,
      textTokenCountB: 200,
      imageSimilarity: 0.95,
      imageCountA: 1,
      imageCountB: 1,
      codeSimilarity: 0.95,
      codeTokenCountA: 200,
      codeTokenCountB: 200,
      codeExtractedFromImage: true
    });

    // Score should reflect the content without stacking duplicate masses
    assert.ok(withSafeguard.similarityPercentage < 90.0, "Safeguard prevents artificial score inflation");
  });

  test("5. Missing modalities normalize smoothly without NaN or penalty", () => {
    // Text-only documents (no images, no code, no tables)
    const textOnly = scoringService.computeOverallScore({
      textSimilarity: 0.75,
      textTokenCountA: 300,
      textTokenCountB: 300,
      imageCountA: 0,
      imageCountB: 0,
      codeTokenCountA: 0,
      codeTokenCountB: 0,
      tableCellCountA: 0,
      tableCellCountB: 0
    });

    assert.strictEqual(textOnly.similarityPercentage, 75.0);

    // Empty documents fallback safely
    const emptyDocs = scoringService.computeOverallScore({});
    assert.strictEqual(emptyDocs.similarityPercentage, 0.0);
    assert.strictEqual(Number.isNaN(emptyDocs.similarityPercentage), false);
  });
});
