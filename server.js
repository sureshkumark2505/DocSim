const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();
const { connectToDatabase, testDatabaseConnection, closeDatabase } = require("./src/config/db");
const { testRedisConnection } = require("./src/queue/connection");
const { startWorkers } = require("./src/workers");
const scanRoutes = require("./src/routes/scanRoutes");
const errorMiddleware = require("./src/middleware/errorMiddleware");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/vendor", express.static(path.join(__dirname, "node_modules", "three", "build")));
app.use(express.static(__dirname));

app.get("/api/health", async (req, res) => {
  const redisOk = await testRedisConnection();
  res.status(200).json({ ok: true, service: "DocSim", engine: "Level 2 (MinHash + LSH + BullMQ)", redis: redisOk });
});

// Middleware to ensure database connection is established for API requests
app.use("/api", async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (err) {
    console.error("Database connection middleware error:", err.message);
    res.status(503).json({ success: false, message: "Database service unavailable. Please retry in a moment.", error: err.message });
  }
});

app.use("/api/scan", scanRoutes);
app.use("/api/scans", scanRoutes);
app.use(errorMiddleware);

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

async function startServer() {
  await testDatabaseConnection();

  const redisConnected = await testRedisConnection();
  if (redisConnected) {
    console.log("Redis connected successfully. Initializing BullMQ workers...");
    startWorkers();
  } else {
    console.log("Redis not connected. Running Level 2 engine with in-process worker pipeline.");
  }

  const triedPorts = new Set();

  function tryListen(port) {
    if (triedPorts.has(port)) {
      return;
    }

    triedPorts.add(port);
    const server = app.listen(port, () => {
      if (port === 3000) {
        console.log("Server running on port 3000");
      } else {
        console.log(`Server running on port ${port}`);
      }
      console.log(`Open: http://localhost:${port}`);
    });

    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        const nextPort = port + 1;
        console.warn(`Port ${port} is already in use. Trying ${nextPort}...`);
        tryListen(nextPort);
        return;
      }

      console.error("Server startup failed:", error.message);
      process.exit(1);
    });
  }

  tryListen(PORT);
}

startServer();
