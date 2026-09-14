const fs = require("fs/promises");
const path = require("path");
const { getDb } = require("../config/db");

const uploadsRoot = path.resolve(__dirname, "..", "..", "uploads");

/**
 * Service to handle safe deletion of temporary upload directories.
 */
const cleanupService = {
  /**
   * Safely deletes the upload directory for a specific scan.
   * Path traversal protection is implemented by verifying that the resolved path lies directly inside the uploads root.
   * 
   * @param {string} scanId 
   */
  async deleteScanDirectory(scanId) {
    if (!scanId || typeof scanId !== "string" || scanId.trim() === "") {
      return;
    }

    const targetDir = path.resolve(uploadsRoot, scanId);

    // Path traversal check
    if (!targetDir.startsWith(uploadsRoot) || targetDir === uploadsRoot) {
      console.warn(`Prevented unsafe deletion attempt of directory: ${targetDir}`);
      return;
    }

    try {
      await fs.rm(targetDir, { recursive: true, force: true });
      console.log(`Successfully cleaned up temporary directory for scan: ${scanId}`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error(`Error deleting scan directory ${scanId}:`, error.message);
      }
    }
  },

  /**
   * Cleanup old/stale temporary upload directories.
   * Only deletes scan directories older than TEMP_FILE_RETENTION_HOURS and NOT currently active ('queued' or 'processing').
   */
  async cleanupOldTempFiles() {
    try {
      const db = getDb();
      const retentionHours = Number(process.env.TEMP_FILE_RETENTION_HOURS) || 24;
      const cutoffTime = Date.now() - retentionHours * 60 * 60 * 1000;

      const items = await fs.readdir(uploadsRoot, { withFileTypes: true });

      for (const item of items) {
        if (!item.isDirectory()) {
          continue;
        }

        const scanId = item.name;
        const dirPath = path.resolve(uploadsRoot, scanId);
        const stats = await fs.stat(dirPath);

        // Check if directory creation date is older than retention period
        if (stats.birthtimeMs < cutoffTime) {
          // Check scan status in database
          const scan = await db.collection("scans").findOne({ scanId });
          
          if (scan) {
            // Protect active scans
            if (scan.status === "queued" || scan.status === "processing") {
              console.log(`Skipped cleanup of active scan directory: ${scanId}`);
              continue;
            }
          }

          // Safe to delete stale terminal/abandoned directories
          await this.deleteScanDirectory(scanId);
        }
      }
    } catch (error) {
      console.error("Stale file cleanup failed:", error.message);
    }
  }
};

module.exports = cleanupService;
