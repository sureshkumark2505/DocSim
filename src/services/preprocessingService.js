/**
 * Service to handle document text normalization and tokenization.
 */
const preprocessingService = {
  /**
   * Tokenizes text and returns a list of normalized tokens.
   * 
   * Preprocessing steps:
   * 1. Convert to lowercase
   * 2. Replace non-alphanumeric/non-space characters with space
   * 3. Split on whitespace
   * 4. Filter out empty tokens
   * 
   * @param {string} text 
   * @returns {string[]}
   */
  tokenize(text) {
    if (!text || typeof text !== "string") {
      return [];
    }
    return text
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
   * Preprocesses text once, returning tokens list, token Set, and stats.
   * @param {string} text 
   * @returns {object}
   */
  process(text) {
    const tokens = this.tokenize(text);
    const shingleArray = this.generateShingles(tokens, 3);
    
    return {
      tokens,
      tokenSet: new Set(tokens),
      shingles: shingleArray,
      shingleSet: new Set(shingleArray),
      tokenCount: tokens.length,
      shingleCount: shingleArray.length
    };
  }
};

module.exports = preprocessingService;
