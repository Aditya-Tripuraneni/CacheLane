CREATE TABLE IF NOT EXISTS blocks (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  kind            TEXT NOT NULL,
  volatility      TEXT NOT NULL,
  is_pinned       INTEGER NOT NULL DEFAULT 0,
  token_count     INTEGER NOT NULL,
  added_at_turn   INTEGER NOT NULL,
  last_referenced_at_turn INTEGER NOT NULL,
  unused_turns    INTEGER NOT NULL DEFAULT 0,
  is_stub         INTEGER NOT NULL DEFAULT 0,
  stub_summary    TEXT,
  refetch_handle  TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocks_session ON blocks(workspace_id, session_id);
CREATE INDEX IF NOT EXISTS idx_blocks_hash    ON blocks(content_hash);
CREATE INDEX IF NOT EXISTS idx_blocks_unused  ON blocks(unused_turns) WHERE is_stub = 0;

CREATE TABLE IF NOT EXISTS turns (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  turn_number     INTEGER NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_creation_5m_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_creation_1h_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens          INTEGER NOT NULL DEFAULT 0,
  effective_cost_units       REAL NOT NULL,
  prefix_breakpoint_hash     TEXT,
  middle_breakpoint_hash     TEXT,
  pruned_blocks_count        INTEGER NOT NULL DEFAULT 0,
  keepalive_pings_since_last_turn INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_session_num
  ON turns(workspace_id, session_id, turn_number);

CREATE TABLE IF NOT EXISTS block_references (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id        TEXT NOT NULL REFERENCES blocks(id),
  turn_id         TEXT NOT NULL REFERENCES turns(id),
  reference_type  TEXT NOT NULL,
  evidence        TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refs_block ON block_references(block_id);
CREATE INDEX IF NOT EXISTS idx_refs_turn  ON block_references(turn_id);
