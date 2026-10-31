const layers = Array.from(document.querySelectorAll(".layer"));
const parallaxTargets = Array.from(document.querySelectorAll(".parallax"));
const enterSystemBtn = document.getElementById("enterSystemBtn");
const startScanBtn = document.getElementById("startScanBtn");
const returnHomeBtn = document.getElementById("returnHomeBtn");
const backToUploadBtn = document.getElementById("backToUploadBtn");
const returnResultsBtn = document.getElementById("returnResultsBtn");

const filesInput = document.getElementById("filesInput");
const chooseFilesBtn = document.getElementById("chooseFilesBtn");
const clearFilesBtn = document.getElementById("clearFilesBtn");
const fileCount = document.getElementById("fileCount");
const selectedFilesPreview = document.getElementById("selectedFilesPreview");
const uploadError = document.getElementById("uploadError");
const uploadInfo = document.getElementById("uploadInfo");
const resultsError = document.getElementById("resultsError");
const historyError = document.getElementById("historyError");
const resultsGrid = document.getElementById("resultsGrid");
const historyTableBody = document.getElementById("historyTableBody");

const API_BASE = (window.DOCSIM_API_BASE || "").replace(/\/+$/, "");
const apiUrl = (path) => (API_BASE ? `${API_BASE}${path}` : path);

const featureCarousel = document.getElementById("featureCarousel");
const carouselPrev = document.getElementById("carouselPrev");
const carouselNext = document.getElementById("carouselNext");
const bookElement = document.querySelector(".book");
const heroTitle = document.getElementById("heroTitle");
const heroPanel = document.querySelector("#layer1 .panel-scroll");
const filePicker = document.querySelector(".file-picker");
let heroLetters = [];

let pointerX = 0;
let pointerY = 0;
let bookScrollOffset = 0;
let selectedFiles = [];
const ALLOWED_EXTENSIONS = new Set(["txt", "pdf", "docx", "png", "jpg", "jpeg", "webp"]);

function showLayer(layerNumber) {
  layers.forEach((layer) => {
    layer.classList.toggle("active", Number(layer.dataset.layer) === layerNumber);
  });

  const activeLayer = layers.find((layer) => Number(layer.dataset.layer) === layerNumber);
  playLayerReveals(activeLayer);
  if (layerNumber === 1) {
    playHeroReveal();
    window.setTimeout(() => {
      if (heroPanel) {
        heroPanel.scrollTop = 0;
      }
    }, 0);
  } else if (layerNumber === 4) {
    window.setTimeout(() => {
      const resultsPanel = document.querySelector(".results-panel");
      if (resultsPanel) {
        resultsPanel.scrollTop = 0;
      }
      const layer4 = document.getElementById("layer4");
      if (layer4) {
        layer4.scrollTop = 0;
      }
    }, 0);
  }
}

function setText(el, text) {
  if (el) {
    el.textContent = text || "";
  }
}

function clearMessages() {
  setText(uploadError, "");
  setText(uploadInfo, "");
  setText(resultsError, "");
  setText(historyError, "");
}

function updateFileCount() {
  const total = selectedFiles.length;
  setText(fileCount, total ? `${total} file${total > 1 ? "s" : ""} selected` : "No files selected");
  if (!total) {
    setText(selectedFilesPreview, "");
    return;
  }

  const previewNames = selectedFiles.slice(0, 4).map((file) => file.name);
  const suffix = total > 4 ? ` +${total - 4} more` : "";
  setText(selectedFilesPreview, previewNames.join(", ") + suffix);
}

function syncUploadState() {
  const total = selectedFiles.length;

  if (total === 0) {
    startScanBtn.disabled = false;
    return;
  }

  if (total < 2) {
    setText(uploadError, "Select at least 2 files.");
    startScanBtn.disabled = true;
    return;
  }

  if (total > 1000) {
    setText(uploadError, "You can select maximum 1000 files.");
    filesInput.value = "";
    updateFileCount();
    startScanBtn.disabled = false;
    return;
  }

  setText(uploadError, "");
  startScanBtn.disabled = false;
}

function validateFiles(files) {
  if (!files || files.length < 2) {
    return "Upload at least 2 files.";
  }

  if (files.length > 1000) {
    return "You can upload up to 1000 files only.";
  }

  for (const file of files) {
    const extension = file.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return `Unsupported file type: ${file.name}. Allowed: PDF, DOCX, PNG, JPG, WEBP, TXT.`;
    }
  }

  return null;
}

function addPickedFiles(pickedFiles) {
  const keyed = new Map(selectedFiles.map((file) => [`${file.name}|${file.size}|${file.lastModified}`, file]));
  const invalidFiles = [];
  const unavailableFiles = [];
  let ignoredByLimit = 0;

  pickedFiles.forEach((file) => {
    if (file.size === 0) {
      unavailableFiles.push(file.name);
      return;
    }

    const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      invalidFiles.push(file.name);
      return;
    }
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (!keyed.has(key) && keyed.size >= 1000) {
      ignoredByLimit += 1;
      return;
    }
    keyed.set(key, file);
  });
  selectedFiles = Array.from(keyed.values());

  if (unavailableFiles.length > 0) {
    setText(
      uploadError,
      `These files are unavailable (size 0). Download them locally first: ${unavailableFiles.slice(0, 2).join(", ")}${unavailableFiles.length > 2 ? "..." : ""}`
    );
  } else if (invalidFiles.length > 0) {
    setText(uploadError, `Ignored unsupported file(s): ${invalidFiles.slice(0, 3).join(", ")}${invalidFiles.length > 3 ? "..." : ""}`);
  } else if (ignoredByLimit > 0) {
    setText(uploadError, `Maximum 1000 files allowed. Ignored ${ignoredByLimit} extra file(s).`);
  } else {
    setText(uploadError, "");
  }
}

function handlePickedFiles(pickedFiles) {
  addPickedFiles(pickedFiles);
  if (filesInput) {
    filesInput.value = "";
  }
  updateFileCount();
  syncUploadState();
  setText(uploadInfo, "Allowed: any combination of PDF, DOCX, PNG, JPG, WEBP, TXT (same or mixed), 2 to 1000 files.");
  setText(resultsError, "");
  setText(historyError, "");
}

// Summary & Dashboard Elements
const summaryTotalDocs = document.getElementById("summaryTotalDocs");
const summaryDupFiles = document.getElementById("summaryDupFiles");
const summaryNonDupFiles = document.getElementById("summaryNonDupFiles");
const viewReportBtn = document.getElementById("viewReportBtn");

const duplicateStatsBadge = document.getElementById("duplicateStatsBadge");
const duplicateFilesContainer = document.getElementById("duplicateFilesContainer");
const noDuplicatesMessage = document.getElementById("noDuplicatesMessage");

const allFilesCountBadge = document.getElementById("allFilesCountBadge");
const nonDuplicateCountBadge = document.getElementById("nonDuplicateCountBadge");
const nonDuplicateGrid = document.getElementById("nonDuplicateGrid");
const noNonDuplicatesMessage = document.getElementById("noNonDuplicatesMessage");
const sortOrder = document.getElementById("sortOrder");
const searchInput = document.getElementById("searchInput");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageInfo = document.getElementById("pageInfo");

// Inspect Modal Elements
const documentDetailModal = document.getElementById("documentDetailModal");
const modalDocTitle = document.getElementById("modalDocTitle");
const modalDocDupBadge = document.getElementById("modalDocDupBadge");
const modalDocAvg = document.getElementById("modalDocAvg");
const closeModalBtn = document.getElementById("closeModalBtn");
const modalComparisonsList = document.getElementById("modalComparisonsList");

// Report Modal Elements
const scanReportModal = document.getElementById("scanReportModal");
const closeReportBtn = document.getElementById("closeReportBtn");
const printReportBtn = document.getElementById("printReportBtn");
const downloadReportPdfBtn = document.getElementById("downloadReportPdfBtn");
const downloadReportModalPdfBtn = document.getElementById("downloadReportModalPdfBtn");
const reportMetaSubtitle = document.getElementById("reportMetaSubtitle");
const reportPrintMeta = document.getElementById("reportPrintMeta");
const reportSummaryGrid = document.getElementById("reportSummaryGrid");
const reportDuplicateContent = document.getElementById("reportDuplicateContent");
const reportRankedMatchesContent = document.getElementById("reportRankedMatchesContent");
const reportAllFilesContent = document.getElementById("reportAllFilesContent");

// Feature 4: Storage Cleanup & Lifecycle State


// Feature 2: View Switcher & Smart Ranking Elements
const tabRankedPairs = document.getElementById("tabRankedPairs");
const tabDocOverview = document.getElementById("tabDocOverview");
const rankedPairsSection = document.getElementById("rankedPairsSection");
const docOverviewSection = document.getElementById("docOverviewSection");
const pairsFilterScore = document.getElementById("pairsFilterScore");
const pairsSearchInput = document.getElementById("pairsSearchInput");
const pairsSortOrder = document.getElementById("pairsSortOrder");
const pairsPrevBtn = document.getElementById("pairsPrevBtn");
const pairsPageInfo = document.getElementById("pairsPageInfo");
const pairsNextBtn = document.getElementById("pairsNextBtn");
const rankedPairsCountBadge = document.getElementById("rankedPairsCountBadge");
const rankedPairsContainer = document.getElementById("rankedPairsContainer");
const noRankedPairsMessage = document.getElementById("noRankedPairsMessage");

// Feature 1: Matching Passage Highlighting Modal Elements
const passageComparisonModal = document.getElementById("passageComparisonModal");
const passageModalHeading = document.getElementById("passageModalHeading");
const passageModalMeta = document.getElementById("passageModalMeta");
const closePassageModalBtn = document.getElementById("closePassageModalBtn");
const passageCardsList = document.getElementById("passageCardsList");
const filterAllPassagesBtn = document.getElementById("filterAllPassagesBtn");
const filterTextPassagesBtn = document.getElementById("filterTextPassagesBtn");
const filterImagePassagesBtn = document.getElementById("filterImagePassagesBtn");
const filterCodePassagesBtn = document.getElementById("filterCodePassagesBtn");
const filterTablePassagesBtn = document.getElementById("filterTablePassagesBtn");

const scanStageHeader = document.getElementById("scanStageHeader");
const scanProgressDetails = document.getElementById("scanProgressDetails");
const scanProgressBar = document.getElementById("scanProgressBar");
const metricDocs = document.getElementById("metricDocs");
const metricPossible = document.getElementById("metricPossible");
const metricCandidates = document.getElementById("metricCandidates");
const metricReduction = document.getElementById("metricReduction");

let currentScanId = null;
let currentPage = 1;
const currentLimit = 24;
let currentSort = "avg_desc";
let currentSearch = "";
let searchDebounceTimer = null;

// Smart Ranked Pairs State
let currentPairsPage = 1;
const currentPairsLimit = 15;
let currentPairsFilterScore = "all";
let currentPairsSearch = "";
let currentPairsSort = "similarity_desc";
let pairsSearchDebounceTimer = null;

// Passage Modal State
let currentPassageData = null;
let currentPassageFilter = "all";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Bind non-duplicate controls
sortOrder?.addEventListener("change", (e) => {
  currentSort = e.target.value;
  currentPage = 1;
  loadDashboard();
});

searchInput?.addEventListener("input", (e) => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    currentSearch = e.target.value;
    currentPage = 1;
    loadDashboard();
  }, 250);
});

prevPageBtn?.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    loadDashboard();
  }
});

nextPageBtn?.addEventListener("click", () => {
  currentPage++;
  loadDashboard();
});

// Feature 2: View Switcher Tabs
tabRankedPairs?.addEventListener("click", () => {
  tabRankedPairs.classList.add("active");
  tabDocOverview?.classList.remove("active");
  if (rankedPairsSection) rankedPairsSection.style.display = "block";
  if (docOverviewSection) docOverviewSection.style.display = "none";
  loadRankedPairs();
});

tabDocOverview?.addEventListener("click", () => {
  tabDocOverview.classList.add("active");
  tabRankedPairs?.classList.remove("active");
  if (docOverviewSection) docOverviewSection.style.display = "block";
  if (rankedPairsSection) rankedPairsSection.style.display = "none";
  loadDashboard();
});

// Feature 2: Ranked Pairs Controls
pairsFilterScore?.addEventListener("change", (e) => {
  currentPairsFilterScore = e.target.value;
  currentPairsPage = 1;
  loadRankedPairs();
});

pairsSearchInput?.addEventListener("input", (e) => {
  clearTimeout(pairsSearchDebounceTimer);
  pairsSearchDebounceTimer = setTimeout(() => {
    currentPairsSearch = e.target.value;
    currentPairsPage = 1;
    loadRankedPairs();
  }, 250);
});

pairsSortOrder?.addEventListener("change", (e) => {
  currentPairsSort = e.target.value;
  currentPairsPage = 1;
  loadRankedPairs();
});

pairsPrevBtn?.addEventListener("click", () => {
  if (currentPairsPage > 1) {
    currentPairsPage--;
    loadRankedPairs();
  }
});

pairsNextBtn?.addEventListener("click", () => {
  currentPairsPage++;
  loadRankedPairs();
});

// Feature 3: Downloadable PDF Report Buttons
function triggerPdfDownload() {
  if (!currentScanId) return;
  window.location.href = apiUrl(`/api/scans/${currentScanId}/report/pdf`);
}
downloadReportPdfBtn?.addEventListener("click", triggerPdfDownload);
downloadReportModalPdfBtn?.addEventListener("click", triggerPdfDownload);

// Feature 1: Passage Modal Filter Buttons & Close
closePassageModalBtn?.addEventListener("click", closePassageComparison);
passageComparisonModal?.addEventListener("click", (e) => {
  if (e.target === passageComparisonModal) {
    closePassageComparison();
  }
});

filterAllPassagesBtn?.addEventListener("click", () => {
  setPassageFilter("all");
});
filterTextPassagesBtn?.addEventListener("click", () => {
  setPassageFilter("text");
});
filterImagePassagesBtn?.addEventListener("click", () => {
  setPassageFilter("images");
});
filterCodePassagesBtn?.addEventListener("click", () => {
  setPassageFilter("code");
});
filterTablePassagesBtn?.addEventListener("click", () => {
  setPassageFilter("tables");
});

function setPassageFilter(filter) {
  currentPassageFilter = filter;
  filterAllPassagesBtn?.classList.toggle("active", filter === "all");
  filterTextPassagesBtn?.classList.toggle("active", filter === "text");
  filterImagePassagesBtn?.classList.toggle("active", filter === "images");
  filterCodePassagesBtn?.classList.toggle("active", filter === "code");
  filterTablePassagesBtn?.classList.toggle("active", filter === "tables");
  renderPassageCards();
}

// Modal Events
closeModalBtn?.addEventListener("click", closeDocumentDetail);
documentDetailModal?.addEventListener("click", (e) => {
  if (e.target === documentDetailModal) {
    closeDocumentDetail();
  }
});

// Report Modal Events
viewReportBtn?.addEventListener("click", openScanReport);
closeReportBtn?.addEventListener("click", closeScanReport);
printReportBtn?.addEventListener("click", () => {
  window.print();
});
scanReportModal?.addEventListener("click", (e) => {
  if (e.target === scanReportModal) {
    closeScanReport();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (passageComparisonModal && passageComparisonModal.style.display !== "none") {
      closePassageComparison();
    }
    if (documentDetailModal && documentDetailModal.style.display !== "none") {
      closeDocumentDetail();
    }
    if (scanReportModal && scanReportModal.style.display !== "none") {
      closeScanReport();
    }
  }
});

function closePassageComparison() {
  if (passageComparisonModal) {
    passageComparisonModal.style.display = "none";
  }
  currentPassageData = null;
}

function closeDocumentDetail() {
  if (documentDetailModal) {
    documentDetailModal.style.display = "none";
  }
}

function closeScanReport() {
  if (scanReportModal) {
    scanReportModal.style.display = "none";
  }
}

async function openDocumentDetail(documentId) {
  if (!currentScanId || !documentId) return;

  try {
    if (modalDocTitle) modalDocTitle.textContent = "Loading...";
    if (modalDocDupBadge) modalDocDupBadge.style.display = "none";
    if (modalDocAvg) modalDocAvg.textContent = "Average Similarity: --";
    if (modalComparisonsList) modalComparisonsList.innerHTML = "<p style='color:#94a3b8;'>Fetching breakdown...</p>";
    if (documentDetailModal) documentDetailModal.style.display = "flex";

    const response = await fetch(apiUrl(`/api/scans/${currentScanId}/documents/${documentId}/similarities`));
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || "Failed to load document similarities.");
    }

    const doc = payload.document || {};
    const comparisons = payload.comparisons || [];

    if (modalDocTitle) modalDocTitle.textContent = doc.filename || documentId;
    if (modalDocDupBadge) {
      modalDocDupBadge.style.display = doc.isDuplicate ? "inline-block" : "none";
    }

    if (modalDocAvg) {
      if (doc.averageSimilarity === null || doc.averageSimilarity === undefined) {
        modalDocAvg.textContent = "Average Similarity: No non-duplicate similarity data";
      } else {
        modalDocAvg.textContent = `Average Similarity: ${Number(doc.averageSimilarity).toFixed(2)}% (${doc.classification || "Analysis"})`;
      }
    }

    if (modalComparisonsList) {
      modalComparisonsList.innerHTML = "";
      if (comparisons.length === 0) {
        modalComparisonsList.innerHTML = "<p style='color:#94a3b8; font-family:\"Space Grotesk\",sans-serif;'>No comparisons available against other non-duplicate documents.</p>";
      } else {
        const frag = document.createDocumentFragment();
        comparisons.forEach(comp => {
          const row = document.createElement("div");
          row.className = "comparison-row";

          const name = document.createElement("div");
          name.className = "comp-doc-name";
          name.textContent = `${doc.filename} vs ${comp.comparedWithName}`;
          name.title = `${doc.filename} vs ${comp.comparedWithName}`;

          const score = document.createElement("div");
          score.className = "comp-score";
          const pct = Number(comp.similarityPercentage || 0);
          score.textContent = `${pct.toFixed(2)}%`;

          if (pct >= 70) score.style.color = "#38bdf8";
          else if (pct >= 40) score.style.color = "#c084fc";
          else score.style.color = "#94a3b8";

          const actionsWrap = document.createElement("div");
          actionsWrap.style.display = "flex";
          actionsWrap.style.alignItems = "center";
          actionsWrap.style.gap = "8px";

          const passageBtn = document.createElement("button");
          passageBtn.className = "btn-inspect-passages";
          passageBtn.type = "button";
          passageBtn.innerHTML = `View Evidence &rarr;`;
          passageBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openPassageComparison(doc.documentId, comp.comparedWithId, doc.filename, comp.comparedWithName);
          });

          actionsWrap.append(score, passageBtn);
          row.append(name, actionsWrap);
          frag.appendChild(row);
        });
        modalComparisonsList.appendChild(frag);
      }
    }
  } catch (error) {
    if (modalComparisonsList) {
      modalComparisonsList.innerHTML = `<p style="color:#ef4444;">Error: ${error.message}</p>`;
    }
  }
}

let isEvidenceLoading = false;

async function openPassageComparison(docAId, docBId, docAName, docBName) {
  if (!currentScanId || !docAId || !docBId) return;
  if (isEvidenceLoading) return;
  isEvidenceLoading = true;

  try {
    if (passageModalHeading) {
      passageModalHeading.textContent = `${docAName || "Document A"} vs ${docBName || "Document B"}`;
    }
    if (passageModalMeta) {
      passageModalMeta.textContent = "Loading matching passages and overlap evidence...";
    }
    if (passageCardsList) {
      passageCardsList.innerHTML = `
        <div style="text-align:center; padding:3rem 1rem; color:#94a3b8; font-family:'Space Grotesk',sans-serif;">
          <div style="display:inline-block; width:28px; height:28px; border:3px solid rgba(56,189,248,0.2); border-top-color:#38bdf8; border-radius:50%; animation:spin 0.8s linear infinite; margin-bottom:12px;"></div>
          <div>Retrieving verified matching evidence and passage alignments...</div>
        </div>
      `;
    }
    if (passageComparisonModal) {
      passageComparisonModal.style.display = "flex";
    }

    const res = await fetch(apiUrl(`/api/scans/${currentScanId}/evidence?docA=${encodeURIComponent(docAId)}&docB=${encodeURIComponent(docBId)}`));
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "Failed to load matching evidence.");
    }

    currentPassageData = data;
    currentPassageFilter = "all";
    filterAllPassagesBtn?.classList.add("active");
    filterTextPassagesBtn?.classList.remove("active");
    filterImagePassagesBtn?.classList.remove("active");
    filterCodePassagesBtn?.classList.remove("active");
    filterTablePassagesBtn?.classList.remove("active");

    const ev = data.evidence || {};
    const totalEv = (ev.passages?.length || data.passages?.length || 0) +
                    (ev.images?.length || 0) +
                    (ev.code?.length || 0) +
                    (ev.tables?.length || 0);

    if (passageModalHeading) {
      passageModalHeading.textContent = `${data.documentA.filename} vs ${data.documentB.filename}`;
    }
    if (passageModalMeta) {
      passageModalMeta.textContent = `Overall Similarity: ${data.similarityPercentage.toFixed(2)}% (${data.classification}) • Matching Evidence: ${totalEv} item${totalEv !== 1 ? 's' : ''}`;
    }

    renderPassageCards();

  } catch (error) {
    if (passageCardsList) {
      passageCardsList.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; color: #ef4444; font-family: 'Space Grotesk', sans-serif;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 36px; height: 36px; margin: 0 auto 12px; display: block; color: #ef4444;">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div style="font-weight: 700; margin-bottom: 6px;">Failed to Load Evidence</div>
          <div style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 16px;">${escapeHtml(error.message)}</div>
          <button id="retryEvidenceBtn" class="btn btn-secondary btn-sm" type="button">Retry</button>
        </div>
      `;
      document.getElementById("retryEvidenceBtn")?.addEventListener("click", () => {
        openPassageComparison(docAId, docBId, docAName, docBName);
      });
    }
  } finally {
    isEvidenceLoading = false;
  }
}

function renderPassageCards() {
  if (!currentPassageData || !passageCardsList) return;

  const ev = currentPassageData.evidence || {};
  const passages = ev.passages || currentPassageData.passages || [];
  const images = ev.images || [];
  const code = ev.code || [];
  const tables = ev.tables || [];

  const showText = currentPassageFilter === "all" || currentPassageFilter === "text";
  const showImages = currentPassageFilter === "all" || currentPassageFilter === "images" || currentPassageFilter === "image";
  const showCode = currentPassageFilter === "all" || currentPassageFilter === "code";
  const showTables = currentPassageFilter === "all" || currentPassageFilter === "tables" || currentPassageFilter === "table";

  let visibleCount = 0;
  if (showText) visibleCount += passages.length;
  if (showImages) visibleCount += images.length;
  if (showCode) visibleCount += code.length;
  if (showTables) visibleCount += tables.length;

  if (visibleCount === 0) {
    passageCardsList.innerHTML = `
      <div style="text-align: center; padding: 2.5rem 1rem; color: #94a3b8; font-family: 'Space Grotesk', sans-serif;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 32px; height: 32px; margin: 0 auto 10px; color: #64748b; display: block;">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="8" y1="12" x2="16" y2="12"></line>
        </svg>
        <div>No matching evidence found under the "${escapeHtml(currentPassageFilter)}" category.</div>
      </div>
    `;
    return;
  }

  passageCardsList.innerHTML = "";
  const frag = document.createDocumentFragment();

  // 1. Render Matching Text Passages
  if (showText && passages.length > 0) {
    passages.forEach((p, idx) => {
      const card = document.createElement("div");
      card.className = "passage-pair-card";

      const header = document.createElement("div");
      header.className = "passage-card-header";

      const indexBadge = document.createElement("span");
      indexBadge.className = "passage-index-badge";
      indexBadge.textContent = `Matching Passage #${p.index || idx + 1}`;

      const overlapBadge = document.createElement("span");
      const sim = typeof p.similarity === "number" ? p.similarity : 0;
      const badgeLevel = sim >= 95 ? "exact" : (sim >= 80 ? "high" : "moderate");
      overlapBadge.className = `passage-overlap-badge ${badgeLevel}`;

      const matchTypeLabel = p.matchType ? p.matchType.toUpperCase() : "TEXT PASSAGE MATCH";
      const overlapPct = typeof p.similarity === "number" ? ` • ${p.similarity.toFixed(1)}% OVERLAP` : "";
      overlapBadge.textContent = `${matchTypeLabel}${overlapPct}`;

      header.append(indexBadge, overlapBadge);

      const sbs = document.createElement("div");
      sbs.className = "passage-side-by-side";

      const locA = p.pageA ? ` (Page ${p.pageA})` : (p.offsetA !== null && p.offsetA !== undefined ? ` (Offset ${p.offsetA})` : "");
      const locB = p.pageB ? ` (Page ${p.pageB})` : (p.offsetB !== null && p.offsetB !== undefined ? ` (Offset ${p.offsetB})` : "");

      const colA = document.createElement("div");
      colA.className = "passage-col";
      colA.innerHTML = `
        <div class="passage-col-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path></svg>
          <span>${escapeHtml(currentPassageData.documentA.filename)}${escapeHtml(locA)}</span>
        </div>
        <div class="passage-text-content">${p.highlightedA || escapeHtml(p.passageA)}</div>
      `;

      const colB = document.createElement("div");
      colB.className = "passage-col";
      colB.innerHTML = `
        <div class="passage-col-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path></svg>
          <span>${escapeHtml(currentPassageData.documentB.filename)}${escapeHtml(locB)}</span>
        </div>
        <div class="passage-text-content">${p.highlightedB || escapeHtml(p.passageB)}</div>
      `;

      sbs.append(colA, colB);

      const footer = document.createElement("div");
      footer.className = "passage-card-footer";
      const chips = Array.isArray(p.matchedWords) && p.matchedWords.length > 0
        ? p.matchedWords.slice(0, 8).map(w => `<span class="matched-word-chip">${escapeHtml(w)}</span>`).join(" ")
        : `<span class="matched-word-chip">Matching prose passages</span>`;
      footer.innerHTML = `<span class="matched-words-label">Evidence:</span> ${chips}`;

      card.append(header, sbs, footer);
      frag.appendChild(card);
    });
  }

  // 2. Render Matching Screenshot / Image Evidence
  if (showImages && images.length > 0) {
    images.forEach((img, idx) => {
      const card = document.createElement("div");
      card.className = "passage-pair-card image-evidence-card";

      const header = document.createElement("div");
      header.className = "passage-card-header";

      const indexBadge = document.createElement("span");
      indexBadge.className = "passage-index-badge";
      indexBadge.textContent = `Screenshot Match #${idx + 1}`;

      const overlapBadge = document.createElement("span");
      overlapBadge.className = "passage-overlap-badge high";
      overlapBadge.textContent = img.isExact ? "EXACT IMAGE DUPLICATE" : "PERCEPTUAL VISUAL MATCH";

      header.append(indexBadge, overlapBadge);

      const sbs = document.createElement("div");
      sbs.className = "passage-side-by-side";

      const colA = document.createElement("div");
      colA.className = "passage-col";
      colA.innerHTML = `
        <div class="passage-col-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          <span>${escapeHtml(currentPassageData.documentA.filename)} (Page ${img.pageA || 1})</span>
        </div>
        <div class="passage-text-content" style="background: rgba(255,255,255,0.02); padding: 12px; border-radius: 6px;">
          <div style="font-size: 0.82rem; color: #94a3b8; font-family: monospace;">Screenshot ID: ${escapeHtml(img.imageAId || 'image_A')}</div>
          <div style="font-size: 0.8rem; color: #38bdf8; margin-top: 4px;">Visual content identified and extracted from document</div>
        </div>
      `;

      const colB = document.createElement("div");
      colB.className = "passage-col";
      colB.innerHTML = `
        <div class="passage-col-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          <span>${escapeHtml(currentPassageData.documentB.filename)} (Page ${img.pageB || 1})</span>
        </div>
        <div class="passage-text-content" style="background: rgba(255,255,255,0.02); padding: 12px; border-radius: 6px;">
          <div style="font-size: 0.82rem; color: #94a3b8; font-family: monospace;">Screenshot ID: ${escapeHtml(img.imageBId || 'image_B')}</div>
          <div style="font-size: 0.8rem; color: #38bdf8; margin-top: 4px;">Matching visual layout and diagram structure verified</div>
        </div>
      `;

      sbs.append(colA, colB);

      const footer = document.createElement("div");
      footer.className = "passage-card-footer";
      footer.innerHTML = `<span class="matched-words-label">Verification:</span> <span class="matched-word-chip">${img.isExact ? 'Exact Bitwise Match (SHA-256)' : 'Perceptual Hash / Structural Similarity'}</span>`;

      card.append(header, sbs, footer);
      frag.appendChild(card);
    });
  }

  // 3. Render Matching Code Evidence
  if (showCode && code.length > 0) {
    code.forEach((c, idx) => {
      const card = document.createElement("div");
      card.className = "passage-pair-card code-evidence-card";

      const header = document.createElement("div");
      header.className = "passage-card-header";

      const indexBadge = document.createElement("span");
      indexBadge.className = "passage-index-badge";
      indexBadge.textContent = `Code Match #${idx + 1}`;

      const overlapBadge = document.createElement("span");
      overlapBadge.className = "passage-overlap-badge high";
      overlapBadge.textContent = "SOURCE CODE OVERLAP";

      header.append(indexBadge, overlapBadge);

      const sbs = document.createElement("div");
      sbs.className = "passage-side-by-side";

      const colA = document.createElement("div");
      colA.className = "passage-col";
      colA.innerHTML = `
        <div class="passage-col-title"><span>${escapeHtml(currentPassageData.documentA.filename)}</span></div>
        <pre class="passage-text-content" style="font-family: monospace; white-space: pre-wrap; font-size: 0.8rem;">${escapeHtml(c.lineA)}</pre>
      `;

      const colB = document.createElement("div");
      colB.className = "passage-col";
      colB.innerHTML = `
        <div class="passage-col-title"><span>${escapeHtml(currentPassageData.documentB.filename)}</span></div>
        <pre class="passage-text-content" style="font-family: monospace; white-space: pre-wrap; font-size: 0.8rem;">${escapeHtml(c.lineB || c.lineA)}</pre>
      `;

      sbs.append(colA, colB);

      const footer = document.createElement("div");
      footer.className = "passage-card-footer";
      footer.innerHTML = `<span class="matched-words-label">Code Analysis:</span> <span class="matched-word-chip">Normalized logic & statement match</span>`;

      card.append(header, sbs, footer);
      frag.appendChild(card);
    });
  }

  // 4. Render Matching Table Evidence
  if (showTables && tables.length > 0) {
    tables.forEach((t, idx) => {
      const card = document.createElement("div");
      card.className = "passage-pair-card table-evidence-card";

      const header = document.createElement("div");
      header.className = "passage-card-header";

      const indexBadge = document.createElement("span");
      indexBadge.className = "passage-index-badge";
      indexBadge.textContent = `Table Match #${idx + 1}`;

      const overlapBadge = document.createElement("span");
      overlapBadge.className = "passage-overlap-badge high";
      overlapBadge.textContent = "EXPERIMENTAL TABLE MATCH";

      header.append(indexBadge, overlapBadge);

      const sbs = document.createElement("div");
      sbs.className = "passage-side-by-side";

      const colA = document.createElement("div");
      colA.className = "passage-col";
      colA.innerHTML = `
        <div class="passage-col-title"><span>${escapeHtml(currentPassageData.documentA.filename)} (Table ${t.tableAIndex || 1})</span></div>
        <div class="passage-text-content" style="font-size: 0.8rem;">${(t.matchingRows || []).map(r => escapeHtml(r.rowA ? r.rowA.join(' | ') : '')).join('<br>')}</div>
      `;

      const colB = document.createElement("div");
      colB.className = "passage-col";
      colB.innerHTML = `
        <div class="passage-col-title"><span>${escapeHtml(currentPassageData.documentB.filename)} (Table ${t.tableBIndex || 1})</span></div>
        <div class="passage-text-content" style="font-size: 0.8rem;">${(t.matchingRows || []).map(r => escapeHtml(r.rowB ? r.rowB.join(' | ') : '')).join('<br>')}</div>
      `;

      sbs.append(colA, colB);

      const footer = document.createElement("div");
      footer.className = "passage-card-footer";
      footer.innerHTML = `<span class="matched-words-label">Table Analysis:</span> <span class="matched-word-chip">Matching cell values & structural rows</span>`;

      card.append(header, sbs, footer);
      frag.appendChild(card);
    });
  }

  passageCardsList.appendChild(frag);
}

async function loadRankedPairs() {
  if (!currentScanId) return;

  try {
    const query = new URLSearchParams({
      page: String(currentPairsPage),
      limit: String(currentPairsLimit),
      scoreCategory: currentPairsFilterScore,
      search: currentPairsSearch,
      sort: currentPairsSort
    });

    const res = await fetch(apiUrl(`/api/scans/${currentScanId}/pairs?${query.toString()}`));
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "Failed to fetch ranked document matches.");
    }

    renderRankedPairs(data);

  } catch (error) {
    console.error("Error loading ranked pairs:", error);
  }
}

function renderRankedPairs(data) {
  const pairs = data.rankedPairs || [];
  const pagination = data.pagination || { total_pairs: 0, total_pages: 1, current_page: 1 };

  setText(rankedPairsCountBadge, `${pagination.total_pairs.toLocaleString()} Ranked Pair${pagination.total_pairs !== 1 ? 's' : ''}`);

  if (pairs.length === 0) {
    if (noRankedPairsMessage) noRankedPairsMessage.style.display = "block";
    if (rankedPairsContainer) rankedPairsContainer.innerHTML = "";
  } else {
    if (noRankedPairsMessage) noRankedPairsMessage.style.display = "none";
    if (rankedPairsContainer) {
      rankedPairsContainer.innerHTML = "";
      const frag = document.createDocumentFragment();

      pairs.forEach(pair => {
        const card = document.createElement("div");
        card.className = "ranked-pair-card";

        // Rank Badge
        const rankBadge = document.createElement("div");
        rankBadge.className = "pair-rank-badge";
        rankBadge.textContent = `#${pair.rank}`;

        // Docs Info
        const docsWrap = document.createElement("div");
        docsWrap.className = "pair-docs-wrap";

        const namesRow = document.createElement("div");
        namesRow.className = "pair-names-row";

        const name1 = document.createElement("span");
        name1.className = "pair-doc-name";
        name1.textContent = pair.fileName1;
        name1.title = pair.fileName1;

        const vs = document.createElement("span");
        vs.className = "pair-vs-divider";
        vs.textContent = "vs";

        const name2 = document.createElement("span");
        name2.className = "pair-doc-name";
        name2.textContent = pair.fileName2;
        name2.title = pair.fileName2;

        namesRow.append(name1, vs, name2);

        const metaRow = document.createElement("div");
        metaRow.className = "pair-meta-row";

        const classTag = document.createElement("span");
        classTag.className = "pair-class-tag";
        classTag.textContent = pair.classification || "Analysis";
        if (pair.isExactDuplicate) {
          classTag.style.background = "rgba(34, 197, 94, 0.15)";
          classTag.style.color = "#4ade80";
          classTag.style.borderColor = "rgba(34, 197, 94, 0.35)";
        } else if (pair.similarityPercentage >= 70) {
          classTag.style.background = "rgba(56, 189, 248, 0.15)";
          classTag.style.color = "#38bdf8";
          classTag.style.borderColor = "rgba(56, 189, 248, 0.35)";
        } else if (pair.similarityPercentage >= 40) {
          classTag.style.background = "rgba(192, 132, 252, 0.15)";
          classTag.style.color = "#c084fc";
          classTag.style.borderColor = "rgba(192, 132, 252, 0.35)";
        }

        metaRow.appendChild(classTag);

        const passagesTag = document.createElement("span");
        passagesTag.className = "pair-passages-tag";
        const totalItems = pair.evidenceSummary?.totalCount || pair.matchingPassagesCount || 0;
        passagesTag.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          </svg>
          ${totalItems} Matching Evidence Item${totalItems !== 1 ? 's' : ''}
        `;
        metaRow.appendChild(passagesTag);

        docsWrap.append(namesRow, metaRow);

        // Score Wrap
        const scoreWrap = document.createElement("div");
        scoreWrap.className = "pair-score-wrap";

        const scoreText = document.createElement("span");
        scoreText.className = "pair-score-text";
        scoreText.textContent = `${pair.similarityPercentage.toFixed(2)}%`;
        if (pair.similarityPercentage >= 70) scoreText.style.color = "#38bdf8";
        else if (pair.similarityPercentage >= 40) scoreText.style.color = "#c084fc";
        else scoreText.style.color = "#94a3b8";

        scoreWrap.appendChild(scoreText);

        // Action Button: View Comparison
        const actionsWrap = document.createElement("div");
        actionsWrap.className = "pair-actions-wrap";

        const inspectBtn = document.createElement("button");
        inspectBtn.className = "btn-inspect-passages";
        inspectBtn.type = "button";
        inspectBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 13px; height: 13px;">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          View Evidence
        `;
        inspectBtn.addEventListener("click", () => {
          openPassageComparison(pair.documentAId, pair.documentBId, pair.fileName1, pair.fileName2);
        });

        actionsWrap.appendChild(inspectBtn);

        card.append(rankBadge, docsWrap, scoreWrap, actionsWrap);
        frag.appendChild(card);
      });

      rankedPairsContainer.appendChild(frag);
    }
  }

  // Update pairs pagination
  setText(pairsPageInfo, `Page ${pagination.current_page} of ${pagination.total_pages || 1}`);
  if (pairsPrevBtn) pairsPrevBtn.disabled = !pagination.has_prev;
  if (pairsNextBtn) pairsNextBtn.disabled = !pagination.has_next;
}

async function openScanReport() {
  if (!currentScanId) return;

  try {
    if (reportMetaSubtitle) reportMetaSubtitle.textContent = `Scan ID: ${currentScanId} • Fetching report...`;
    if (scanReportModal) scanReportModal.style.display = "flex";

    const response = await fetch(apiUrl(`/api/scans/${currentScanId}/report`));
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || "Failed to generate report.");
    }

    const summary = payload.summary || {};
    const duplicateFiles = payload.duplicateFiles || [];
    const allFiles = payload.allFiles || [];
    const dateStr = payload.scan?.completedAt ? new Date(payload.scan.completedAt).toLocaleString() : new Date().toLocaleString();

    if (reportMetaSubtitle) {
      reportMetaSubtitle.textContent = `Scan ID: ${payload.scan_id} • Analyzed: ${dateStr}`;
    }
    if (reportPrintMeta) {
      reportPrintMeta.textContent = `Scan Session: ${payload.scan_id} | Date: ${dateStr} | Total Documents Analyzed: ${summary.documentsAnalyzed || 0}`;
    }

    // 1. Populate Summary Statistics
    if (reportSummaryGrid) {
      reportSummaryGrid.innerHTML = `
        <div class="report-stat-card">
          <div class="report-stat-label">Documents Analyzed</div>
          <div class="report-stat-val">${Number(summary.documentsAnalyzed || 0).toLocaleString()}</div>
        </div>
        <div class="report-stat-card highlight-stat">
          <div class="report-stat-label">Duplicate Files</div>
          <div class="report-stat-val">${Number(summary.duplicateFilesCount || 0).toLocaleString()}</div>
        </div>
        <div class="report-stat-card">
          <div class="report-stat-label">Files With Similarity Data</div>
          <div class="report-stat-val">${Number(summary.filesWithSimilarityCount || 0).toLocaleString()}</div>
        </div>
        <div class="report-stat-card">
          <div class="report-stat-label">Overall Average Similarity</div>
          <div class="report-stat-val">${summary.overallAverageSimilarity !== null && summary.overallAverageSimilarity !== undefined ? summary.overallAverageSimilarity.toFixed(2) + '%' : '--'}</div>
        </div>
        <div class="report-stat-card">
          <div class="report-stat-label">Highest Document Average</div>
          <div class="report-stat-val">${summary.highestAverageSimilarity !== null && summary.highestAverageSimilarity !== undefined ? summary.highestAverageSimilarity.toFixed(2) + '%' : '--'}</div>
        </div>
        <div class="report-stat-card">
          <div class="report-stat-label">Lowest Document Average</div>
          <div class="report-stat-val">${summary.lowestAverageSimilarity !== null && summary.lowestAverageSimilarity !== undefined ? summary.lowestAverageSimilarity.toFixed(2) + '%' : '--'}</div>
        </div>
      `;
    }

    // 2. Populate Duplicate Files Section
    if (reportDuplicateContent) {
      if (duplicateFiles.length === 0) {
        reportDuplicateContent.innerHTML = `<div class="report-empty-notice">No 100% exact duplicate files found in this scan.</div>`;
      } else {
        let dupHtml = `
          <table class="report-table">
            <thead>
              <tr>
                <th style="width: 50px;">#</th>
                <th>File Name</th>
                <th style="width: 120px;">Type</th>
                <th style="width: 160px;">Match Status</th>
              </tr>
            </thead>
            <tbody>
        `;
        duplicateFiles.forEach((file, idx) => {
          dupHtml += `
            <tr>
              <td>${idx + 1}</td>
              <td style="font-weight: 600;">${escapeHtml(file.filename)}</td>
              <td>${escapeHtml(file.fileType || 'N/A')}</td>
              <td><span class="report-badge-dup">100% Identical</span></td>
            </tr>
          `;
        });
        dupHtml += `</tbody></table>`;
        reportDuplicateContent.innerHTML = dupHtml;
      }
    }

    // 3. Populate Ranked Document Matches & Matching-Passage Evidence Section
    const rankedMatches = payload.rankedMatches || [];
    if (reportRankedMatchesContent) {
      if (rankedMatches.length === 0) {
        reportRankedMatchesContent.innerHTML = `<div class="report-empty-notice">No pairwise matches recorded for this scan.</div>`;
      } else {
        let rankedHtml = `
          <table class="report-table">
            <thead>
              <tr>
                <th style="width: 50px;">Rank</th>
                <th>Document 1</th>
                <th>Document 2</th>
                <th style="width: 110px;">Similarity</th>
                <th style="width: 140px;">Classification</th>
                <th>Matching Passage Evidence Excerpt</th>
              </tr>
            </thead>
            <tbody>
        `;
        rankedMatches.slice(0, 20).forEach((item) => {
          const pct = item.similarityPercentage || 0;
          const scoreColor = pct >= 80 ? '#38bdf8' : (pct >= 50 ? '#c084fc' : '#94a3b8');
          const passage = (item.matchingPassages && item.matchingPassages.length > 0)
            ? `"${escapeHtml(item.matchingPassages[0].passageA || item.matchingPassages[0].passageB)}"`
            : `<span style="color:#64748b; font-style:italic;">Identical or mathematical overlap</span>`;

          rankedHtml += `
            <tr>
              <td style="font-weight: 700; color: #a78bfa;">#${item.rank}</td>
              <td style="font-weight: 600;">${escapeHtml(item.fileName1)}</td>
              <td style="font-weight: 600;">${escapeHtml(item.fileName2)}</td>
              <td style="font-weight: 700; color: ${scoreColor};">${pct.toFixed(2)}%</td>
              <td>${escapeHtml(item.classification || '--')}</td>
              <td style="font-size: 0.8rem; color: #cbd5e1; max-width: 320px; white-space: normal;">${passage}</td>
            </tr>
          `;
        });
        rankedHtml += `</tbody></table>`;
        reportRankedMatchesContent.innerHTML = rankedHtml;
      }
    }

    // 4. Populate All Files Similarity Section
    if (reportAllFilesContent) {
      if (allFiles.length === 0) {
        reportAllFilesContent.innerHTML = `<div class="report-empty-notice">No document similarity records available.</div>`;
      } else {
        let allHtml = `
          <table class="report-table">
            <thead>
              <tr>
                <th style="width: 50px;">#</th>
                <th>Document Name</th>
                <th style="width: 140px;">Status</th>
                <th style="width: 150px;">Average Similarity</th>
                <th style="width: 120px;">Comparisons</th>
                <th style="width: 160px;">Classification</th>
              </tr>
            </thead>
            <tbody>
        `;
        allFiles.forEach((doc, idx) => {
          const hasScore = doc.averageSimilarity !== null && doc.averageSimilarity !== undefined;
          const scoreText = hasScore ? `${Number(doc.averageSimilarity).toFixed(2)}%` : '--';
          const dupTag = doc.isDuplicate ? `<span class="exact-dup-badge">Exact Duplicate</span>` : `<span style="color: #94a3b8; font-size: 0.8rem;">Standard</span>`;

          allHtml += `
            <tr>
              <td>${idx + 1}</td>
              <td style="font-weight: 600;">${escapeHtml(doc.filename)}</td>
              <td>${dupTag}</td>
              <td style="font-weight: 700; ${hasScore && doc.averageSimilarity >= 70 ? 'color:#38bdf8;' : (hasScore && doc.averageSimilarity >= 40 ? 'color:#c084fc;' : '')}">${scoreText}</td>
              <td>${doc.comparisonCount || 0}</td>
              <td>${escapeHtml(doc.classification || 'No Data')}</td>
            </tr>
          `;
        });
        allHtml += `</tbody></table>`;
        reportAllFilesContent.innerHTML = allHtml;
      }
    }

  } catch (error) {
    if (reportMetaSubtitle) {
      reportMetaSubtitle.textContent = `Error: ${error.message}`;
    }
  }
}

async function loadDashboard() {
  if (!currentScanId) return;
  clearMessages();

  try {
    const query = new URLSearchParams({
      page: String(currentPage),
      limit: String(currentLimit),
      sort: currentSort,
      search: currentSearch
    });

    const response = await fetch(apiUrl(`/api/scans/${currentScanId}/dashboard?${query.toString()}`));
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || "Failed to fetch similarity analysis.");
    }

    renderDashboard(payload);
    loadRankedPairs();

  } catch (error) {
    setText(resultsError, error.message);
  }
}

function renderDashboard(data) {
  const summary = data.summary || { totalDocuments: 0, duplicateFiles: 0, nonDuplicateFiles: 0 };
  
  // Extract flat duplicate files array
  let duplicateFiles = [];
  if (Array.isArray(data.duplicates)) {
    // If backend returned array of files or groups
    duplicateFiles = data.duplicates.flatMap(d => d.files ? d.files : [d]);
  } else if (data.duplicates && Array.isArray(data.duplicates.files)) {
    duplicateFiles = data.duplicates.files;
  }

  const allDocuments = data.fileSimilarities?.documents || data.nonDuplicates?.documents || [];
  const pagination = data.fileSimilarities?.pagination || data.nonDuplicates?.pagination || { total_documents: 0, total_pages: 1, current_page: 1 };

  // 1. Update Summary Metrics
  setText(summaryTotalDocs, Number(summary.totalDocuments || 0).toLocaleString());
  setText(summaryDupFiles, Number(summary.duplicateFiles ?? duplicateFiles.length).toLocaleString());
  setText(summaryNonDupFiles, Number(summary.nonDuplicateFiles ?? (summary.totalDocuments - duplicateFiles.length)).toLocaleString());

  // 2. Render Duplicate Files Section (ONE Flat List)
  const dupCount = duplicateFiles.length;
  setText(duplicateStatsBadge, `${dupCount.toLocaleString()} File${dupCount !== 1 ? 's' : ''} • 100% Identical`);

  if (dupCount === 0) {
    if (noDuplicatesMessage) noDuplicatesMessage.style.display = "flex";
    if (duplicateFilesContainer) duplicateFilesContainer.innerHTML = "";
  } else {
    if (noDuplicatesMessage) noDuplicatesMessage.style.display = "none";
    if (duplicateFilesContainer) {
      duplicateFilesContainer.innerHTML = "";
      const flatList = document.createElement("div");
      flatList.className = "flat-dup-list";

      duplicateFiles.forEach((file) => {
        const item = document.createElement("div");
        item.className = "flat-dup-item";

        const left = document.createElement("div");
        left.className = "flat-dup-left";

        const icon = document.createElement("span");
        icon.className = "flat-dup-bullet";
        icon.textContent = "•";

        const fname = document.createElement("span");
        fname.className = "flat-dup-name";
        fname.textContent = file.filename;
        fname.title = file.filename;

        left.append(icon, fname);

        const badge = document.createElement("div");
        badge.className = "flat-dup-badge";
        badge.textContent = "100% Identical";

        item.append(left, badge);
        flatList.appendChild(item);
      });

      duplicateFilesContainer.appendChild(flatList);
    }
  }

  // 3. Render All File Similarity Section (All N Uploaded Documents)
  const countBadgeText = `${pagination.total_documents.toLocaleString()} Document${pagination.total_documents !== 1 ? 's' : ''}`;
  if (allFilesCountBadge) setText(allFilesCountBadge, countBadgeText);
  if (nonDuplicateCountBadge) setText(nonDuplicateCountBadge, countBadgeText);

  if (allDocuments.length === 0) {
    if (noNonDuplicatesMessage) noNonDuplicatesMessage.style.display = "block";
    if (nonDuplicateGrid) nonDuplicateGrid.innerHTML = "";
  } else {
    if (noNonDuplicatesMessage) noNonDuplicatesMessage.style.display = "none";
    if (nonDuplicateGrid) {
      nonDuplicateGrid.innerHTML = "";
      const nonDupFrag = document.createDocumentFragment();

      allDocuments.forEach((doc, index) => {
        const card = document.createElement("article");
        card.className = "non-dup-card";
        card.style.animationDelay = `${Math.min(index * 0.04, 0.3)}s`;

        const topRow = document.createElement("div");
        topRow.className = "non-dup-card-header";
        topRow.style.display = "flex";
        topRow.style.justifyContent = "space-between";
        topRow.style.alignItems = "flex-start";
        topRow.style.gap = "8px";

        const title = document.createElement("div");
        title.className = "non-dup-title";
        title.textContent = doc.filename;
        title.title = doc.filename;

        const badgesWrap = document.createElement("div");
        badgesWrap.style.display = "flex";
        badgesWrap.style.alignItems = "center";
        badgesWrap.style.gap = "6px";
        badgesWrap.style.flexShrink = "0";

        // Exact Duplicate Tag if document is an exact duplicate
        if (doc.isDuplicate) {
          const dupChip = document.createElement("span");
          dupChip.className = "exact-dup-badge";
          dupChip.textContent = "Exact Duplicate";
          badgesWrap.appendChild(dupChip);
        }

        const classBadge = document.createElement("span");
        classBadge.className = "non-dup-class-badge";
        classBadge.textContent = doc.classification || "N/A";

        const hasScore = doc.averageSimilarity !== null && doc.averageSimilarity !== undefined;
        const avg = hasScore ? Number(doc.averageSimilarity) : null;

        if (avg !== null && avg >= 70) {
          classBadge.style.background = "rgba(56, 189, 248, 0.15)";
          classBadge.style.color = "#38bdf8";
          classBadge.style.borderColor = "rgba(56, 189, 248, 0.35)";
        } else if (avg !== null && avg >= 40) {
          classBadge.style.background = "rgba(192, 132, 252, 0.15)";
          classBadge.style.color = "#c084fc";
          classBadge.style.borderColor = "rgba(192, 132, 252, 0.35)";
        } else {
          classBadge.style.background = "rgba(148, 163, 184, 0.15)";
          classBadge.style.color = "#94a3b8";
          classBadge.style.borderColor = "rgba(148, 163, 184, 0.3)";
        }

        badgesWrap.appendChild(classBadge);
        topRow.append(title, badgesWrap);

        const label = document.createElement("div");
        label.className = "non-dup-label";
        label.textContent = "Average Similarity";

        const scoreWrap = document.createElement("div");
        scoreWrap.className = "non-dup-score-wrap";

        const score = document.createElement("span");
        score.className = "non-dup-score";

        let barColor = "#64748b";
        let fillWidth = 0;

        if (hasScore) {
          score.textContent = `${avg.toFixed(2)}%`;
          fillWidth = Math.min(100, Math.max(0, avg));

          if (avg >= 70) {
            score.style.color = "#38bdf8";
            barColor = "linear-gradient(90deg, #38bdf8, #818cf8)";
          } else if (avg >= 40) {
            score.style.color = "#c084fc";
            barColor = "linear-gradient(90deg, #c084fc, #a78bfa)";
          } else {
            score.style.color = "#94a3b8";
            barColor = "#64748b";
          }
        } else {
          score.textContent = "--";
          score.style.color = "#94a3b8";
          score.style.fontSize = "1.2rem";
          score.title = "No non-duplicate similarity data";
        }
        scoreWrap.appendChild(score);

        if (!hasScore) {
          const noDataHint = document.createElement("span");
          noDataHint.style.color = "#94a3b8";
          noDataHint.style.fontSize = "0.78rem";
          noDataHint.textContent = "(No non-duplicate comparisons)";
          scoreWrap.appendChild(noDataHint);
        }

        const barBg = document.createElement("div");
        barBg.className = "non-dup-bar-bg";
        const barFill = document.createElement("div");
        barFill.className = "non-dup-bar-fill";
        barFill.style.width = `${fillWidth}%`;
        barFill.style.background = barColor;
        barBg.appendChild(barFill);

        const footer = document.createElement("div");
        footer.className = "non-dup-footer";

        const comps = document.createElement("span");
        comps.textContent = `${doc.comparisonCount || 0} comparison${doc.comparisonCount !== 1 ? 's' : ''}`;

        const hint = document.createElement("span");
        hint.className = "inspect-hint";
        hint.innerHTML = "Inspect &rarr;";

        footer.append(comps, hint);
        card.append(topRow, label, scoreWrap, barBg, footer);

        card.addEventListener("click", () => {
          openDocumentDetail(doc.documentId);
        });

        nonDupFrag.appendChild(card);
      });

      nonDuplicateGrid.appendChild(nonDupFrag);
    }
  }

  // 4. Update Pagination Controls
  setText(pageInfo, `Page ${pagination.current_page} of ${pagination.total_pages || 1}`);
  if (prevPageBtn) prevPageBtn.disabled = !pagination.has_prev;
  if (nextPageBtn) nextPageBtn.disabled = !pagination.has_next;
}

async function startScan() {
  clearMessages();
  const files = [...selectedFiles];
  const validationError = validateFiles(files);

  if (validationError) {
    setText(uploadError, validationError);
    return;
  }

  // Execute processing engine
  const selectedAlgorithm = "minhash-lsh-jaccard";

  showLayer(3);
  startScanBtn.disabled = true;

  if (scanStageHeader) scanStageHeader.textContent = "Stage: Initializing";
  if (scanProgressDetails) scanProgressDetails.textContent = "Creating scan session...";
  if (scanProgressBar) scanProgressBar.style.width = "0%";
  setText(metricDocs, `0 / ${files.length}`);
  setText(metricPossible, `${((files.length * (files.length - 1)) / 2).toLocaleString()}`);
  setText(metricCandidates, "0");
  setText(metricReduction, "0.0%");

  currentPairsPage = 1;
  currentPairsSearch = "";
  if (pairsSearchInput) pairsSearchInput.value = "";

  try {
    // 1. Create a Scan Session
    const initResponse = await fetch(apiUrl("/api/scans"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ algorithm: selectedAlgorithm })
    });
    const initPayload = await initResponse.json();
    if (!initResponse.ok) {
      throw new Error(initPayload.message || "Failed to initialize scan session.");
    }

    currentScanId = initPayload.scan_id;
    currentPage = 1;
    currentSearch = "";
    if (searchInput) searchInput.value = "";

    // 2. Upload the files to this scan session
    if (scanStageHeader) scanStageHeader.textContent = "Stage: Uploading";
    if (scanProgressDetails) scanProgressDetails.textContent = `Uploading ${files.length} document(s)...`;
    if (scanProgressBar) scanProgressBar.style.width = "20%";

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));

    const uploadResponse = await fetch(apiUrl(`/api/scans/${currentScanId}/documents`), {
      method: "POST",
      body: formData
    });
    const uploadPayload = await uploadResponse.json();

    if (!uploadResponse.ok) {
      throw new Error(uploadPayload.message || "Failed to upload documents.");
    }

    // 3. Start the scan asynchronously
    if (scanStageHeader) scanStageHeader.textContent = "Stage: Processing";
    if (scanProgressDetails) scanProgressDetails.textContent = "Running document similarity engine...";
    if (scanProgressBar) scanProgressBar.style.width = "40%";

    const startResponse = await fetch(apiUrl(`/api/scans/${currentScanId}/start`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ algorithm: selectedAlgorithm })
    });
    const startPayload = await startResponse.json();

    if (!startResponse.ok) {
      throw new Error(startPayload.message || "Failed to start similarity engine.");
    }

    // 4. Poll status
    pollScanStatus(currentScanId);

  } catch (error) {
    showLayer(2);
    setText(uploadError, error.message);
    startScanBtn.disabled = false;
  }
}

function pollScanStatus(scanId) {
  const pollInterval = setInterval(async () => {
    try {
      const response = await fetch(apiUrl(`/api/scans/${scanId}/status`));
      const statusData = await response.json();

      if (!response.ok) {
        clearInterval(pollInterval);
        throw new Error(statusData.message || "Failed to fetch scan status.");
      }

      const stage = statusData.currentStage || "processing";
      const totalDocs = statusData.totalDocuments || 0;
      const processedDocs = statusData.processedDocuments || 0;
      const completedComps = statusData.completedComparisons || 0;
      const totalPossible = statusData.totalPossiblePairs || 0;
      const candidatePairs = statusData.candidatePairs || 0;
      const reduction = statusData.candidateReductionPercent || 0;
      const percentage = statusData.percentage || 0;

      // Update real-time metrics cards
      setText(metricDocs, `${processedDocs} / ${totalDocs}`);
      setText(metricPossible, totalPossible.toLocaleString());
      setText(metricCandidates, candidatePairs.toLocaleString());
      setText(metricReduction, `${reduction.toFixed(1)}%`);

      // Update stage and progress text without exposing internal algorithm names
      if (scanStageHeader) scanStageHeader.textContent = `Stage: ${stage.replace(/_/g, " ")}`;
      if (scanProgressDetails) {
        if (stage === "extracting") {
          scanProgressDetails.textContent = `Extracting files: ${processedDocs} / ${totalDocs} parsed`;
        } else if (stage === "preprocessing") {
          scanProgressDetails.textContent = "Normalizing text and preparing document tokens...";
        } else if (stage === "fingerprinting") {
          scanProgressDetails.textContent = `Generating document signatures: ${processedDocs} / ${totalDocs}`;
        } else if (stage === "candidate_generation") {
          scanProgressDetails.textContent = `Indexing candidate comparisons: ${candidatePairs.toLocaleString()} pairs queued`;
        } else if (stage === "comparing") {
          scanProgressDetails.textContent = `Analyzing document similarities: ${completedComps.toLocaleString()} / ${totalPossible.toLocaleString()}`;
        } else if (stage === "cleaning_up") {
          scanProgressDetails.textContent = "Processing completed. Cleaning up temporary artifacts...";
        } else {
          scanProgressDetails.textContent = "Saving similarity analysis to repository...";
        }
      }

      // Update progress bar width dynamically
      if (scanProgressBar) {
        let baseProgress = 30;
        if (stage === "extracting") baseProgress += (processedDocs / (totalDocs || 1)) * 15;
        else if (stage === "preprocessing") baseProgress = 50;
        else if (stage === "fingerprinting") baseProgress = 55 + (processedDocs / (totalDocs || 1)) * 15;
        else if (stage === "candidate_generation") baseProgress = 75;
        else if (stage === "comparing") baseProgress = 80 + (completedComps / (totalPossible || 1)) * 15;
        else if (stage === "cleaning_up") baseProgress = 96;
        else if (stage === "saving") baseProgress = 98;
        
        scanProgressBar.style.width = `${Math.min(100, Math.max(baseProgress, percentage))}%`;
      }

      // Check if finished
      if (statusData.status === "completed") {
        clearInterval(pollInterval);
        if (scanProgressBar) scanProgressBar.style.width = "100%";
        
        await loadDashboard();
        await loadRankedPairs();
        showLayer(4);
        startScanBtn.disabled = false;
      } else if (statusData.status === "failed") {
        clearInterval(pollInterval);
        showLayer(2);
        setText(uploadError, statusData.error || "Document scan job failed.");
        startScanBtn.disabled = false;
      }

    } catch (error) {
      clearInterval(pollInterval);
      showLayer(2);
      setText(uploadError, error.message);
      startScanBtn.disabled = false;
    }
  }, 1000);
}

function formatDate(dateInput) {
  return new Date(dateInput).toLocaleString();
}

async function loadHistory() {
  clearMessages();
  historyTableBody.innerHTML = "";

  try {
    const response = await fetch(apiUrl("/api/scan/history"));
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.message || "Unable to load repository.");
    }

    const rows = payload.history || [];
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.textContent = "No stored scan records found.";
      tr.appendChild(td);
      historyTableBody.appendChild(tr);
    } else {
      const fragment = document.createDocumentFragment();
      rows.forEach((row, index) => {
        const tr = document.createElement("tr");
        const cells = [
          String(index + 1),
          String(row.id ?? "-"),
          String(row.file_name_1 ?? ""),
          String(row.file_name_2 ?? ""),
          `${Number(row.similarity).toFixed(2)}%`,
          "Similarity Match",
          formatDate(row.created_at)
        ];

        cells.forEach((value) => {
          const td = document.createElement("td");
          td.textContent = value;
          tr.appendChild(td);
        });
        fragment.appendChild(tr);
      });
      historyTableBody.appendChild(fragment);
    }

    showLayer(5);
  } catch (error) {
    setText(historyError, error.message);
    showLayer(5);
  }
}

function playLayerReveals(layer) {
  if (!layer) {
    return;
  }

  const targets = Array.from(layer.querySelectorAll(".reveal"));
  targets.forEach((target) => target.classList.remove("in"));

  targets.forEach((target, index) => {
    window.setTimeout(() => {
      target.classList.add("in");
    }, index * 85);
  });
}

function playHeroReveal() {
  if (!heroTitle) {
    return;
  }

  if (heroTitle.dataset.static === "true" || heroTitle.dataset.animate !== "fall") {
    return;
  }

  const text = heroTitle.dataset.text || heroTitle.textContent || "DocSim";
  heroTitle.textContent = "";
  heroLetters = [];

  text.split("").forEach((char, index) => {
    const outer = document.createElement("span");
    outer.className = "hero-letter";
    if (index >= text.length - 3) {
      outer.classList.add("highlight");
    }

    const inner = document.createElement("span");
    inner.className = "hero-letter-inner";
    inner.textContent = char;
    inner.style.animationDelay = `${index * 0.08}s`;
    outer.appendChild(inner);
    heroTitle.appendChild(outer);
    heroLetters.push(outer);
  });
}

function renderBookTransform() {
  if (!bookElement) {
    return;
  }

  const rx = 63 + pointerY * 0.12 - bookScrollOffset * 4.2;
  const rz = -14 + pointerX * 0.08;
  const tx = pointerX * 0.55;
  const ty = 7 + pointerY * 0.07 - bookScrollOffset * 8;
  bookElement.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}vh, 0)`;
}

function initCarousel() {
  if (!featureCarousel) {
    return;
  }

  const step = () => Math.max(featureCarousel.clientWidth * 0.72, 260);
  carouselPrev?.addEventListener("click", () => featureCarousel.scrollBy({ left: -step(), behavior: "smooth" }));
  carouselNext?.addEventListener("click", () => featureCarousel.scrollBy({ left: step(), behavior: "smooth" }));

  let isDown = false;
  let startX = 0;
  let startScroll = 0;

  featureCarousel.addEventListener("pointerdown", (event) => {
    isDown = true;
    startX = event.clientX;
    startScroll = featureCarousel.scrollLeft;
    featureCarousel.setPointerCapture(event.pointerId);
  });

  featureCarousel.addEventListener("pointermove", (event) => {
    if (!isDown) {
      return;
    }
    const delta = event.clientX - startX;
    featureCarousel.scrollLeft = startScroll - delta;
  });

  const stopDrag = () => {
    isDown = false;
  };

  featureCarousel.addEventListener("pointerup", stopDrag);
  featureCarousel.addEventListener("pointercancel", stopDrag);
  featureCarousel.addEventListener("pointerleave", stopDrag);
}

function initParallax() {
  window.addEventListener("mousemove", (event) => {
    const x = (event.clientX / window.innerWidth - 0.5) * 20;
    const y = (event.clientY / window.innerHeight - 0.5) * 20;
    pointerX = x;
    pointerY = y;

    parallaxTargets.forEach((item, index) => {
      const depth = (index + 1) * 0.42;
      item.style.transform = `translate3d(${(-x * depth).toFixed(2)}px, ${(-y * depth).toFixed(2)}px, 0)`;
    });

    if (heroLetters.length) {
      heroLetters.forEach((letter, index) => {
        const offsetX = x * 0.35 * (index % 3 - 1);
        const offsetY = y * 0.25 * ((index % 2) ? 1 : -1);
        letter.style.setProperty("--lx", `${offsetX.toFixed(2)}px`);
        letter.style.setProperty("--ly", `${offsetY.toFixed(2)}px`);
      });
    }

    renderBookTransform();
  });
}

function initHeroScrollParallax() {
  if (!heroPanel) {
    return;
  }

  heroPanel.addEventListener("scroll", () => {
    const maxScroll = heroPanel.scrollHeight - heroPanel.clientHeight;
    bookScrollOffset = maxScroll > 0 ? heroPanel.scrollTop / maxScroll : 0;
    renderBookTransform();
  });
}

function bindEvents() {
  if (window.location.protocol === "file:") {
    setText(uploadError, "Open DocSim from http://localhost:<port>, not from file:// path.");
  }

  enterSystemBtn?.addEventListener("click", () => showLayer(2));
  returnHomeBtn?.addEventListener("click", () => showLayer(1));
  backToUploadBtn?.addEventListener("click", () => showLayer(2));
  returnResultsBtn?.addEventListener("click", () => showLayer(4));
  startScanBtn?.addEventListener("click", startScan);
  clearFilesBtn?.addEventListener("click", () => {
    selectedFiles = [];
    filesInput.value = "";
    updateFileCount();
    syncUploadState();
    clearMessages();
  });

  chooseFilesBtn?.addEventListener("click", () => {
    filesInput?.click();
  });

  filesInput?.addEventListener("change", () => {
    const pickedFiles = Array.from(filesInput?.files || []);
    handlePickedFiles(pickedFiles);
  });

  filePicker?.addEventListener("dragover", (event) => {
    event.preventDefault();
    filePicker.classList.add("dragover");
  });

  filePicker?.addEventListener("dragleave", () => {
    filePicker.classList.remove("dragover");
  });

  filePicker?.addEventListener("drop", (event) => {
    event.preventDefault();
    filePicker.classList.remove("dragover");
    const pickedFiles = Array.from(event.dataTransfer?.files || []);
    handlePickedFiles(pickedFiles);
  });

  // Fallback delegation to guarantee layer navigation even if a direct listener fails.
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.id === "enterSystemBtn") {
      showLayer(2);
    } else if (target.id === "returnHomeBtn") {
      showLayer(1);
    } else if (target.id === "backToUploadBtn") {
      showLayer(2);
    } else if (target.id === "returnResultsBtn") {
      showLayer(4);
    }
  });
}

bindEvents();
updateFileCount();
syncUploadState();
initParallax();
initCarousel();
initHeroScrollParallax();
playHeroReveal();
showLayer(1);
