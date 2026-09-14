/**
 * Calculates the Jaccard Similarity between two Sets.
 * 
 * J(A, B) = |A ∩ B| / |A ∪ B|
 * 
 * @param {Set<string>} setA 
 * @param {Set<string>} setB 
 * @returns {number} Similarity score between 0.0 and 1.0
 */
function calculateJaccardSimilarity(setA, setB) {
  if (!(setA instanceof Set) || !(setB instanceof Set)) {
    throw new Error("Inputs must be instance of Set");
  }

  if (setA.size === 0 && setB.size === 0) {
    return 0.0;
  }

  let intersectionSize = 0;
  
  // Optimization: iterate over the smaller Set
  if (setA.size < setB.size) {
    for (const token of setA) {
      if (setB.has(token)) {
        intersectionSize++;
      }
    }
  } else {
    for (const token of setB) {
      if (setA.has(token)) {
        intersectionSize++;
      }
    }
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  
  if (unionSize === 0) {
    return 0.0;
  }

  return intersectionSize / unionSize;
}

module.exports = {
  calculateJaccardSimilarity
};
