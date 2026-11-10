import crypto from "node:crypto";
import multer from "multer";
import { z } from "zod";
import { config } from "./config.js";
import { pool, query, transaction } from "./db.js";
import { AppError, asyncHandler } from "./errors.js";
import { enqueueProcessing } from "./queue.js";
import { validatePdf } from "./pdf.js";
import { deletePdf, storePdf } from "./storage.js";

export const uploadPdf = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileBytes, files: 1 }, fileFilter: (_req, file, done) => {
  if (file.mimetype !== "application/pdf" || !file.originalname.toLowerCase().endsWith(".pdf")) return done(new AppError(415, "PDF_ONLY", "Upload a PDF file."));
  done(null, true);
} }).single("file");

const safeName = (name) => name.replace(/[\\/\0<>:"|?*\x00-\x1f]/g, "_").trim().slice(0, 255) || "document.pdf";
const mapDoc = (row) => ({ id: row.id, originalName: row.original_name, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), pageCount: row.page_count, status: row.status, errorCode: row.error_code, createdAt: row.created_at, updatedAt: row.updated_at });

function parseCursor(cursor) {
  if (!cursor) return null;
  try { const [date, id] = Buffer.from(cursor, "base64url").toString().split("|"); if (!date || !id) return null; return { date, id }; } catch { return null; }
}
function nextCursor(row) { return Buffer.from(`${new Date(row.created_at).toISOString()}|${row.id}`).toString("base64url"); }

export const createDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, "FILE_REQUIRED", "Choose a PDF file to upload.");
  const parsed = await validatePdf(req.file.buffer, config.maxPages);
  const storageKey = await storePdf(req.file.buffer);
  const id = crypto.randomUUID(); const jobId = crypto.randomUUID();
  try {
    await transaction(async (connection) => {
      const [users] = await connection.execute("SELECT id,storage_used_bytes FROM users WHERE id=? FOR UPDATE", [req.user.id]);
      if (!users.length) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
      const [counts] = await connection.execute("SELECT COUNT(*) AS total FROM documents WHERE user_id=? AND status<>'deleted'", [req.user.id]);
      if (Number(counts[0].total) >= config.maxDocuments) throw new AppError(429, "DOCUMENT_QUOTA_REACHED", `Your account can store up to ${config.maxDocuments} documents.`);
      if (Number(users[0].storage_used_bytes) + req.file.size > config.maxStorageBytes) throw new AppError(429, "STORAGE_QUOTA_REACHED", "Your document storage quota is full. Delete a document before uploading another.");
      await connection.execute("UPDATE users SET storage_used_bytes=storage_used_bytes+? WHERE id=?", [req.file.size, req.user.id]);
      await connection.execute("INSERT INTO documents (id,user_id,original_name,storage_key,mime_type,size_bytes,page_count,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [id, req.user.id, safeName(req.file.originalname), storageKey, "application/pdf", req.file.size, parsed.pageCount]);
      await connection.execute("INSERT INTO processing_jobs (id,document_id,user_id,job_type,status,idempotency_key,max_attempts,created_at,updated_at) VALUES (?,?,?,'process','queued',?,3,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [jobId, id, req.user.id, `process:${id}`]);
    });
  } catch (error) { await deletePdf(storageKey).catch(() => {}); throw error; }
  try { await enqueueProcessing(jobId); } catch (error) { console.error(JSON.stringify({ level: "warn", code: "QUEUE_ENQUEUE_PENDING", jobId, message: error.message })); }
  res.status(202).json({ success: true, data: { document: { id, originalName: safeName(req.file.originalname), sizeBytes: req.file.size, pageCount: parsed.pageCount, status: "queued" }, jobId }, message: "Your PDF is queued for processing." });
});

export const listDocuments = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const cursor = parseCursor(String(req.query.cursor || ""));
  const rows = cursor
    ? await query("SELECT id,original_name,mime_type,size_bytes,page_count,status,error_code,created_at,updated_at FROM documents WHERE user_id=? AND status<>'deleted' AND (created_at < ? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?", [req.user.id, cursor.date, cursor.date, cursor.id, limit + 1])
    : await query("SELECT id,original_name,mime_type,size_bytes,page_count,status,error_code,created_at,updated_at FROM documents WHERE user_id=? AND status<>'deleted' ORDER BY created_at DESC,id DESC LIMIT ?", [req.user.id, limit + 1]);
  const more = rows.length > limit; const page = rows.slice(0, limit);
  res.json({ success: true, data: { items: page.map(mapDoc), nextCursor: more ? nextCursor(page.at(-1)) : null } });
});

export const getDocument = asyncHandler(async (req, res) => {
  const rows = await query("SELECT id,original_name,mime_type,size_bytes,page_count,status,error_code,created_at,updated_at FROM documents WHERE id=? AND user_id=? AND status<>'deleted' LIMIT 1", [req.params.documentId, req.user.id]);
  if (!rows.length) throw new AppError(404, "DOCUMENT_NOT_FOUND", "That document could not be found.");
  res.json({ success: true, data: { document: mapDoc(rows[0]) } });
});

export const deleteDocument = asyncHandler(async (req, res) => {
  const id = req.params.documentId; const jobId = crypto.randomUUID();
  const result = await transaction(async (connection) => {
    const [rows] = await connection.execute("SELECT id,status FROM documents WHERE id=? AND user_id=? FOR UPDATE", [id, req.user.id]);
    if (!rows.length || rows[0].status === "deleted") throw new AppError(404, "DOCUMENT_NOT_FOUND", "That document could not be found.");
    if (rows[0].status === "deleting") return { alreadyDeleting: true };
    await connection.execute("UPDATE documents SET status='deleting',updated_at=UTC_TIMESTAMP(3) WHERE id=?", [id]);
    await connection.execute("UPDATE processing_jobs SET status='cancelled',locked_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE document_id=? AND user_id=? AND job_type='process' AND status='queued'", [id, req.user.id]);
    await connection.execute("INSERT INTO processing_jobs (id,document_id,user_id,job_type,status,idempotency_key,max_attempts,created_at,updated_at) VALUES (?,?,?,'delete','queued',?,5,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [jobId, id, req.user.id, `delete:${id}:${jobId}`]);
    return { alreadyDeleting: false };
  });
  if (!result.alreadyDeleting) { try { await enqueueProcessing(jobId); } catch (error) { console.error(JSON.stringify({ level: "warn", code: "DELETE_ENQUEUE_PENDING", jobId, message: error.message })); } }
  res.status(202).json({ success: true, data: { id, status: "deleting" }, message: "Document cleanup has been queued." });
});

export async function failDocumentJob(jobId, errorCode) {
  await transaction(async (connection) => {
    const [jobs] = await connection.execute("SELECT document_id,status FROM processing_jobs WHERE id=? FOR UPDATE", [jobId]);
    if (!jobs.length) return;
    await connection.execute("UPDATE processing_jobs SET status='failed',last_error_code=?,locked_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [errorCode, jobId]);
    if (jobs[0].status !== "completed") await connection.execute("UPDATE documents SET status='failed',error_code=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status NOT IN ('deleted','deleting')", [errorCode, jobs[0].document_id]);
  });
}
