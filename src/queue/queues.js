/**
 * BullMQ Queue definitions for DocSim distributed similarity engine.
 */

const { Queue } = require("bullmq");
const { getRedisConnectionOptions } = require("./connection");

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000
  },
  removeOnComplete: {
    count: 1000,
    age: 3600 // Keep completed jobs for 1 hour
  },
  removeOnFail: {
    count: 1000,
    age: 86400 // Keep failed jobs for 24 hours
  }
};

let documentQueue = null;
let comparisonQueue = null;

/**
 * Returns the document processing queue.
 * @returns {Queue}
 */
function getDocumentQueue() {
  if (!documentQueue) {
    const connection = getRedisConnectionOptions();
    documentQueue = new Queue("document-processing", {
      connection,
      defaultJobOptions
    });
  }
  return documentQueue;
}

/**
 * Returns the similarity comparison queue.
 * @returns {Queue}
 */
function getComparisonQueue() {
  if (!comparisonQueue) {
    const connection = getRedisConnectionOptions();
    comparisonQueue = new Queue("similarity-comparison", {
      connection,
      defaultJobOptions
    });
  }
  return comparisonQueue;
}

/**
 * Gracefully closes all BullMQ queues.
 */
async function closeQueues() {
  const promises = [];
  if (documentQueue) {
    promises.push(documentQueue.close());
    documentQueue = null;
  }
  if (comparisonQueue) {
    promises.push(comparisonQueue.close());
    comparisonQueue = null;
  }
  await Promise.all(promises);
}

module.exports = {
  getDocumentQueue,
  getComparisonQueue,
  closeQueues,
  defaultJobOptions
};
