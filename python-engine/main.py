"""
DocSim Python Acceleration Engine - FastAPI Server
High-throughput document similarity engine designed for 1,000+ files.
"""

import time
import os
import psutil
from typing import List, Dict, Any, Optional
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from algorithms.minhash_vectorized import (
    compute_minhash_signature,
    estimate_minhash_similarity,
    DEFAULT_NUM_PERMUTATIONS
)
from algorithms.lsh_engine import LSHEngine
from algorithms.sparse_jaccard import exact_jaccard_sets, compute_all_pairs_sparse_jaccard
from algorithms.extractor import (
    parallel_extract_documents,
    process_single_file,
    DEFAULT_SHINGLE_SIZE
)

app = FastAPI(
    title="DocSim Python Acceleration Engine",
    version="2.0.0",
    description="Vectorized SIMD MinHash, LSH, and Sparse Jaccard acceleration for 1000+ documents."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DocumentItem(BaseModel):
    documentId: str
    filePath: Optional[str] = None
    filename: Optional[str] = None
    text: Optional[str] = None


class ScanProcessRequest(BaseModel):
    scan_id: str
    documents: List[DocumentItem]
    algorithm: Optional[str] = "minhash-lsh-jaccard"
    shingle_size: Optional[int] = DEFAULT_SHINGLE_SIZE
    num_permutations: Optional[int] = DEFAULT_NUM_PERMUTATIONS
    lsh_bands: Optional[int] = 32
    lsh_rows: Optional[int] = 4
    high_similarity_threshold: Optional[float] = 0.80
    include_all_pairwise: Optional[bool] = True


class FingerprintRequest(BaseModel):
    text: Optional[str] = None
    tokens: Optional[List[str]] = None
    shingles: Optional[List[str]] = None
    num_permutations: Optional[int] = DEFAULT_NUM_PERMUTATIONS


@app.get("/health")
def health_check():
    """Returns engine health, hardware specs, and CPU core availability."""
    return {
        "status": "online",
        "engine": "DocSim Python SIMD Acceleration Engine v2.0",
        "cpu_count": os.cpu_count(),
        "memory_total_gb": round(psutil.virtual_memory().total / (1024 ** 3), 2),
        "memory_available_gb": round(psutil.virtual_memory().available / (1024 ** 3), 2),
        "numpy_simd_enabled": True
    }


@app.post("/api/v1/fingerprint")
def fingerprint_document(req: FingerprintRequest):
    """Computes MinHash signature for a single document or token stream."""
    if req.text:
        processed = process_single_file({"text": req.text, "doc_id": "temp"})
        shingles = processed["shingles"]
    elif req.tokens:
        from algorithms.extractor import create_shingles
        shingles = create_shingles(req.tokens)
    elif req.shingles:
        shingles = set(req.shingles)
    else:
        raise HTTPException(status_code=400, detail="Must provide text, tokens, or shingles.")

    sig = compute_minhash_signature(shingles, num_permutations=req.num_permutations)
    return {
        "shingle_count": len(shingles),
        "signature": [int(x) for x in sig]
    }


@app.post("/api/v1/scan/process")
def process_scan(req: ScanProcessRequest):
    """
    Main High-Performance Scan Endpoint.
    Scales effortlessly to 1,000+ documents by leveraging:
    1. Multi-threaded parallel file extraction
    2. NumPy SIMD vectorized MinHash computation
    3. LSH sub-quadratic candidate indexing
    4. Exact Jaccard verification on candidate pairs
    """
    t_start = time.perf_counter()
    N = len(req.documents)

    if N < 2:
        raise HTTPException(status_code=400, detail="Scan requires at least 2 documents.")

    total_possible_pairs = (N * (N - 1)) // 2

    # 1. Parallel Document Extraction & Shingling
    raw_doc_items = [doc.model_dump() for doc in req.documents]
    extracted_docs = parallel_extract_documents(raw_doc_items, k=req.shingle_size)
    t_extracted = time.perf_counter()

    # Index extracted docs by doc_id
    doc_map = {d["doc_id"]: d for d in extracted_docs}
    # Preserve input ordering
    ordered_docs = [doc_map[d.documentId] for d in req.documents if d.documentId in doc_map]

    # 2. Level 1 Engine: All-Pairs Exact Jaccard using SciPy Sparse CSR Matrix
    if req.algorithm == "jaccard":
        shingle_sets = [d["shingles"] for d in ordered_docs]
        jaccard_matrix = compute_all_pairs_sparse_jaccard(shingle_sets)

        pairwise_results = []
        high_sim_count = 0
        exact_dup_count = 0

        for i in range(N):
            doc_a = ordered_docs[i]
            for j in range(i + 1, N):
                doc_b = ordered_docs[j]
                score = float(round(jaccard_matrix[i, j], 4))
                
                if score >= 0.999:
                    exact_dup_count += 1
                if score >= req.high_similarity_threshold:
                    high_sim_count += 1

                pairwise_results.append({
                    "scanId": req.scan_id,
                    "documentAId": doc_a["doc_id"],
                    "documentBId": doc_b["doc_id"],
                    "fileName1": doc_a["filename"],
                    "fileName2": doc_b["filename"],
                    "similarityScore": score,
                    "algorithm": "jaccard"
                })

        t_end = time.perf_counter()
        return {
            "scan_id": req.scan_id,
            "status": "completed",
            "algorithm": "jaccard",
            "document_count": N,
            "total_possible_pairs": total_possible_pairs,
            "candidate_pairs": total_possible_pairs,
            "candidate_reduction_percent": 0.0,
            "exact_comparisons": total_possible_pairs,
            "exact_duplicates": exact_dup_count,
            "high_similarity_pairs": high_sim_count,
            "extraction_time_ms": round((t_extracted - t_start) * 1000, 2),
            "processing_time_ms": round((t_end - t_start) * 1000, 2),
            "results": pairwise_results
        }

    # 3. Level 2 Engine: MinHash + LSH + Jaccard Verification
    # Vectorized MinHash generation
    signatures_list = []
    lsh_input_docs = []

    for d in ordered_docs:
        sig = compute_minhash_signature(d["shingles"], num_permutations=req.num_permutations)
        signatures_list.append(sig)
        d["minhashSignature"] = [int(x) for x in sig]
        lsh_input_docs.append({
            "doc_id": d["doc_id"],
            "signature": sig
        })

    t_fingerprint = time.perf_counter()

    # LSH Candidate Generation
    lsh = LSHEngine(bands=req.lsh_bands, rows=req.lsh_rows)
    lsh_result = lsh.index_documents(lsh_input_docs)
    candidate_pairs_set = set(lsh_result["candidate_pairs"])

    t_lsh = time.perf_counter()

    # Exact Jaccard verification for candidates
    pairwise_results = []
    high_sim_count = 0
    exact_dup_count = 0
    exact_comparisons = 0

    # Build doc index lookup for fast pair retrieval
    doc_lookup = {d["doc_id"]: idx for idx, d in enumerate(ordered_docs)}

    # Process Candidate Pairs with Exact Jaccard
    candidate_scores = {}
    for (id_a, id_b) in candidate_pairs_set:
        idx_a = doc_lookup[id_a]
        idx_b = doc_lookup[id_b]
        set_a = ordered_docs[idx_a]["shingles"]
        set_b = ordered_docs[idx_b]["shingles"]
        
        jaccard = exact_jaccard_sets(set_a, set_b)
        exact_comparisons += 1
        score = float(round(jaccard, 4))
        candidate_scores[(id_a, id_b)] = score

    # Generate pairwise results
    if req.include_all_pairwise:
        for i in range(N):
            doc_a = ordered_docs[i]
            id_a = doc_a["doc_id"]
            sig_a = signatures_list[i]

            for j in range(i + 1, N):
                doc_b = ordered_docs[j]
                id_b = doc_b["doc_id"]
                pair_key = (min(id_a, id_b), max(id_a, id_b))

                if pair_key in candidate_scores:
                    similarity_score = candidate_scores[pair_key]
                else:
                    # Fast estimated similarity from MinHash signatures
                    sig_b = signatures_list[j]
                    similarity_score = float(round(estimate_minhash_similarity(sig_a, sig_b), 4))

                if similarity_score >= 0.999:
                    exact_dup_count += 1
                if similarity_score >= req.high_similarity_threshold:
                    high_sim_count += 1

                pairwise_results.append({
                    "scanId": req.scan_id,
                    "documentAId": doc_a["doc_id"],
                    "documentBId": doc_b["doc_id"],
                    "fileName1": doc_a["filename"],
                    "fileName2": doc_b["filename"],
                    "similarityScore": similarity_score,
                    "isCandidate": pair_key in candidate_scores,
                    "algorithm": "minhash-lsh-jaccard"
                })
    else:
        # Only return candidate pairs (for ultra-high scale 5000+ documents)
        for (id_a, id_b), score in candidate_scores.items():
            idx_a = doc_lookup[id_a]
            idx_b = doc_lookup[id_b]
            doc_a = ordered_docs[idx_a]
            doc_b = ordered_docs[idx_b]

            if score >= 0.999:
                exact_dup_count += 1
            if score >= req.high_similarity_threshold:
                high_sim_count += 1

            pairwise_results.append({
                "scanId": req.scan_id,
                "documentAId": doc_a["doc_id"],
                "documentBId": doc_b["doc_id"],
                "fileName1": doc_a["filename"],
                "fileName2": doc_b["filename"],
                "similarityScore": score,
                "isCandidate": True,
                "algorithm": "minhash-lsh-jaccard"
            })

    t_end = time.perf_counter()

    return {
        "scan_id": req.scan_id,
        "status": "completed",
        "algorithm": "minhash-lsh-jaccard",
        "document_count": N,
        "total_possible_pairs": total_possible_pairs,
        "candidate_pairs": lsh_result["candidate_count"],
        "candidate_reduction_percent": lsh_result["reduction_percent"],
        "exact_comparisons": exact_comparisons,
        "exact_duplicates": exact_dup_count,
        "high_similarity_pairs": high_sim_count,
        "extraction_time_ms": round((t_extracted - t_start) * 1000, 2),
        "fingerprinting_time_ms": round((t_fingerprint - t_extracted) * 1000, 2),
        "lsh_indexing_time_ms": round((t_lsh - t_fingerprint) * 1000, 2),
        "comparison_time_ms": round((t_end - t_lsh) * 1000, 2),
        "processing_time_ms": round((t_end - t_start) * 1000, 2),
        "results": pairwise_results,
        "document_signatures": {
            d["doc_id"]: {
                "tokenCount": d["token_count"],
                "shingleCount": d["shingle_count"],
                "minhashSignature": d["minhashSignature"]
            } for d in ordered_docs
        }
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PYTHON_ENGINE_PORT", 8000))
    host = os.environ.get("PYTHON_ENGINE_HOST", "127.0.0.1")
    print(f"Starting DocSim Python Acceleration Engine on {host}:{port}...")
    uvicorn.run("main:app", host=host, port=port, reload=False, log_level="info")
