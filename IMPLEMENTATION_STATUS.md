# DocSim Implementation Status & Progress Tracker

## Baseline vs Current Status
- **Baseline Test Suite (Stage 1)**: 82/82 passing (10 test suites in `tests/`).
- **Current Test Suite (Stage 8 Completed)**: **108/108 passing across 13 test suites (0 failures, 0 skipped, 0 regressions)**.
- **Python Acceleration Engine**: 1,000 documents benchmark (499,500 pairs) verified in ~5.6 seconds.
- **Git Tree**: Maintained cleanly, preserving all existing architecture while extending functionality.

---

## Stages & Progress

### Stage 1: Inspect Architecture & Establish Baseline
- [x] Inspect directory structure and code architecture
- [x] Run baseline regression test suite (82 passing, 0 failing)
- [x] Map frontend (`index.html`, `app.js`, `style.css`), backend (`server.js`, `src/`), and database models
- [x] Initialize `IMPLEMENTATION_STATUS.md`

### Stage 2: Fix PDF Layout & Pagination
- [x] Support long filenames with dynamic wrapping and row height calculation (`doc.heightOfString`)
- [x] Handle filenames without spaces and preserve Unicode text (NFKC normalization and safe sanitization)
- [x] Keep table rows together, repeat table headers across pages with continuation header logic
- [x] Reliable page numbering ("Page X of Y"), prevent blank trailing pages via `doc.page.margins.bottom = 0` during footer rendering
- [x] Orphan prevention: keep section headings together with content (`currentY > 640` page break threshold)
- [x] Display genuine matching evidence with page numbers and source locations; no fabricated evidence
- [x] Remove presentation-only privacy status cards and banners from PDF report
- [x] Add PDF unit and integration tests (`tests/pdf_report.test.js` - 5/5 passing)

### Stage 3: Remove Unnecessary Privacy-Status UI
- [x] Remove `scanPrivacyCard` ("Privacy Protocol: Active Sandbox", "In Sandbox") from `index.html`
- [x] Remove `resultsPrivacyBanner` ("Zero File Storage Verified • Automatic Cleanup Complete") from `index.html`
- [x] Clean up JavaScript tracking and update logic in `app.js` without touching actual backend security
- [x] Verify visual layout, colors, typography, and responsive integrity

### Stage 4: Implement Evidence Endpoint & Viewer
- [x] Add "View Evidence" action button to document pair results in UI
- [x] Add `/api/scans/:scanId/evidence` endpoint routing alongside `/api/scans/:scanId/passages`
- [x] Parameter validation: validate scanId, docA, docB; reject self-comparison with 400; return 404 for missing scans or comparisons
- [x] Omit internal filesystem paths (`filePath`) and stack traces from API payloads
- [x] Responsive side-by-side (desktop: 2-column grid) and stacked (mobile: 1-column grid) evidence viewer modal
- [x] Display Doc A filename, Doc B filename, single overall similarity %, classification, matched passages with `<mark>` spans, page numbers / source locations
- [x] Implement loading spinner, empty state notice, 404/500 error state, and interactive "Retry" button
- [x] Debounce button clicks with `isEvidenceLoading` guard to prevent duplicate network requests
- [x] Prevent XSS through strict HTML escaping in `passageService.highlightMatchedTokens`

### Stage 5: Improve Text Detection, Evidence Generation & Scoring
- [x] Detect exact duplicates despite harmless formatting differences (whitespace, line endings, Unicode NFC/NFD) via `preprocessingService.areNormalizedTextsIdentical`
- [x] Detect partial copying across multi-paragraph documents via sentence alignment and `computePassageCoverage`
- [x] Detect modified copying (small word substitutions, minor edits, reordered paragraphs)
- [x] False-positive reduction: suppress generic academic and administrative boilerplate headings ("Table of Contents", "Introduction", "References", etc.)
- [x] Guarantee exactly ONE overall similarity percentage (0-100%) per document pair
- [x] Accurate evidence spans with offsets (`offsetA`, `offsetB`) and page numbers (`pageA`, `pageB`)
- [x] Add comprehensive plagiarism engine tests (`tests/plagiarism_engine.test.js` - 14/14 passing)

### Stage 6: Database Handling, Performance & Cleanup
- [x] Ensure MongoDB schemas and indexes match query patterns (added `normalizedHash` index to `documents` collection)
- [x] Verify temporary file deletion on success and failure without path traversal (`cleanupService.js`)
- [x] Concurrency isolation: separate scan UUID directories prevent cross-job deletion
- [x] Ensure non-permanent storage of binary files and extracted raw text (only metadata and minimal evidence retained)
- [x] Add security and storage lifecycle tests (`tests/security_lifecycle.test.js` - 7/7 passing)

### Stage 7: Extend Modality Capabilities (Code, Image, OCR, Tables)
- [x] OCR handling via `tesseract.js` with worker pooling and error handling
- [x] Code normalization, comment stripping, identifier abstraction, and boilerplate suppression (`codeService.js`)
- [x] Perceptual and exact image deduplication via binary headers and dHash (`imageService.js`)
- [x] Table structural alignment and cell overlap comparison (`tableService.js`)
- [x] Unified scoring with mass-weighting and anti-double-counting (`scoringService.js`)

### Stage 8: Comprehensive Testing & Security Review
- [x] Run full test suite: 108 tests across 13 suites, 108 passing, 0 failing
- [x] Security checks: path traversal, XSS prevention, parameter validation, no secret leaks
- [x] Zero regressions across existing Level 1, Level 2, and multimodal test suites

### Stage 9: Documentation & Final Report
- [x] Update `README.md` with exact architecture, scoring methodology, API endpoints, and run commands
- [x] Prepare comprehensive final implementation report
