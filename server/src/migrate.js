import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const files = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
try {
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const connection = await pool.getConnection();
    try {
      for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)) await connection.query(statement);
      console.log(`Applied ${file}`);
    } finally { connection.release(); }
  }
} catch (error) {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
} finally { await pool.end(); }
