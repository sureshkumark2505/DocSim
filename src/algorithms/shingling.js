/**
 * Configurable word-level k-shingling algorithm for document token sequences.
 */

const DEFAULT_SHINGLE_SIZE = Number(process.env.SHINGLE_SIZE) || 5;

/**
 * Generates an array of contiguous word-level k-shingles from normalized tokens.
 * 
 * @param {string[]} tokens Normalized array of tokens
 * @param {number} [k=DEFAULT_SHINGLE_SIZE] Window size for each shingle
 * @returns {string[]} Array of shingles
 */
function generateShingles(tokens, k = DEFAULT_SHINGLE_SIZE) {
  if (!Array.isArray(tokens) || tokens.length === 0 || k <= 0) {
    return [];
  }

  // If token count is less than k, join all available tokens as a single shingle
  if (tokens.length < k) {
    return [tokens.join(" ")];
  }

  const shingles = [];
  const limit = tokens.length - k;
  for (let i = 0; i <= limit; i++) {
    shingles.push(tokens.slice(i, i + k).join(" "));
  }

  return shingles;
}

/**
 * Generates a deduplicated Set of word-level k-shingles.
 * 
 * @param {string[]} tokens Normalized array of tokens
 * @param {number} [k=DEFAULT_SHINGLE_SIZE] Window size for each shingle
 * @returns {Set<string>} Unique set of shingles
 */
function createShingleSet(tokens, k = DEFAULT_SHINGLE_SIZE) {
  return new Set(generateShingles(tokens, k));
}

module.exports = {
  DEFAULT_SHINGLE_SIZE,
  generateShingles,
  createShingleSet
};
