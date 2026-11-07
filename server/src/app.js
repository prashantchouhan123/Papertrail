import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { checkDatabase } from "./db.js";
import { AppError, asyncHandler, errorHandler } from "./errors.js";
import { authenticate, csrfRoute, login, logout, me, refresh, register, requireCsrf, requireOrigin } from "./auth.js";
import { createDocument, deleteDocument, getDocument, listDocuments, uploadPdf } from "./documents.js";
import { askQuestion, createChat, deleteChat, getChat, listChats, renameChat } from "./chats.js";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.trustProxyHops > 0 ? config.trustProxyHops : false);
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" }, contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'", config.clientUrl, "http://localhost:5000"] } } }));
app.use(cors({ origin: config.clientUrl, credentials: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"] }));
app.use((req, res, next) => { req.id = crypto.randomUUID(); res.setHeader("X-Request-Id", req.id); next(); });
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ status: "ok", service: "papertrail-api", timestamp: new Date().toISOString() }));
app.get("/health/dependencies", asyncHandler(async (_req, res) => {
  const checks = { mysql: "unavailable", redis: "not_checked", qdrant: "not_checked", ai: config.aiEnabled ? "configured" : "disabled" };
  try { await checkDatabase(); checks.mysql = "ok"; } catch { /* Readiness response explains dependency state without leaking details. */ }
  const ready = checks.mysql === "ok";
  res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "degraded", checks });
}));

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 60_000, limit: config.authRate, standardHeaders: "draft-8", legacyHeaders: false, message: { success: false, error: { code: "RATE_LIMITED", message: "Too many sign-in attempts. Please wait and try again." } } });
const chatLimiter = rateLimit({ windowMs: 60_000, limit: config.chatRate, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip), message: { success: false, error: { code: "RATE_LIMITED", message: "Too many research requests. Please wait and try again." } } });
export const createUploadLimiter = (limit = config.uploadRate) => rateLimit({ windowMs: 60_000, limit, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip), message: { success: false, error: { code: "RATE_LIMITED", message: "Too many document uploads. Please wait and try again." } } });
export const uploadLimiter = createUploadLimiter();

router.get("/auth/csrf", requireOrigin, csrfRoute);
router.post("/auth/register", authLimiter, requireOrigin, requireCsrf, register);
router.post("/auth/login", authLimiter, requireOrigin, requireCsrf, login);
router.post("/auth/refresh", requireOrigin, requireCsrf, refresh);
router.post("/auth/logout", requireOrigin, requireCsrf, logout);
router.get("/auth/me", authenticate, me);

router.post("/documents", authenticate, requireOrigin, requireCsrf, uploadLimiter, uploadPdf, createDocument);
router.get("/documents", authenticate, listDocuments);
router.get("/documents/:documentId", authenticate, getDocument);
router.delete("/documents/:documentId", authenticate, requireOrigin, requireCsrf, deleteDocument);

router.post("/chat/sessions", authenticate, requireOrigin, requireCsrf, createChat);
router.get("/chat/sessions", authenticate, listChats);
router.get("/chat/sessions/:sessionId", authenticate, getChat);
router.patch("/chat/sessions/:sessionId", authenticate, requireOrigin, requireCsrf, renameChat);
router.delete("/chat/sessions/:sessionId", authenticate, requireOrigin, requireCsrf, deleteChat);
router.post("/chat/sessions/:sessionId/messages", authenticate, requireOrigin, requireCsrf, chatLimiter, askQuestion);

app.use(config.basePath, router);
app.use((_req, _res, next) => next(new AppError(404, "NOT_FOUND", "This endpoint could not be found.")));
app.use(errorHandler);
