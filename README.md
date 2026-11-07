# AI Document Research Assistant

React/Vite client and Express API for private PDF research. The API and worker use MySQL, Redis/BullMQ, Qdrant, and private local file storage in development. Gemini calls are disabled by default.

## Local setup

Requirements: a currently supported Node.js LTS release, npm, and Docker Compose (or separately running MySQL 8, Redis, and Qdrant services).

1. Copy `.env.example` to `.env` and set a strong, unique `JWT_ACCESS_SECRET` (at least 32 random bytes). In PowerShell, generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
2. Set a MySQL password in `.env`. Use matching values for the local database user/password in `docker-compose.yml`, or configure your own MySQL user and database.
3. Start services with `docker compose up -d mysql redis qdrant`.
4. Install dependencies and apply migrations: `npm install`, then `npm run db:migrate`.
5. Start the API and web app with `npm run dev`. The frontend is at http://localhost:5173 and API at http://localhost:5000/api/v1.
6. Start the document worker in a second terminal with `npm run worker`.

The current PDF processing pipeline requires Gemini for embeddings and answer generation. It is disabled until `ENABLE_GEMINI=true` and a valid `GEMINI_API_KEY` is configured. Provider calls may incur charges; verify current model availability, quotas, privacy terms, and pricing before enabling. The model values in `.env.example` are placeholders and must be checked against official provider documentation. No provider API calls are made by default.

For production, configure private S3-compatible storage, TLS, strict `CLIENT_URL`, production secrets, encrypted backups, and a managed service deployment. Never commit `.env` or expose uploaded PDFs through public URLs.

Run checks with `npm test` and `npm run build`.
