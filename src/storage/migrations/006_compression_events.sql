CREATE TABLE IF NOT EXISTS compression_events (
  id                TEXT PRIMARY KEY,
  turn_id           TEXT NOT NULL,
  session_id        TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  tool_use_id       TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  original_tokens   INTEGER NOT NULL,
  compressed_tokens INTEGER NOT NULL,
  tokens_saved      INTEGER NOT NULL,
  created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compression_session
  ON compression_events (workspace_id, session_id, created_at);
