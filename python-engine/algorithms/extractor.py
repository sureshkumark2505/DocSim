"""
Parallel document text extractor, normalizer, and k-shingling pipeline.
Utilizes multi-core processing to extract and parse 1,000+ files in seconds.
"""

import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Set, Dict, Any, Optional
import pypdf
import docx


TOKEN_REGEX = re.compile(r"[a-z0-9]+")
DEFAULT_SHINGLE_SIZE = 5


def extract_raw_text(file_path: str) -> str:
    """Extracts raw text content from TXT, PDF, or DOCX files."""
    if not os.path.isfile(file_path):
        return ""

    ext = os.path.splitext(file_path)[1].lower()

    try:
        if ext == ".txt":
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()

        elif ext == ".pdf":
            reader = pypdf.PdfReader(file_path)
            pages = []
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    pages.append(text)
            return "\n".join(pages)

        elif ext in (".docx", ".doc"):
            doc = docx.Document(file_path)
            paragraphs = [p.text for p in doc.paragraphs if p.text]
            return "\n".join(paragraphs)

        else:
            # Fallback text read
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()

    except Exception as e:
        print(f"Error extracting {file_path}: {e}")
        return ""


def tokenize_text(text: str) -> List[str]:
    """Converts text to lowercase alphanumeric normalized tokens."""
    if not text:
        return []
    return TOKEN_REGEX.findall(text.lower())


def create_shingles(tokens: List[str], k: int = DEFAULT_SHINGLE_SIZE) -> Set[str]:
    """Generates unique k-shingles from token list."""
    if not tokens or k <= 0:
        return set()
    if len(tokens) < k:
        return {" ".join(tokens)}
    
    limit = len(tokens) - k + 1
    return {" ".join(tokens[i:i + k]) for i in range(limit)}


def process_single_file(file_info: Dict[str, Any], k: int = DEFAULT_SHINGLE_SIZE) -> Dict[str, Any]:
    """
    Worker task: extracts text, generates tokens, and produces shingle set for a single document.
    """
    doc_id = file_info.get("documentId") or file_info.get("doc_id") or file_info.get("id")
    file_path = file_info.get("filePath") or file_info.get("path")
    filename = file_info.get("filename") or file_info.get("originalname") or os.path.basename(file_path or "")
    
    # If text is already passed directly in the payload:
    raw_text = file_info.get("text")
    if raw_text is None and file_path:
        raw_text = extract_raw_text(file_path)
    elif raw_text is None:
        raw_text = ""

    tokens = tokenize_text(raw_text)
    shingles = create_shingles(tokens, k=k)

    return {
        "doc_id": str(doc_id),
        "filename": filename,
        "token_count": len(tokens),
        "shingle_count": len(shingles),
        "shingles": shingles,
        "raw_text_len": len(raw_text)
    }


def parallel_extract_documents(
    documents: List[Dict[str, Any]],
    k: int = DEFAULT_SHINGLE_SIZE,
    max_workers: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Extracts and tokenizes 1,000+ documents in parallel across thread pool workers.
    """
    if not documents:
        return []

    workers = max_workers or min(32, (os.cpu_count() or 4) * 4)
    results = []

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_doc = {
            executor.submit(process_single_file, doc, k): doc for doc in documents
        }
        for future in as_completed(future_to_doc):
            try:
                res = future.result()
                results.append(res)
            except Exception as exc:
                print(f"Document extraction generated an exception: {exc}")

    return results
