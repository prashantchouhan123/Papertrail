import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkPages } from "../src/pdf.js";

describe("PDF page chunking", () => {
  it("keeps page metadata and bounded overlapping chunks", () => {
    const chunks = chunkPages([
      { page: 1, text: "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda." },
      { page: 2, text: "Second page stays separate." },
    ], 24, 5);

    assert.ok(chunks.length > 2);
    assert.ok(chunks.every((chunk) => chunk.text.length <= 24));
    assert.ok(chunks.filter((chunk) => chunk.pageStart === 1).length > 1);
    assert.ok(chunks.some((chunk) => chunk.pageStart === 2 && chunk.pageEnd === 2));
    assert.ok(chunks.every((chunk) => chunk.pageStart === chunk.pageEnd));
  });
});
