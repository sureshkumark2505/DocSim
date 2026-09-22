/**
 * Deterministic MinHash signature generation algorithm.
 * Produces compact fixed-size integer signatures for shingle sets.
 */

const DEFAULT_NUM_PERMUTATIONS = Number(process.env.MINHASH_NUM_PERMUTATIONS) || 128;
const LARGE_PRIME = 4294967311; // 2^32 + 207 (prime)
const DETERMINISTIC_SEED = 0x5a17c0de;

/**
 * 32-bit FNV-1a string hashing function.
 * @param {string} str 
 * @returns {number} Unsigned 32-bit integer
 */
function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic PRNG (Mulberry32) for generating reproducible hash permutation coefficients.
 * @param {number} seed 
 * @returns {() => number}
 */
function createMulberry32(seed) {
  return function() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

/**
 * Precomputes deterministic (a_i, b_i) coefficients for MinHash permutation hash functions:
 * h_i(x) = (a_i * x + b_i) mod LARGE_PRIME
 * 
 * @param {number} numPermutations 
 * @param {number} [seed=DETERMINISTIC_SEED]
 * @returns {{ a: number[], b: number[] }}
 */
function generatePermutationCoefficients(numPermutations, seed = DETERMINISTIC_SEED) {
  const rng = createMulberry32(seed);
  const a = new Array(numPermutations);
  const b = new Array(numPermutations);

  for (let i = 0; i < numPermutations; i++) {
    // a_i must be odd and non-zero
    let aVal = rng();
    if (aVal % 2 === 0) aVal += 1;
    a[i] = aVal >>> 0;
    b[i] = rng() >>> 0;
  }

  return { a, b };
}

// Cached coefficients for default permutation count
const defaultCoefficients = generatePermutationCoefficients(DEFAULT_NUM_PERMUTATIONS);

/**
 * Generates a deterministic MinHash signature for a given set or array of shingles.
 * 
 * @param {Set<string>|string[]} shingles Set or array of shingles
 * @param {number} [numPermutations=DEFAULT_NUM_PERMUTATIONS] Number of hash permutations (signature size)
 * @returns {number[]} Array of unsigned 32-bit integers representing the MinHash signature
 */
function generateMinHashSignature(shingles, numPermutations = DEFAULT_NUM_PERMUTATIONS) {
  const coeff = (numPermutations === DEFAULT_NUM_PERMUTATIONS)
    ? defaultCoefficients
    : generatePermutationCoefficients(numPermutations);

  const signature = new Uint32Array(numPermutations);
  signature.fill(0xFFFFFFFF);
  const shingleArray = shingles instanceof Set ? Array.from(shingles) : (Array.isArray(shingles) ? shingles : []);

  if (shingleArray.length === 0) {
    return Array.from(signature);
  }

  const primeBig = BigInt(LARGE_PRIME);
  const aBigArray = coeff.aBig || (coeff.aBig = coeff.a.map(x => BigInt(x)));
  const bBigArray = coeff.bBig || (coeff.bBig = coeff.b.map(x => BigInt(x)));

  for (let sIdx = 0; sIdx < shingleArray.length; sIdx++) {
    const rawHash = fnv1a32(String(shingleArray[sIdx]));
    const rawHashBig = BigInt(rawHash);

    for (let i = 0; i < numPermutations; i++) {
      const hashVal = Number((aBigArray[i] * rawHashBig + bBigArray[i]) % primeBig);

      if (hashVal < signature[i]) {
        signature[i] = hashVal;
      }
    }
  }

  return Array.from(signature);
}

/**
 * Estimates Jaccard similarity directly from two MinHash signatures.
 * 
 * @param {number[]} sigA 
 * @param {number[]} sigB 
 * @returns {number} Estimated similarity between 0.0 and 1.0
 */
function estimateMinHashSimilarity(sigA, sigB) {
  if (!Array.isArray(sigA) || !Array.isArray(sigB) || sigA.length === 0 || sigB.length === 0) {
    return 0.0;
  }

  const length = Math.min(sigA.length, sigB.length);
  let matches = 0;

  for (let i = 0; i < length; i++) {
    if (sigA[i] === sigB[i]) {
      matches++;
    }
  }

  return matches / length;
}

module.exports = {
  DEFAULT_NUM_PERMUTATIONS,
  LARGE_PRIME,
  DETERMINISTIC_SEED,
  fnv1a32,
  generatePermutationCoefficients,
  generateMinHashSignature,
  estimateMinHashSimilarity
};
