CREATE TABLE IF NOT EXISTS turn_counters (
  workspace_id      TEXT NOT NULL,
  session_id        TEXT NOT NULL,
  next_turn_number  INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, session_id)
);
