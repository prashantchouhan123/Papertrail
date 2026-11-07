import { config } from "./config.js";
import { AppError } from "./errors.js";

function sanitizedQdrantError(body) {
  if (!body || typeof body !== "object") return { response: "Non-JSON error response" };
  const status = typeof body.status === "string" ? body.status.slice(0, 120) : undefined;
  const message = typeof body.status?.error === "string" ? body.status.error : typeof body.message === "string" ? body.message : undefined;
  return {
    ...(status ? { qdrantStatus: status } : {}),
    ...(message ? { message: message.replace(/[\r\n\t]+/g, " ").slice(0, 500) } : {}),
  };
}

async function qdrant(path, options = {}) {
  const response = await fetch(`${config.qdrantUrl.replace(/\/$/, "")}${path}`, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(config.qdrantKey ? { "api-key": config.qdrantKey } : {}), ...options.headers } });
  if (!response.ok) {
    const responseBody = await response.text();
    let parsed;
    try { parsed = JSON.parse(responseBody); } catch { parsed = null; }
    console.error(JSON.stringify({ level: "error", code: "QDRANT_HTTP_ERROR", path, httpStatus: response.status, ...sanitizedQdrantError(parsed) }));
    throw new AppError(response.status >= 500 ? 503 : 502, "VECTOR_STORE_UNAVAILABLE", "The vector search service is unavailable.");
  }
  return response.status === 204 ? null : response.json();
}

export async function ensureCollection(dimension) {
  const collection = encodeURIComponent(config.qdrantCollection);
  const existing = await fetch(`${config.qdrantUrl.replace(/\/$/, "")}/collections/${collection}`, { headers: config.qdrantKey ? { "api-key": config.qdrantKey } : {} });
  if (existing.ok) {
    const info = await existing.json();
    const size = info.result?.config?.params?.vectors?.size;
    if (size !== dimension) throw new AppError(503, "VECTOR_DIMENSION_MISMATCH", "The configured Qdrant collection dimension does not match the embedding model.");
    return;
  }
  if (existing.status !== 404) {
    const responseBody = await existing.text();
    let parsed;
    try { parsed = JSON.parse(responseBody); } catch { parsed = null; }
    console.error(JSON.stringify({ level: "error", code: "QDRANT_HTTP_ERROR", path: `/collections/${collection}`, httpStatus: existing.status, ...sanitizedQdrantError(parsed) }));
    throw new AppError(503, "VECTOR_STORE_UNAVAILABLE", "The vector search service is unavailable.");
  }
  await qdrant(`/collections/${collection}`, { method: "PUT", body: JSON.stringify({ vectors: { size: dimension, distance: "Cosine" } }) });
  for (const field of ["userId", "documentId"]) await qdrant(`/collections/${collection}/index`, { method: "PUT", body: JSON.stringify({ field_name: field, field_schema: "keyword" }) });
}

export async function upsertVectors(chunks) {
  if (!chunks.length) return;
  await qdrant(`/collections/${encodeURIComponent(config.qdrantCollection)}/points?wait=true`, { method: "PUT", body: JSON.stringify({ points: chunks.map((chunk) => ({ id: chunk.id, vector: chunk.vector, payload: { userId: chunk.userId, documentId: chunk.documentId, chunkId: chunk.id, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, text: chunk.text, documentName: chunk.documentName } })) }) });
}

export async function searchVectors(vector, userId, documentIds, limit = 5) {
  return qdrant(`/collections/${encodeURIComponent(config.qdrantCollection)}/points/query`, { method: "POST", body: JSON.stringify({ query: vector, limit, with_payload: true, filter: { must: [{ key: "userId", match: { value: userId } }, { key: "documentId", match: { any: documentIds } }] } }) }).then((data) => data.result?.points || []);
}

export async function deleteDocumentVectors(userId, documentId) {
  return qdrant(`/collections/${encodeURIComponent(config.qdrantCollection)}/points/delete?wait=true`, { method: "POST", body: JSON.stringify({ filter: { must: [{ key: "userId", match: { value: userId } }, { key: "documentId", match: { value: documentId } }] } }) });
}
