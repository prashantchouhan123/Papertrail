import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specs = [
  ["api", path.join(serverDir, "src", "server.js")],
  ["worker", path.join(serverDir, "src", "worker.js")],
];
const children = new Map();
const closed = new Set();
let stopping = false;
let exitCode = 0;
let timeout;

function finishIfClosed() {
  if (closed.size !== specs.length) return;
  clearTimeout(timeout);
  process.exit(exitCode);
}

function stop(signal, code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  console.log(`Stopping API and worker (${signal}).`);
  for (const child of children.values()) {
    if (child && !child.killed && !closed.has(child)) child.kill(signal);
  }
  timeout = setTimeout(() => {
    console.error("Child processes did not stop within 20 seconds; forcing shutdown.");
    for (const child of children.values()) {
      if (child && !closed.has(child)) child.kill("SIGKILL");
    }
  }, 20_000);
  timeout.unref();
  finishIfClosed();
}

for (const [name, entrypoint] of specs) {
  const child = spawn(process.execPath, [entrypoint], {
    cwd: serverDir,
    stdio: "inherit",
    env: process.env,
  });
  children.set(name, child);
  child.on("error", (error) => {
    console.error(`${name} process failed to start: ${error.message}`);
    closed.add(child);
    stop("SIGTERM", 1);
    finishIfClosed();
  });
  child.on("close", (code, signal) => {
    closed.add(child);
    if (!stopping) {
      const result = signal ? `signal ${signal}` : `exit code ${code}`;
      console.error(`${name} exited unexpectedly (${result}); stopping its sibling.`);
      stop("SIGTERM", 1);
    }
    finishIfClosed();
  });
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
