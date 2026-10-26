/**
 * Service to detect, normalize, tokenize, and compare programming code
 * across documents and screenshots.
 */

// Common programming language keywords for detection and tokenization
const CODE_KEYWORDS = new Set([
  "abstract", "arguments", "as", "async", "await", "boolean", "break", "byte", "case", "catch",
  "char", "class", "const", "continue", "debugger", "default", "delete", "do", "double", "else",
  "enum", "eval", "export", "extends", "false", "final", "finally", "float", "for", "from",
  "function", "goto", "if", "implements", "import", "in", "instanceof", "int", "interface",
  "let", "long", "native", "new", "null", "package", "private", "protected", "public",
  "return", "short", "static", "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "true", "try", "typeof", "var", "void", "volatile", "while", "with", "yield",
  "def", "elif", "except", "lambda", "pass", "raise", "include", "printf", "cout", "cin", "vector"
]);

// Common assignment boilerplate lines to suppress from dominating similarity
const BOILERPLATE_PATTERNS = [
  /^#include\s*<.*>$/i,
  /^using\s+namespace\s+std\s*;?$/i,
  /^int\s+main\s*\([^)]*\)\s*\{?$/i,
  /^return\s+0\s*;?$/i,
  /^public\s+class\s+\w+\s*\{?$/i,
  /^public\s+static\s+void\s+main\s*\([^)]*\)\s*\{?$/i,
  /^from\s+\w+\s+import\s+\w+$/i,
  /^import\s+\w+$/i
];

const codeService = {
  /**
   * Evaluates whether a given text snippet appears to be programming source code.
   * @param {string} text 
   * @returns {{ isCode: boolean, confidence: number, matchedKeywords: string[] }}
   */
  detectCode(text) {
    if (!text || typeof text !== "string") {
      return { isCode: false, confidence: 0, matchedKeywords: [] };
    }

    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      return { isCode: false, confidence: 0, matchedKeywords: [] };
    }

    const words = text.toLowerCase().match(/\b[a-z_][a-z0-9_]*\b/g) || [];
    const matchedKeywords = words.filter(w => CODE_KEYWORDS.has(w));
    const uniqueKeywords = [...new Set(matchedKeywords)];

    // Structural indicators: semicolons, braces, arrows, indentation
    const hasSemicolons = (text.match(/;/g) || []).length;
    const hasBraces = (text.match(/[\{\}\[\]\(\)]/g) || []).length;
    const hasOperators = (text.match(/[=+\-*/<>!&|]=?/g) || []).length;
    const hasIndentedLines = lines.filter(l => /^[ \t]{2,}/.test(l)).length;

    let score = 0;
    if (uniqueKeywords.length >= 3) score += 35;
    if (uniqueKeywords.length >= 6) score += 25;
    if (hasSemicolons >= 2) score += 15;
    if (hasBraces >= 4) score += 15;
    if (hasOperators >= 3) score += 10;

    const isCode = score >= 45 || (uniqueKeywords.length >= 4 && hasBraces >= 2);

    return {
      isCode,
      confidence: Math.min(100, score),
      matchedKeywords: uniqueKeywords
    };
  },

  /**
   * Normalizes code snippet:
   * - Strips single-line and multi-line comments
   * - Strips common boilerplate header lines
   * - Collapses whitespace
   * - Standardizes delimiters
   * 
   * @param {string} code 
   * @param {object} [options]
   * @param {boolean} [options.stripBoilerplate=true]
   * @returns {string}
   */
  normalizeCode(code, options = {}) {
    if (!code || typeof code !== "string") return "";
    const stripBoilerplate = options.stripBoilerplate !== false;

    // 1. Remove multi-line comments /* ... */
    let cleaned = code.replace(/\/\*[\s\S]*?\*\//g, "");

    // 2. Remove single-line comments // ... and # ... (except #include)
    cleaned = cleaned.replace(/\/\/[^\n]*/g, "");
    cleaned = cleaned.replace(/(?<!#include.*)#(?![a-zA-Z]).*/g, "");

    // 3. Process line by line
    const rawLines = cleaned.split("\n");
    const preservedLines = [];

    for (const raw of rawLines) {
      const line = raw.trim();
      if (!line) continue;

      if (stripBoilerplate) {
        const isBoilerplate = BOILERPLATE_PATTERNS.some(pat => pat.test(line));
        if (isBoilerplate) continue;
      }

      // Collapse internal whitespace
      const normalizedLine = line.replace(/\s+/g, " ");
      preservedLines.push(normalizedLine);
    }

    // If stripBoilerplate is true and only isolated brackets/braces remain, clean them up
    if (stripBoilerplate) {
      const meaningfulLines = preservedLines.filter(l => !/^[{}();,\s]+$/.test(l));
      if (meaningfulLines.length === 0) {
        return "";
      }
    }

    return preservedLines.join("\n");
  },

  /**
   * Tokenizes normalized code into structural and lexical tokens.
   * Strips identifier variance if abstractIdentifiers is true.
   * 
   * @param {string} code 
   * @param {boolean} [abstractIdentifiers=false]
   * @returns {string[]}
   */
  tokenizeCode(code, abstractIdentifiers = false) {
    if (!code) return [];
    const normalized = this.normalizeCode(code);

    // Split on symbols and whitespace while keeping keywords intact
    const rawTokens = normalized
      .replace(/([\{\}\(\)\[\];,\.=\+\-\*\/<>!&|])/g, " $1 ")
      .split(/\s+/)
      .filter(Boolean);

    if (!abstractIdentifiers) {
      return rawTokens.map(t => t.toLowerCase());
    }

    // Abstract identifiers to detect structural copying despite variable renaming
    return rawTokens.map(t => {
      const lower = t.toLowerCase();
      if (CODE_KEYWORDS.has(lower) || /^[0-9]+$/.test(lower) || /^[^\w\s]$/.test(lower)) {
        return lower;
      }
      return "ID";
    });
  },

  /**
   * Compares two code blocks and returns similarity in range [0, 1].
   * Uses both exact token Jaccard and abstract identifier token overlap.
   * 
   * @param {string} codeA 
   * @param {string} codeB 
   * @returns {{ similarity: number, matchingLines: Array<{ lineA: string, lineB: string }>, tokenCountA: number, tokenCountB: number }}
   */
  compareCode(codeA, codeB) {
    const normA = this.normalizeCode(codeA);
    const normB = this.normalizeCode(codeB);

    if (!normA || !normB) {
      return { similarity: 0, matchingLines: [], tokenCountA: 0, tokenCountB: 0 };
    }

    const tokensA = this.tokenizeCode(normA, false);
    const tokensB = this.tokenizeCode(normB, false);

    if (tokensA.length === 0 || tokensB.length === 0) {
      return { similarity: 0, matchingLines: [], tokenCountA: 0, tokenCountB: 0 };
    }

    // 1. Literal Token Jaccard
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    const intersectionSize = [...setA].filter(t => setB.has(t)).length;
    const unionSize = new Set([...setA, ...setB]).size;
    const literalJaccard = unionSize > 0 ? intersectionSize / unionSize : 0;

    // 2. Abstract Token Overlap (detects logic structure when variable names are modified)
    const abstractA = this.tokenizeCode(normA, true);
    const abstractB = this.tokenizeCode(normB, true);
    const absSetA = new Set(abstractA);
    const absSetB = new Set(abstractB);
    const absIntersection = [...absSetA].filter(t => absSetB.has(t)).length;
    const absUnion = new Set([...absSetA, ...absSetB]).size;
    const abstractJaccard = absUnion > 0 ? absIntersection / absUnion : 0;

    // 3. Line-by-line matching for human review evidence
    const linesA = normA.split("\n");
    const linesB = normB.split("\n");
    const matchingLines = [];

    const linesSetB = new Set(linesB);
    for (const lA of linesA) {
      if (lA.length > 5 && linesSetB.has(lA)) {
        matchingLines.push({ lineA: lA, lineB: lA });
      }
    }

    // Balanced combination: 60% literal, 40% abstract
    const combinedScore = (literalJaccard * 0.6) + (abstractJaccard * 0.4);

    // If literal matching produced no lines but structural similarity is high, match on abstract tokens
    if (matchingLines.length === 0 && combinedScore >= 0.5) {
      for (const lA of linesA) {
        const absTokensA = this.tokenizeCode(lA, true);
        if (absTokensA.length < 3) continue;
        const absStrA = absTokensA.join(" ");

        for (const lB of linesB) {
          const absTokensB = this.tokenizeCode(lB, true);
          if (absTokensB.length < 3) continue;
          const absStrB = absTokensB.join(" ");

          if (absStrA === absStrB) {
            matchingLines.push({ lineA: lA, lineB: lB });
            break;
          }
        }
      }
    }

    return {
      similarity: Number(Math.min(1.0, combinedScore).toFixed(4)),
      matchingLines: matchingLines.slice(0, 10),
      tokenCountA: tokensA.length,
      tokenCountB: tokensB.length
    };
  }
};

module.exports = codeService;
