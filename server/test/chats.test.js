import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateQuestionAnswer, generateThenPersist, isExplicitDocumentQuestion, persistChatTurn } from "../src/chats.js";
import { generateConversationTurn, generateGroundedAnswer } from "../src/ai.js";
import { config } from "../src/config.js";
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

describe("conversational and document answer routing", () => {
  const docs = [{ id: "doc-1" }];

  it("routes greetings, thanks, and casual conversation to a conversation reply without retrieval", async () => {
    const cases = [
      ["नमस्ते", "Hindi greeting", true],
      ["Hello", "English greeting", true],
      ["Hi, kaise ho?", "Hinglish greeting", true],
      ["Thank you!", "Thank-you message", true],
      ["What's up?", "Casual conversation", true],
      ["What is your name?", "General conversation", false],
    ];

    for (const [question, label, expectedForce] of cases) {
      let classifiedQuestion;
      let forceConversation;
      const result = await generateQuestionAnswer(question, {
        userId: "user-1",
        docs,
        conversationTurn: async (value, force) => { classifiedQuestion = value; forceConversation = force; return { intent: force ? "document" : "conversation", answer: "Natural reply" }; },
        embed: async () => { throw new Error("conversation should skip embeddings"); },
        retrieve: async () => { throw new Error("conversation should skip retrieval"); },
      });
      assert.equal(classifiedQuestion, question, label);
      assert.equal(forceConversation, expectedForce, label);
      assert.deepEqual(result, { answer: "Natural reply", insufficientEvidence: false, citations: [] }, label);
    }
  });

  it("uses Gemini's existing generation endpoint and asks it to mirror Hindi, English, or Hinglish", async () => {
    const previousEnabled = config.aiEnabled;
    const previousKey = config.geminiKey;
    const previousFetch = globalThis.fetch;
    let requestBody;
    config.aiEnabled = true;
    config.geminiKey = "test-key";
    globalThis.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: "conversation", answer: "नमस्ते!" }) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
      const turn = await generateConversationTurn("नमस्ते");
      const prompt = requestBody.contents[0].parts[0].text;
      assert.equal(turn.answer, "नमस्ते!");
      assert.match(prompt, /Hindi to Hindi, and Hinglish to natural Hinglish/);
      assert.match(prompt, /LATEST MESSAGE:\nनमस्ते/);
    } finally {
      config.aiEnabled = previousEnabled;
      config.geminiKey = previousKey;
      globalThis.fetch = previousFetch;
    }
  });

  it("includes Papertrail's developer attribution in conversation prompts in English, Hindi, and Hinglish", async () => {
    const previousEnabled = config.aiEnabled;
    const previousKey = config.geminiKey;
    const previousFetch = globalThis.fetch;
    const prompts = [];
    config.aiEnabled = true;
    config.geminiKey = "test-key";
    globalThis.fetch = async (_url, options) => {
      prompts.push(JSON.parse(options.body).contents[0].parts[0].text);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: "conversation", answer: "I was developed by Prashant Chouhan." }) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
      for (const question of ["Who developed Papertrail AI?", "पेपरट्रेल AI को किसने विकसित किया?", "Papertrail AI ko kisne develop kiya?"]) {
        await generateConversationTurn(question);
      }
      assert.equal(prompts.length, 3);
      for (const prompt of prompts) {
        assert.match(prompt, /Papertrail AI was developed by Prashant Chouhan/);
        assert.match(prompt, /not the developer of the underlying Gemini AI model/);
        assert.match(prompt, /language and style of the user's latest message/);
      }
    } finally {
      config.aiEnabled = previousEnabled;
      config.geminiKey = previousKey;
      globalThis.fetch = previousFetch;
    }
  });

  it("includes Papertrail's developer attribution in document-grounded prompts in all three languages", async () => {
    const previousEnabled = config.aiEnabled;
    const previousKey = config.geminiKey;
    const previousFetch = globalThis.fetch;
    const prompts = [];
    config.aiEnabled = true;
    config.geminiKey = "test-key";
    globalThis.fetch = async (_url, options) => {
      prompts.push(JSON.parse(options.body).contents[0].parts[0].text);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: "I was developed by Prashant Chouhan.", insufficientEvidence: false, citations: [{ chunkId: "chunk-1" }] }) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const excerpts = [{ chunkId: "chunk-1", documentId: "doc-1", documentName: "paper.pdf", pageStart: 1, pageEnd: 1, text: "Document content." }];
    try {
      for (const question of ["Who built Papertrail AI?", "Papertrail AI को किसने बनाया?", "Papertrail AI kisne banaya?"]) {
        const result = await generateGroundedAnswer(question, excerpts);
        assert.equal(result.answer, "I was developed by Prashant Chouhan.");
      }
      assert.equal(prompts.length, 3);
      for (const prompt of prompts) {
        assert.match(prompt, /Papertrail AI was developed by Prashant Chouhan/);
        assert.match(prompt, /not the developer of the underlying Gemini AI model/);
        assert.match(prompt, /language and style of the user's latest message/);
      }
    } finally {
      config.aiEnabled = previousEnabled;
      config.geminiKey = previousKey;
      globalThis.fetch = previousFetch;
    }
  });

  it("keeps explicit PDF questions on the grounded retrieval path", async () => {
    let embedded = false;
    let retrieved = false;
    let grounded = false;
    const question = "Summarize this PDF.";
    assert.equal(isExplicitDocumentQuestion(question), true);

    const result = await generateQuestionAnswer(question, {
      userId: "user-1",
      docs,
      conversationTurn: async () => { throw new Error("explicit document question should bypass conversation classification"); },
      embed: async () => { embedded = true; return [1]; },
      retrieve: async () => { retrieved = true; return [{ payload: { chunkId: "chunk-1", documentId: "doc-1", userId: "user-1", documentName: "paper.pdf", pageStart: 2, pageEnd: 2, text: "Supported content." } }]; },
      groundedAnswer: async (_question, excerpts) => { grounded = true; assert.equal(excerpts[0].chunkId, "chunk-1"); return { answer: "Grounded summary", insufficientEvidence: false, citations: [] }; },
    });

    assert.equal(embedded, true);
    assert.equal(retrieved, true);
    assert.equal(grounded, true);
    assert.equal(result.answer, "Grounded summary");
  });

  it("preserves insufficient-evidence handling when document retrieval finds nothing", async () => {
    const result = await generateQuestionAnswer("Explain page 5.", {
      userId: "user-1",
      docs,
      embed: async () => [1],
      retrieve: async () => [],
      groundedAnswer: async () => { throw new Error("should not generate without excerpts"); },
    });

    assert.equal(result.insufficientEvidence, true);
    assert.deepEqual(result.citations, []);
    assert.match(result.answer, /couldn't find relevant passages/);
  });
});
