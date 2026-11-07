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
  await addProcessingJob(getQueue(), jobId);
}

// The MySQL processing_jobs row is the durable record. Remove completed BullMQ
// jobs so a deferred database job can be added again with its stable job ID.
export async function addProcessingJob(queue, jobId) {
  await queue.add("process-document", { jobId }, {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: true,
  });
}

export async function closeQueue() { if (documentQueue) await documentQueue.close(); if (connection) await connection.quit(); }
