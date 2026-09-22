"""
High-Performance Locality-Sensitive Hashing (LSH) Engine.
Sub-quadratic candidate pair indexing for massive document corpora (1,000+ to 100,000+ files).
"""

import math
from collections import defaultdict
from typing import List, Dict, Set, Tuple, Any
import numpy as np


class LSHEngine:
    def __init__(self, bands: int = 32, rows: int = 4):
        """
        Initializes the LSH index with b bands and r rows.
        Default b=32, r=4 (for 128 permutations, target s-curve threshold ~0.50).
        """
        self.bands = bands
        self.rows = rows
        self.expected_dim = bands * rows
        self.buckets = defaultdict(list)
        self.doc_signatures = {}

    def get_band_hashes(self, signature: np.ndarray) -> List[int]:
        """Calculates bucket hash keys for each of the b bands."""
        if len(signature) < self.expected_dim:
            raise ValueError(f"Signature length ({len(signature)}) must be at least {self.expected_dim}")
        
        band_hashes = []
        for band_idx in range(self.bands):
            start = band_idx * self.rows
            band_slice = signature[start:start + self.rows]
            # Use Python's fast tuple hashing
            band_hash = hash((band_idx, tuple(band_slice)))
            band_hashes.append(band_hash)
        return band_hashes

    def index_documents(self, documents: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Indexes an array of documents with their MinHash signatures and generates candidate pairs.
        
        @param documents: List of dicts with 'doc_id' and 'signature' (np.ndarray or list)
        @return: Candidate pair statistics and list of candidate pairs
        """
        self.buckets.clear()
        self.doc_signatures.clear()
        
        N = len(documents)
        if N < 2:
            return {
                "candidate_pairs": [],
                "candidate_count": 0,
                "total_possible_pairs": 0,
                "reduction_percent": 100.0
            }

        total_possible_pairs = (N * (N - 1)) // 2

        # 1. Bucket insertion
        for doc in documents:
            doc_id = doc["doc_id"]
            sig = np.asarray(doc["signature"], dtype=np.uint64)
            self.doc_signatures[doc_id] = sig
            
            band_keys = self.get_band_hashes(sig)
            for band_key in band_keys:
                self.buckets[band_key].append(doc_id)

        # 2. Extract unique candidate pairs from colliding buckets
        candidate_pair_set = set()
        
        for bucket_members in self.buckets.values():
            if len(bucket_members) > 1:
                member_count = len(bucket_members)
                for i in range(member_count):
                    for j in range(i + 1, member_count):
                        id_a = bucket_members[i]
                        id_b = bucket_members[j]
                        if id_a != id_b:
                            pair = (min(id_a, id_b), max(id_a, id_b))
                            candidate_pair_set.add(pair)

        candidate_count = len(candidate_pair_set)
        reduction_percent = 0.0
        if total_possible_pairs > 0:
            reduction_percent = round((1.0 - (candidate_count / total_possible_pairs)) * 100.0, 2)

        return {
            "candidate_pairs": list(candidate_pair_set),
            "candidate_count": candidate_count,
            "total_possible_pairs": total_possible_pairs,
            "reduction_percent": reduction_percent
        }

    @staticmethod
    def candidate_probability(similarity: float, bands: int = 32, rows: int = 4) -> float:
        """Computes the theoretical probability that a pair with similarity s becomes an LSH candidate."""
        if similarity <= 0.0:
            return 0.0
        if similarity >= 1.0:
            return 1.0
        return 1.0 - (1.0 - math.pow(similarity, rows)) ** bands
