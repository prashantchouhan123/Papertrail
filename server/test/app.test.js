import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";

const base = "/api/v1";

describe("API foundation", () => {
  it("serves a liveness response without requiring database credentials", async () => {
    const response = await request(app).get("/health").expect(200);
    assert.equal(response.body.status, "ok");
    assert.ok(response.headers["x-request-id"]);
  });

  it("protects document endpoints when no access token is supplied", async () => {
    const response = await request(app).get(`${base}/documents`).expect(401);
    assert.equal(response.body.error.code, "UNAUTHENTICATED");
    assert.ok(response.body.error.requestId);
  });

  it("rejects an untrusted request origin", async () => {
    const response = await request(app).get(`${base}/auth/csrf`).set("Origin", "https://attacker.invalid").expect(403);
    assert.equal(response.body.error.code, "ORIGIN_NOT_ALLOWED");
  });

  it("requires the CSRF cookie and matching header for login", async () => {
    const response = await request(app).post(`${base}/auth/login`).send({ email: "a@example.com", password: "not-a-real-password" }).expect(403);
    assert.equal(response.body.error.code, "CSRF_INVALID");
  });
});

after(async () => { await pool.end(); });
