import os
import sys
import json
import hashlib

def extract_pdf(pdf_path, output_dir):
    try:
        import pypdf
        from PIL import Image
    except ImportError as e:
        return {"error": f"Required Python packages not available: {e}"}

    if not os.path.exists(pdf_path):
        return {"error": f"PDF file not found: {pdf_path}"}

    os.makedirs(output_dir, exist_ok=True)

    try:
        reader = pypdf.PdfReader(pdf_path)
    except Exception as e:
        return {"error": f"Corrupt or invalid PDF file: {e}"}

    pages = []
    images = []
    total_pages = len(reader.pages)
    total_text_len = 0

    for page_num, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        total_text_len += len(text.strip())
        pages.append({"pageNumber": page_num, "text": text})

        # Extract embedded images
        try:
            page_imgs = page.images
            for img_idx, img in enumerate(page_imgs, start=1):
                try:
                    ext = os.path.splitext(img.name)[1].lower()
                    if ext not in [".png", ".jpg", ".jpeg", ".webp"]:
                        ext = ".png"
                    img_id = f"p{page_num}_img{img_idx}"
                    img_name = f"{img_id}{ext}"
                    img_path = os.path.join(output_dir, img_name)

                    with open(img_path, "wb") as f:
                        f.write(img.data)

                    sha = hashlib.sha256(img.data).hexdigest()

                    # Fingerprint via PIL
                    w, h = 0, 0
                    dhash_hex = "0" * 16
                    try:
                        with Image.open(img_path) as im:
                            w, h = im.size
                            gray = im.convert("L").resize((9, 8), Image.Resampling.BILINEAR)
                            px = list(gray.getdata())
                            diff = [1 if px[r * 9 + c] > px[r * 9 + c + 1] else 0 for r in range(8) for c in range(8)]
                            dhash_hex = hex(int(''.join(str(b) for b in diff), 2))[2:].zfill(16)
                    except Exception:
                        pass

                    images.append({
                        "imageId": img_id,
                        "pageNumber": page_num,
                        "filename": img_name,
                        "path": img_path,
                        "width": w,
                        "height": h,
                        "sha256": sha,
                        "dhash": dhash_hex
                    })
                except Exception:
                    pass
        except Exception:
            pass

    avg_text_per_page = (total_text_len / total_pages) if total_pages > 0 else 0
    is_scanned = total_pages > 0 and avg_text_per_page < 30 and len(images) > 0

    return {
        "success": True,
        "totalPages": total_pages,
        "pages": pages,
        "images": images,
        "isScanned": is_scanned,
        "fullText": "\n\n".join(p["text"] for p in pages if p["text"])
    }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python pdf_extractor.py <pdf_path> <output_dir>"}))
        sys.exit(1)

    pdf_file = sys.argv[1]
    out_dir = sys.argv[2]
    result = extract_pdf(pdf_file, out_dir)
    print(json.dumps(result))
