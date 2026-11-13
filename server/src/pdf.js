import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { AppError } from "./errors.js";

async function cleanupPdf(pdf, loadingTask) {
  try { await pdf?.cleanup(); } catch { /* Continue to destroy the loading task. */ }
  try { await loadingTask?.destroy(); } catch { /* Preserve the original parse or validation error. */ }
}

async function openPdf(buffer, maxPages) {
  buffer = Buffer.from(buffer);
  if (buffer.length < 8 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new AppError(415, "INVALID_PDF", "This file is not a valid PDF.");
  let loadingTask;
  let pdf;
  try {
    loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, stopAtErrors: true });
    pdf = await loadingTask.promise;
    if (pdf.numPages > maxPages) throw new AppError(422, "PAGE_LIMIT_EXCEEDED", `PDFs can contain at most ${maxPages} pages.`);
    return { pdf, loadingTask };
  } catch (error) {
    await cleanupPdf(pdf, loadingTask);
    if (error instanceof AppError) throw error;
    throw new AppError(422, "PDF_PARSE_FAILED", "This PDF could not be read. Try exporting it again.");
  }
}

export async function validatePdf(buffer, maxPages) {
  const { pdf, loadingTask } = await openPdf(buffer, maxPages);
  try {
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      page.cleanup();
    }
    return { pageCount: pdf.numPages };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, "PDF_PARSE_FAILED", "This PDF could not be read. Try exporting it again.");
  } finally {
    await cleanupPdf(pdf, loadingTask);
  }
}

export async function extractPdf(buffer, maxPages) {
  const { pdf, loadingTask } = await openPdf(buffer, maxPages);
  const pages = [];
  try {
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      try {
        const content = await page.getTextContent();
        const text = content.items.map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim();
        pages.push({ page: pageNo, text });
      } finally {
        page.cleanup();
      }
    }
    return { pageCount: pdf.numPages, pages };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, "PDF_PARSE_FAILED", "This PDF could not be read. Try exporting it again.");
  } finally {
    await cleanupPdf(pdf, loadingTask);
  }
}

export function chunkPages(pages, maxChars = 3200, overlap = 320) {
  const chunks = [];
  for (const page of pages) {
    const text = page.text;
    if (!text) continue;
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + maxChars, text.length);
      if (end < text.length) {
        const boundary = text.lastIndexOf(" ", end);
        if (boundary > start + Math.floor(maxChars * 0.6)) end = boundary;
      }
      const chunkText = text.slice(start, end).trim();
      if (chunkText) chunks.push({ text: chunkText, pageStart: page.page, pageEnd: page.page });
      if (end >= text.length) break;
      start = Math.max(start + 1, end - overlap);
    }
  }
  return chunks;
}
