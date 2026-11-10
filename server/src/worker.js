import crypto from "node:crypto";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config.js";
import { pool, query, transaction } from "./db.js";
import { contentHash, embedText } from "./ai.js";
import { chunkPages, extractPdf } from "./pdf.js";
import { deletePdf, readPdf } from "./storage.js";
import { deleteDocumentVectors, ensureCollection, upsertVectors } from "./vectors.js";
import { enqueueProcessing } from "./queue.js";
import { externalErrorDetails } from "./external-errors.js";

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function claim(jobId) {
  return transaction(async (connection) => {
    const [jobs] = await connection.execute("SELECT id,document_id,user_id,job_type,status FROM processing_jobs WHERE id=? FOR UPDATE", [jobId]);
    if (!jobs.length || ["completed","cancelled"].includes(jobs[0].status)) return null;
    const job = jobs[0];
    const [users] = await connection.execute("SELECT id FROM users WHERE id=? FOR UPDATE", [job.user_id]);
    if (!users.length) return null;
    const [active] = await connection.execute("SELECT COUNT(*) AS total FROM processing_jobs WHERE user_id=? AND status='active' AND locked_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE)", [job.user_id]);
    const otherActive = Number(active[0].total) - (job.status === "active" ? 1 : 0);
    if (otherActive >= config.maxJobsPerUser) {
      await connection.execute("UPDATE processing_jobs SET status='queued',locked_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [jobId]);
      return { deferred: true };
    }
    const [docs] = await connection.execute("SELECT storage_key,status,original_name FROM documents WHERE id=? AND user_id=? FOR UPDATE", [job.document_id, job.user_id]);
    if (!docs.length) return null;
    if (job.job_type === "process" && ["deleting", "deleted"].includes(docs[0].status)) {
      await connection.execute("UPDATE processing_jobs SET status='cancelled',locked_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [jobId]);
      return null;
    }
    await connection.execute("UPDATE processing_jobs SET status='active',attempts=attempts+1,locked_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=?", [jobId]);
    if (job.job_type === "process") await connection.execute("UPDATE documents SET status='processing',error_code=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status IN ('uploaded','queued','failed','processing')", [job.document_id]);
    return { ...job, ...docs[0] };
  });
}

async function finish(jobId, documentId, userId) {
  await transaction(async (connection) => {
    await connection.execute("UPDATE processing_jobs SET status='completed',locked_at=NULL,last_error_code=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [jobId]);
    await connection.execute("UPDATE documents SET status='ready',error_code=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND user_id=? AND status='processing'", [documentId, userId]);
  });
}

async function cleanDocument(job) {
  const metadata = await query("SELECT storage_key,size_bytes FROM documents WHERE id=? AND user_id=?", [job.document_id, job.user_id]);
  if (!metadata.length) return;
  await deleteDocumentVectors(job.user_id, job.document_id);
  await deletePdf(metadata[0].storage_key);
  await transaction(async (connection) => {
    await connection.execute("DELETE FROM message_citations WHERE document_id=? AND user_id=?", [job.document_id, job.user_id]);
    await connection.execute("DELETE FROM chat_documents WHERE document_id=? AND user_id=?", [job.document_id, job.user_id]);
    await connection.execute("DELETE FROM document_chunks WHERE document_id=? AND user_id=?", [job.document_id, job.user_id]);
    await connection.execute("UPDATE processing_jobs SET status='cancelled',locked_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE document_id=? AND user_id=? AND job_type='process' AND status IN ('queued','active','failed')", [job.document_id, job.user_id]);
    await connection.execute("UPDATE users SET storage_used_bytes=GREATEST(storage_used_bytes-?,0) WHERE id=?", [metadata[0].size_bytes, job.user_id]);
    await connection.execute("UPDATE documents SET status='deleted',deleted_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND user_id=?", [job.document_id, job.user_id]);
    await connection.execute("UPDATE processing_jobs SET status='completed',locked_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [job.id]);
  });
}

async function processDocument(job) {
  const bytes = await readPdf(job.storage_key);
  const parsed = await extractPdf(bytes, config.maxPages);
  const chunks = chunkPages(parsed.pages);
  if (!chunks.length) throw Object.assign(new Error("No usable text was found in this PDF."), { code: "NO_EXTRACTABLE_TEXT" });
  await ensureCollection(config.embeddingDimension);
  const batchSize = 10;
  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const prepared = chunks.slice(offset, offset + batchSize).map((chunk, index) => {
      const chunkIndex = offset + index;
      return { ...chunk, index: chunkIndex, id: stableUuid(`${job.document_id}:${chunkIndex}:${contentHash(chunk.text)}`), contentHash: contentHash(chunk.text), userId: job.user_id, documentId: job.document_id };
    });
    await transaction(async (connection) => {
      for (const chunk of prepared) await connection.execute("INSERT INTO document_chunks (id,document_id,user_id,chunk_index,page_start,page_end,text,content_hash,created_at) VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE text=VALUES(text),content_hash=VALUES(content_hash),page_start=VALUES(page_start),page_end=VALUES(page_end)", [chunk.id, chunk.documentId, chunk.userId, chunk.index, chunk.pageStart, chunk.pageEnd, chunk.text, chunk.contentHash]);
      if (offset === 0) await connection.execute("UPDATE documents SET page_count=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [parsed.pageCount, job.document_id]);
    });
    const embedded = [];
    for (const chunk of prepared) embedded.push({ ...chunk, documentName: job.original_name, vector: await embedText(chunk.text) });
    const [current] = await query("SELECT status FROM documents WHERE id=? AND user_id=?", [job.document_id, job.user_id]);
    if (!current || current.status !== "processing") return;
    await upsertVectors(embedded);
  }
  await finish(job.id, job.document_id, job.user_id);
}

async function handle(jobId) {
  const job = await claim(jobId);
  if (!job || job.deferred) return;
  try {
    if (job.job_type === "delete") await cleanDocument(job);
    else await processDocument(job);
  } catch (error) {
    const code = ["NO_EXTRACTABLE_TEXT", "PDF_PARSE_FAILED", "PAGE_LIMIT_EXCEEDED"].includes(error.code) ? error.code : error.code === "AI_NOT_CONFIGURED" ? "AI_SETUP_REQUIRED" : "PROCESSING_FAILED";
    console.error(JSON.stringify({ level: "error", jobId, documentId: job.document_id, code, ...externalErrorDetails(error) }));
    if (job.job_type === "delete") {
      await query("UPDATE processing_jobs SET status='failed',last_error_code=?,locked_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [code, job.id]);
      await query("UPDATE documents SET status='failed',error_code=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND user_id=? AND status='deleting'", [code, job.document_id, job.user_id]);
    } else {
      await deleteDocumentVectors(job.user_id, job.document_id).catch(() => {});
      await query("DELETE FROM document_chunks WHERE document_id=? AND user_id=?", [job.document_id, job.user_id]).catch(() => {});
      await query("UPDATE processing_jobs SET status='failed',last_error_code=?,locked_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [code, job.id]);
      await query("UPDATE documents SET status='failed',error_code=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status<>'deleting'", [code, job.document_id]);
    }
    if (code === "AI_SETUP_REQUIRED" || ["NO_EXTRACTABLE_TEXT", "PDF_PARSE_FAILED", "PAGE_LIMIT_EXCEEDED"].includes(code)) throw error;
    throw error;
  }
}

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
const worker = new Worker("document-processing", (job) => handle(job.data.jobId), { connection, prefix: config.bullPrefix, concurrency: 1, limiter: { max: 20, duration: 60_000 } });

async function reconcile() {
  await query("UPDATE processing_jobs SET status='queued',locked_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE status='active' AND locked_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE)");
  const rows = await query("SELECT id FROM processing_jobs WHERE status='queued' AND available_at<=UTC_TIMESTAMP(3) ORDER BY created_at LIMIT 100");
  for (const row of rows) await enqueueProcessing(row.id).catch(() => {});
}

await reconcile().catch((error) => console.warn(`Queue recovery will retry when dependencies are ready: ${error.message}`));
const timer = setInterval(() => reconcile().catch((error) => console.warn(`Queue reconciliation failed: ${error.message}`)), 15_000);
timer.unref();
worker.on("ready", () => console.log("Document worker is ready."));
worker.on("failed", (job, error) => console.error(JSON.stringify({ level: "error", code: "QUEUE_JOB_FAILED", jobId: job?.id, ...externalErrorDetails(error) })));
worker.on("error", (error) => console.error(JSON.stringify({ level: "error", code: "WORKER_ERROR", ...externalErrorDetails(error) })));
console.log("Document worker starting; Gemini is disabled unless ENABLE_GEMINI=true.");

async function shutdown() { clearInterval(timer); await worker.close(); await connection.quit(); await pool.end(); process.exit(0); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
