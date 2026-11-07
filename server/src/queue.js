import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config.js";

let connection;
let documentQueue;

function getQueue() {
  if (!documentQueue) {
    connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: true, retryStrategy: (attempt) => Math.min(attempt * 250, 5000) });
    documentQueue = new Queue("document-processing", { connection, prefix: config.bullPrefix, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 2_000 }, removeOnComplete: 1000, removeOnFail: 2000 } });
  }
  return documentQueue;
}

export async function enqueueProcessing(jobId) {
  await getQueue().add("process-document", { jobId }, { jobId, attempts: 3, backoff: { type: "exponential", delay: 2_000 } });
}

export async function closeQueue() { if (documentQueue) await documentQueue.close(); if (connection) await connection.quit(); }
