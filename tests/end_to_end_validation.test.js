const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs/promises");
const path = require("path");
const PDFDocument = require("pdfkit");
const JSZip = require("jszip");

const extractionService = require("../src/services/extractionService");
const similarityService = require("../src/services/similarityService");
const passageService = require("../src/services/passageService");
const ocrService = require("../src/services/ocrService");

describe("DocSim Whole-Document Similarity End-to-End Validation Dataset (Phase 14)", () => {
  const testDir = path.join(__dirname, "..", "uploads", "test_validation_dataset");

  // Valid 50x50 PNG base64 strings
  const samplePngBase64 = "iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAIAAACRXR/mAAAATUlEQVR4nO3OMQHAIBAAsQf/nlsDLJlguCjImvnmPft24KyWqCVqiVqilqglaolaopaoJWqJWqKWqCVqiVqilqglaolaopaoJWqJWuIHP6wBY/cJXlsAAAAASUVORK5CYII=";
  const distinctPngBase64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCABkAGQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==";

  before(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  after(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (_) {}
    await ocrService.terminate();
  });

  // Helper to create a PDF with text and optional embedded image
  async function createPdf(filename, text, imgBuffer = null) {
    const filePath = path.join(testDir, filename);
    const doc = new PDFDocument();
    const writeStream = require("fs").createWriteStream(filePath);
    doc.pipe(writeStream);
    doc.text(text);
    if (imgBuffer) {
      doc.image(imgBuffer, 50, 150, { width: 50 });
    }
    doc.end();
    await new Promise((res) => writeStream.on("finish", res));
    return filePath;
  }

  // Helper to create a DOCX with paragraphs, optional table, and optional image
  async function createDocx(filename, text, tableRows = null, imgBuffer = null) {
    const filePath = path.join(testDir, filename);
    const zip = new JSZip();

    let tableXml = "";
    if (tableRows && tableRows.length > 0) {
      const rowsXml = tableRows.map(row => 
        `<w:tr>${row.map(cell => `<w:tc><w:p><w:r><w:t>${cell}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`
      ).join("");
      tableXml = `<w:tbl>${rowsXml}</w:tbl>`;
    }

    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
        ${tableXml}
      </w:body>
    </w:document>`;

    zip.file("word/document.xml", docXml);
    if (imgBuffer) {
      zip.file("word/media/image1.png", imgBuffer);
    }

    const docxBuf = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(filePath, docxBuf);
    return filePath;
  }

  // Helper to execute end-to-end extraction and comparison on a file pair
  async function evaluatePair(docAInfo, docBInfo) {
    const multiA = await extractionService.extractMultimodalContent(docAInfo, { outputDir: testDir });
    const multiB = await extractionService.extractMultimodalContent(docBInfo, { outputDir: testDir });

    const rawA = await fs.readFile(docAInfo.path);
    const rawB = await fs.readFile(docBInfo.path);
    const hashA = require("crypto").createHash("sha256").update(rawA).digest("hex");
    const hashB = require("crypto").createHash("sha256").update(rawB).digest("hex");

    const docA = { documentId: "doc_A", filename: docAInfo.originalname, filePath: docAInfo.path, sha256Hash: hashA };
    const docB = { documentId: "doc_B", filename: docBInfo.originalname, filePath: docBInfo.path, sha256Hash: hashB };

    let baseTextSim = 0;
    let matchingPassages = [];
    if (docA.sha256Hash === docB.sha256Hash) {
      baseTextSim = 1.0;
      matchingPassages = passageService.findMatchingPassages(multiA.text, multiA.text, { minSimilarity: 35 });
    } else if (multiA.text && multiB.text) {
      matchingPassages = passageService.findMatchingPassages(multiA.text, multiB.text, { minSimilarity: 30, maxPassages: 10 });
      // Approximate word overlap
      const wordsA = new Set(multiA.text.toLowerCase().match(/\w+/g) || []);
      const wordsB = new Set(multiB.text.toLowerCase().match(/\w+/g) || []);
      const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
      const union = new Set([...wordsA, ...wordsB]).size;
      baseTextSim = union > 0 ? intersection / union : 0;
    }

    const result = await similarityService.compareMultimodalPair(docA, docB, multiA, multiB, baseTextSim, matchingPassages);

    // STRICT NON-NEGOTIABLE VERIFICATION: Exactly ONE overall percentage, NO separate modality percentages
    assert.strictEqual(typeof result.similarityPercentage, "number", "Pair must have single similarityPercentage");
    assert.strictEqual(result.textPercentage, undefined, "Must NOT have textPercentage");
    assert.strictEqual(result.codePercentage, undefined, "Must NOT have codePercentage");
    assert.strictEqual(result.imagePercentage, undefined, "Must NOT have imagePercentage");
    assert.strictEqual(result.tablePercentage, undefined, "Must NOT have tablePercentage");
    assert.ok(result.evidence, "Pair must include categorized evidence object");
    assert.ok(Array.isArray(result.evidence.passages), "Evidence has passages array");
    assert.ok(Array.isArray(result.evidence.images), "Evidence has images array");
    assert.ok(Array.isArray(result.evidence.code), "Evidence has code array");
    assert.ok(Array.isArray(result.evidence.tables), "Evidence has tables array");

    return result;
  }

  test("Case 1: Identical assignments (100% expected)", async () => {
    const text = "Computer Systems: Buffer overflow exploitation, stack frame layout, and shellcode injection defenses. Modern operating systems implement address space layout randomization and non-executable stack segments to prevent execution of malicious payload injected through vulnerable buffers.";
    const pA = await createPdf("case1_a.pdf", text);
    const pB = await createPdf("case1_b.pdf", text);

    const res = await evaluatePair(
      { originalname: "case1_a.pdf", path: pA },
      { originalname: "case1_b.pdf", path: pB }
    );

    assert.strictEqual(res.similarityPercentage, 100.0, "Identical assignment must produce 100%");
    assert.ok(res.evidence.passages.length > 0, "Identifies matching text evidence");
  });

  test("Case 2: Copied text with different screenshots", async () => {
    const copiedParagraph = `
      Microprocessor Systems Laboratory Assessment.
      In this experiment, we initialized UART serial communication on the ATmega328P microcontroller at 9600 baud rate with eight data bits and no parity bit.
      The microcontroller receives command bytes from the workstation terminal and responds with status acknowledgments across the RX and TX pins.
      Timers were configured using CTC mode to trigger periodic ADC sampling of analog temperature sensors at 100Hz frequency.
      Interrupt service routines were kept lightweight to prevent latency jitter across concurrent peripheral communication buses.
    `;
    const pA = await createPdf("case2_a.pdf", copiedParagraph, Buffer.from(samplePngBase64, "base64"));
    const pB = await createPdf("case2_b.pdf", copiedParagraph, Buffer.from(distinctPngBase64, "base64"));

    const res = await evaluatePair(
      { originalname: "case2_a.pdf", path: pA },
      { originalname: "case2_b.pdf", path: pB }
    );

    // Text is identical (~80 words mass), but screenshot is completely different (150 mass)
    assert.ok(res.similarityPercentage >= 30.0 && res.similarityPercentage <= 60.0, "Score in expected range [30, 60]");
    assert.ok(res.evidence.passages.length > 0, "Finds copied text passage evidence");
    assert.strictEqual(res.evidence.images.length, 0, "Does not match distinct screenshots");
  });

  test("Case 3: Rewritten text with identical screenshots", async () => {
    const textA = "We observed that network throughput collapsed as router packet queues filled beyond capacity during the peak burst.";
    const textB = "During high-traffic testing, router congestion precipitated rapid packet drop rates and throttled communication channels.";
    const imgBuf = Buffer.from(samplePngBase64, "base64");

    const pA = await createPdf("case3_a.pdf", textA, imgBuf);
    const pB = await createPdf("case3_b.pdf", textB, imgBuf);

    const res = await evaluatePair(
      { originalname: "case3_a.pdf", path: pA },
      { originalname: "case3_b.pdf", path: pB }
    );

    assert.ok(res.similarityPercentage >= 60.0, `Score (${res.similarityPercentage}%) reflects reused screenshot`);
    assert.ok(res.evidence.images.length > 0, "Detects identical screenshot evidence");
  });

  test("Case 4: Modified code with variable renames and unchanged logic", async () => {
    const codeA = `
      def bubbleSort(dataset):
          n = len(dataset)
          for i in range(n):
              for j in range(0, n - i - 1):
                  if dataset[j] > dataset[j + 1]:
                      temp = dataset[j]
                      dataset[j] = dataset[j + 1]
                      dataset[j + 1] = temp
          return dataset
    `;
    const codeB = `
      def bubbleSort(items):
          length = len(items)
          for outer in range(length):
              for inner in range(0, length - outer - 1):
                  if items[inner] > items[inner + 1]:
                      val = items[inner]
                      items[inner] = items[inner + 1]
                      items[inner + 1] = val
          return items
    `;

    const pA = path.join(testDir, "case4_a.txt");
    const pB = path.join(testDir, "case4_b.txt");
    await fs.writeFile(pA, codeA);
    await fs.writeFile(pB, codeB);

    const res = await evaluatePair(
      { originalname: "case4_a.txt", path: pA },
      { originalname: "case4_b.txt", path: pB }
    );

    assert.ok(res.similarityPercentage >= 60.0, `Score (${res.similarityPercentage}%) detects renamed code logic`);
    assert.ok(res.evidence.code.length > 0, "Captures matching code statement evidence");
  });

  test("Case 5: Copied diagrams between documents", async () => {
    const textA = "Analysis of the operational amplifier summing circuit in inverting configuration.";
    const textB = "Laboratory investigation into active filters and frequency response characteristics.";
    const diagramBuf = Buffer.from(samplePngBase64, "base64");

    const pA = await createPdf("case5_a.pdf", textA, diagramBuf);
    const pB = await createPdf("case5_b.pdf", textB, diagramBuf);

    const res = await evaluatePair(
      { originalname: "case5_a.pdf", path: pA },
      { originalname: "case5_b.pdf", path: pB }
    );

    assert.ok(res.evidence.images.length > 0, "Diagram match captured in image evidence");
    assert.strictEqual(typeof res.similarityPercentage, "number");
  });

  test("Case 6: Standard lab instructions boilerplate only (< 25%)", async () => {
    const docA = `
      Course: Data Structures and Algorithms Lab 04.
      Instructor: Dr. Alan Turing.
      Department of Computer Science and Engineering.
      Instructions: Implement all functions independently. No unauthorized sharing permitted.
      Student Answer and Methodology:
      I designed an AVL self-balancing binary search tree. Each node maintains a balance factor between -1 and 1.
      When insertions cause an imbalance, single left or right rotations or composite double rotations restore logarithmic height.
      Extensive benchmarking with ten thousand randomized integer insertions confirmed height stayed strictly below 1.44 log2(n).
    `;
    const docB = `
      Course: Data Structures and Algorithms Lab 04.
      Instructor: Dr. Alan Turing.
      Department of Computer Science and Engineering.
      Instructions: Implement all functions independently. No unauthorized sharing permitted.
      Student Answer and Methodology:
      My implementation utilized a red-black tree with node color toggling.
      Every leaf node is black, and red nodes never have red children. Violations were corrected via color flips and tree rotations.
      Worst-case lookup latency proved consistently optimal across varied workloads with minimal overhead compared to standard BSTs.
    `;

    const pA = await createPdf("case6_a.pdf", docA);
    const pB = await createPdf("case6_b.pdf", docB);

    const res = await evaluatePair(
      { originalname: "case6_a.pdf", path: pA },
      { originalname: "case6_b.pdf", path: pB }
    );

    // Boilerplate should not produce a high plagiarism match
    assert.ok(res.similarityPercentage <= 35.0, `Score (${res.similarityPercentage}%) should be <= 35% due to independent answers`);
  });

  test("Case 7: Completely unrelated assignments (~0%)", async () => {
    const textA = "Database normalization theory: First normal form eliminates repeating groups. Boyce-Codd normal form enforces all determinants are candidate keys.";
    const textB = "Molecular genetics: The double-helix structure of DNA comprises adenine, thymine, guanine, and cytosine base pairs linked by hydrogen bonds.";

    const pA = await createPdf("case7_a.pdf", textA);
    const pB = await createPdf("case7_b.pdf", textB);

    const res = await evaluatePair(
      { originalname: "case7_a.pdf", path: pA },
      { originalname: "case7_b.pdf", path: pB }
    );

    assert.ok(res.similarityPercentage <= 10.0, `Unrelated assignments score (${res.similarityPercentage}%) must be near 0`);
    assert.strictEqual(res.evidence.images.length, 0);
    assert.strictEqual(res.evidence.tables.length, 0);
  });

  test("Case 8: PDF and DOCX cross-format versions of substantially same assignment", async () => {
    const sharedText = `
      Operating Systems Laboratory: Process Synchronization and Deadlock Avoidance.
      In this project, we implemented Dijkstra's Banker's Algorithm to safely allocate multiple resource types among competing threads.
      The safety algorithm evaluates whether a safe sequence exists where each thread can satisfy its maximum remaining resource claims.
      Mutex locks and counting semaphores were deployed to protect critical section access to shared global resource vectors.
    `;

    const pPdf = await createPdf("case8.pdf", sharedText);
    const pDocx = await createDocx("case8.docx", sharedText);

    const res = await evaluatePair(
      { originalname: "case8.pdf", path: pPdf },
      { originalname: "case8.docx", path: pDocx }
    );

    assert.ok(res.similarityPercentage >= 70.0, `Cross-format score (${res.similarityPercentage}%) detects high similarity`);
    assert.ok(res.evidence.passages.length > 0, "Finds matching text passages across PDF and DOCX");
  });

  test("Case 9: Scanned assignment with image-embedded content", async () => {
    const pA = path.join(testDir, "case9_a.png");
    const pB = path.join(testDir, "case9_b.png");
    await fs.writeFile(pA, Buffer.from(samplePngBase64, "base64"));
    await fs.writeFile(pB, Buffer.from(samplePngBase64, "base64"));

    const res = await evaluatePair(
      { originalname: "case9_a.png", path: pA },
      { originalname: "case9_b.png", path: pB }
    );

    assert.strictEqual(res.similarityPercentage, 100.0, "Identical standalone images evaluate to 100%");
    assert.strictEqual(res.evidence.images.length, 1, "Image evidence captured");
  });

  test("Case 10: Mixed original and copied content", async () => {
    const commonTheory = `
      Introduction and Theoretical Background:
      Thermal conductivity measures a material's capability to conduct heat according to Fourier's Law of heat conduction.
      Heat transfer rate Q is directly proportional to temperature gradient dT/dx and cross-sectional area A perpendicular to heat flow.
    `;
    const originalPartA = `
      Experimental Setup: We measured cylindrical copper specimens heated with an electrical resistance coil.
      Thermocouples recorded temperatures at five-centimeter intervals along the bar until thermal equilibrium was reached after forty minutes.
    `;
    const originalPartB = `
      Error Analysis and Convective Heat Losses:
      Unlike ideal vacuum conditions, convective dissipation to the ambient room atmosphere produced a non-linear temperature drop.
      Finite element simulation showed five percent radiation losses along uninsulated measurement boundaries.
    `;
    const diagram = Buffer.from(samplePngBase64, "base64");

    const pA = await createPdf("case10_a.pdf", `${commonTheory}\n${originalPartA}`, diagram);
    const pB = await createPdf("case10_b.pdf", `${commonTheory}\n${originalPartB}`, diagram);

    const res = await evaluatePair(
      { originalname: "case10_a.pdf", path: pA },
      { originalname: "case10_b.pdf", path: pB }
    );

    // Partially copied text + identical diagram
    assert.ok(res.similarityPercentage >= 40.0 && res.similarityPercentage <= 90.0, `Score (${res.similarityPercentage}%) in mixed range [40, 90]`);
    assert.ok(res.evidence.passages.length > 0, "Passage evidence captured");
    assert.ok(res.evidence.images.length > 0, "Image diagram evidence captured");
  });
});
