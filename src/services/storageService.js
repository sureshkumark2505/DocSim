const fs = require("fs/promises");
const path = require("path");

const uploadsRoot = path.join(__dirname, "..", "..", "uploads");

/**
 * Storage Service abstraction for handling temporary files.
 */
const storageService = {
  /**
   * Resolves paths inside uploads/<scanId>/
   * @param {string} scanId 
   * @param {string} filename 
   * @returns {string}
   */
  resolvePath(scanId, filename) {
    return path.join(uploadsRoot, scanId, path.basename(filename));
  },

  /**
   * Reads a file path as buffer.
   * @param {string} filePath 
   * @returns {Promise<Buffer>}
   */
  async readToBuffer(filePath) {
    return fs.readFile(filePath);
  },

  /**
   * Reads a file path as string.
   * @param {string} filePath 
   * @returns {Promise<string>}
   */
  async readToString(filePath) {
    return fs.readFile(filePath, "utf8");
  },

  /**
   * Deletes a file.
   * @param {string} filePath 
   * @returns {Promise<void>}
   */
  async deleteFile(filePath) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
};

module.exports = storageService;
