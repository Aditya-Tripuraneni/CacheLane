CREATE TABLE IF NOT EXISTS turn_explanations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id         TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  turn_number     INTEGER NOT NULL,
  model           TEXT NOT NULL,
  prefix_breakpoint_hash TEXT,
  middle_breakpoint_hash TEXT,
  mutated         INTEGER NOT NULL DEFAULT 0,
  pruned_blocks_count INTEGER NOT NULL DEFAULT 0,
  prune_decisions_json TEXT NOT NULL,
  block_metadata_json  TEXT NOT NULL,
  region_metadata_json TEXT NOT NULL,
  signals_json         TEXT NOT NULL,
  usage_input_tokens INTEGER NOT NULL DEFAULT 0,
  usage_output_tokens INTEGER NOT NULL DEFAULT 0,
  usage_cache_creation_5m_tokens INTEGER NOT NULL DEFAULT 0,
  usage_cache_creation_1h_tokens INTEGER NOT NULL DEFAULT 0,
  usage_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  usage_effective_cost_units REAL NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_explanations_session_num
  ON turn_explanations(workspace_id, session_id, turn_number);

CREATE INDEX IF NOT EXISTS idx_turn_explanations_turn_id
  ON turn_explanations(turn_id);

CREATE INDEX IF NOT EXISTS idx_turn_explanations_created
  ON turn_explanations(created_at);
