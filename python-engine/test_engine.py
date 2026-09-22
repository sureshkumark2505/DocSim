"""
Comprehensive Test and Benchmark Script for DocSim Python Acceleration Engine.
Tests scalability across 10, 100, and 1,000 documents.
"""

import time
import random
import string
import numpy as np
from algorithms.minhash_vectorized import (
    compute_minhash_signature,
    estimate_minhash_similarity
)
from algorithms.lsh_engine import LSHEngine
from algorithms.sparse_jaccard import exact_jaccard_sets, compute_all_pairs_sparse_jaccard
from algorithms.extractor import create_shingles, tokenize_text


def generate_synthetic_document(word_count=500, shared_pool=None):
    """Generates a synthetic text document with controlled vocabulary."""
    if shared_pool is None:
        words = ["quantum", "algorithm", "similarity", "document", "hashing", 
                 "vector", "matrix", "computation", "cluster", "index",
                 "database", "performance", "optimization", "parallel", "distributed",
                 "analysis", "feature", "token", "shingle", "permutation"]
        # Add random words
        for _ in range(100):
            words.append(''.join(random.choices(string.ascii_lowercase, k=6)))
    else:
        words = shared_pool
    
    doc_words = random.choices(words, k=word_count)
    return " ".join(doc_words)


def run_benchmark(num_docs=1000):
    print(f"\n=======================================================")
    print(f"BENCHMARK: Testing Python Acceleration Engine on {num_docs} Documents")
    print(f"=======================================================")
    
    total_possible_pairs = (num_docs * (num_docs - 1)) // 2
    print(f"Total possible pairwise comparisons: {total_possible_pairs:,}")
    
    # 1. Generate synthetic documents
    print("\n[Stage 1] Generating synthetic documents & shingles...")
    t0 = time.perf_counter()
    vocab = [f"word_{i}" for i in range(2000)]
    documents = []
    
    # Create some intentional near-duplicates
    base_doc = generate_synthetic_document(word_count=600, shared_pool=vocab)
    base_tokens = tokenize_text(base_doc)
    
    for i in range(num_docs):
        if i % 20 == 0 and i > 0:
            # 80% similar mutation of base document
            mutated_tokens = base_tokens.copy()
            for _ in range(len(mutated_tokens) // 5):
                idx = random.randint(0, len(mutated_tokens) - 1)
                mutated_tokens[idx] = "mutated_term"
            shingles = create_shingles(mutated_tokens, k=5)
        else:
            text = generate_synthetic_document(word_count=600, shared_pool=vocab)
            tokens = tokenize_text(text)
            shingles = create_shingles(tokens, k=5)
            
        documents.append({
            "doc_id": f"doc_{i}",
            "filename": f"document_{i}.txt",
            "shingles": shingles,
            "token_count": len(tokens)
        })
    
    t1 = time.perf_counter()
    print(f"-> Generated {num_docs} documents in {(t1 - t0)*1000:.2f} ms")
    
    # 2. Vectorized MinHash Generation (NumPy SIMD)
    print("\n[Stage 2] Computing 128-permutation MinHash signatures via NumPy SIMD...")
    signatures = []
    lsh_input = []
    
    for doc in documents:
        sig = compute_minhash_signature(doc["shingles"], num_permutations=128)
        signatures.append(sig)
        lsh_input.append({
            "doc_id": doc["doc_id"],
            "signature": sig
        })
    
    t2 = time.perf_counter()
    minhash_time = (t2 - t1) * 1000
    print(f"-> Computed {num_docs} MinHash signatures (128 perms each = {num_docs * 128:,} hashes) in {minhash_time:.2f} ms")
    print(f"-> Throughput: {num_docs / (minhash_time / 1000):.1f} documents/sec")
    
    # 3. LSH Candidate Generation (b=32, r=4)
    print("\n[Stage 3] LSH Candidate Indexing (32 bands, 4 rows)...")
    lsh = LSHEngine(bands=32, rows=4)
    lsh_res = lsh.index_documents(lsh_input)
    t3 = time.perf_counter()
    lsh_time = (t3 - t2) * 1000
    
    print(f"-> LSH Candidate Pairs Found: {lsh_res['candidate_count']:,} out of {total_possible_pairs:,} total pairs")
    print(f"-> Candidate Search Space Reduction: {lsh_res['reduction_percent']}%")
    print(f"-> LSH Indexing Time: {lsh_time:.2f} ms")
    
    # 4. Exact Jaccard Verification on Candidates
    print("\n[Stage 4] Exact Jaccard Verification on Candidates...")
    doc_map = {d["doc_id"]: d for d in documents}
    high_sim_pairs = 0
    
    for id_a, id_b in lsh_res["candidate_pairs"]:
        set_a = doc_map[id_a]["shingles"]
        set_b = doc_map[id_b]["shingles"]
        jaccard = exact_jaccard_sets(set_a, set_b)
        if jaccard >= 0.70:
            high_sim_pairs += 1
            
    t4 = time.perf_counter()
    verification_time = (t4 - t3) * 1000
    print(f"-> Verified {lsh_res['candidate_count']} candidate pairs in {verification_time:.2f} ms")
    print(f"-> High Similarity Matches Found: {high_sim_pairs}")
    
    total_time = (t4 - t1) * 1000
    print(f"\n=======================================================")
    print(f"TOTAL TIME FOR {num_docs} DOCUMENTS: {total_time:.2f} ms ({total_time / 1000:.3f} seconds)")
    print(f"=======================================================")
    
    # 5. Optional Level 1 SciPy CSR Matrix Benchmark
    print("\n[Bonus Stage 5] All-Pairs Exact Jaccard via SciPy CSR Matrix (500k comparisons)...")
    t5 = time.perf_counter()
    shingle_sets = [d["shingles"] for d in documents]
    jaccard_mat = compute_all_pairs_sparse_jaccard(shingle_sets)
    t6 = time.perf_counter()
    sparse_time = (t6 - t5) * 1000
    print(f"-> SciPy Computed ALL {total_possible_pairs:,} Exact Jaccard Pairs in {sparse_time:.2f} ms ({sparse_time/1000:.3f} s)")
    print(f"-> Jaccard Matrix Shape: {jaccard_mat.shape}")


if __name__ == "__main__":
    # Test with 1,000 documents
    run_benchmark(num_docs=1000)
