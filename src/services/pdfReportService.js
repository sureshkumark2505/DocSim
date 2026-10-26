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

    // 2. Privacy & Automatic Cleanup Certification Card
    const isCleanedUp = report.privacyAudit?.filesDeleted === true && report.privacyAudit?.cleanupStatus === "deleted";

    if (isCleanedUp) {
      doc.rect(40, currentY, 515, 42).fill("#ecfdf5");
      doc.rect(40, currentY, 515, 42).stroke("#a7f3d0");

      doc.fillColor("#065f46")
        .fontSize(9)
        .font("Helvetica-Bold")
        .text("PRIVACY & STORAGE STATUS: AUTOMATIC CLEANUP VERIFIED", 55, currentY + 8);

      const cleanupTime = report.privacyAudit?.cleanedUpAt
        ? new Date(report.privacyAudit.cleanedUpAt).toLocaleString()
        : "Recorded at completion";

      doc.fillColor("#047857")
        .fontSize(8)
        .font("Helvetica")
        .text(
          `Temporary uploaded files were verified deleted from server storage at ${cleanupTime}. Mathematical similarity metrics and matching passage evidence excerpts are retained for reporting.`,
          55,
          currentY + 22,
          { width: 485 }
        );
    } else {
      doc.rect(40, currentY, 515, 42).fill("#fffbeb");
      doc.rect(40, currentY, 515, 42).stroke("#fde68a");

      doc.fillColor("#92400e")
        .fontSize(9)
        .font("Helvetica-Bold")
        .text("PRIVACY & STORAGE STATUS: CLEANUP INCOMPLETE / PENDING", 55, currentY + 8);

      const notice = report.privacyAudit?.privacyNotice ||
        "Temporary uploaded files are pending cleanup or could not be verified as deleted from server storage.";

      doc.fillColor("#b45309")
        .fontSize(8)
        .font("Helvetica")
        .text(
          notice,
          55,
          currentY + 22,
          { width: 485 }
        );
    }

    currentY += 55;

    // 3. Executive Summary Grid
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

    // 4. Ranked Matches Table
    doc.fillColor(primaryColor)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("2. Ranked Document Similarity Matches", 40, currentY);

    doc.fillColor(textMuted)
      .fontSize(8)
      .font("Helvetica")
      .text("Ranked from highest to lowest similarity percentage.", 270, currentY + 3);

    currentY += 18;

    // Table Header
    doc.rect(40, currentY, 515, 20).fill(primaryColor);
    doc.fillColor("#ffffff")
      .fontSize(8)
      .font("Helvetica-Bold")
      .text("Rank", 45, currentY + 6, { width: 35 })
      .text("Document 1", 85, currentY + 6, { width: 155 })
      .text("Document 2", 245, currentY + 6, { width: 155 })
      .text("Similarity", 405, currentY + 6, { width: 60, align: "right" })
      .text("Classification", 475, currentY + 6, { width: 75, align: "right" });

    currentY += 20;

    const rankedMatches = report.rankedMatches || [];
    const displayMatches = rankedMatches.slice(0, 15);

    if (displayMatches.length === 0) {
      doc.rect(40, currentY, 515, 24).fill(lightBg).stroke(borderLine);
      doc.fillColor(textMuted).fontSize(8).font("Helvetica")
        .text("No pairwise comparison records found.", 55, currentY + 8);
      currentY += 30;
    } else {
      displayMatches.forEach((match, idx) => {
        if (currentY > 740) {
          doc.addPage();
          currentY = 50;
        }

        const rowBg = idx % 2 === 0 ? "#ffffff" : lightBg;
        doc.rect(40, currentY, 515, 18).fill(rowBg).stroke(borderLine);

        const pct = match.similarityPercentage || 0;
        const scoreColor = pct >= 80 ? "#0284c7" : (pct >= 50 ? "#7c3aed" : textDark);

        doc.fillColor(textMuted)
          .fontSize(8)
          .font("Helvetica")
          .text(`#${match.rank || idx + 1}`, 45, currentY + 5, { width: 35 });

        doc.fillColor(textDark)
          .fontSize(8)
          .font("Helvetica-Bold")
          .text(match.fileName1 || "--", 85, currentY + 5, { width: 155, ellipsis: true })
          .text(match.fileName2 || "--", 245, currentY + 5, { width: 155, ellipsis: true });

        doc.fillColor(scoreColor)
          .fontSize(8)
          .font("Helvetica-Bold")
          .text(`${pct.toFixed(2)}%`, 405, currentY + 5, { width: 60, align: "right" });

        doc.fillColor(textMuted)
          .fontSize(7.5)
          .font("Helvetica")
          .text(match.classification || "--", 475, currentY + 5, { width: 75, align: "right" });

        currentY += 18;
      });
    }

    currentY += 25;

    // 5. Matching Passage Evidence Section
    if (currentY > 600) {
      doc.addPage();
      currentY = 50;
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
      (m.evidence?.images && m.evidence.images.length > 0) ||
      (m.evidence?.code && m.evidence.code.length > 0) ||
      (m.evidence?.tables && m.evidence.tables.length > 0)
    ).slice(0, 5);

    if (matchesWithEvidence.length === 0) {
      doc.rect(40, currentY, 515, 32).fill(lightBg).stroke(borderLine);
      doc.fillColor(textMuted).fontSize(8).font("Helvetica")
        .text("No cross-document matching evidence recorded for this scan.", 55, currentY + 11);
      currentY += 40;
    } else {
      matchesWithEvidence.forEach((item) => {
        if (currentY > 650) {
          doc.addPage();
          currentY = 50;
        }

        // Pair Header
        doc.rect(40, currentY, 515, 22).fill("#f1f5f9").stroke(borderLine);
        doc.fillColor(primaryColor)
          .fontSize(8.5)
          .font("Helvetica-Bold")
          .text(`Evidence: ${item.fileName1}  vs  ${item.fileName2}`, 48, currentY + 6);

        doc.fillColor(accentBlue)
          .fontSize(8.5)
          .font("Helvetica-Bold")
          .text(`Overall: ${item.similarityPercentage.toFixed(2)}%`, 450, currentY + 6, { align: "right", width: 95 });

        currentY += 24;

        // 1. Text Passages (up to 2)
        const passages = (item.matchingPassages || []).slice(0, 2);
        passages.forEach((p, pIdx) => {
          if (currentY > 680) {
            doc.addPage();
            currentY = 50;
          }

          doc.rect(40, currentY, 515, 48).fill("#ffffff").stroke(borderLine);

          doc.fillColor(textMuted)
            .fontSize(7.5)
            .font("Helvetica-Bold")
            .text(`Text Passage Match #${pIdx + 1}:`, 48, currentY + 6);

          doc.fillColor(textDark)
            .fontSize(7.5)
            .font("Helvetica")
            .text(`Doc A: "${p.passageA}"`, 48, currentY + 18, { width: 495, ellipsis: true });

          doc.fillColor(textDark)
            .fontSize(7.5)
            .font("Helvetica")
            .text(`Doc B: "${p.passageB}"`, 48, currentY + 32, { width: 495, ellipsis: true });

          currentY += 52;
        });

        // 2. Screenshot / Image Evidence (up to 2)
        const imageEvidence = (item.evidence?.images || []).slice(0, 2);
        imageEvidence.forEach((img, iIdx) => {
          if (currentY > 700) {
            doc.addPage();
            currentY = 50;
          }

          doc.rect(40, currentY, 515, 28).fill("#ffffff").stroke(borderLine);
          doc.fillColor(textMuted)
            .fontSize(7.5)
            .font("Helvetica-Bold")
            .text(`Screenshot Match #${iIdx + 1}:`, 48, currentY + 5);

          doc.fillColor(textDark)
            .fontSize(7.5)
            .font("Helvetica")
            .text(`Doc A Image (Page ${img.pageA || 1})  <==>  Doc B Image (Page ${img.pageB || 1}) [Verification: ${img.isExact ? 'Exact Image Duplicate' : 'Perceptual Visual Match'}]`, 48, currentY + 16, { width: 495, ellipsis: true });

          currentY += 32;
        });

        // 3. Code Evidence (up to 2)
        const codeEvidence = (item.evidence?.code || []).slice(0, 2);
        codeEvidence.forEach((c, cIdx) => {
          if (currentY > 700) {
            doc.addPage();
            currentY = 50;
          }

          doc.rect(40, currentY, 515, 28).fill("#ffffff").stroke(borderLine);
          doc.fillColor(textMuted)
            .fontSize(7.5)
            .font("Helvetica-Bold")
            .text(`Code Match #${cIdx + 1}:`, 48, currentY + 5);

          doc.fillColor(textDark)
            .fontSize(7.5)
            .font("Helvetica")
            .text(`Statement: "${c.lineA}"`, 48, currentY + 16, { width: 495, ellipsis: true });

          currentY += 32;
        });

        // 4. Table Evidence (up to 1)
        const tableEvidence = (item.evidence?.tables || []).slice(0, 1);
        tableEvidence.forEach((t) => {
          if (currentY > 700) {
            doc.addPage();
            currentY = 50;
          }

          doc.rect(40, currentY, 515, 28).fill("#ffffff").stroke(borderLine);
          doc.fillColor(textMuted)
            .fontSize(7.5)
            .font("Helvetica-Bold")
            .text(`Experimental Results Table Match:`, 48, currentY + 5);

          doc.fillColor(textDark)
            .fontSize(7.5)
            .font("Helvetica")
            .text(`Table ${t.tableAIndex || 1} in Doc A matches Table ${t.tableBIndex || 1} in Doc B (overlapping experimental data rows)`, 48, currentY + 16, { width: 495, ellipsis: true });

          currentY += 32;
        });

        currentY += 8;
      });
    }

    // 6. Footer on all pages
    const pageRange = doc.bufferedPageRange();
    for (let i = 0; i < pageRange.count; i++) {
      doc.switchToPage(i);
      doc.fillColor(textMuted)
        .fontSize(7.5)
        .font("Helvetica")
        .text(
          `DocSim Intelligence Platform • Automated Document Similarity Verification Report • Page ${i + 1} of ${pageRange.count}`,
          40,
          800,
          { align: "center", width: 515 }
        );
    }

    return doc;
  }
};

module.exports = pdfReportService;
