const PDFDocument = require("pdfkit");
const resultService = require("./resultService");

/**
 * Service to generate professional downloadable PDF reports for similarity scans.
 */
const pdfReportService = {
  /**
   * Generates a PDF document stream for a given scan report.
   * 
   * @param {string} scanId 
   * @returns {Promise<PDFDocument>}
   */
  async generateReportPdf(scanId) {
    const report = await resultService.getScanReport(scanId);
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      bufferPages: true,
      autoFirstPage: true,
      info: {
        Title: `DocSim Similarity Report - ${scanId}`,
        Author: "DocSim Document Intelligence Platform",
        Subject: "Document Similarity and Plagiarism Review Report"
      }
    });

    const primaryColor = "#1e293b";
    const accentBlue = "#0284c7";
    const textDark = "#0f172a";
    const textMuted = "#64748b";
    const lightBg = "#f8fafc";
    const borderLine = "#e2e8f0";
    const pageBottomLimit = 760;

    // Helper: Safely format filename for wrapping without overflow
    function sanitizeForPdf(str) {
      if (!str) return "--";
      return String(str)
        .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "")
        .trim();
    }

    // 1. Header Banner
    doc.rect(40, 40, 515, 65).fill(lightBg);
    doc.rect(40, 40, 515, 65).stroke(borderLine);

    doc.fillColor(accentBlue)
      .fontSize(20)
      .font("Helvetica-Bold")
      .text("DOCSIM", 55, 52);

    doc.fillColor(primaryColor)
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("Document Similarity & Plagiarism Review Report", 55, 78);

    doc.fillColor(textMuted)
      .fontSize(8)
      .font("Helvetica")
      .text(`Scan ID: ${scanId}`, 340, 55, { align: "right", width: 200 })
      .text(`Generated: ${new Date().toLocaleString()}`, 340, 68, { align: "right", width: 200 })
      .text(`Status: Completed`, 340, 81, { align: "right", width: 200 });

    let currentY = 120;

    // 2. Executive Summary Grid (Presentation privacy banners removed)
    doc.fillColor(primaryColor)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("1. Executive Summary & Key Metrics", 40, currentY);

    currentY += 18;

    const summary = report.summary || {};
    const metricBoxes = [
      { label: "Documents Analyzed", value: String(summary.documentsAnalyzed || 0) },
      { label: "Duplicate Files (100%)", value: String(summary.duplicateFilesCount || 0) },
      { label: "Overall Avg Similarity", value: (summary.overallAverageSimilarity !== null && summary.overallAverageSimilarity !== undefined) ? `${summary.overallAverageSimilarity}%` : "--" },
      { label: "Highest Document Avg", value: (summary.highestAverageSimilarity !== null && summary.highestAverageSimilarity !== undefined) ? `${summary.highestAverageSimilarity}%` : "--" }
    ];

    const boxWidth = 122;
    metricBoxes.forEach((m, idx) => {
      const bx = 40 + idx * (boxWidth + 9);
      doc.rect(bx, currentY, boxWidth, 48).fill(lightBg);
      doc.rect(bx, currentY, boxWidth, 48).stroke(borderLine);

      doc.fillColor(textMuted)
        .fontSize(7.5)
        .font("Helvetica")
        .text(m.label, bx + 6, currentY + 8, { width: boxWidth - 12 });

      doc.fillColor(accentBlue)
        .fontSize(14)
        .font("Helvetica-Bold")
        .text(m.value, bx + 6, currentY + 24, { width: boxWidth - 12 });
    });

    currentY += 65;

    // 3. Ranked Matches Table Section Header
    doc.fillColor(primaryColor)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("2. Ranked Document Similarity Matches", 40, currentY);

    doc.fillColor(textMuted)
      .fontSize(8)
      .font("Helvetica")
      .text("Ranked from highest to lowest similarity percentage.", 270, currentY + 3);

    currentY += 18;

    // Table Column Metrics:
    // Rank: x=45, w=35
    // Doc 1: x=85, w=160
    // Doc 2: x=250, w=160
    // Similarity: x=415, w=60
    // Classification: x=480, w=70
    function renderTableHeader(yPos) {
      doc.rect(40, yPos, 515, 20).fill(primaryColor);
      doc.fillColor("#ffffff")
        .fontSize(8)
        .font("Helvetica-Bold")
        .text("Rank", 45, yPos + 6, { width: 35 })
        .text("Document 1", 85, yPos + 6, { width: 160 })
        .text("Document 2", 250, yPos + 6, { width: 160 })
        .text("Similarity", 415, yPos + 6, { width: 60, align: "right" })
        .text("Classification", 480, yPos + 6, { width: 70, align: "right" });
      return yPos + 20;
    }

    currentY = renderTableHeader(currentY);

    const rankedMatches = report.rankedMatches || [];
    const displayMatches = rankedMatches.slice(0, 100);

    if (displayMatches.length === 0) {
      doc.rect(40, currentY, 515, 24).fill(lightBg).stroke(borderLine);
      doc.fillColor(textMuted).fontSize(8).font("Helvetica")
        .text("No pairwise comparison records found.", 55, currentY + 8);
      currentY += 30;
    } else {
      displayMatches.forEach((match, idx) => {
        const file1 = sanitizeForPdf(match.fileName1);
        const file2 = sanitizeForPdf(match.fileName2);

        // Calculate dynamic heights for filenames with width 160
        doc.fontSize(8).font("Helvetica-Bold");
        const h1 = doc.heightOfString(file1, { width: 160 });
        const h2 = doc.heightOfString(file2, { width: 160 });
        const maxTextHeight = Math.max(h1, h2);
        const rowPadding = 8;
        const rowHeight = Math.max(20, Math.ceil(maxTextHeight + rowPadding));

        // Check for page break with continuation header
        if (currentY + rowHeight > pageBottomLimit) {
          doc.addPage();
          currentY = 40;
          currentY = renderTableHeader(currentY);
        }

        const rowBg = idx % 2 === 0 ? "#ffffff" : lightBg;
        doc.rect(40, currentY, 515, rowHeight).fill(rowBg).stroke(borderLine);

        const pct = typeof match.similarityPercentage === "number" ? match.similarityPercentage : 0;
        const scoreColor = pct >= 80 ? "#0284c7" : (pct >= 50 ? "#7c3aed" : textDark);
        const textY = currentY + 4;

        // Rank
        doc.fillColor(textMuted)
          .fontSize(8)
          .font("Helvetica")
          .text(`#${match.rank || idx + 1}`, 45, textY, { width: 35 });

        // Doc 1 (wrapped)
        doc.fillColor(textDark)
          .fontSize(8)
          .font("Helvetica-Bold")
          .text(file1, 85, textY, { width: 160, lineBreak: true });

        // Doc 2 (wrapped)
        doc.fillColor(textDark)
          .fontSize(8)
          .font("Helvetica-Bold")
          .text(file2, 250, textY, { width: 160, lineBreak: true });

        // Similarity % (single overall percentage)
        doc.fillColor(scoreColor)
          .fontSize(8)
          .font("Helvetica-Bold")
          .text(`${pct.toFixed(2)}%`, 415, textY, { width: 60, align: "right" });

        // Classification
        doc.fillColor(textMuted)
          .fontSize(7.5)
          .font("Helvetica")
          .text(match.classification || "--", 480, textY, { width: 70, align: "right" });

        currentY += rowHeight;
      });
    }

    currentY += 25;

    // 4. Matching Passage Evidence Section (Orphan prevention: keep heading with content)
    if (currentY > 640) {
      doc.addPage();
      currentY = 40;
    }

    doc.fillColor(primaryColor)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("3. Matching Evidence (Text, Screenshots, Code, Tables)", 40, currentY);

    doc.fillColor(textMuted)
      .fontSize(8)
      .font("Helvetica")
      .text("Direct evidence of overlapping content across documents. Single overall similarity percentage shown.", 40, currentY + 14);

    currentY += 28;

    // Filter matches that have matching passages or multimodal evidence
    const matchesWithEvidence = rankedMatches.filter(m =>
      (m.matchingPassages && m.matchingPassages.length > 0) ||
      (m.evidence?.passages && m.evidence.passages.length > 0) ||
      (m.evidence?.images && m.evidence.images.length > 0) ||
      (m.evidence?.code && m.evidence.code.length > 0) ||
      (m.evidence?.tables && m.evidence.tables.length > 0)
    ).slice(0, 20);

    if (matchesWithEvidence.length === 0) {
      doc.rect(40, currentY, 515, 32).fill(lightBg).stroke(borderLine);
      doc.fillColor(textMuted).fontSize(8).font("Helvetica")
        .text("No cross-document matching evidence recorded for this scan.", 55, currentY + 11);
      currentY += 40;
    } else {
      matchesWithEvidence.forEach((item) => {
        // Pair Header requires at least 45pt
        if (currentY > 700) {
          doc.addPage();
          currentY = 40;
        }

        const file1 = sanitizeForPdf(item.fileName1);
        const file2 = sanitizeForPdf(item.fileName2);
        const pairPct = typeof item.similarityPercentage === "number" ? item.similarityPercentage : 0;

        // Pair Header Bar
        doc.rect(40, currentY, 515, 22).fill("#f1f5f9").stroke(borderLine);
        doc.fillColor(primaryColor)
          .fontSize(8.5)
          .font("Helvetica-Bold")
          .text(`Evidence: ${file1}  vs  ${file2}`, 48, currentY + 6, { width: 380, ellipsis: true });

        doc.fillColor(accentBlue)
          .fontSize(8.5)
          .font("Helvetica-Bold")
          .text(`Overall: ${pairPct.toFixed(2)}%`, 435, currentY + 6, { align: "right", width: 110 });

        currentY += 26;

        // Text Passages
        const passages = (item.matchingPassages || item.evidence?.passages || []).slice(0, 5);
        passages.forEach((p, pIdx) => {
          const passA = sanitizeForPdf(p.passageA || p.matchedWords?.join(" ") || "");
          const passB = sanitizeForPdf(p.passageB || p.passageA || "");
          const locA = p.pageA ? `Page ${p.pageA}` : (p.offsetA !== undefined ? `Offset ${p.offsetA}` : "");
          const locB = p.pageB ? `Page ${p.pageB}` : (p.offsetB !== undefined ? `Offset ${p.offsetB}` : "");
          const matchLabel = p.matchType ? p.matchType.toUpperCase() : "MATCH";
          const overlapPct = p.similarity ? ` • Overlap: ${p.similarity.toFixed(1)}%` : "";

          // Measure heights dynamically
          doc.fontSize(7.5).font("Helvetica");
          const labelA = locA ? `Doc A (${locA}):` : "Doc A:";
          const textAStr = `"${passA}"`;
          const hA = doc.heightOfString(`${labelA} ${textAStr}`, { width: 495 });

          const labelB = locB ? `Doc B (${locB}):` : "Doc B:";
          const textBStr = `"${passB}"`;
          const hB = doc.heightOfString(`${labelB} ${textBStr}`, { width: 495 });

          const headerH = 16;
          const passageCardH = Math.ceil(headerH + hA + hB + 16);

          if (currentY + passageCardH > pageBottomLimit) {
            doc.addPage();
            currentY = 40;
          }

          doc.rect(40, currentY, 515, passageCardH).fill("#ffffff").stroke(borderLine);

          let innerY = currentY + 6;
          doc.fillColor(textMuted)
            .fontSize(7.5)
            .font("Helvetica-Bold")
            .text(`Text Passage Match #${pIdx + 1} (${matchLabel}${overlapPct}):`, 48, innerY);

          innerY += 12;
          doc.fillColor(textDark)
            .fontSize(7.5)
            .font("Helvetica")
            .text(`${labelA} ${textAStr}`, 48, innerY, { width: 495, lineBreak: true });

          innerY += hA + 4;
          doc.fillColor(textDark)
            .fontSize(7.5)
            .font("Helvetica")
            .text(`${labelB} ${textBStr}`, 48, innerY, { width: 495, lineBreak: true });

          currentY += passageCardH + 6;
        });

        // Screenshot / Image Evidence
        const imageEvidence = (item.evidence?.images || []).slice(0, 3);
        imageEvidence.forEach((img, iIdx) => {
          const cardH = 34;
          if (currentY + cardH > pageBottomLimit) {
            doc.addPage();
            currentY = 40;
          }

          doc.rect(40, currentY, 515, cardH).fill("#ffffff").stroke(borderLine);
          doc.fillColor(textMuted)
            .fontSize(7.5)
            .font("Helvetica-Bold")
            .text(`Screenshot Match #${iIdx + 1}:`, 48, currentY + 6);

          doc.fillColor(textDark)
            .fontSize(7.5)
            .font("Helvetica")
            .text(
              `Doc A Image (Page ${img.pageA || 1})  <==>  Doc B Image (Page ${img.pageB || 1}) [Verification: ${img.isExact ? 'Exact Image Duplicate' : 'Perceptual Visual Match'}]`,
              48,
              currentY + 18,
              { width: 495, ellipsis: true }
            );

          currentY += cardH + 4;
        });

        // Code Evidence
        const codeEvidence = (item.evidence?.code || []).slice(0, 3);
        codeEvidence.forEach((c, cIdx) => {
          const codeSnippet = sanitizeForPdf(c.lineA || c.code || "");
          doc.fontSize(7.5).font("Courier");
          const codeH = Math.min(60, doc.heightOfString(codeSnippet, { width: 495 }));
          const cardH = Math.ceil(24 + codeH);

          if (currentY + cardH > pageBottomLimit) {
            doc.addPage();
            currentY = 40;
          }

          doc.rect(40, currentY, 515, cardH).fill("#ffffff").stroke(borderLine);
          doc.fillColor(textMuted)
            .fontSize(7.5)
            .font("Helvetica-Bold")
            .text(`Code Match #${cIdx + 1}:`, 48, currentY + 6);

          doc.fillColor(textDark)
            .fontSize(7.5)
            .font("Courier")
            .text(codeSnippet, 48, currentY + 18, { width: 495, lineBreak: true });

          currentY += cardH + 4;
        });

        // Table Evidence
        const tableEvidence = (item.evidence?.tables || []).slice(0, 2);
        tableEvidence.forEach((t) => {
          const cardH = 34;
          if (currentY + cardH > pageBottomLimit) {
            doc.addPage();
            currentY = 40;
          }

          doc.rect(40, currentY, 515, cardH).fill("#ffffff").stroke(borderLine);
          doc.fillColor(textMuted)
            .fontSize(7.5)
            .font("Helvetica-Bold")
            .text(`Experimental Results Table Match:`, 48, currentY + 6);

          doc.fillColor(textDark)
            .fontSize(7.5)
            .font("Helvetica")
            .text(
              `Table ${t.tableAIndex || 1} in Doc A matches Table ${t.tableBIndex || 1} in Doc B (overlapping experimental data rows)`,
              48,
              currentY + 18,
              { width: 495, ellipsis: true }
            );

          currentY += cardH + 4;
        });

        currentY += 8;
      });
    }

    // 5. Footer with reliable pagination ("Page X of Y") on all pages (prevent blank page auto-triggers)
    const pageRange = doc.bufferedPageRange();
    for (let i = 0; i < pageRange.count; i++) {
      doc.switchToPage(i);
      const originalBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fillColor(textMuted)
        .fontSize(7.5)
        .font("Helvetica")
        .text(
          `DocSim Intelligence Platform • Automated Document Similarity Verification Report • Page ${i + 1} of ${pageRange.count}`,
          40,
          810,
          { align: "center", width: 515 }
        );
      doc.page.margins.bottom = originalBottom;
    }

    return doc;
  }
};

module.exports = pdfReportService;
