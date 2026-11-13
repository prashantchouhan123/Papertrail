import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDocumentListQuery } from "../src/documents.js";
import { buildChatListQuery } from "../src/chats.js";
import { pool } from "../src/db.js";

function assertParameterizedValuesMatch(sql, params) {
  assert.equal((sql.match(/\?/g) || []).length, params.length);
}

describe("TiDB pagination queries", () => {
  it("keeps the document list limit as a bounded SQL integer", () => {
    const query = buildDocumentListQuery("user-id", null, 20);
    assert.match(query.sql, /LIMIT 21$/);
    assert.doesNotMatch(query.sql, /LIMIT\s+\?/);
    assert.deepEqual(query.params, ["user-id"]);
    assertParameterizedValuesMatch(query.sql, query.params);
  });

  it("keeps the cursor chat list values parameterized and limit as a SQL integer", () => {
    const cursor = { date: "2026-11-13 10:00:00", id: "chat-id" };
    const query = buildChatListQuery("user-id", cursor, 100);
    assert.match(query.sql, /LIMIT 101$/);
    assert.doesNotMatch(query.sql, /LIMIT\s+\?/);
    assert.deepEqual(query.params, ["user-id", cursor.date, cursor.date, cursor.id]);
    assertParameterizedValuesMatch(query.sql, query.params);
  });
});

after(async () => { await pool.end(); });
