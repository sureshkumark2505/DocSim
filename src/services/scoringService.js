/**
 * Scoring Service — Unified Whole-Document Similarity Fusion Engine
 * 
 * STRICT PRODUCT REQUIREMENT:
 * Computes exactly ONE overall similarity percentage per document pair.
 * Never exposes separate similarity percentages for individual modalities.
 * 
 * Fuses text, code, image, table, and OCR evidence while preventing double-counting
 * and normalizing across available modalities.
 */

const scoringService = {
  /**
   * Calculates the single unified overall similarity score for a document pair.
   * 
   * @param {object} params
   * @param {boolean} [params.isExactFileMatch=false] True if raw file SHA-256 hashes are identical
   * @param {number} [params.textSimilarity=0] Jaccard/passage text similarity [0, 1]
   * @param {number} [params.textTokenCountA=0]
   * @param {number} [params.textTokenCountB=0]
   * @param {number} [params.imageSimilarity=0] Best image similarity [0, 1]
   * @param {number} [params.imageCountA=0]
   * @param {number} [params.imageCountB=0]
   * @param {number} [params.codeSimilarity=0] Code similarity [0, 1]
   * @param {number} [params.codeTokenCountA=0]
   * @param {number} [params.codeTokenCountB=0]
   * @param {number} [params.tableSimilarity=0] Table similarity [0, 1]
   * @param {number} [params.tableCellCountA=0]
   * @param {number} [params.tableCellCountB=0]
   * @param {boolean} [params.codeExtractedFromImage=false] True if code was recovered via OCR
   * @returns {{ similarityScore: number, similarityPercentage: number, isExactDuplicate: boolean }}
   */
  computeOverallScore({
    isExactFileMatch = false,
    textSimilarity = 0,
    textTokenCountA = 0,
    textTokenCountB = 0,
    imageSimilarity = 0,
    imageCountA = 0,
    imageCountB = 0,
    codeSimilarity = 0,
    codeTokenCountA = 0,
    codeTokenCountB = 0,
    tableSimilarity = 0,
    tableCellCountA = 0,
    tableCellCountB = 0,
    codeExtractedFromImage = false
  }) {
    // 1. Exact Duplicate Override: Identical file hash guarantees 100.00%
    if (isExactFileMatch) {
      return {
        similarityScore: 1.0,
        similarityPercentage: 100.0,
        isExactDuplicate: true
      };
    }

    // Clamp input similarities into [0, 1]
    const sText = Math.max(0, Math.min(1, Number(textSimilarity) || 0));
    const sImg = Math.max(0, Math.min(1, Number(imageSimilarity) || 0));
    const sCode = Math.max(0, Math.min(1, Number(codeSimilarity) || 0));
    const sTable = Math.max(0, Math.min(1, Number(tableSimilarity) || 0));

    // 2. Compute Content Masses (weights proportional to actual presence in documents)
    const avgTextTokens = (textTokenCountA + textTokenCountB) / 2;
    const avgImages = (imageCountA + imageCountB) / 2;
    const avgCodeTokens = (codeTokenCountA + codeTokenCountB) / 2;
    const avgTableCells = (tableCellCountA + tableCellCountB) / 2;

    // Weight conversions:
    // Text: 1 token = 1 mass unit
    // Image: 1 image ~ 150 mass units (equivalent to typical diagram/screenshot explanation)
    // Code: 1 code token = 1 mass unit
    // Table: 1 cell ~ 5 mass units
    let massText = avgTextTokens;
    let massImg = avgImages * 150;
    let massCode = avgCodeTokens;
    let massTable = avgTableCells * 5;

    // 3. Anti-Double-Counting Safeguards:
    // If code was recovered from an image via OCR, and both image similarity and code similarity match,
    // take the maximum score for that content portion rather than stacking them to inflate the total.
    let effectiveImgSim = sImg;
    let effectiveCodeSim = sCode;

    if (codeExtractedFromImage && massImg > 0 && massCode > 0) {
      if (sImg > 0 && sCode > 0) {
        const unified = Math.max(sImg, sCode);
        effectiveImgSim = unified;
        effectiveCodeSim = unified;
        // Dampen code mass so the screenshot isn't counted as two independent pieces of content
        massCode = massCode * 0.5;
      }
    }

    // Zero out mass if neither document has that content type
    if (textTokenCountA === 0 && textTokenCountB === 0) massText = 0;
    if (imageCountA === 0 && imageCountB === 0) massImg = 0;
    if (codeTokenCountA === 0 && codeTokenCountB === 0) massCode = 0;
    if (tableCellCountA === 0 && tableCellCountB === 0) massTable = 0;

    const totalMass = massText + massImg + massCode + massTable;

    // Fallback if no measurable mass was found
    if (totalMass <= 0) {
      const fallbackScore = Math.max(sText, sImg, sCode, sTable);
      const pct = Number((fallbackScore * 100).toFixed(2));
      return {
        similarityScore: Number(fallbackScore.toFixed(4)),
        similarityPercentage: pct,
        isExactDuplicate: pct >= 99.99
      };
    }

    // 4. Normalized Mass-Weighted Score
    const weightedSum =
      (sText * massText) +
      (effectiveImgSim * massImg) +
      (effectiveCodeSim * massCode) +
      (sTable * massTable);

    let finalScore = weightedSum / totalMass;

    // If all available modalities were 1.0, guarantee 100%
    const availableModalities = [];
    if (massText > 0) availableModalities.push(sText);
    if (massImg > 0) availableModalities.push(effectiveImgSim);
    if (massCode > 0) availableModalities.push(effectiveCodeSim);
    if (massTable > 0) availableModalities.push(sTable);

    const allMax = availableModalities.length > 0 && availableModalities.every(s => s >= 0.999);
    if (allMax) {
      finalScore = 1.0;
    }

    finalScore = Math.max(0.0, Math.min(1.0, finalScore));
    const similarityPercentage = Number((finalScore * 100).toFixed(2));
    const isExactDuplicate = similarityPercentage >= 99.99;

    return {
      similarityScore: Number(finalScore.toFixed(4)),
      similarityPercentage,
      isExactDuplicate
    };
  }
};

module.exports = scoringService;
