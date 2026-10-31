const crypto = require("crypto");

/**
 * Service to handle document text normalization, Unicode standardization,
 * canonical content hashing, and shingle tokenization.
 */
const preprocessingService = {
  /**
   * Normalizes document text for exact content comparison despite harmless differences
   * (line endings, Unicode character representations, multiple spaces, tabs, trailing whitespace).
   * 
   * @param {string} text 
   * @returns {string}
   */
  normalizeForComparison(text) {
    if (!text || typeof text !== "string") {
      return "";
    }
    return text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[\u200B-\u200D\uFEFF]/g, "") // Remove zero-width spaces
      .replace(/[ \t]+/g, " ")               // Collapse inline whitespace
      .replace(/^[ \t]+|[ \t]+$/gm, "")     // Trim each line
      .replace(/\n{3,}/g, "\n\n")            // Collapse excessive line breaks
      .trim();
  },

  /**
   * Determines if two texts are identical after Unicode and whitespace normalization.
   * 
   * @param {string} textA 
   * @param {string} textB 
   * @returns {boolean}
   */
  areNormalizedTextsIdentical(textA, textB) {
    if (!textA || !textB) return false;
    const normA = this.normalizeForComparison(textA);
    const normB = this.normalizeForComparison(textB);
    if (normA.length === 0 || normB.length === 0) return false;
    if (normA === normB) return true;

    // Fast token-sequence fallback for documents differing solely in punctuation formatting
    const tokensA = this.tokenize(textA);
    const tokensB = this.tokenize(textB);
    if (tokensA.length === 0 || tokensA.length !== tokensB.length) return false;
    return tokensA.every((t, i) => t === tokensB[i]);
  },

  /**
   * Computes a SHA-256 hash of the normalized text content.
   * 
   * @param {string} text 
   * @returns {string} Hex-encoded SHA-256 hash
   */
  computeNormalizedHash(text) {
    const norm = this.normalizeForComparison(text);
    return crypto.createHash("sha256").update(norm, "utf8").digest("hex");
  },

  /**
   * Tokenizes text and returns a list of normalized tokens.
   * 
   * Preprocessing steps:
   * 1. Normalize Unicode (NFKC)
   * 2. Convert to lowercase
   * 3. Replace non-alphanumeric/non-space characters with space
   * 4. Split on whitespace
   * 5. Filter out empty tokens
   * 
   * @param {string} text 
   * @returns {string[]}
   */
  tokenize(text) {
    if (!text || typeof text !== "string") {
      return [];
    }
    return text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  },

  /**
   * Generates shingles from a list of tokens (architectural preparation for Level 2 LSH/shingling).
   * Default shingle size is 3 words.
   * 
   * @param {string[]} tokens 
   * @param {number} k 
   * @returns {string[]}
   */
  generateShingles(tokens, k = 3) {
    if (!tokens || tokens.length < k) {
      return [];
    }
    const shingles = [];
    for (let i = 0; i <= tokens.length - k; i++) {
      shingles.push(tokens.slice(i, i + k).join(" "));
    }
    return shingles;
  },

  /**
   * Preprocesses text once, returning tokens list, token Set, shingles, and normalized stats.
   * @param {string} text 
   * @returns {object}
   */
  process(text) {
    const tokens = this.tokenize(text);
    const shingleArray = this.generateShingles(tokens, 3);
    const normalizedText = this.normalizeForComparison(text);
    const normalizedHash = this.computeNormalizedHash(text);
    
    return {
      tokens,
      tokenSet: new Set(tokens),
      shingles: shingleArray,
      shingleSet: new Set(shingleArray),
      tokenCount: tokens.length,
      shingleCount: shingleArray.length,
      normalizedText,
      normalizedHash
    };
  }
};

module.exports = preprocessingService;
