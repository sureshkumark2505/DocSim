/**
 * Redis connection manager for BullMQ queues and workers.
 * Supports REDIS_URL or REDIS_HOST / REDIS_PORT / REDIS_PASSWORD.
 */

const Redis = require("ioredis");

/**
 * Parses and returns connection options for ioredis and BullMQ.
 * BullMQ requires `maxRetriesPerRequest: null`.
 * 
 * @returns {object}
 */
function getRedisConnectionOptions() {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl && redisUrl.trim() !== "") {
    return {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      enableOfflineQueue: false,
      retryStrategy(times) {
        if (times > 3) return null; // stop reconnecting after 3 failed attempts
        return Math.min(times * 200, 1000);
      }
    };
  }

  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    retryStrategy(times) {
      if (times > 3) return null; // stop reconnecting after 3 failed attempts
      return Math.min(times * 200, 1000);
    }
  };
}

/**
 * Creates a new Redis client instance.
 * 
 * @param {object} [customOptions]
 * @returns {Redis}
 */
function createRedisClient(customOptions = {}) {
  const redisUrl = process.env.REDIS_URL;
  const options = {
    ...getRedisConnectionOptions(),
    ...customOptions
  };

  let client;
  if (redisUrl && redisUrl.trim() !== "") {
    client = new Redis(redisUrl, options);
  } else {
    client = new Redis(options);
  }

  client.on("error", () => {
    // Suppress unhandled error events during connection checks
  });

  return client;
}

let sharedClient = null;

/**
 * Gets or creates the shared Redis client.
 * @returns {Redis}
 */
function getSharedRedisClient() {
  if (!sharedClient) {
    sharedClient = createRedisClient();
  }
  return sharedClient;
}

/**
 * Tests the Redis connection.
 * @returns {Promise<boolean>}
 */
async function testRedisConnection() {
  let client = null;
  try {
    const opts = {
      ...getRedisConnectionOptions(),
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 800,
      retryStrategy: () => null // Do not retry for healthcheck
    };

    client = new Redis(process.env.REDIS_URL || opts);
    client.on("error", () => {}); // Silence connection check errors

    await client.connect();
    const pong = await client.ping();
    await client.quit();
    return pong === "PONG";
  } catch (error) {
    if (client) {
      try { client.disconnect(); } catch (e) {}
    }
    return false;
  }
}

/**
 * Closes the shared Redis client.
 */
async function closeRedisConnection() {
  if (sharedClient) {
    try {
      await sharedClient.quit();
    } catch (e) {
      sharedClient.disconnect();
    }
    sharedClient = null;
  }
}

module.exports = {
  getRedisConnectionOptions,
  createRedisClient,
  getSharedRedisClient,
  testRedisConnection,
  closeRedisConnection
};
