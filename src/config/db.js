const { MongoClient } = require("mongodb");

let client = null;
let db = null;
let memoryServer = null;
let connectingPromise = null;

/**
 * Checks if the MongoDB client is actively connected with a healthy topology.
 * @returns {boolean}
 */
function isClientConnected() {
  return !!(client && client.topology && client.topology.isConnected());
}

/**
 * Connect to the MongoDB database (Atlas or in-memory fallback).
 * Automatically reconnects if connection drops or becomes stale.
 * 
 * @param {boolean} [forceReconnect=false]
 * @returns {Promise<Db>}
 */
async function connectToDatabase(forceReconnect = false) {
  if (db && isClientConnected() && !forceReconnect) {
    return db;
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = (async () => {
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB_NAME || "SIMILARITY";

    // 1. Attempt connection to primary Atlas MongoDB URI
    if (uri && !process.env.FORCE_MEMORY_DB) {
      try {
        if (client) {
          try { await client.close(); } catch (_) {}
          client = null;
          db = null;
        }

        client = new MongoClient(uri, {
          maxPoolSize: 50,
          minPoolSize: 5,
          retryWrites: true,
          serverSelectionTimeoutMS: 3000
        });

        await client.connect();
        db = client.db(dbName);
        console.log("Connected to MongoDB Atlas successfully");

        await initDbCollectionsAndIndexes(db);
        return db;
      } catch (error) {
        console.warn(`Primary MongoDB Atlas connection failed (${error.message}). Checking fallback...`);
      }
    }

    // 2. Try MongoMemoryServer fallback for local testing / offline environments
    try {
      const { MongoMemoryServer } = require("mongodb-memory-server");
      
      // If memoryServer was stopped or crashed, create a fresh instance
      if (!memoryServer || memoryServer.state !== "running") {
        try {
          if (memoryServer) await memoryServer.stop();
        } catch (_) {}
        memoryServer = await MongoMemoryServer.create();
      }

      const memUri = memoryServer.getUri();

      if (client) {
        try { await client.close(); } catch (_) {}
        client = null;
        db = null;
      }

      client = new MongoClient(memUri, {
        maxPoolSize: 50,
        minPoolSize: 5,
        retryWrites: true,
        serverSelectionTimeoutMS: 5000
      });

      await client.connect();
      db = client.db(dbName);
      console.log("Connected to in-memory MongoDB fallback successfully for test/benchmark suite.");

      await initDbCollectionsAndIndexes(db);
      return db;
    } catch (memError) {
      console.error("Failed to connect to MongoDB and memory server fallback:", memError.message);
      throw memError;
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}

/**
 * Get active database instance.
 * @returns {Db}
 */
function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call connectToDatabase() first.");
  }
  return db;
}

/**
 * Closes the database connection and stops any active in-memory test server.
 */
async function closeDatabase() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
  if (memoryServer) {
    try {
      await memoryServer.stop();
    } catch (_) {}
    memoryServer = null;
  }
  console.log("MongoDB connection closed.");
}

/**
 * Tests connection.
 * @returns {Promise<boolean>}
 */
async function testDatabaseConnection() {
  try {
    const database = await connectToDatabase();
    await database.command({ ping: 1 });
    console.log("Database ping successful.");
    return true;
  } catch (error) {
    console.error("Database connection test failed:", error.message);
    return false;
  }
}

/**
 * Create collections and useful indexes if they do not exist.
 * @param {Db} database 
 */
async function initDbCollectionsAndIndexes(database) {
  try {
    // 1. scans collection
    const scans = database.collection("scans");
    await scans.createIndex({ scanId: 1 }, { unique: true });

    // 2. documents collection
    const documents = database.collection("documents");
    await documents.createIndex({ scanId: 1 });
    await documents.createIndex({ sha256Hash: 1 });
    await documents.createIndex({ scanId: 1, documentId: 1 });

    // 3. similarity_results collection
    const results = database.collection("similarity_results");
    await results.createIndex({ scanId: 1 });
    await results.createIndex({ similarityScore: 1 });
    await results.createIndex({ scanId: 1, similarityScore: -1 });
    await results.createIndex({ scanId: 1, similarityScore: 1, documentAId: 1 });
    await results.createIndex({ scanId: 1, similarityScore: 1, documentBId: 1 });
    await results.createIndex({ documentAId: 1 });
    await results.createIndex({ documentBId: 1 });
    await results.createIndex({ scanId: 1, documentAId: 1, documentBId: 1 }, { unique: true });

    console.log("MongoDB collections and indexes initialized.");
  } catch (error) {
    console.error("Error creating database indexes:", error.message);
  }
}

module.exports = {
  connectToDatabase,
  isClientConnected,
  getDb,
  closeDatabase,
  testDatabaseConnection
};
