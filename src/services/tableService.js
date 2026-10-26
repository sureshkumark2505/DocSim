/**
 * Service to extract, normalize, and compare tabular experimental results
 * and tables from documents.
 */

const tableService = {
  /**
   * Extracts tables from a DOCX document's word/document.xml string.
   * 
   * @param {string} xmlString 
   * @returns {Array<{ tableIndex: number, rowCount: number, colCount: number, rows: string[][] }>}
   */
  extractTablesFromDocxXml(xmlString) {
    if (!xmlString || typeof xmlString !== "string") return [];

    const tables = [];
    const tableMatches = xmlString.match(/<w:tbl[\s\S]*?<\/w:tbl>/g) || [];

    for (let tIdx = 0; tIdx < tableMatches.length; tIdx++) {
      const tblXml = tableMatches[tIdx];
      const rowMatches = tblXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
      const rows = [];

      for (const rXml of rowMatches) {
        const cellMatches = rXml.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
        const cells = [];

        for (const cXml of cellMatches) {
          const textParts = cXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
          const cellText = textParts.map(t => t.replace(/<[^>]+>/g, "")).join(" ").trim();
          cells.push(cellText);
        }

        if (cells.length > 0 && cells.some(c => c.length > 0)) {
          rows.push(cells);
        }
      }

      if (rows.length > 0) {
        const colCount = Math.max(...rows.map(r => r.length), 0);
        tables.push({
          tableIndex: tIdx + 1,
          rowCount: rows.length,
          colCount,
          rows
        });
      }
    }

    return tables;
  },

  /**
   * Normalizes cell value for comparison (trim, lowercase, canonical numbers).
   * @param {string} val 
   * @returns {string}
   */
  normalizeCellValue(val) {
    if (!val) return "";
    const clean = String(val).toLowerCase().trim().replace(/\s+/g, " ");
    // Normalize numeric values if clean number (e.g. "9.80" -> "9.8")
    const num = parseFloat(clean);
    if (!isNaN(num) && clean.match(/^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$/)) {
      return String(Number(num.toFixed(4)));
    }
    return clean;
  },

  /**
   * Compares two tables based on structure and normalized cell values.
   * 
   * @param {object} tableA 
   * @param {object} tableB 
   * @returns {{ similarity: number, matchingCellsCount: number, matchingRows: Array<{ rowA: string[], rowB: string[] }> }}
   */
  compareTables(tableA, tableB) {
    if (!tableA || !tableB || !tableA.rows?.length || !tableB.rows?.length) {
      return { similarity: 0, matchingCellsCount: 0, matchingRows: [] };
    }

    // 1. Structure similarity (dimensions)
    const maxRows = Math.max(tableA.rowCount, tableB.rowCount);
    const minRows = Math.min(tableA.rowCount, tableB.rowCount);
    const rowRatio = maxRows > 0 ? minRows / maxRows : 1.0;

    const maxCols = Math.max(tableA.colCount, tableB.colCount);
    const minCols = Math.min(tableA.colCount, tableB.colCount);
    const colRatio = maxCols > 0 ? minCols / maxCols : 1.0;

    const structureScore = (rowRatio + colRatio) / 2.0;

    // 2. Cell content overlap
    const cellsA = tableA.rows.flat().map(this.normalizeCellValue).filter(Boolean);
    const cellsB = tableB.rows.flat().map(this.normalizeCellValue).filter(Boolean);

    if (cellsA.length === 0 || cellsB.length === 0) {
      return { similarity: 0, matchingCellsCount: 0, matchingRows: [] };
    }

    const setA = new Set(cellsA);
    const setB = new Set(cellsB);
    const matchingCells = [...setA].filter(c => setB.has(c));
    const unionCells = new Set([...setA, ...setB]).size;

    const cellJaccard = unionCells > 0 ? matchingCells.length / unionCells : 0;

    // 3. Row matching for evidence inspection
    const matchingRows = [];
    for (const rA of tableA.rows) {
      const normRA = rA.map(this.normalizeCellValue).join(" | ");
      for (const rB of tableB.rows) {
        const normRB = rB.map(this.normalizeCellValue).join(" | ");
        if (normRA.length > 3 && normRA === normRB) {
          matchingRows.push({ rowA: rA, rowB: rB });
          break;
        }
      }
    }

    // Weighted similarity: 30% structure, 70% cell content
    const similarity = (structureScore * 0.3) + (cellJaccard * 0.7);

    return {
      similarity: Number(Math.min(1.0, similarity).toFixed(4)),
      matchingCellsCount: matchingCells.length,
      matchingRows: matchingRows.slice(0, 5)
    };
  },

  /**
   * Compares all tables between Document A and Document B.
   * Returns highest table match and overall table similarity.
   * 
   * @param {Array<object>} tablesA 
   * @param {Array<object>} tablesB 
   * @returns {{ similarity: number, tableMatches: Array<object> }}
   */
  compareAllTables(tablesA, tablesB) {
    if (!tablesA?.length || !tablesB?.length) {
      return { similarity: 0, tableMatches: [] };
    }

    const tableMatches = [];
    let maxSim = 0;

    for (const tA of tablesA) {
      for (const tB of tablesB) {
        const comp = this.compareTables(tA, tB);
        if (comp.similarity >= 0.35) {
          tableMatches.push({
            tableAIndex: tA.tableIndex,
            tableBIndex: tB.tableIndex,
            similarity: comp.similarity,
            matchingRows: comp.matchingRows
          });
        }
        if (comp.similarity > maxSim) {
          maxSim = comp.similarity;
        }
      }
    }

    return {
      similarity: Number(maxSim.toFixed(4)),
      tableMatches
    };
  }
};

module.exports = tableService;
