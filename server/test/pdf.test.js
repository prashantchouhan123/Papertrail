import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkPages, extractPdf, validatePdf } from "../src/pdf.js";

function onePagePdf() {
  const parts = ["%PDF-1.4\n"];
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(parts.join("")));
    parts.push(object);
  }
  const xrefOffset = Buffer.byteLength(parts.join(""));
  parts.push(`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.from(parts.join(""));
}

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

describe("PDF validation and extraction", () => {
  it("validates a readable PDF and releases resources before returning", async () => {
    const pdf = onePagePdf();
    assert.deepEqual(await validatePdf(pdf, 10), { pageCount: 1 });
    assert.deepEqual(await extractPdf(pdf, 10), { pageCount: 1, pages: [{ page: 1, text: "" }] });
  });

  it("rejects empty and non-PDF files with the existing invalid-PDF error", async () => {
    for (const input of [Buffer.alloc(0), Buffer.from("not a PDF")]) {
      await assert.rejects(validatePdf(input, 10), { code: "INVALID_PDF", status: 415 });
    }
  });

  it("maps corrupted PDFs and page-limit violations to validation errors", async () => {
    await assert.rejects(validatePdf(Buffer.from("%PDF-1.4 corrupted content"), 10), { code: "PDF_PARSE_FAILED", status: 422 });
    await assert.rejects(validatePdf(onePagePdf(), 0), { code: "PAGE_LIMIT_EXCEEDED", status: 422 });
  });
});
