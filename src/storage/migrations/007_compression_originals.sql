CREATE TABLE IF NOT EXISTS compression_originals (
  handle TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  tool_use_id TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  original_text TEXT NOT NULL,
  original_tokens INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_compression_originals_scope
  ON compression_originals (workspace_id, session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_compression_originals_expiry
  ON compression_originals (expires_at);
