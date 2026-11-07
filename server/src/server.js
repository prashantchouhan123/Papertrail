import { app } from "./app.js";
import { config } from "./config.js";

const server = app.listen(config.port, () => {
  console.log(`Papertrail API listening on http://localhost:${config.port}${config.basePath}`);
  if (!process.env.MYSQL_PASSWORD) console.warn("MYSQL_PASSWORD is not set. Health checks and public configuration are available; database features require local MySQL configuration.");
});

async function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
