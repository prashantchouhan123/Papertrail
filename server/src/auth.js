import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { config } from "./config.js";
import { pool, query, transaction } from "./db.js";
import { AppError, asyncHandler } from "./errors.js";
import { cookieOptions, hashToken, newToken, signAccess, verifyAccess, requireCsrf, requireOrigin } from "./security.js";

const credentials = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) });
const registration = credentials.extend({ name: z.string().trim().min(2).max(120), password: z.string().min(10).max(128) });
const cleanUser = ({ id, name, email, created_at }) => ({ id, name, email, createdAt: created_at });
const setRefreshCookie = (res, token) => res.cookie("refreshToken", token, { ...cookieOptions, maxAge: config.refreshDays * 86400_000 });

export const csrfRoute = (_req, res) => {
  const token = crypto.randomBytes(24).toString("base64url");
  res.cookie("csrfToken", token, { httpOnly: false, secure: config.cookieSecure, sameSite: "lax", path: "/", maxAge: 86400_000 });
  res.json({ success: true, data: { csrfToken: token } });
};

export const register = asyncHandler(async (req, res) => {
  const input = registration.parse(req.body);
  const email = input.email.toLowerCase();
  const existing = await query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  if (existing.length) throw new AppError(409, "EMAIL_IN_USE", "An account with this email already exists.");
  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(input.password, 12);
  await query("INSERT INTO users (id,name,email,password_hash,storage_used_bytes,created_at,updated_at) VALUES (?,?,?,?,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [id, input.name, email, passwordHash]);
  const user = { id, name: input.name, email };
  const session = await issueRefresh(user);
  setRefreshCookie(res, session.token);
  res.status(201).json({ success: true, data: { accessToken: signAccess(user), user } });
});

export const login = asyncHandler(async (req, res) => {
  const input = credentials.parse(req.body);
  const rows = await query("SELECT id,name,email,password_hash,created_at FROM users WHERE email = ? LIMIT 1", [input.email.toLowerCase()]);
  if (!rows.length || !(await bcrypt.compare(input.password, rows[0].password_hash))) throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  const user = cleanUser(rows[0]);
  const session = await issueRefresh(user);
  setRefreshCookie(res, session.token);
  res.json({ success: true, data: { accessToken: signAccess(user), user } });
});

async function issueRefresh(user, familyId = crypto.randomUUID()) {
  const token = newToken();
  const id = crypto.randomUUID();
  await query("INSERT INTO refresh_tokens (id,user_id,family_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY),UTC_TIMESTAMP(3))", [id, user.id, familyId, hashToken(token), config.refreshDays]);
  return { token, id, familyId };
}

export const refresh = asyncHandler(async (req, res) => {
  const raw = req.cookies?.refreshToken;
  if (!raw) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  const existing = await query("SELECT rt.*,u.name,u.email FROM refresh_tokens rt JOIN users u ON u.id=rt.user_id WHERE rt.token_hash=? LIMIT 1", [hashToken(raw)]);
  if (!existing.length) { res.clearCookie("refreshToken", cookieOptions); throw new AppError(401, "SESSION_EXPIRED", "Your session has expired. Please sign in again."); }
  const record = existing[0];
  if (record.revoked_at || new Date(record.expires_at) <= new Date()) {
    if (record.revoked_at) await query("UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)) WHERE family_id=?", [record.family_id]);
    res.clearCookie("refreshToken", cookieOptions);
    throw new AppError(401, "SESSION_REUSE_DETECTED", "This session is no longer valid. Please sign in again.");
  }
  const next = newToken(); const nextId = crypto.randomUUID();
  const user = { id: record.user_id, name: record.name, email: record.email };
  await transaction(async (connection) => {
    const [locked] = await connection.execute("SELECT revoked_at FROM refresh_tokens WHERE id=? FOR UPDATE", [record.id]);
    if (!locked.length || locked[0].revoked_at) throw new AppError(401, "SESSION_REUSE_DETECTED", "This session is no longer valid. Please sign in again.");
    await connection.execute("INSERT INTO refresh_tokens (id,user_id,family_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY),UTC_TIMESTAMP(3))", [nextId, user.id, record.family_id, hashToken(next), config.refreshDays]);
    await connection.execute("UPDATE refresh_tokens SET revoked_at=UTC_TIMESTAMP(3),last_used_at=UTC_TIMESTAMP(3),replaced_by_id=? WHERE id=?", [nextId, record.id]);
  });
  setRefreshCookie(res, next);
  res.json({ success: true, data: { accessToken: signAccess(user) } });
});

export const logout = asyncHandler(async (req, res) => {
  const raw = req.cookies?.refreshToken;
  if (raw) await query("UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)) WHERE token_hash=?", [hashToken(raw)]);
  res.clearCookie("refreshToken", cookieOptions);
  res.status(200).json({ success: true, data: { loggedOut: true } });
});

export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  const claims = verifyAccess(token);
  const users = await query("SELECT id,name,email,created_at FROM users WHERE id=? LIMIT 1", [claims.sub]);
  if (!users.length) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  req.user = cleanUser(users[0]);
  next();
});

export const me = asyncHandler(async (req, res) => res.json({ success: true, data: { user: req.user } }));
export { requireCsrf, requireOrigin };
