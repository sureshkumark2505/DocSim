/**
 * Service to detect, extract, align, and highlight matching passages and sentences between documents.
 * 
 * Supports:
 * - Exact sentence and paragraph matching
 * - Partial copying detection across multi-paragraph content
 * - Modified copying detection (small word substitutions, minor edits, reordered paragraphs)
 * - False-positive suppression for generic boilerplate, headings, and bibliographies
 * - Source location preservation: page numbers and character offsets
 * - Safe HTML highlighting (<mark> tags with strict escaping)
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

// Common generic academic and administrative boilerplate to reduce false positives
const COMMON_BOILERPLATE_HEADINGS = new Set([
  "table of contents", "introduction", "background", "methods", "methodology",
  "materials and methods", "results", "discussion", "results and discussion",
  "results discussion", "conclusion", "conclusions", "conclusion and future work",
  "references", "bibliography", "works cited", "abstract", "declaration",
  "acknowledgments", "acknowledgements", "appendix", "appendices", "all rights reserved",
  "table of figures", "list of tables", "course overview", "lab report", "executive summary",
  "student answer", "problem statement", "author declaration", "copyright notice"
]);

/**
 * Splits raw document text into meaningful sentences and passages with character offsets.
 * 
 * @param {string} text 
 * @param {Array<object>} [pages=[]] Optional pages array from extractionService [{ pageNumber: 1, text: "..." }]
 * @returns {Array<{ original: string, offset: number, pageNumber: number }>}
 */
function splitIntoSentencesWithOffsets(text, pages = []) {
  if (!text || typeof text !== "string") return [];

  const safeText = text.length > 2000000 ? text.slice(0, 2000000) : text;
  const normalized = safeText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Build page boundary offset map if pages metadata is provided
  const pageBoundaries = [];
  if (Array.isArray(pages) && pages.length > 0) {
    let runningOffset = 0;
    for (const p of pages) {
      const pLen = (p.text || "").length;
      pageBoundaries.push({
        pageNumber: p.pageNumber || pageBoundaries.length + 1,
        startOffset: runningOffset,
        endOffset: runningOffset + pLen
      });
      runningOffset += pLen;
    }
  }

  function resolvePage(offset) {
    if (pageBoundaries.length === 0) return 1;
    for (const pb of pageBoundaries) {
      if (offset >= pb.startOffset && offset <= pb.endOffset) {
        return pb.pageNumber;
      }
    }
    return 1;
  }

  // Regex splitting on sentence boundaries (. ? ! followed by space or newline) or paragraph breaks
  const rawSegments = [];
  const regex = /[^.?!;\n]+(?:[.?!;]+["']?(?=\s|$)|(?=\n+|$))/g;
  let match;

  while ((match = regex.exec(normalized)) !== null) {
    const raw = match[0].trim().replace(/\s+/g, " ");
    const offset = match.index;

    // Filter out trivial segments (< 3 words with length >= 2)
    const words = raw.match(/[a-zA-Z0-9]{2,}/g) || [];
    if (words.length >= 3) {
      rawSegments.push({
        original: raw,
        offset,
        pageNumber: resolvePage(offset)
      });
    }
  }

  return rawSegments;
}

/**
 * Backward compatible helper that returns raw string array of sentences.
 * 
 * @param {string} text 
 * @returns {string[]}
 */
function splitIntoSentences(text) {
  const segments = splitIntoSentencesWithOffsets(text);
  return segments.map(s => s.original);
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
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 1);
}

/**
 * Checks if a sentence is a common generic boilerplate heading.
 * 
 * @param {string} sentence 
 * @param {string[]} tokens 
 * @returns {boolean}
 */
function isBoilerplateHeading(sentence, tokens) {
  if (!sentence || !tokens) return false;
  const clean = sentence.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  if (COMMON_BOILERPLATE_HEADINGS.has(clean)) return true;

  const contentTokens = tokens.filter(w => !STOP_WORDS.has(w));
  if (contentTokens.length <= 2 && COMMON_BOILERPLATE_HEADINGS.has(contentTokens.join(" "))) {
    return true;
  }
  if (contentTokens.length <= 3 && contentTokens.every(w => COMMON_BOILERPLATE_HEADINGS.has(w))) {
    return true;
  }

  return false;
}

/**
 * Computes meaningful overlap between two sentences.
 * Handles exact matching, word substitutions, and minor sentence edits.
 * 
 * @param {string[]} tokensA 
 * @param {string[]} tokensB 
 * @returns {{ score: number, matchedWords: string[], matchType: string }}
 */
function computeSentenceOverlap(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) {
    return { score: 0, matchedWords: [], matchType: "none" };
  }

  const contentA = tokensA.filter(w => !STOP_WORDS.has(w));
  const contentB = tokensB.filter(w => !STOP_WORDS.has(w));

  const contentSetB = new Set(contentB);
  const matchedContent = contentA.filter(w => contentSetB.has(w));
  const uniqueMatchedWords = [...new Set(matchedContent)];

  // If there are zero shared content words, reject as unrelated grammatical noise
  if (uniqueMatchedWords.length === 0) {
    return { score: 0, matchedWords: [], matchType: "none" };
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

  // Blended overlap score
  const score = Number(((contentJaccard * 0.35 + containment * 0.35 + contentRatio * 0.30) * 100).toFixed(1));

  let matchType = "partial";
  if (score >= 95.0 || (containment >= 0.95 && uniqueMatchedWords.length >= 4)) {
    matchType = "exact";
  } else if (score >= 80.0) {
    matchType = "high";
  } else if (score >= 60.0) {
    matchType = "modified";
  }

  return {
    score: Math.min(100, score),
    matchedWords: uniqueMatchedWords,
    matchType
  };
}

/**
 * Finds, aligns, and pairs matching passages between two documents.
 * 
 * @param {string} textA - Full text of Document A
 * @param {string} textB - Full text of Document B
 * @param {object} [options]
 * @param {number} [options.minSimilarity=35] - Minimum passage similarity percentage
 * @param {number} [options.maxPassages=15] - Maximum number of matching passages to return
 * @param {Array<object>} [options.pagesA=[]] - Optional page structure for Doc A
 * @param {Array<object>} [options.pagesB=[]] - Optional page structure for Doc B
 * @returns {Array<object>}
 */
function findMatchingPassages(textA, textB, {
  minSimilarity = 35,
  maxPassages = 15,
  pagesA = [],
  pagesB = []
} = {}) {
  if (!textA || !textB) return [];

  const segmentsA = splitIntoSentencesWithOffsets(textA, pagesA);
  const segmentsB = splitIntoSentencesWithOffsets(textB, pagesB);

  if (segmentsA.length === 0 || segmentsB.length === 0) return [];

  const tokenizedA = segmentsA.map(s => ({
    original: s.original,
    offset: s.offset,
    pageNumber: s.pageNumber,
    tokens: tokenizeSentence(s.original)
  }));

  const tokenizedB = segmentsB.map(s => ({
    original: s.original,
    offset: s.offset,
    pageNumber: s.pageNumber,
    tokens: tokenizeSentence(s.original)
  }));

  const matches = [];
  const usedB = new Set();

  for (let i = 0; i < tokenizedA.length; i++) {
    const itemA = tokenizedA[i];
    if (itemA.tokens.length < 3) continue;

    // Filter boilerplate headings
    if (isBoilerplateHeading(itemA.original, itemA.tokens)) continue;

    let bestMatch = null;
    let bestScore = 0;
    let bestIndexB = -1;

    for (let j = 0; j < tokenizedB.length; j++) {
      if (usedB.has(j)) continue;

      const itemB = tokenizedB[j];
      if (itemB.tokens.length < 3) continue;

      // Filter boilerplate headings on B
      if (isBoilerplateHeading(itemB.original, itemB.tokens)) continue;

      // Exact case-insensitive match check
      if (itemA.original.toLowerCase() === itemB.original.toLowerCase()) {
        const contentWords = [...new Set(itemA.tokens.filter(w => !STOP_WORDS.has(w)))];
        bestScore = 100;
        bestMatch = {
          passageA: itemA.original,
          passageB: itemB.original,
          pageA: itemA.pageNumber,
          pageB: itemB.pageNumber,
          offsetA: itemA.offset,
          offsetB: itemB.offset,
          similarity: 100,
          matchedWords: contentWords.length > 0 ? contentWords : [...new Set(itemA.tokens)],
          matchType: "exact"
        };
        bestIndexB = j;
        break;
      }

      const { score, matchedWords, matchType } = computeSentenceOverlap(itemA.tokens, itemB.tokens);
      if (score >= minSimilarity && score > bestScore) {
        bestScore = score;
        bestMatch = {
          passageA: itemA.original,
          passageB: itemB.original,
          pageA: itemA.pageNumber,
          pageB: itemB.pageNumber,
          offsetA: itemA.offset,
          offsetB: itemB.offset,
          similarity: score,
          matchedWords,
          matchType
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
 * Calculates the proportion of words in both documents that participate in verified matching passages.
 * Prevents under-scoring substantial partial copying where verbatim passages are copied.
 * 
 * @param {string} textA 
 * @param {string} textB 
 * @param {Array<object>} matchingPassages 
 * @returns {{ coverageA: number, coverageB: number, maxCoverage: number, avgCoverage: number }}
 */
function computePassageCoverage(textA, textB, matchingPassages = []) {
  if (!textA || !textB || !matchingPassages.length) {
    return { coverageA: 0, coverageB: 0, maxCoverage: 0, avgCoverage: 0 };
  }

  const wordsA = tokenizeSentence(textA);
  const wordsB = tokenizeSentence(textB);

  const matchedSet = new Set();
  for (const m of matchingPassages) {
    for (const w of m.matchedWords || []) {
      matchedSet.add(w.toLowerCase());
    }
  }

  const countA = wordsA.filter(w => matchedSet.has(w)).length;
  const countB = wordsB.filter(w => matchedSet.has(w)).length;

  const coverageA = wordsA.length > 0 ? countA / wordsA.length : 0;
  const coverageB = wordsB.length > 0 ? countB / wordsB.length : 0;

  return {
    coverageA: Number(coverageA.toFixed(4)),
    coverageB: Number(coverageB.toFixed(4)),
    maxCoverage: Number(Math.max(coverageA, coverageB).toFixed(4)),
    avgCoverage: Number(((coverageA + coverageB) / 2).toFixed(4))
  };
}

/**
 * Highlights matched words in text for side-by-side HTML display.
 * Strictly escapes text to prevent script execution / HTML injection.
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
  splitIntoSentencesWithOffsets,
  tokenizeSentence,
  isBoilerplateHeading,
  computeSentenceOverlap,
  findMatchingPassages,
  computePassageCoverage,
  highlightMatchedTokens,
  escapeHtml
};
