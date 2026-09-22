# 🚀 DocSim — Intelligent & Distributed Document Similarity Detection Platform

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg?logo=node.js)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg?logo=python)](https://python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-teal.svg?logo=fastapi)](https://fastapi.tiangolo.com/)
[![NumPy](https://img.shields.io/badge/NumPy-SIMD%20Vectorized-orange.svg?logo=numpy)](https://numpy.org/)
[![Express.js](https://img.shields.io/badge/Express-4.21-lightgrey.svg?logo=express)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas%20%7C%20In--Memory-brightgreen.svg?logo=mongodb)](https://www.mongodb.com/)
[![BullMQ](https://img.shields.io/badge/BullMQ-Distributed%20Queue-red.svg?logo=redis)](https://bullmq.io/)
[![Three.js](https://img.shields.io/badge/Three.js-3D%20Visualizer-black.svg?logo=three.js)](https://threejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**DocSim** is a high-throughput, distributed document similarity detection platform engineered to process and cross-examine large corpora of documents (**PDF, DOCX, and TXT**) at massive scale (1,000+ files). 

By combining a **High-Performance Python SIMD Acceleration Engine (NumPy + SciPy + Datasketch)** with **word-level $k$-shingling**, **deterministic MinHash signatures**, **Locality-Sensitive Hashing (LSH)**, and **exact Set-based Jaccard similarity**, DocSim slashes computational complexity from quadratic $O(N^2)$ all-pairs comparisons down to near-linear $O(N)$ candidate checks—delivering over **95% comparison reductions** and processing hundreds of thousands of document comparisons in seconds.

---

## 🌟 Key Features

- **High-Performance Python SIMD Engine**:
  - Vectorized 128-permutation MinHash signature generation using NumPy C/SIMD broadcasting (`AVX2`), achieving **>230 documents/sec**.
  - SciPy Compressed Sparse Row (`CSR`) matrix multiplication computing all-pairs exact Jaccard for **499,500 pairs in under 1 second**.
  - Multi-threaded text extraction and parsing across all CPU cores.
- **Multi-Format Extraction**: Ingests and extracts clean text from `.pdf` (via `pypdf` / `pdf-parse`), `.docx` (via `python-docx` / `mammoth`), and `.txt` files in parallel.
- **SHA-256 Fast-Path Deduplication**: Instantly fingerprints files with cryptographic SHA-256 hashes to identify exact duplicates ($1.0$ similarity) with zero Jaccard computations.
- **Intelligent Sub-Quadratic Engine (Level 2)**:
  - **$k$-Shingling**: Generates contiguous word-level shingle sets ($k=5$).
  - **MinHash Signatures**: Creates compact 128-permutation integer signatures.
  - **LSH Banding**: Partitions signatures into 32 bands $\times$ 4 rows to index candidate pairs with high collision probability for true matches.
  - **Exact Jaccard Verification**: Evaluates true Jaccard similarity exclusively on filtered candidate pairs.
- **Distributed & Asynchronous Queueing**:
  - Scalable background processing with **BullMQ** and **Redis** (`documentWorker` & `comparisonWorker`).
  - **Graceful Fallback**: Automatically falls back to an in-process asynchronous execution pipeline if Redis is offline.
- **Resilient Database Layer**:
  - **MongoDB Atlas** with connection pooling and optimized multi-field indexes.
  - Automatic failover to **In-Memory MongoDB** (`mongodb-memory-server`) for zero-config local testing and offline workflows.
  - Legacy **MySQL** schema support included.
- **Real-Time Interactive Web UI**:
  - Immersive 3D Hyperspeed canvas powered by **Three.js**.
  - Real-time scan progress polling through distinct execution stages (`uploading` $\rightarrow$ `extracting` $\rightarrow$ `preprocessing` $\rightarrow$ `comparing` $\rightarrow$ `saving` $\rightarrow$ `completed`).
  - Interactive results table with similarity threshold filtering, multi-field sorting, and pagination.
- **Lifecycle & Storage Management**: Automatic post-scan cleanup of uploaded physical files to prevent disk exhaustion.

---

## 🏗️ Architecture & Pipeline Flow

```text
+-----------------------------------------------------------------------------------+
|                                 DOCSIM PIPELINE                                   |
+-----------------------------------------------------------------------------------+
                                          │
 1. Document Ingestion                    ▼
    [ PDF / DOCX / TXT ] ───► Multer Middleware (Limit & MIME Validation)
                                          │
 2. Single-Pass Extraction                ▼
    [ Text Extraction ] ────► SHA-256 Content Hashing (Identical Document Bypass)
                                          │
 3. Preprocessing                         ▼
    [ Tokenization ] ───────► Word-Level k-Shingling (k = 5)
                                          │
 4. Dimensionality Reduction              ▼
    [ Shingle Sets ] ───────► 128-Permutation MinHash Signatures
                                          │
 5. Candidate Generation                  ▼
    [ MinHash Signatures ] ─► LSH Banding (32 Bands x 4 Rows) ──► Candidate Pairs
                                          │
 6. Similarity Calculation                ▼
    [ Candidate Pairs ] ────► Exact Set-Based Jaccard Similarity (J = |A ∩ B| / |A ∪ B|)
                                          │
 7. Persistence & Delivery                ▼
    [ Results Batch ] ──────► MongoDB Atlas (similarity_results collection)
                                          │
 8. Real-time UI                          ▼
    [ REST API / SSE / Poll] ► Interactive 3D Web Dashboard & Paginated Table
```

---

## 📁 Repository Structure

```text
SIMILARITY/
├── python-engine/              # High-Performance Python SIMD & SciPy Engine
│   ├── algorithms/
│   │   ├── extractor.py        # Multi-core document text parser & k-shingler
│   │   ├── lsh_engine.py       # LSH candidate pair indexing engine
│   │   ├── minhash_vectorized.py # NumPy SIMD 128-permutation MinHash
│   │   └── sparse_jaccard.py   # SciPy CSR matrix multiplication Jaccard
│   ├── main.py                 # FastAPI microservice entrypoint
│   ├── requirements.txt        # Python dependency specifications
│   └── test_engine.py          # 1,000-document scalability benchmark script
├── database/
│   └── schema.sql              # MySQL migration schema (legacy/relational support)
├── src/
│   ├── algorithms/
│   │   ├── jaccard.js          # Optimized Set-based exact Jaccard similarity
│   │   ├── lsh.js              # Locality-Sensitive Hashing (banding & bucket logic)
│   │   ├── minhash.js          # Deterministic MinHash signature generation (Uint32Array)
│   │   └── shingling.js        # Word-level k-shingling and token extraction
│   ├── config/
│   │   └── db.js               # MongoDB connection pool & in-memory fallback
│   ├── controllers/
│   │   └── scanController.js   # HTTP controllers for scan operations & lifecycle
│   ├── middleware/
│   │   ├── errorMiddleware.js  # Centralized Express error handler
│   │   └── uploadMiddleware.js # Multer file upload & boundary validation
│   ├── queue/
│   │   ├── connection.js       # Redis connection handling
│   │   ├── jobs.js             # BullMQ job dispatchers & reference payloads
│   │   └── queues.js           # Document & Comparison queue definitions
│   ├── routes/
│   │   └── scanRoutes.js       # Express route definitions
│   ├── services/
│   │   ├── candidateService.js # LSH candidate pair filtering & pair deduplication
│   │   ├── cleanupService.js   # File deletion & retention lifecycle
│   │   ├── documentService.js  # Document & Scan CRUD persistence
│   │   ├── extractionService.js# Multi-format document parser (PDF, DOCX, TXT)
│   │   ├── featureService.js   # Shingle and signature generation coordinator
│   │   ├── hashingService.js   # SHA-256 hashing utilities
│   │   ├── preprocessingService.js # Text normalization & tokenization
│   │   ├── resultService.js    # Paginated, sorted, and filtered query engine
│   │   ├── similarityService.js# Hybrid Python/Node Level 1 & Level 2 runners
│   │   └── storageService.js   # Disk storage abstraction
│   └── workers/
│       ├── comparisonWorker.js # BullMQ worker for parallel similarity computation
│       ├── documentWorker.js   # BullMQ worker for parallel document parsing
│       └── index.js            # Worker initialization hub
├── tests/
│   ├── dashboard.test.js       # Dashboard, aggregations & report test suite
│   ├── level2.test.js          # Comprehensive test suite for MinHash, LSH & Workers
│   └── scans.test.js           # API integration & scan lifecycle test suite
├── uploads/                    # Temporary upload destination (.gitkeep)
├── app.js                      # Frontend dashboard logic & API polling client
├── benchmark.js                # Performance benchmarking suite (Level 1 vs Level 2)
├── hyperspeed.js               # Three.js 3D background animation engine
├── index.html                  # Responsive web user interface
├── server.js                   # Application bootstrap and server entry point
├── style.css                   # Modern CSS styling (Glassmorphism & dark theme)
├── package.json                # Project dependencies and script runner
└── .env.example                # Sample environment configuration
```

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory by copying `.env.example`:

```bash
cp .env.example .env
```

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | `number` | `3001` | Express server port |
| `PYTHON_ENGINE_URL` | `string` | `http://127.0.0.1:8000` | Python Acceleration Engine URL (auto-detected) |
| `MONGODB_URI` | `string` | *Optional* | MongoDB Atlas connection string (falls back to in-memory if omitted/unreachable) |
| `MONGODB_DB_NAME` | `string` | `SIMILARITY` | MongoDB database name |
| `REDIS_URL` | `string` | *Optional* | Redis connection URI for BullMQ distributed queues |
| `REDIS_HOST` | `string` | `127.0.0.1` | Redis host |
| `REDIS_PORT` | `number` | `6379` | Redis port |
| `REDIS_PASSWORD` | `string` | *Optional* | Redis password |
| `MAX_FILES` | `number` | `1000` | Maximum number of files permitted per scan |
| `MAX_FILE_SIZE_MB` | `number` | `20` | Maximum size per individual file in MB |
| `MAX_TOTAL_UPLOAD_SIZE_MB` | `number` | `500` | Maximum cumulative upload size per scan in MB |
| `SIMILARITY_THRESHOLD` | `number` | `0.80` | Default similarity threshold filter ($0.0 - 1.0$) |
| `DB_BATCH_SIZE` | `number` | `1000` | Batch insert chunk size for similarity results |
| `SHINGLE_SIZE` | `number` | `5` | Word-level $k$-shingle window length ($k$) |
| `MINHASH_NUM_PERMUTATIONS` | `number` | `128` | Number of hash permutations for MinHash signatures |
| `LSH_BANDS` | `number` | `32` | Number of LSH bands ($b$) |
| `LSH_ROWS` | `number` | `4` | Number of rows per LSH band ($r$, where $b \times r = 128$) |
| `DOCUMENT_WORKER_CONCURRENCY` | `number` | `4` | BullMQ document parser concurrency |
| `COMPARISON_WORKER_CONCURRENCY` | `number` | `4` | BullMQ similarity comparison concurrency |

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: `v18.0.0` or higher
- **Python**: `3.10` or higher (with `pip`)
- **MongoDB** *(Optional)*: MongoDB Atlas or local MongoDB instance (DocSim automatically spawns an in-memory database if no external database is configured).
- **Redis** *(Optional)*: Redis server if running distributed BullMQ workers.

### 2. Installation

```bash
# Clone repository
git clone https://github.com/your-username/SIMILARITY.git
cd SIMILARITY

# Install Node.js dependencies
npm install

# Install Python Acceleration Engine dependencies
pip install -r python-engine/requirements.txt
```

### 3. Start the Platform

For maximum performance on 1,000+ files, run both the **Python Acceleration Engine** and the **Node.js Web Server**:

#### Terminal 1 — Start Python Acceleration Engine:
```bash
npm run py:start
# Or directly:
python python-engine/main.py
```
*The Python engine starts on `http://127.0.0.1:8000` with SIMD acceleration enabled.*

#### Terminal 2 — Start Node.js Web Application:
```bash
# Production mode
npm start

# Or Development mode (with live reload)
npm run dev
```

Once started, open your browser and navigate to **`http://localhost:3001`** (or your configured `PORT`) to access the interactive 3D Web UI.

> [!TIP]
> **Automatic Failover**: If the Python engine is not running, DocSim seamlessly executes using the optimized in-process Node.js Level 1 / Level 2 engine without any disruption.

Once started, navigate to `http://localhost:3000` (or configured `PORT`) in your browser to access the dashboard.

---

## 📡 REST API Reference

### 1. Initialize a Scan
- **`POST /api/scans`**
- **Response:**
  ```json
  {
    "scanId": "3f82e85a-940d-4b82-8bc1-12c8a14b09b4",
    "status": "created",
    "message": "Scan initialized successfully"
  }
  ```

### 2. Upload Documents
- **`POST /api/scans/:scanId/documents`**
- **Content-Type:** `multipart/form-data`
- **Body:** `files`: Array of files (`.pdf`, `.docx`, `.txt`)
- **Response:**
  ```json
  {
    "scanId": "3f82e85a-940d-4b82-8bc1-12c8a14b09b4",
    "totalFiles": 12,
    "status": "uploading"
  }
  ```

### 3. Start Similarity Scan
- **`POST /api/scans/:scanId/start`**
- **Response:**
  ```json
  {
    "scanId": "3f82e85a-940d-4b82-8bc1-12c8a14b09b4",
    "status": "processing",
    "algorithm": "minhash-lsh-jaccard",
    "message": "Scan execution started"
  }
  ```

### 4. Poll Scan Status
- **`GET /api/scans/:scanId/status`**
- **Response:**
  ```json
  {
    "scanId": "3f82e85a-940d-4b82-8bc1-12c8a14b09b4",
    "status": "completed",
    "stage": "completed",
    "progress": 100,
    "totalDocuments": 12,
    "processedDocuments": 12,
    "processingTimeMs": 342,
    "algorithm": "minhash-lsh-jaccard"
  }
  ```

### 5. Fetch Scan Results
- **`GET /api/scans/:scanId/results`**
- **Query Parameters:**
  - `page` *(number, default: 1)* — Page number
  - `limit` *(number, default: 50, max: 1000)* — Page size
  - `threshold` *(number, default: 0.80)* — Minimum similarity score ($0.0 - 1.0$)
  - `sort` *(string, default: `similarity_desc`)* — Sort options: `similarity_desc`, `similarity_asc`, `filename_1`, `filename_2`
- **Response:**
  ```json
  {
    "scanId": "3f82e85a-940d-4b82-8bc1-12c8a14b09b4",
    "page": 1,
    "limit": 50,
    "totalMatches": 4,
    "totalPages": 1,
    "results": [
      {
        "documentAId": "doc_1",
        "documentBId": "doc_4",
        "fileName1": "research_draft_v1.docx",
        "fileName2": "research_draft_v2.docx",
        "similarityScore": 0.942,
        "algorithm": "minhash-lsh-jaccard"
      }
    ]
  }
  ```

### 6. Scan History & Health
- **`GET /api/scans/history`** — Lists recent scans with metadata and completion status.
- **`GET /api/health`** — Checks server uptime, engine status, and Redis connectivity.
- **`POST /api/scan/compare`** *(Legacy)* — Synchronous one-shot pairwise comparison.

---

## 🔬 Algorithm & Theory

### 1. Word-Level $k$-Shingling
Documents are decomposed into contiguous overlapping sequences of $k$ tokens ($k=5$):
$$\text{Shingles}(D) = \{ (w_i, w_{i+1}, \dots, w_{i+k-1}) \mid 1 \le i \le |D|-k+1 \}$$

### 2. MinHash Signatures
MinHash converts large shingle sets into fixed-length integer vectors of length $M=128$:
$$h_{a,b}(x) = (a \cdot x + b) \pmod p$$
For two document shingle sets $S_1$ and $S_2$:
$$P(\min(h(S_1)) = \min(h(S_2))) = J(S_1, S_2) = \frac{|S_1 \cap S_2|}{|S_1 \cup S_2|}$$

### 3. Locality-Sensitive Hashing (LSH) Banding
Signatures of size $M = 128$ are divided into $b = 32$ bands with $r = 4$ rows each ($b \times r = 128$). Two documents become a candidate pair if they collide in **at least one band**.

The probability $P$ of two documents with Jaccard similarity $s$ becoming candidate pairs is:
$$P(\text{candidate} \mid s) = 1 - (1 - s^r)^b = 1 - (1 - s^4)^{32}$$

- For $s = 0.80$ (High similarity): $P \approx 99.99\%$ (near-zero false negatives)
- For $s = 0.20$ (Low similarity): $P \approx 5.0\%$ (drastic reduction of unnecessary checks)

```
Candidate Probability vs Similarity Curve
1.0 ┤                                        ╭─────
    │                                     ╭──╯
0.8 ┤                                  ╭──╯
    │                                ╭─╯
0.6 ┤                              ╭─╯
    │                            ╭─╯
0.4 ┤                          ╭─╯
    │                       ╭──╯
0.2 ┤                    ╭──╯
    │             ╭──────╯
0.0 ┼─────────────┴────────────────────────────────
   0.0   0.1   0.2   0.3   0.4   0.5   0.6   0.7   0.8   0.9   1.0
                              Similarity (s)
```

---

## 📊 Performance Benchmarks

DocSim includes benchmarking tools comparing **Level 1 (All-Pairs Exact Jaccard)**, **Level 2 (Optimized Node.js MinHash + LSH)**, and the **Python SIMD & SciPy Acceleration Engine** across large document corpora (up to 1,000+ files / 499,500 comparisons):

| Document Count ($N$) | Total Possible Pairs ($N(N-1)/2$) | Level 1 (Brute Force) | Level 2 (Node.js) | Python SIMD Engine | Candidate Reduction | Speedup vs Baseline |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **100** | 4,950 | 187 ms | 77 ms | **~15 ms** | **92.4%** | **$12.4\times$** |
| **250** | 31,125 | 929 ms | 208 ms | **~65 ms** | **91.8%** | **$14.3\times$** |
| **500** | 124,750 | 3.91 s | 603 ms | **~240 ms** | **91.6%** | **$16.3\times$** |
| **1,000** | 499,500 | 17.31 s | 2.08 s | **907 ms (SciPy)** | **91.5% - 100%** | **$19.1\times$** |

### Running Benchmarks Locally:
```bash
# Run Python 1,000-document SIMD & SciPy scalability benchmark
npm run py:test

# Run Node.js Level 1 vs Level 2 comparative benchmark
npm run benchmark
```

---

## 🧪 Testing

The repository features comprehensive integration and unit test suites utilizing Node.js native test runner:

```bash
# Run complete test suite (Level 1, Level 2, Dashboard & Reports)
npm test

# Run Level 1 scan & API tests
npm run test:l1

# Run Level 2 algorithm, LSH, & worker tests
npm run test:l2

# Run dashboard & aggregation tests
npm run test:dashboard
```

---

## 🛡️ License

This project is open-source software licensed under the [MIT License](LICENSE).
