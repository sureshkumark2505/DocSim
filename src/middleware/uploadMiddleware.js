const path = require("path");
const fs = require("fs/promises");
const multer = require("multer");
const crypto = require("crypto");
const documentService = require("../services/documentService");

const uploadsRoot = path.join(__dirname, "..", "..", "uploads");

// Configure dynamic destination folder based on scanId
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const scanId = req.params.scanId || req.tempScanId || (req.tempScanId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2));
    const scanDir = path.join(uploadsRoot, scanId);
    try {
      await fs.mkdir(scanDir, { recursive: true });
      cb(null, scanDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // Safe filename handling
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${cleanName}`);
  }
});

const allowedExtensions = new Set([".txt", ".pdf", ".docx"]);
const allowedMimeTypes = new Set([
  "text/plain",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

function fileFilter(req, file, cb) {
  const extension = path.extname(file.originalname).toLowerCase();
  const mimeValid = allowedMimeTypes.has(file.mimetype);
  const extensionValid = allowedExtensions.has(extension);

  if (!mimeValid && !extensionValid) {
    cb(new Error(`Unsupported file type: ${file.originalname}. Only TXT, PDF, and DOCX are allowed.`));
    return;
  }

  cb(null, true);
}

const getMulterConfig = () => {
  const maxFiles = Number(process.env.MAX_FILES) || 1000;
  const maxFileSize = (Number(process.env.MAX_FILE_SIZE_MB) || 20) * 1024 * 1024;

  return multer({
    storage,
    fileFilter,
    limits: {
      files: maxFiles,
      fileSize: maxFileSize
    }
  });
};

/**
 * Middleware wrapper. Validates scan exists in MongoDB BEFORE Multer processes file upload.
 */
const uploadMiddleware = async (req, res, next) => {
  const { scanId } = req.params;

  try {
    if (scanId) {
      // 1. Validate scan existence
      const scan = await documentService.getScan(scanId);
      if (!scan) {
        return res.status(404).json({ success: false, message: `Scan job ${scanId} not found.` });
      }
    } else {
      // Generate temporary scan ID for legacy endpoint
      req.tempScanId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    }

    // 2. Validate total upload size via headers
    const maxTotalSize = (Number(process.env.MAX_TOTAL_UPLOAD_SIZE_MB) || 500) * 1024 * 1024;
    if (req.headers["content-length"] && parseInt(req.headers["content-length"], 10) > maxTotalSize) {
      return res.status(400).json({
        success: false,
        message: `Total upload size exceeds the limit of ${process.env.MAX_TOTAL_UPLOAD_SIZE_MB || 500}MB.`
      });
    }

    // 3. Process the file uploads
    const maxFiles = Number(process.env.MAX_FILES) || 1000;
    const uploadHandler = getMulterConfig().array("files", maxFiles);

    uploadHandler(req, res, (err) => {
      if (err) {
        let errorMessage = err.message;
        if (err.code === "LIMIT_FILE_SIZE") {
          errorMessage = `File size exceeds the limit of ${process.env.MAX_FILE_SIZE_MB || 20}MB.`;
        } else if (err.code === "LIMIT_FILE_COUNT") {
          errorMessage = `File count exceeds the limit of ${process.env.MAX_FILES || 1000} files.`;
        }
        return res.status(400).json({
          success: false,
          message: errorMessage
        });
      }
      next();
    });

  } catch (error) {
    console.error("Upload validation error:", error);
    return res.status(500).json({ success: false, message: "Upload validation failed.", error: error.message });
  }
};

module.exports = uploadMiddleware;
