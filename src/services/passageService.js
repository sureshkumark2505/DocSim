/**
 * Service to detect, extract, and highlight matching passages and sentences between documents.
 */

// Common English stop words to avoid highlighting or ranking trivial overlaps
const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing",
  "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't",
  "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself",
  "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is",
  "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself",
  "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours",
  "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should",
  "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs", "them",
  "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've",
  "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we",
  "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where",
  "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would",
  "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves"
]);

/**
 * Splits raw document text into meaningful sentences/passages.
 * Preserves original sentence formatting for side-by-side display.
 * 
 * @param {string} text 
 * @returns {string[]}
 */
function splitIntoSentences(text) {
  if (!text || typeof text !== "string") return [];

  // Safety guard against massive payloads causing unbounded processing
  const safeText = text.length > 2000000 ? text.slice(0, 2000000) : text;

  // Normalize line breaks
  const normalized = safeText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split on sentence boundaries: period/question/exclamation followed by optional quote and whitespace, or newlines
  const rawSentences = normalized
    .split(/(?<=[.?!]["']?)\s+|\n+/)
    .map(s => s.trim().replace(/\s+/g, " "))
    .filter(s => {
      // Must contain at least 3 alphanumeric words (with length >= 2) to be considered a meaningful passage
      const words = s.match(/[a-zA-Z0-9]{2,}/g) || [];
      return words.length >= 3;
    });

  return rawSentences;
}

/**
 * Tokenizes sentence into normalized words for comparison.
 * 
 * @param {string} sentence 
 * @returns {string[]}
 */
function tokenizeSentence(sentence) {
  if (!sentence) return [];
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 1);
}

/**
 * Computes meaningful overlap between two sentences.
 * Returns overlap score and list of shared content words.
 * Ignores trivial stop-word-only overlaps.
 * 
 * @param {string[]} tokensA 
 * @param {string[]} tokensB 
 * @returns {{ score: number, matchedWords: string[] }}
 */
function computeSentenceOverlap(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) {
    return { score: 0, matchedWords: [] };
  }

  // Content words (excluding stop words) for meaningful similarity
  const contentA = tokensA.filter(w => !STOP_WORDS.has(w));
  const contentB = tokensB.filter(w => !STOP_WORDS.has(w));

  const contentSetB = new Set(contentB);
  const matchedContent = contentA.filter(w => contentSetB.has(w));
  const uniqueMatchedWords = [...new Set(matchedContent)];

  // If there are zero shared content words, generic grammatical matches are rejected
  if (uniqueMatchedWords.length === 0) {
    return { score: 0, matchedWords: [] };
  }

  // Jaccard score on content words
  const unionContentSize = new Set([...contentA, ...contentB]).size;
  const contentJaccard = unionContentSize > 0 ? uniqueMatchedWords.length / unionContentSize : 0;

  // Containment score on content words
  const minContentLength = Math.min(contentA.length, contentB.length);
  const containment = minContentLength > 0 ? uniqueMatchedWords.length / minContentLength : 0;

  // Relative ratio of matching tokens
  const contentRatio = (contentA.length + contentB.length) > 0
    ? (2 * matchedContent.length) / (contentA.length + contentB.length)
    : 0;

  // Blended score
  const score = Number(((contentJaccard * 0.35 + containment * 0.35 + contentRatio * 0.30) * 100).toFixed(1));

  return {
    score: Math.min(100, score),
    matchedWords: uniqueMatchedWords
  };
}

/**
 * Finds and pairs matching passages between two documents.
 * 
 * @param {string} textA - Full text of Document A
 * @param {string} textB - Full text of Document B
 * @param {object} [options]
 * @param {number} [options.minSimilarity=40] - Minimum passage similarity percentage
 * @param {number} [options.maxPassages=15] - Maximum number of matching passages to return
 * @returns {Array<object>}
 */
function findMatchingPassages(textA, textB, { minSimilarity = 40, maxPassages = 15 } = {}) {
  if (!textA || !textB) return [];

  const sentencesA = splitIntoSentences(textA);
  const sentencesB = splitIntoSentences(textB);

  if (sentencesA.length === 0 || sentencesB.length === 0) return [];

  const tokenizedA = sentencesA.map(s => ({
    original: s,
    tokens: tokenizeSentence(s)
  }));

  const tokenizedB = sentencesB.map(s => ({
    original: s,
    tokens: tokenizeSentence(s)
  }));

  const matches = [];
  const usedB = new Set();

  for (let i = 0; i < tokenizedA.length; i++) {
    const itemA = tokenizedA[i];
    if (itemA.tokens.length < 3) continue;

    let bestMatch = null;
    let bestScore = 0;
    let bestIndexB = -1;

    for (let j = 0; j < tokenizedB.length; j++) {
      if (usedB.has(j)) continue;

      const itemB = tokenizedB[j];
      if (itemB.tokens.length < 3) continue;

      // Exact sentence check
      if (itemA.original.toLowerCase() === itemB.original.toLowerCase()) {
        bestScore = 100;
        const contentWords = [...new Set(itemA.tokens.filter(w => !STOP_WORDS.has(w)))];
        bestMatch = {
          passageA: itemA.original,
          passageB: itemB.original,
          similarity: 100,
          matchedWords: contentWords.length > 0 ? contentWords : [...new Set(itemA.tokens)],
          matchType: "exact"
        };
        bestIndexB = j;
        break;
      }

      const { score, matchedWords } = computeSentenceOverlap(itemA.tokens, itemB.tokens);
      if (score >= minSimilarity && score > bestScore) {
        bestScore = score;
        bestMatch = {
          passageA: itemA.original,
          passageB: itemB.original,
          similarity: score,
          matchedWords,
          matchType: score >= 80 ? "high" : (score >= 60 ? "moderate" : "partial")
        };
        bestIndexB = j;
      }
    }

    if (bestMatch && bestScore >= minSimilarity) {
      matches.push(bestMatch);
      if (bestIndexB >= 0) {
        usedB.add(bestIndexB);
      }
    }
  }

  // Sort by similarity descending
  matches.sort((a, b) => b.similarity - a.similarity);

  return matches.slice(0, maxPassages);
}

/**
 * Highlights matched words in text for side-by-side HTML display.
 * 
 * @param {string} text 
 * @param {string[]} matchedWords 
 * @returns {string} Safe HTML string with <mark> tags
 */
function highlightMatchedTokens(text, matchedWords = []) {
  if (!text) return "";
  if (!matchedWords || matchedWords.length === 0) {
    return escapeHtml(text);
  }

  // Build a set of meaningful matched words
  const wordSet = new Set(matchedWords.map(w => w.toLowerCase()));

  // Split text by word boundaries while preserving punctuation and spacing
  const tokens = text.split(/(\b[a-zA-Z0-9]+\b)/g);

  return tokens.map(token => {
    const lower = token.toLowerCase();
    if (wordSet.has(lower) && !STOP_WORDS.has(lower)) {
      return `<mark class="passage-highlight">${escapeHtml(token)}</mark>`;
    }
    return escapeHtml(token);
  }).join("");
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = {
  splitIntoSentences,
  tokenizeSentence,
  computeSentenceOverlap,
  findMatchingPassages,
  highlightMatchedTokens
};
