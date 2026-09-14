const crypto = require("crypto");
const fs = require("fs");

/**
 * Service to calculate secure hashes of documents.
 */
const hashingService = {
  /**
   * Computes the SHA-256 hash of a file at a given path.
   * @param {string} filePath Absolute or relative path to file
   * @returns {Promise<string>} Hex representation of the SHA-256 hash
   */
  calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);

      stream.on("data", (data) => {
        hash.update(data);
      });

      stream.on("end", () => {
        resolve(hash.digest("hex"));
      });

      stream.on("error", (error) => {
        reject(error);
      });
    });
  },

  /**
   * Computes the SHA-256 hash of a string buffer directly.
   * @param {Buffer|string} content 
   * @returns {string}
   */
  calculateContentHash(content) {
    return crypto.createHash("sha256").update(content).digest("hex");
  }
};

module.exports = hashingService;
