import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });
const number = (name, fallback) => Number(process.env[name] || fallback);
const refreshTtl = process.env.JWT_REFRESH_EXPIRES_IN || "7d";
const refreshMatch = refreshTtl.match(/^(\d+)d$/);

export function mysqlTlsOptions(enabled, ca) {
  if (!enabled) return undefined;
  return {
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    ...(ca ? { ca: ca.replace(/\\n/g, "\n") } : {}),
  };
}

const mysqlTls = mysqlTlsOptions(process.env.MYSQL_SSL === "true", process.env.MYSQL_SSL_CA || "");

export const config = {
  root,
  env: process.env.NODE_ENV || "development",
  port: number("PORT", 5000),
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  basePath: process.env.API_BASE_PATH || "/api/v1",
  mysql: {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: number("MYSQL_PORT", 3306),
    user: process.env.MYSQL_USER || "research_app",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "ai_document_research_assistant",
    ...(mysqlTls ? { ssl: mysqlTls } : {}),
  },
  accessSecret: process.env.JWT_ACCESS_SECRET || "",
  refreshSecret: process.env.JWT_REFRESH_SECRET || "",
  accessTtl: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  refreshDays: refreshMatch ? Number(refreshMatch[1]) : 7,
  cookieSecure: (process.env.NODE_ENV || "development") === "production",
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  bullPrefix: process.env.BULLMQ_PREFIX || "ai-doc-research",
  qdrantUrl: process.env.QDRANT_URL || "http://127.0.0.1:6333",
  qdrantKey: process.env.QDRANT_API_KEY || "",
  qdrantCollection: process.env.QDRANT_COLLECTION || "documents",
  geminiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  embeddingModel: process.env.EMBEDDING_MODEL || "gemini-embedding-2",
  embeddingDimension: number("EMBEDDING_DIMENSION", 768),
  aiEnabled: process.env.ENABLE_GEMINI === "true",
  storageDriver: process.env.STORAGE_DRIVER || "local",
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || "private-uploads"),
  maxFileBytes: number("MAX_FILE_SIZE_MB", 20) * 1024 * 1024,
  maxPages: number("MAX_PDF_PAGES", 100),
  maxDocuments: number("MAX_DOCUMENTS_PER_USER", 20),
  maxStorageBytes: number("MAX_STORAGE_BYTES_PER_USER", 1_000_000_000),
  maxJobsPerUser: number("MAX_CONCURRENT_JOBS_PER_USER", 2),
  authRate: number("MAX_AUTH_REQUESTS_PER_MINUTE", 10),
  chatRate: number("MAX_CHAT_REQUESTS_PER_MINUTE", 10),
  uploadRate: number("MAX_UPLOAD_REQUESTS_PER_MINUTE", 10),
  trustProxyHops: number("TRUST_PROXY_HOPS", 0),
};
