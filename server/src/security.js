import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { AppError } from "./errors.js";

export const cookieOptions = {
  httpOnly: true,
  secure: config.env === "production" ? true : config.cookieSecure,
  sameSite: config.env === "production" ? "none" : "lax",
  path: "/",
};

export function hashToken(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
export function newToken() { return crypto.randomBytes(48).toString("base64url"); }

export function signAccess(user) {
  if (!config.accessSecret || config.accessSecret.length < 32) throw new AppError(503, "AUTH_NOT_CONFIGURED", "Authentication is not configured. Set a JWT access secret of at least 32 characters.");
  return jwt.sign({ email: user.email }, config.accessSecret, { subject: user.id, expiresIn: config.accessTtl, issuer: "papertrail-api", audience: "papertrail-client" });
}

export function verifyAccess(token) {
  if (!config.accessSecret) throw new AppError(503, "AUTH_NOT_CONFIGURED", "Authentication is not configured.");
  try { return jwt.verify(token, config.accessSecret, { issuer: "papertrail-api", audience: "papertrail-client" }); }
  catch { throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue."); }
}

export function requireCsrf(req, _res, next) {
  const origin = req.get("origin");
  if (origin && origin !== config.clientUrl) return next(new AppError(403, "ORIGIN_NOT_ALLOWED", "This request origin is not allowed."));
  const cookie = req.cookies?.csrfToken;
  const header = req.get("x-csrf-token");
  if (!cookie || !header || cookie.length !== header.length || !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) return next(new AppError(403, "CSRF_INVALID", "Refresh the page and try again."));
  next();
}

export function requireOrigin(req, _res, next) {
  const origin = req.get("origin");
  if (!origin && config.env === "production") return next(new AppError(403, "ORIGIN_REQUIRED", "This request must include an allowed origin."));
  if (origin && origin !== config.clientUrl) return next(new AppError(403, "ORIGIN_NOT_ALLOWED", "This request origin is not allowed."));
  next();
}
