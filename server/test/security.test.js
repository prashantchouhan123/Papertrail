import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { createUploadLimiter } from "../src/app.js";
import { rotateRefreshToken } from "../src/auth.js";
import { mysqlTlsOptions } from "../src/config.js";
import { pool } from "../src/db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("security hardening regressions", () => {
  it("revokes the whole refresh family when a concurrent refresh detects the rotated token", async () => {
    const statements = [];
    const transactionFn = async (callback) => callback({
      async execute(sql, params) {
        statements.push({ sql, params });
        if (sql.startsWith("SELECT revoked_at")) return [[{ revoked_at: new Date() }]];
        return [{ affectedRows: 1 }];
      },
    });

    const result = await rotateRefreshToken({ id: "token-1", family_id: "family-1" }, { id: "user-1" }, transactionFn);

    assert.deepEqual(result, { reuseDetected: true });
    assert.ok(statements.some(({ sql, params }) => sql.includes("WHERE family_id=?") && params[0] === "family-1"));
    assert.equal(statements.some(({ sql }) => sql.startsWith("INSERT INTO refresh_tokens")), false, "a replay must not issue another token");
  });

  it("rotates an active token without changing the normal success path", async () => {
    const statements = [];
    const transactionFn = async (callback) => callback({
      async execute(sql, params) {
        statements.push({ sql, params });
        if (sql.startsWith("SELECT revoked_at")) return [[{ revoked_at: null }]];
        return [{ affectedRows: 1 }];
      },
    });

    const result = await rotateRefreshToken({ id: "token-1", family_id: "family-1" }, { id: "user-1" }, transactionFn);

    assert.equal(result.reuseDetected, false);
    assert.equal(typeof result.token, "string");
    assert.ok(statements.some(({ sql }) => sql.startsWith("INSERT INTO refresh_tokens")));
    assert.ok(statements.some(({ sql }) => sql.includes("replaced_by_id=?")));
  });

  it("rate limits document uploads by authenticated user before the upload parser runs", async () => {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: "upload-rate-test-user" }; next(); });
    app.post("/upload", createUploadLimiter(2), (_req, res) => res.sendStatus(204));

    await request(app).post("/upload").expect(204);
    await request(app).post("/upload").expect(204);
    const limited = await request(app).post("/upload").expect(429);
    assert.equal(limited.body.error.code, "RATE_LIMITED");
  });

  it("binds development data services to loopback instead of all host interfaces", async () => {
    const compose = await fs.readFile(path.join(root, "docker-compose.yml"), "utf8");

    assert.match(compose, /127\.0\.0\.1:3306:3306/);
    assert.match(compose, /127\.0\.0\.1:6379:6379/);
    assert.match(compose, /127\.0\.0\.1:6333:6333/);
    assert.match(compose, /127\.0\.0\.1:6334:6334/);
  });

  it("supports verified MySQL TLS while leaving local development unchanged by default", () => {
    assert.equal(mysqlTlsOptions(false, "ignored"), undefined);
    assert.deepEqual(mysqlTlsOptions(true, "-----BEGIN CERTIFICATE-----\\ncertificate\\n-----END CERTIFICATE-----"), {
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----",
    });
  });
});

after(async () => { await pool.end(); });
