import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateThenPersist, persistChatTurn } from "../src/chats.js";
import { pool, runTransaction } from "../src/db.js";

function transactionalRecorder({ failOn = null } = {}) {
  const committed = [];
  const transactionFn = async (callback) => {
    const staged = [];
    try {
      await callback({ execute: async (sql, params) => {
        if (failOn && sql.includes(failOn)) throw new Error("simulated database failure");
        staged.push({ sql, params });
      } });
      committed.push(...staged);
    } catch (error) {
      staged.length = 0;
      throw error;
    }
  };
  return { committed, transactionFn };
}

after(async () => { await pool.end(); });

const turn = {
  chatId: "chat-1",
  userId: "user-1",
  question: "What does the paper conclude?",
  userMessageId: "user-message-1",
  answerId: "assistant-message-1",
  modelName: "test-model",
  result: {
    answer: "It concludes the treatment was effective.",
    citations: [{ documentId: "doc-1", chunkId: "chunk-1", pageStart: 4, pageEnd: 4, excerpt: "The measured effect was positive." }],
  },
};

describe("chat turn persistence", () => {
  it("does not persist a turn when AI generation fails", async () => {
    let persisted = false;

    await assert.rejects(generateThenPersist(async () => {
      throw new Error("simulated AI failure");
    }, async () => { persisted = true; }), /simulated AI failure/);

    assert.equal(persisted, false);
  });

  it("persists the user message, answer, citations, and title in one transaction", async () => {
    const recorder = transactionalRecorder();

    await persistChatTurn({ ...turn, transactionFn: recorder.transactionFn });

    assert.equal(recorder.committed.length, 4);
    assert.match(recorder.committed[0].sql, /'user'/);
    assert.equal(recorder.committed[0].params[0], turn.userMessageId);
    assert.match(recorder.committed[1].sql, /'assistant'/);
    assert.equal(recorder.committed[1].params[0], turn.answerId);
    assert.match(recorder.committed[2].sql, /INSERT INTO message_citations/);
    assert.match(recorder.committed[3].sql, /UPDATE chats/);
  });

  it("rolls back the entire turn if citation persistence fails", async () => {
    const recorder = transactionalRecorder({ failOn: "INSERT INTO message_citations" });

    await assert.rejects(persistChatTurn({ ...turn, transactionFn: recorder.transactionFn }), /simulated database failure/);

    assert.deepEqual(recorder.committed, [], "neither message nor partial citations should remain committed");
  });

  it("releases a failed transaction and preserves its original error when rollback succeeds", async () => {
    const events = [];
    const connection = {
      async beginTransaction() { events.push("begin"); },
      async commit() { events.push("commit"); },
      async rollback() { events.push("rollback"); },
      release() { events.push("release"); },
    };
    const failure = new Error("write failed");

    await assert.rejects(runTransaction(connection, async () => { throw failure; }), (error) => error === failure);
    assert.deepEqual(events, ["begin", "rollback", "release"]);
  });

  it("preserves both errors and releases the connection if rollback fails", async () => {
    const failure = new Error("write failed");
    const rollbackFailure = new Error("rollback failed");
    let released = false;
    const connection = {
      async beginTransaction() {},
      async commit() {},
      async rollback() { throw rollbackFailure; },
      release() { released = true; },
    };

    await assert.rejects(runTransaction(connection, async () => { throw failure; }), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, failure);
      assert.deepEqual(error.errors, [failure, rollbackFailure]);
      return true;
    });
    assert.equal(released, true);
  });
});
