CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  volatility TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  unused_turns INTEGER NOT NULL DEFAULT 0,
  is_stub INTEGER NOT NULL DEFAULT 0,
  refetch_handle TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocks_workspace_session
  ON blocks(workspace_id, session_id);

CREATE INDEX IF NOT EXISTS idx_blocks_content_hash
  ON blocks(content_hash);

CREATE INDEX IF NOT EXISTS idx_blocks_unused
  ON blocks(unused_turns) WHERE is_stub = 0;

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  cache_write_short_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_long_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  effective_cost_units REAL NOT NULL,
  prefix_breakpoint_hash TEXT,
  middle_breakpoint_hash TEXT,
  pruned_blocks_count INTEGER NOT NULL DEFAULT 0,
  keepalive_pings_since_last_turn INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, session_id, turn_number)
);

CREATE TABLE IF NOT EXISTS block_references (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL REFERENCES blocks(id),
  turn_id TEXT NOT NULL REFERENCES turns(id),
  reference_type TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_block_references_block_id
  ON block_references(block_id);

CREATE INDEX IF NOT EXISTS idx_block_references_turn_id
  ON block_references(turn_id);
