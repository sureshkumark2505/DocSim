const multer = require("multer");

/**
 * Centralized Express Error Handling Middleware.
 * Standardizes multer upload errors and application exceptions.
 */
function errorMiddleware(err, req, res, next) {
  if (!err) {
    next();
    return;
  }

  if (err instanceof multer.MulterError) {
    let message = "File upload failed.";

    if (err.code === "LIMIT_FILE_COUNT") {
      message = `Maximum ${process.env.MAX_FILES || 1000} files can be uploaded at once.`;
    }

    if (err.code === "LIMIT_FILE_SIZE") {
      message = `Each file must be smaller than ${process.env.MAX_FILE_SIZE_MB || 20} MB.`;
    }

    res.status(400).json({ success: false, message });
    return;
  }

  res.status(400).json({ success: false, message: err.message || "Request failed." });
}

module.exports = errorMiddleware;
