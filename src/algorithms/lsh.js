/**
 * Banding-based Locality Sensitive Hashing (LSH) for MinHash signatures.
 * Partitions signatures into bands to identify candidate pairs with high collision probability.
 */

const { fnv1a32 } = require("./minhash");

const DEFAULT_LSH_BANDS = Number(process.env.LSH_BANDS) || 32;
const DEFAULT_LSH_ROWS = Number(process.env.LSH_ROWS) || 4;

/**
 * Computes bucket keys for a single MinHash signature across all bands.
 * 
 * @param {number[]} signature MinHash signature array of length (bands * rows)
 * @param {number} [bands=DEFAULT_LSH_BANDS] Number of bands (b)
 * @param {number} [rows=DEFAULT_LSH_ROWS] Number of rows per band (r)
 * @returns {string[]} Array of bucket identifiers, one per band
 */
function getBandBuckets(signature, bands = DEFAULT_LSH_BANDS, rows = DEFAULT_LSH_ROWS) {
  if (!Array.isArray(signature) || signature.length < bands * rows) {
    throw new Error(`Signature length (${signature?.length || 0}) must be at least ${bands * rows} (bands * rows).`);
  }

  const bucketKeys = new Array(bands);

  for (let bandIdx = 0; bandIdx < bands; bandIdx++) {
    const start = bandIdx * rows;
    const bandRows = signature.slice(start, start + rows);
    // Deterministic hash of the band values
    const bandHash = fnv1a32(bandRows.join(","));
    bucketKeys[bandIdx] = `b${bandIdx}:${bandHash}`;
  }

  return bucketKeys;
}

/**
 * Groups documents into LSH buckets across all bands.
 * 
 * @param {Array<{ documentId: string, minhashSignature: number[] }>} documents 
 * @param {number} [bands=DEFAULT_LSH_BANDS] 
 * @param {number} [rows=DEFAULT_LSH_ROWS] 
 * @returns {Map<string, string[]>} Map of bucketKey -> array of documentIds
 */
function bucketDocuments(documents, bands = DEFAULT_LSH_BANDS, rows = DEFAULT_LSH_ROWS) {
  const buckets = new Map();

  for (const doc of documents) {
    if (!doc.minhashSignature || doc.minhashSignature.length < bands * rows) {
      continue;
    }

    const bucketKeys = getBandBuckets(doc.minhashSignature, bands, rows);

    for (const key of bucketKeys) {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = [];
        buckets.set(key, bucket);
      }
      bucket.push(doc.documentId);
    }
  }

  return buckets;
}

/**
 * Calculates theoretical LSH candidate probability curve for a given similarity s:
 * P(candidate | s) = 1 - (1 - s^r)^b
 * 
 * @param {number} s True Jaccard similarity (0.0 to 1.0)
 * @param {number} [bands=DEFAULT_LSH_BANDS] 
 * @param {number} [rows=DEFAULT_LSH_ROWS] 
 * @returns {number} Probability between 0.0 and 1.0
 */
function calculateCandidateProbability(s, bands = DEFAULT_LSH_BANDS, rows = DEFAULT_LSH_ROWS) {
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  return 1 - Math.pow(1 - Math.pow(s, rows), bands);
}

module.exports = {
  DEFAULT_LSH_BANDS,
  DEFAULT_LSH_ROWS,
  getBandBuckets,
  bucketDocuments,
  calculateCandidateProbability
};
