import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addProcessingJob } from "../src/queue.js";

describe("processing queue re-enqueue", () => {
  it("removes a completed deferred job so reconciliation can enqueue its stable ID again", async () => {
    const completedJobs = new Map();
    let executions = 0;
    const queue = {
      async add(name, data, options) {
        assert.equal(name, "process-document");
        const existing = completedJobs.get(options.jobId);
        if (existing) return existing;
        const job = { name, data, options };
        executions += 1;
        if (options.removeOnComplete !== true) completedJobs.set(options.jobId, job);
        return job;
      },
    };

    await addProcessingJob(queue, "deferred-job-id");
    await addProcessingJob(queue, "deferred-job-id");

    assert.equal(executions, 2, "the same durable job ID should be accepted after completion");
    assert.equal(completedJobs.size, 0, "completed queue records should not block the next enqueue");
  });

  it("preserves BullMQ retry settings", async () => {
    let addedOptions;
    const queue = { async add(_name, _data, options) { addedOptions = options; } };

    await addProcessingJob(queue, "retry-job-id");

    assert.equal(addedOptions.attempts, 3);
    assert.deepEqual(addedOptions.backoff, { type: "exponential", delay: 2_000 });
    assert.equal(addedOptions.removeOnComplete, true);
  });
});
