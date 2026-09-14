/**
 * Workers manager to start and stop document and comparison workers.
 */

const { createDocumentWorker } = require("./documentWorker");
const { createComparisonWorker } = require("./comparisonWorker");

let documentWorker = null;
let comparisonWorker = null;

/**
 * Starts all BullMQ workers.
 */
function startWorkers() {
  if (!documentWorker) {
    documentWorker = createDocumentWorker();
    console.log("[Workers] Document worker started.");
  }
  if (!comparisonWorker) {
    comparisonWorker = createComparisonWorker();
    console.log("[Workers] Comparison worker started.");
  }

  return { documentWorker, comparisonWorker };
}

/**
 * Stops all BullMQ workers gracefully.
 */
async function stopWorkers() {
  const promises = [];
  if (documentWorker) {
    promises.push(documentWorker.close());
    documentWorker = null;
  }
  if (comparisonWorker) {
    promises.push(comparisonWorker.close());
    comparisonWorker = null;
  }
  await Promise.all(promises);
  console.log("[Workers] All workers stopped.");
}

module.exports = {
  startWorkers,
  stopWorkers
};
