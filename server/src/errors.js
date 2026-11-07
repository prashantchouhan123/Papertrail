export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function safeDiagnostic(error, requestId) {
  const stages = new Set(["validate_request", "validate_documents", "validate_chat", "save_user_message", "generate_embedding", "qdrant_retrieval", "generate_answer", "save_assistant_message", "save_citations"]);
  const name = typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : "Error";
  const metadata = {};
  if (typeof error?.code === "string" && /^[A-Za-z0-9_]{1,64}$/.test(error.code)) metadata.code = error.code;
  if (Number.isSafeInteger(error?.errno)) metadata.errno = error.errno;
  if (typeof error?.sqlState === "string" && /^[A-Z0-9]{5}$/.test(error.sqlState)) metadata.sqlState = error.sqlState;
  const stackFrames = typeof error?.stack === "string"
    ? error.stack.split("\n").slice(1).filter((frame) => /^\s+at\s/.test(frame) && !/\beval\b/i.test(frame)).slice(0, 12).map((frame) => frame.trim().replace(/([A-Za-z]:\\Users\\)[^\\]+/gi, "$1<redacted>").replace(/(\/home\/)[^/]+/g, "$1<redacted>").slice(0, 300))
    : [];
  return {
    level: "error",
    requestId,
    processId: process.pid,
    stage: stages.has(error?.diagnosticStage) ? error.diagnosticStage : "request_pipeline",
    errorName: name,
    ...metadata,
    stackFrames,
  };
}

export function errorHandler(error, req, res, _next) {
  if (error?.name === "ZodError") return res.status(422).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Check the highlighted fields and try again.", requestId: req.id, details: error.issues?.map((issue) => ({ field: issue.path.join("."), code: issue.code })) } });
  if (error?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ success: false, error: { code: "FILE_TOO_LARGE", message: "This PDF exceeds the 20 MB upload limit.", requestId: req.id } });
  if (error?.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ success: false, error: { code: "INVALID_UPLOAD", message: "Upload one PDF file using the file field.", requestId: req.id } });
  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
  const message = status < 500 ? error.message : "Something went wrong. Please try again.";
  if (status >= 500) console.error(JSON.stringify(safeDiagnostic(error, req.id)));
  res.status(status).json({ success: false, error: { code, message, requestId: req.id, ...(error.details ? { details: error.details } : {}) } });
}
