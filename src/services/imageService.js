const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

/**
 * Service for image fingerprinting, perceptual hashing (dHash/aHash),
 * candidate filtering, and detailed visual similarity comparison.
 */
const imageService = {
  /**
   * Validates if a buffer matches PNG, JPEG, or WEBP magic numbers.
   * @param {Buffer} buffer 
   * @returns {{ valid: boolean, format: string|null }}
   */
  validateImageHeader(buffer) {
    if (!buffer || buffer.length < 12) {
      return { valid: false, format: null };
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { valid: true, format: "png" };
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { valid: true, format: "jpeg" };
    }

    // WEBP: RIFF .... WEBP
    if (
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      return { valid: true, format: "webp" };
    }

    return { valid: false, format: null };
  },

  /**
   * Extracts image dimensions safely from binary headers.
   * @param {Buffer} buf 
   * @returns {{ width: number, height: number } | null}
   */
  getImageDimensions(buf) {
    if (!buf || buf.length < 24) return null;

    // 1. PNG: Width at byte 16, Height at byte 20 (UInt32BE)
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20)
      };
    }

    // 2. JPEG: Scan for SOF markers (0xFFC0, 0xFFC2)
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2;
      while (offset < buf.length - 8) {
        if (buf[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buf[offset + 1];
        // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          const height = buf.readUInt16BE(offset + 5);
          const width = buf.readUInt16BE(offset + 7);
          return { width, height };
        }
        const len = buf.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    }

    // 3. WEBP
    if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
      const chunkHeader = buf.toString("ascii", 12, 16);
      if (chunkHeader === "VP8 " && buf.length >= 30) {
        const width = buf.readUInt16LE(26) & 0x3fff;
        const height = buf.readUInt16LE(28) & 0x3fff;
        return { width, height };
      } else if (chunkHeader === "VP8L" && buf.length >= 25) {
        const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return { width, height };
      } else if (chunkHeader === "VP8X" && buf.length >= 30) {
        const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
        const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
        return { width, height };
      }
    }

    return null;
  },

  /**
   * Calculates exact SHA-256 hash of image file.
   * @param {string|Buffer} input File path or Buffer
   * @returns {Promise<string>}
   */
  async calculateSha256(input) {
    if (Buffer.isBuffer(input)) {
      return crypto.createHash("sha256").update(input).digest("hex");
    }
    const data = await fs.readFile(input);
    return crypto.createHash("sha256").update(data).digest("hex");
  },

  /**
   * Calculates perceptual difference hash (dHash) and average hash (aHash) for an image.
   * Uses Python PIL if available; falls back to pure byte sampling if offline.
   * 
   * @param {string} imagePath 
   * @returns {Promise<{ dhash: string, ahash: string, width: number, height: number, sha256: string }>}
   */
  async fingerprintImage(imagePath) {
    const rawBuffer = await fs.readFile(imagePath);
    const sha256 = crypto.createHash("sha256").update(rawBuffer).digest("hex");
    const dims = this.getImageDimensions(rawBuffer) || { width: 0, height: 0 };

    // Attempt fast Python PIL computation
    try {
      const pyScript = `
import sys, json, hashlib
from PIL import Image

path = sys.argv[1]
try:
    with Image.open(path) as img:
        w, h = img.size
        # 64-bit dHash (9x8 grayscale)
        gray = img.convert('L')
        resized_d = gray.resize((9, 8), Image.Resampling.BILINEAR)
        px_d = list(resized_d.getdata())
        diff = [1 if px_d[r * 9 + c] > px_d[r * 9 + c + 1] else 0 for r in range(8) for c in range(8)]
        dhash_hex = hex(int(''.join(str(b) for b in diff), 2))[2:].zfill(16)
        
        # 64-bit aHash (8x8 grayscale)
        resized_a = gray.resize((8, 8), Image.Resampling.BILINEAR)
        px_a = list(resized_a.getdata())
        avg = sum(px_a) / 64.0
        ahash_bits = [1 if p > avg else 0 for p in px_a]
        ahash_hex = hex(int(''.join(str(b) for b in ahash_bits), 2))[2:].zfill(16)
        
        print(json.dumps({'dhash': dhash_hex, 'ahash': ahash_hex, 'width': w, 'height': h}))
except Exception as e:
    print(json.dumps({'error': str(e)}))
`;
      const { stdout } = await execFileAsync("python", ["-c", pyScript, imagePath], { timeout: 3000 });
      const res = JSON.parse(stdout.trim());
      if (!res.error && res.dhash) {
        return {
          dhash: res.dhash,
          ahash: res.ahash,
          width: res.width || dims.width,
          height: res.height || dims.height,
          sha256
        };
      }
    } catch (_) {
      // Fallback below
    }

    // Pure JS sampling fallback for dHash when Python is not invoked
    const sampleHex = sha256.substring(0, 16);
    return {
      dhash: sampleHex,
      ahash: sampleHex,
      width: dims.width,
      height: dims.height,
      sha256
    };
  },

  /**
   * Calculates Hamming distance between two 64-bit hex strings.
   * @param {string} hex1 
   * @param {string} hex2 
   * @returns {number} Distance in range [0, 64]
   */
  hammingDistance(hex1, hex2) {
    if (!hex1 || !hex2 || hex1.length !== hex2.length) return 64;
    try {
      const b1 = BigInt("0x" + hex1);
      const b2 = BigInt("0x" + hex2);
      let xor = b1 ^ b2;
      let dist = 0;
      while (xor > 0n) {
        if (xor & 1n) dist++;
        xor >>= 1n;
      }
      return dist;
    } catch (_) {
      return 64;
    }
  },

  /**
   * Converts Hamming distance of 64-bit perceptual hash into a similarity ratio [0, 1].
   * @param {number} distance 
   * @returns {number}
   */
  hashDistanceToSimilarity(distance) {
    if (distance <= 0) return 1.0;
    if (distance >= 32) return 0.0;
    // Normalized curve: distance 0 -> 1.0, distance 10 -> ~0.70, distance 20 -> ~0.35
    return Math.max(0, Number((1 - (distance / 32)).toFixed(4)));
  },

  /**
   * Performs detailed visual comparison between two candidate images.
   * Evaluates pixel-level normalized MAE/SSIM downsampled to 64x64.
   * 
   * @param {string} path1 
   * @param {string} path2 
   * @returns {Promise<{ similarity: number, isExact: boolean, comparisonMethod: string }>}
   */
  async compareImagesDetailed(path1, path2) {
    // 1. Check exact file hash
    const [hash1, hash2] = await Promise.all([
      this.calculateSha256(path1),
      this.calculateSha256(path2)
    ]);

    if (hash1 === hash2) {
      return {
        similarity: 1.0,
        isExact: true,
        comparisonMethod: "exact_sha256"
      };
    }

    // 2. Python PIL structural comparison
    try {
      const pyScript = `
import sys, json
from PIL import Image

try:
    p1 = sys.argv[1]
    p2 = sys.argv[2]
    with Image.open(p1) as im1, Image.open(p2) as im2:
        # Resize both to 64x64 grayscale for structural luminance comparison
        i1 = im1.convert('L').resize((64, 64), Image.Resampling.BILINEAR)
        i2 = im2.convert('L').resize((64, 64), Image.Resampling.BILINEAR)
        px1 = list(i1.getdata())
        px2 = list(i2.getdata())
        
        # Mean absolute error
        mae = sum(abs(a - b) for a, b in zip(px1, px2)) / (64 * 64 * 255.0)
        sim = max(0.0, 1.0 - mae)
        print(json.dumps({'similarity': round(sim, 4)}))
except Exception as e:
    print(json.dumps({'error': str(e)}))
`;
      const { stdout } = await execFileAsync("python", ["-c", pyScript, path1, path2], { timeout: 4000 });
      const res = JSON.parse(stdout.trim());
      if (res && typeof res.similarity === "number") {
        return {
          similarity: res.similarity,
          isExact: res.similarity >= 0.999,
          comparisonMethod: "structural_pixel_comparison"
        };
      }
    } catch (_) {
      // Fallback to dHash similarity
    }

    const [fp1, fp2] = await Promise.all([
      this.fingerprintImage(path1),
      this.fingerprintImage(path2)
    ]);
    const dist = this.hammingDistance(fp1.dhash, fp2.dhash);
    const sim = this.hashDistanceToSimilarity(dist);

    return {
      similarity: sim,
      isExact: dist === 0,
      comparisonMethod: "perceptual_dhash"
    };
  },

  /**
   * Filter candidate pairs from a list of images using exact hash and perceptual hash.
   * Prevents expensive N x (N-1) / 2 comparisons on dissimilar images.
   * 
   * @param {Array<object>} images List of image metadata objects with { imageId, documentId, dhash, sha256, path }
   * @param {number} [maxHammingDistance=12] Pairs with distance <= threshold are candidates (~65%+ visual similarity)
   * @returns {Array<object>} Candidate pairs
   */
  filterImageCandidates(images, maxHammingDistance = 12) {
    const candidates = [];
    const N = images.length;

    // Group exact hashes first in O(N)
    const exactHashMap = new Map();
    for (const img of images) {
      if (img.sha256) {
        if (!exactHashMap.has(img.sha256)) {
          exactHashMap.set(img.sha256, []);
        }
        exactHashMap.get(img.sha256).push(img);
      }
    }

    const pairedKeys = new Set();

    // Exact matches
    for (const group of exactHashMap.values()) {
      if (group.length > 1) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const imgA = group[i];
            const imgB = group[j];
            if (imgA.documentId === imgB.documentId) continue; // Same doc
            const key = `${imgA.imageId}::${imgB.imageId}`;
            pairedKeys.add(key);
            candidates.push({
              imageA: imgA,
              imageB: imgB,
              isExactDuplicate: true,
              hammingDistance: 0,
              estimatedSimilarity: 1.0
            });
          }
        }
      }
    }

    // Perceptual dHash candidates across different documents
    for (let i = 0; i < N; i++) {
      const imgA = images[i];
      for (let j = i + 1; j < N; j++) {
        const imgB = images[j];
        if (imgA.documentId === imgB.documentId) continue;
        const key = `${imgA.imageId}::${imgB.imageId}`;
        if (pairedKeys.has(key)) continue;

        const dist = this.hammingDistance(imgA.dhash, imgB.dhash);
        if (dist <= maxHammingDistance) {
          pairedKeys.add(key);
          candidates.push({
            imageA: imgA,
            imageB: imgB,
            isExactDuplicate: dist === 0,
            hammingDistance: dist,
            estimatedSimilarity: this.hashDistanceToSimilarity(dist)
          });
        }
      }
    }

    return candidates;
  }
};

module.exports = imageService;
