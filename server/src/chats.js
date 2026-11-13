import crypto from "node:crypto";
import { z } from "zod";
import { AppError, asyncHandler } from "./errors.js";
import { query, transaction } from "./db.js";
import { config } from "./config.js";
import { embedText, generateGroundedAnswer } from "./ai.js";
import { searchVectors } from "./vectors.js";

const sessionInput = z.object({ documentIds: z.array(z.string().uuid()).max(20).default([]) });
const questionInput = z.object({ question: z.string().trim().min(2).max(6000), documentIds: z.array(z.string().uuid()).min(1).max(20) });
function cursorDecode(cursor) { try { const [date, id] = Buffer.from(cursor, "base64url").toString().split("|"); return date && id ? { date, id } : null; } catch { return null; } }
function cursorEncode(row) { return Buffer.from(`${new Date(row.updated_at).toISOString()}|${row.id}`).toString("base64url"); }

export function buildChatListQuery(userId, cursor, limit) {
  const pageSize = limit + 1;
  return cursor
    ? { sql: "SELECT id,title,created_at,updated_at FROM chats WHERE user_id=? AND (updated_at<? OR (updated_at=? AND id<?)) ORDER BY updated_at DESC,id DESC LIMIT " + pageSize, params: [userId, cursor.date, cursor.date, cursor.id] }
    : { sql: "SELECT id,title,created_at,updated_at FROM chats WHERE user_id=? ORDER BY updated_at DESC,id DESC LIMIT " + pageSize, params: [userId] };
}

async function validateDocuments(userId, ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const placeholders = unique.map(() => "?").join(",");
  const rows = await query(`SELECT id,original_name,status FROM documents WHERE user_id=? AND status='ready' AND id IN (${placeholders})`, [userId, ...unique]);
  if (rows.length !== unique.length) throw new AppError(422, "DOCUMENTS_NOT_READY", "Choose documents that are ready and belong to your account.");
  return rows;
}

async function setChatDocuments(chatId, userId, documents) {
  await transaction(async (connection) => {
    await connection.execute("DELETE FROM chat_documents WHERE chat_id=? AND user_id=?", [chatId, userId]);
    for (const doc of documents) await connection.execute("INSERT INTO chat_documents (chat_id,document_id,user_id,created_at) VALUES (?,?,?,UTC_TIMESTAMP(3))", [chatId, doc.id, userId]);
  });
}

export const createChat = asyncHandler(async (req, res) => {
  const { documentIds } = sessionInput.parse(req.body || {});
  const docs = await validateDocuments(req.user.id, documentIds);
  const id = crypto.randomUUID();
  await query("INSERT INTO chats (id,user_id,title,created_at,updated_at) VALUES (?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [id, req.user.id, "Untitled research"]);
  await setChatDocuments(id, req.user.id, docs);
  res.status(201).json({ success: true, data: { id, title: "Untitled research", documentIds: docs.map((doc) => doc.id) } });
});

export const listChats = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100); const cursor = cursorDecode(String(req.query.cursor || ""));
  const { sql, params } = buildChatListQuery(req.user.id, cursor, limit);
  const rows = await query(sql, params);
  const more = rows.length > limit; const page = rows.slice(0, limit);
  res.json({ success: true, data: { items: page.map((chat) => ({ id: chat.id, title: chat.title, createdAt: chat.created_at, updatedAt: chat.updated_at })), nextCursor: more ? cursorEncode(page.at(-1)) : null } });
});

export const getChat = asyncHandler(async (req, res) => {
  const chats = await query("SELECT id,title,created_at,updated_at FROM chats WHERE id=? AND user_id=?", [req.params.sessionId, req.user.id]);
  if (!chats.length) throw new AppError(404, "CHAT_NOT_FOUND", "That conversation could not be found.");
  const docs = await query("SELECT document_id FROM chat_documents WHERE chat_id=? AND user_id=?", [req.params.sessionId, req.user.id]);
  const messages = await query("SELECT id,role,content,model_name,created_at FROM chat_messages WHERE chat_id=? AND user_id=? ORDER BY created_at,id LIMIT 200", [req.params.sessionId, req.user.id]);
  const ids = messages.map((message) => message.id);
  const citations = ids.length ? await query(`SELECT mc.message_id,mc.document_id,d.original_name,mc.page_start,mc.page_end,mc.excerpt FROM message_citations mc JOIN documents d ON d.id=mc.document_id WHERE mc.user_id=? AND mc.message_id IN (${ids.map(() => "?").join(",")}) ORDER BY mc.created_at`, [req.user.id, ...ids]) : [];
  const byMessage = new Map(); for (const citation of citations) { const list = byMessage.get(citation.message_id) || []; list.push({ documentId: citation.document_id, documentName: citation.original_name, pageStart: citation.page_start, pageEnd: citation.page_end, excerpt: citation.excerpt }); byMessage.set(citation.message_id, list); }
  res.json({ success: true, data: { id: chats[0].id, title: chats[0].title, documentIds: docs.map((doc) => doc.document_id), messages: messages.map((message) => ({ id: message.id, role: message.role, content: message.content, createdAt: message.created_at, citations: byMessage.get(message.id) || [] })) } });
});

export const renameChat = asyncHandler(async (req, res) => {
  const { title } = z.object({ title: z.string().trim().min(1).max(200) }).parse(req.body);
  const result = await query("UPDATE chats SET title=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND user_id=?", [title, req.params.sessionId, req.user.id]);
  if (!result.affectedRows) throw new AppError(404, "CHAT_NOT_FOUND", "That conversation could not be found.");
  res.json({ success: true, data: { id: req.params.sessionId, title } });
});

export const deleteChat = asyncHandler(async (req, res) => {
  const result = await query("DELETE FROM chats WHERE id=? AND user_id=?", [req.params.sessionId, req.user.id]);
  if (!result.affectedRows) throw new AppError(404, "CHAT_NOT_FOUND", "That conversation could not be found.");
  res.json({ success: true, data: { deleted: true } });
});

export const askQuestion = asyncHandler(async (req, res) => {
  let stage = "validate_request";
  try {
    const { question, documentIds } = questionInput.parse(req.body);
    stage = "validate_documents";
    const docs = await validateDocuments(req.user.id, documentIds);
    stage = "validate_chat";
    const chats = await query("SELECT id FROM chats WHERE id=? AND user_id=?", [req.params.sessionId, req.user.id]);
    if (!chats.length) throw new AppError(404, "CHAT_NOT_FOUND", "That conversation could not be found.");
    await setChatDocuments(req.params.sessionId, req.user.id, docs);
    const userMessageId = crypto.randomUUID();
    return await generateThenPersist(async () => {
      stage = "generate_embedding";
      const vector = await embedText(question);
      stage = "qdrant_retrieval";
      const points = await searchVectors(vector, req.user.id, docs.map((doc) => doc.id), 5);
      const excerpts = points.map((point) => point.payload).filter((payload) => payload && docs.some((doc) => doc.id === payload.documentId) && payload.userId === req.user.id).map((payload) => ({ chunkId: payload.chunkId, documentId: payload.documentId, documentName: payload.documentName, pageStart: payload.pageStart, pageEnd: payload.pageEnd, text: payload.text }));
      if (!excerpts.length) return { answer: "I couldn't find relevant passages in the selected documents. Try another question or select different sources.", insufficientEvidence: true, citations: [] };
      stage = "generate_answer";
      return generateGroundedAnswer(question, excerpts);
    }, (result) => saveAnswer(req, res, userMessageId, question, result, (nextStage) => { stage = nextStage; }));
  } catch (error) {
    if (error && typeof error === "object") error.diagnosticStage = stage;
    throw error;
  }
});

export async function generateThenPersist(generate, persist) {
  const result = await generate();
  await persist(result);
  return result;
}

async function saveAnswer(req, res, userMessageId, question, result, setStage) {
  const answerId = crypto.randomUUID();
  await persistChatTurn({
    transactionFn: transaction,
    chatId: req.params.sessionId,
    userId: req.user.id,
    question,
    userMessageId,
    answerId,
    result,
    modelName: config.aiEnabled ? config.geminiModel : null,
    setStage,
  });
  res.json({ success: true, data: { messageId: answerId, answer: result.answer, citations: result.citations.map(({ chunkId, ...citation }) => citation), insufficientEvidence: result.insufficientEvidence } });
}

export async function persistChatTurn({ transactionFn = transaction, chatId, userId, question, userMessageId, answerId, result, modelName, setStage = () => {} }) {
  await transactionFn(async (connection) => {
    setStage("save_user_message");
    await connection.execute("INSERT INTO chat_messages (id,chat_id,user_id,role,content,created_at) VALUES (?,?,?,'user',?,UTC_TIMESTAMP(3))", [userMessageId, chatId, userId, question]);
    setStage("save_assistant_message");
    await connection.execute("INSERT INTO chat_messages (id,chat_id,user_id,role,content,model_name,created_at) VALUES (?,?,?,'assistant',?,?,UTC_TIMESTAMP(3))", [answerId, chatId, userId, result.answer, modelName]);
    setStage("save_citations");
    for (const citation of result.citations) await connection.execute("INSERT INTO message_citations (id,message_id,user_id,document_id,chunk_id,page_start,page_end,excerpt,created_at) VALUES (?,?,?,?,?,?,?, ?,UTC_TIMESTAMP(3))", [crypto.randomUUID(), answerId, userId, citation.documentId, citation.chunkId, citation.pageStart, citation.pageEnd, citation.excerpt]);
    setStage("save_assistant_message");
    const title = question.slice(0, 78);
    await connection.execute("UPDATE chats SET title=IF(title='Untitled research',?,title),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND user_id=?", [title, chatId, userId]);
  });
}
