CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  storage_used_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  family_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  replaced_by_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at DATETIME(3) NULL,
  UNIQUE KEY uq_refresh_hash (token_hash),
  KEY ix_refresh_user_active (user_id, revoked_at, expires_at),
  KEY ix_refresh_family (family_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_refresh_replacement FOREIGN KEY (replaced_by_id) REFERENCES refresh_tokens(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS documents (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  page_count SMALLINT UNSIGNED NULL,
  status ENUM('uploaded','queued','processing','ready','failed','deleting','deleted') NOT NULL DEFAULT 'uploaded',
  error_code VARCHAR(80) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_document_storage_key (storage_key),
  UNIQUE KEY uq_documents_id_user (id, user_id),
  KEY ix_documents_user_created (user_id, created_at, id),
  KEY ix_documents_user_status (user_id, status),
  CONSTRAINT fk_documents_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS processing_jobs (
  id CHAR(36) PRIMARY KEY,
  document_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  job_type ENUM('process','delete') NOT NULL,
  status ENUM('queued','active','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
  idempotency_key VARCHAR(160) NOT NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_at DATETIME(3) NULL,
  last_error_code VARCHAR(80) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_jobs_idempotency (idempotency_key),
  KEY ix_jobs_reconcile (status, available_at),
  KEY ix_jobs_user_status (user_id, status),
  CONSTRAINT fk_jobs_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS document_chunks (
  id CHAR(36) PRIMARY KEY,
  document_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  chunk_index INT UNSIGNED NOT NULL,
  page_start SMALLINT UNSIGNED NOT NULL,
  page_end SMALLINT UNSIGNED NOT NULL,
  text MEDIUMTEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_chunks_document_index (document_id, chunk_index),
  UNIQUE KEY uq_chunks_document_id (document_id, id),
  KEY ix_chunks_user_document (user_id, document_id),
  CONSTRAINT fk_chunks_document FOREIGN KEY (document_id, user_id) REFERENCES documents(id, user_id) ON DELETE CASCADE,
  CONSTRAINT fk_chunks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_chunk_pages CHECK (page_start > 0 AND page_end >= page_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS chats (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(200) NOT NULL DEFAULT 'Untitled research',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_chats_id_user (id, user_id),
  KEY ix_chats_user_updated (user_id, updated_at, id),
  CONSTRAINT fk_chats_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS chat_documents (
  chat_id CHAR(36) NOT NULL,
  document_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (chat_id, document_id),
  KEY ix_chat_documents_user (user_id, chat_id),
  CONSTRAINT fk_chat_documents_chat FOREIGN KEY (chat_id, user_id) REFERENCES chats(id, user_id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_documents_document FOREIGN KEY (document_id, user_id) REFERENCES documents(id, user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id CHAR(36) PRIMARY KEY,
  chat_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role ENUM('user','assistant') NOT NULL,
  content MEDIUMTEXT NOT NULL,
  model_name VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_chat_messages_id_user (id, user_id),
  KEY ix_messages_chat_created (chat_id, created_at, id),
  CONSTRAINT fk_messages_chat FOREIGN KEY (chat_id, user_id) REFERENCES chats(id, user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS message_citations (
  id CHAR(36) PRIMARY KEY,
  message_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  document_id CHAR(36) NOT NULL,
  chunk_id CHAR(36) NOT NULL,
  page_start SMALLINT UNSIGNED NOT NULL,
  page_end SMALLINT UNSIGNED NOT NULL,
  excerpt TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_citations_message (message_id, user_id),
  KEY ix_citations_document (document_id, user_id),
  CONSTRAINT fk_citations_message FOREIGN KEY (message_id, user_id) REFERENCES chat_messages(id, user_id) ON DELETE CASCADE,
  CONSTRAINT fk_citations_document FOREIGN KEY (document_id, user_id) REFERENCES documents(id, user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_citations_chunk FOREIGN KEY (document_id, chunk_id) REFERENCES document_chunks(document_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_citation_pages CHECK (page_start > 0 AND page_end >= page_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
