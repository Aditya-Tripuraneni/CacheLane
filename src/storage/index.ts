import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Block, BlockKind, Volatility } from "../types/index.js";

const MIGRATION_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations"
);

const BUILTIN_MIGRATIONS = [
  {
    id: "001_initial",
    sql: `
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
`,
  },
  {
    id: "002_restored_at_turn",
    sql: "ALTER TABLE blocks ADD COLUMN restored_at_turn INTEGER;",
  },
  {
    id: "003_turn_explanations",
    sql: `
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
`,
  },
] as const;

export interface BlockRow {
  id: string;
  workspace_id: string;
  session_id: string;
  content_hash: string;
  kind: BlockKind;
  volatility: Volatility;
  is_pinned: number; // SQLite stores booleans as 0/1; use rowToBlock() to convert
  token_count: number;
  added_at_turn: number;
  last_referenced_at_turn: number;
  unused_turns: number;
  is_stub: number;
  stub_summary: string | null;
  refetch_handle: string | null;
  restored_at_turn: number | null;
  created_at: number;
  updated_at: number;
}

export function rowToBlock(row: BlockRow): Block {
  return {
    ...row,
    is_pinned: row.is_pinned === 1,
    is_stub: row.is_stub === 1,
  };
}

export interface TurnRow {
  id: string;
  workspace_id: string;
  session_id: string;
  turn_number: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  cache_read_tokens: number;
  effective_cost_units: number;
  prefix_breakpoint_hash: string | null;
  middle_breakpoint_hash: string | null;
  pruned_blocks_count: number;
  keepalive_pings_since_last_turn: number;
  created_at: number;
}

// Storage params mirror the row shape (snake_case, per CLAUDE.md naming
// invariant). Booleans are still ergonomic in TS — adapter below converts
// is_pinned / is_stub to SQLite's 0/1 ints at the boundary.
export interface InsertBlockParams {
  id: string;
  workspace_id: string;
  session_id: string;
  content_hash: string;
  kind: string;
  volatility: string;
  is_pinned: boolean;
  token_count: number;
  added_at_turn: number;
  last_referenced_at_turn: number;
  unused_turns: number;
  is_stub: boolean;
  stub_summary: string | null;
  refetch_handle: string | null;
  restored_at_turn?: number | null;
  created_at: number;
  updated_at: number;
}

export interface InsertTurnParams {
  id: string;
  workspace_id: string;
  session_id: string;
  turn_number: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  cache_read_tokens: number;
  effective_cost_units: number;
  prefix_breakpoint_hash: string | null;
  middle_breakpoint_hash: string | null;
  pruned_blocks_count: number;
  keepalive_pings_since_last_turn: number;
  created_at: number;
}

export interface BlockReferenceRow {
  id: number;
  block_id: string;
  turn_id: string;
  reference_type: string;
  evidence: string;
  created_at: number;
}

export interface TurnExplanationUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  cache_read_tokens: number;
  effective_cost_units: number;
}

export interface TurnExplanationPruneDecision {
  block_id: string;
  action: string;
  reason: string;
  kind: BlockKind;
  stub_summary: string | null;
  has_refetch_handle: boolean;
}

export interface TurnExplanationBlockMetadata {
  block_id: string;
  message_index: number;
  content_index: number;
  kind: BlockKind;
  volatility: Volatility;
  is_pinned: boolean;
  is_stub?: boolean;
  has_refetch_handle: boolean;
  restored_at_turn?: number | null;
}

export interface TurnExplanationRegionMetadata {
  message_count: number;
  stable_count: number;
  semi_count: number;
  volatile_count: number;
}

export interface InsertTurnExplanationParams {
  turn_id: string;
  workspace_id: string;
  session_id: string;
  turn_number: number;
  model: string;
  prefix_breakpoint_hash: string | null;
  middle_breakpoint_hash: string | null;
  mutated: boolean;
  pruned_blocks_count: number;
  prune_decisions: TurnExplanationPruneDecision[];
  block_metadata: TurnExplanationBlockMetadata[];
  region_metadata: TurnExplanationRegionMetadata;
  signals: string[];
  usage?: Partial<TurnExplanationUsage>;
  created_at: number;
  updated_at: number;
}

export interface TurnExplanationRow {
  id: number;
  turn_id: string;
  workspace_id: string;
  session_id: string;
  turn_number: number;
  model: string;
  prefix_breakpoint_hash: string | null;
  middle_breakpoint_hash: string | null;
  mutated: number;
  pruned_blocks_count: number;
  prune_decisions_json: string;
  block_metadata_json: string;
  region_metadata_json: string;
  signals_json: string;
  usage_input_tokens: number;
  usage_output_tokens: number;
  usage_cache_creation_5m_tokens: number;
  usage_cache_creation_1h_tokens: number;
  usage_cache_read_tokens: number;
  usage_effective_cost_units: number;
  created_at: number;
  updated_at: number;
}

export interface TurnExplanationRecord {
  id: number;
  turn_id: string;
  workspace_id: string;
  session_id: string;
  turn_number: number;
  model: string;
  prefix_breakpoint_hash: string | null;
  middle_breakpoint_hash: string | null;
  mutated: boolean;
  pruned_blocks_count: number;
  prune_decisions: TurnExplanationPruneDecision[];
  block_metadata: TurnExplanationBlockMetadata[];
  region_metadata: TurnExplanationRegionMetadata;
  signals: string[];
  usage: TurnExplanationUsage;
  created_at: number;
  updated_at: number;
}

export type StatsScope = "session" | "workspace" | "all";

export interface GetStatsParams {
  scope: StatsScope;
  workspace_id?: string;
  session_id?: string;
  since_ms?: number;
}

export interface CachelaneStats {
  scope: StatsScope;
  workspace_id: string | null;
  session_id: string | null;
  since_ms: number | null;
  turns: number;
  cache_hit_ratio: number;
  effective_cost_units: number;
  baseline_cost_units: number;
  savings_ratio: number;
  pruner_counts: {
    pruned_blocks: number;
    turns_with_pruning: number;
  };
  keepalive_counts: {
    pings: number;
    turns_with_keepalive: number;
  };
}

export interface GetTurnExplanationParams {
  workspace_id?: string;
  session_id?: string;
  turn_number?: number;
}

export interface GetRecentTurnParams {
  workspace_id?: string;
  session_id?: string;
}

export interface UpdateTurnUsageParams {
  turn_id: string;
  workspace_id: string;
  session_id: string;
  turn_number: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  cache_read_tokens: number;
  effective_cost_units: number;
  updated_at: number;
}

// id is AUTOINCREMENT; caller does not supply it.
export interface InsertBlockReferenceParams {
  block_id: string;
  turn_id: string;
  reference_type: string;
  evidence: string;
  created_at: number;
}

export interface GetPrunableBlocksParams {
  workspace_id: string;
  session_id: string;
  k: number;
}

export interface GetBlocksByIdPrefixParams {
  workspace_id: string;
  session_id: string;
  block_id_prefix: string;
}

export interface RestoreStubParams {
  workspace_id: string;
  session_id: string;
  block_id: string;
  turn_number: number;
  updated_at: number;
}

export interface CachelaneDb extends Database.Database {
  insertBlock(params: InsertBlockParams): void;
  getBlock(id: string): BlockRow | null;
  getPrunableBlocks(params: GetPrunableBlocksParams): BlockRow[];
  getBlocksByIdPrefix(params: GetBlocksByIdPrefixParams): BlockRow[];
  incrementUnusedTurns(id: string, updatedAt: number): void;
  resetUnusedTurns(id: string, lastReferencedAtTurn: number, updatedAt: number): void;
  getBlocksBySession(workspaceId: string, sessionId: string): BlockRow[];
  markStub(
    id: string,
    refetchHandle: string,
    stubSummary: string | null,
    updatedAt: number
  ): void;
  restoreStub(params: RestoreStubParams): void;
  insertTurn(params: InsertTurnParams): void;
  getTurn(id: string): TurnRow | null;
  getRecentTurn(params?: GetRecentTurnParams): TurnRow | null;
  getTurnByNumber(workspaceId: string, sessionId: string, turnNumber: number): TurnRow | null;
  updateTurnUsage(params: UpdateTurnUsageParams): void;
  insertBlockReference(params: InsertBlockReferenceParams): number;
  insertBlockReferences(params: InsertBlockReferenceParams[]): number[];
  getBlockReferencesForTurn(turnId: string): BlockReferenceRow[];
  insertTurnExplanation(params: InsertTurnExplanationParams): void;
  getTurnExplanation(params?: GetTurnExplanationParams): TurnExplanationRecord | null;
  getStats(params: GetStatsParams): CachelaneStats;
  updateBlockCounters(params: UpdateBlockCountersParams): void;
}

export interface UpdateBlockCountersParams {
  workspace_id: string;
  session_id: string;
  turn_number: number;
  referenced_ids: Set<string>;
  updated_at: number;
}

function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    (
      db
        .prepare("SELECT id FROM schema_migrations ORDER BY id")
        .all() as { id: string }[]
    ).map((row) => row.id),
  );
  const insertMigrationStmt = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  );

  const migrations = fs.existsSync(MIGRATION_DIR)
    ? fs
        .readdirSync(MIGRATION_DIR)
        .filter((file) => file.endsWith(".sql"))
        .sort()
        .map((file) => ({
          id: path.basename(file, ".sql"),
          sql: fs.readFileSync(path.join(MIGRATION_DIR, file), "utf-8"),
        }))
    : [...BUILTIN_MIGRATIONS];

  for (const { id, sql } of migrations) {
    if (applied.has(id)) continue;

    const applyOne = db.transaction(() => {
      db.exec(sql);
      insertMigrationStmt.run(id, Date.now());
    });
    applyOne();
  }
}

function tryOpen(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function zeroUsage(): TurnExplanationUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_5m_tokens: 0,
    cache_creation_1h_tokens: 0,
    cache_read_tokens: 0,
    effective_cost_units: 0,
  };
}

function normalizeUsage(
  usage: Partial<TurnExplanationUsage> | undefined,
): TurnExplanationUsage {
  return {
    ...zeroUsage(),
    ...usage,
  };
}

export function calculateEffectiveCostUnits(params: {
  input_tokens: number;
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  cache_read_tokens: number;
}): number {
  return (
    params.input_tokens +
    1.25 * params.cache_creation_5m_tokens +
    2.0 * params.cache_creation_1h_tokens +
    0.1 * params.cache_read_tokens
  );
}

export function rowToTurnExplanation(
  row: TurnExplanationRow,
): TurnExplanationRecord {
  return {
    id: row.id,
    turn_id: row.turn_id,
    workspace_id: row.workspace_id,
    session_id: row.session_id,
    turn_number: row.turn_number,
    model: row.model,
    prefix_breakpoint_hash: row.prefix_breakpoint_hash,
    middle_breakpoint_hash: row.middle_breakpoint_hash,
    mutated: row.mutated === 1,
    pruned_blocks_count: row.pruned_blocks_count,
    prune_decisions: parseJson<TurnExplanationPruneDecision[]>(
      row.prune_decisions_json,
      [],
    ),
    block_metadata: parseJson<TurnExplanationBlockMetadata[]>(
      row.block_metadata_json,
      [],
    ),
    region_metadata: parseJson<TurnExplanationRegionMetadata>(
      row.region_metadata_json,
      {
        message_count: 0,
        stable_count: 0,
        semi_count: 0,
        volatile_count: 0,
      },
    ),
    signals: parseJson<string[]>(row.signals_json, []),
    usage: {
      input_tokens: row.usage_input_tokens,
      output_tokens: row.usage_output_tokens,
      cache_creation_5m_tokens: row.usage_cache_creation_5m_tokens,
      cache_creation_1h_tokens: row.usage_cache_creation_1h_tokens,
      cache_read_tokens: row.usage_cache_read_tokens,
      effective_cost_units: row.usage_effective_cost_units,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function scopedWhere(params: GetStatsParams): {
  sql: string;
  bindings: Record<string, string | number>;
} {
  const clauses: string[] = [];
  const bindings: Record<string, string | number> = {};

  if (params.scope === "session") {
    clauses.push("workspace_id = @workspace_id", "session_id = @session_id");
    bindings.workspace_id = params.workspace_id ?? "";
    bindings.session_id = params.session_id ?? "";
  } else if (params.scope === "workspace") {
    clauses.push("workspace_id = @workspace_id");
    bindings.workspace_id = params.workspace_id ?? "";
  }

  if (params.since_ms !== undefined) {
    clauses.push("created_at >= @since_ms");
    bindings.since_ms = params.since_ms;
  }

  return {
    sql: clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`,
    bindings,
  };
}

function explanationWhere(params?: GetTurnExplanationParams): {
  sql: string;
  bindings: Record<string, string | number>;
} {
  const clauses: string[] = [];
  const bindings: Record<string, string | number> = {};

  if (params?.workspace_id !== undefined) {
    clauses.push("workspace_id = @workspace_id");
    bindings.workspace_id = params.workspace_id;
  }
  if (params?.session_id !== undefined) {
    clauses.push("session_id = @session_id");
    bindings.session_id = params.session_id;
  }
  if (params?.turn_number !== undefined) {
    clauses.push("turn_number = @turn_number");
    bindings.turn_number = params.turn_number;
  }

  return {
    sql: clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`,
    bindings,
  };
}

export function openDatabase(dbPath: string): CachelaneDb {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  let rawDb: Database.Database;
  try {
    rawDb = tryOpen(dbPath);
    const result = rawDb.pragma("integrity_check") as {
      integrity_check: string;
    }[];
    if (result[0].integrity_check !== "ok") {
      rawDb.close();
      throw new Error("integrity_check failed");
    }
  } catch {
    const corruptPath = `${dbPath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(dbPath, corruptPath);
    } catch {
      // ignore if rename fails (e.g. file already gone)
    }
    rawDb = tryOpen(dbPath);
  }

  const insertBlockStmt = rawDb.prepare(`
    INSERT INTO blocks
      (id, workspace_id, session_id, content_hash, kind, volatility,
       is_pinned, token_count, added_at_turn, last_referenced_at_turn,
       unused_turns, is_stub, stub_summary, refetch_handle,
       restored_at_turn, created_at, updated_at)
    VALUES
      (@id, @workspace_id, @session_id, @content_hash, @kind, @volatility,
       @is_pinned, @token_count, @added_at_turn, @last_referenced_at_turn,
       @unused_turns, @is_stub, @stub_summary, @refetch_handle,
       @restored_at_turn, @created_at, @updated_at)
  `);

  const getBlockStmt = rawDb.prepare("SELECT * FROM blocks WHERE id = ?");

  const incrementUnusedTurnsStmt = rawDb.prepare(
    "UPDATE blocks SET unused_turns = unused_turns + 1, updated_at = ? WHERE id = ?"
  );

  const resetUnusedTurnsStmt = rawDb.prepare(
    "UPDATE blocks SET unused_turns = 0, last_referenced_at_turn = ?, updated_at = ? WHERE id = ?"
  );

  const getBlocksBySessionStmt = rawDb.prepare(
    "SELECT * FROM blocks WHERE workspace_id = ? AND session_id = ?"
  );

  const markStubStmt = rawDb.prepare(
    "UPDATE blocks SET is_stub = 1, refetch_handle = ?, stub_summary = ?, restored_at_turn = NULL, updated_at = ? WHERE id = ?"
  );

  const restoreStubStmt = rawDb.prepare(`
    UPDATE blocks
    SET is_stub = 0,
        unused_turns = 0,
        last_referenced_at_turn = @turn_number,
        restored_at_turn = @turn_number,
        updated_at = @updated_at
    WHERE workspace_id = @workspace_id
      AND session_id = @session_id
      AND id = @block_id
  `);

  const getPrunableBlocksStmt = rawDb.prepare(`
    SELECT * FROM blocks
    WHERE workspace_id = @workspace_id
      AND session_id = @session_id
      AND unused_turns >= @k
      AND is_stub = 0
      AND is_pinned = 0
      AND volatility != 'STABLE'
      AND refetch_handle IS NOT NULL
    ORDER BY added_at_turn ASC, id ASC
  `);

  const getBlocksByIdPrefixStmt = rawDb.prepare(`
    SELECT * FROM blocks
    WHERE workspace_id = @workspace_id
      AND session_id = @session_id
      AND substr(id, 1, length(@block_id_prefix)) = @block_id_prefix
    ORDER BY id ASC
  `);

  const insertTurnStmt = rawDb.prepare(`
    INSERT INTO turns
      (id, workspace_id, session_id, turn_number, model,
       input_tokens, output_tokens,
       cache_creation_5m_tokens, cache_creation_1h_tokens, cache_read_tokens,
       effective_cost_units, prefix_breakpoint_hash, middle_breakpoint_hash,
       pruned_blocks_count, keepalive_pings_since_last_turn, created_at)
    VALUES
      (@id, @workspace_id, @session_id, @turn_number, @model,
       @input_tokens, @output_tokens,
       @cache_creation_5m_tokens, @cache_creation_1h_tokens, @cache_read_tokens,
       @effective_cost_units, @prefix_breakpoint_hash, @middle_breakpoint_hash,
       @pruned_blocks_count, @keepalive_pings_since_last_turn, @created_at)
  `);

  const getTurnStmt = rawDb.prepare("SELECT * FROM turns WHERE id = ?");

  const getRecentTurnBaseSql = "SELECT * FROM turns";

  const getTurnByNumberStmt = rawDb.prepare(`
    SELECT * FROM turns
    WHERE workspace_id = ?
      AND session_id = ?
      AND turn_number = ?
  `);

  const updateTurnUsageStmt = rawDb.prepare(`
    UPDATE turns
    SET input_tokens = @input_tokens,
        output_tokens = @output_tokens,
        cache_creation_5m_tokens = @cache_creation_5m_tokens,
        cache_creation_1h_tokens = @cache_creation_1h_tokens,
        cache_read_tokens = @cache_read_tokens,
        effective_cost_units = @effective_cost_units
    WHERE id = @turn_id
  `);

  const insertBlockReferenceStmt = rawDb.prepare(`
    INSERT INTO block_references (block_id, turn_id, reference_type, evidence, created_at)
    VALUES (@block_id, @turn_id, @reference_type, @evidence, @created_at)
  `);

  const getBlockReferencesForTurnStmt = rawDb.prepare(
    "SELECT * FROM block_references WHERE turn_id = ? ORDER BY id"
  );

  const insertTurnExplanationStmt = rawDb.prepare(`
    INSERT INTO turn_explanations
      (turn_id, workspace_id, session_id, turn_number, model,
       prefix_breakpoint_hash, middle_breakpoint_hash, mutated,
       pruned_blocks_count, prune_decisions_json, block_metadata_json,
       region_metadata_json, signals_json,
       usage_input_tokens, usage_output_tokens,
       usage_cache_creation_5m_tokens, usage_cache_creation_1h_tokens,
       usage_cache_read_tokens, usage_effective_cost_units,
       created_at, updated_at)
    VALUES
      (@turn_id, @workspace_id, @session_id, @turn_number, @model,
       @prefix_breakpoint_hash, @middle_breakpoint_hash, @mutated,
       @pruned_blocks_count, @prune_decisions_json, @block_metadata_json,
       @region_metadata_json, @signals_json,
       @usage_input_tokens, @usage_output_tokens,
       @usage_cache_creation_5m_tokens, @usage_cache_creation_1h_tokens,
       @usage_cache_read_tokens, @usage_effective_cost_units,
       @created_at, @updated_at)
    ON CONFLICT(workspace_id, session_id, turn_number) DO UPDATE SET
      turn_id = excluded.turn_id,
      model = excluded.model,
      prefix_breakpoint_hash = excluded.prefix_breakpoint_hash,
      middle_breakpoint_hash = excluded.middle_breakpoint_hash,
      mutated = excluded.mutated,
      pruned_blocks_count = excluded.pruned_blocks_count,
      prune_decisions_json = excluded.prune_decisions_json,
      block_metadata_json = excluded.block_metadata_json,
      region_metadata_json = excluded.region_metadata_json,
      signals_json = excluded.signals_json,
      usage_input_tokens = excluded.usage_input_tokens,
      usage_output_tokens = excluded.usage_output_tokens,
      usage_cache_creation_5m_tokens = excluded.usage_cache_creation_5m_tokens,
      usage_cache_creation_1h_tokens = excluded.usage_cache_creation_1h_tokens,
      usage_cache_read_tokens = excluded.usage_cache_read_tokens,
      usage_effective_cost_units = excluded.usage_effective_cost_units,
      updated_at = excluded.updated_at
  `);

  const updateTurnExplanationUsageStmt = rawDb.prepare(`
    UPDATE turn_explanations
    SET turn_id = @turn_id,
        usage_input_tokens = @input_tokens,
        usage_output_tokens = @output_tokens,
        usage_cache_creation_5m_tokens = @cache_creation_5m_tokens,
        usage_cache_creation_1h_tokens = @cache_creation_1h_tokens,
        usage_cache_read_tokens = @cache_read_tokens,
        usage_effective_cost_units = @effective_cost_units,
        updated_at = @updated_at
    WHERE workspace_id = @workspace_id
      AND session_id = @session_id
      AND turn_number = @turn_number
  `);

  rawDb.exec(`
    CREATE TEMP TABLE IF NOT EXISTS cachelane_referenced_ids (
      id TEXT PRIMARY KEY
    )
  `);

  const clearReferencedIdsStmt = rawDb.prepare(
    "DELETE FROM cachelane_referenced_ids"
  );

  const insertReferencedIdStmt = rawDb.prepare(
    "INSERT OR IGNORE INTO cachelane_referenced_ids (id) VALUES (?)"
  );

  const resetReferencedBlocksStmt = rawDb.prepare(`
    UPDATE blocks
    SET unused_turns = 0,
        last_referenced_at_turn = @turn_number,
        updated_at = @updated_at
    WHERE workspace_id = @workspace_id
      AND session_id = @session_id
      AND id IN (SELECT id FROM cachelane_referenced_ids)
  `);

  const incrementEligibleBlocksStmt = rawDb.prepare(`
    UPDATE blocks
    SET unused_turns = unused_turns + 1,
        updated_at = @updated_at
    WHERE workspace_id = @workspace_id
      AND session_id = @session_id
      AND id NOT IN (SELECT id FROM cachelane_referenced_ids)
      AND is_stub = 0
      AND is_pinned = 0
      AND volatility != 'STABLE'
  `);

  const db = rawDb as CachelaneDb;

  db.insertBlock = (p: InsertBlockParams) =>
    void insertBlockStmt.run({
      ...p,
      is_pinned: p.is_pinned ? 1 : 0,
      is_stub: p.is_stub ? 1 : 0,
      restored_at_turn: p.restored_at_turn ?? null,
    });

  db.getBlock = (id: string) =>
    (getBlockStmt.get(id) as BlockRow | undefined) ?? null;

  db.getPrunableBlocks = (p: GetPrunableBlocksParams) =>
    getPrunableBlocksStmt.all(p) as BlockRow[];

  db.getBlocksByIdPrefix = (p: GetBlocksByIdPrefixParams) =>
    getBlocksByIdPrefixStmt.all(p) as BlockRow[];

  db.incrementUnusedTurns = (id: string, updatedAt: number) =>
    void incrementUnusedTurnsStmt.run(updatedAt, id);

  db.resetUnusedTurns = (id: string, lastReferencedAtTurn: number, updatedAt: number) =>
    void resetUnusedTurnsStmt.run(lastReferencedAtTurn, updatedAt, id);

  db.getBlocksBySession = (workspaceId: string, sessionId: string) =>
    getBlocksBySessionStmt.all(workspaceId, sessionId) as BlockRow[];

  db.markStub = (
    id: string,
    refetchHandle: string,
    stubSummary: string | null,
    updatedAt: number
  ) => void markStubStmt.run(refetchHandle, stubSummary, updatedAt, id);

  db.restoreStub = (p: RestoreStubParams) => void restoreStubStmt.run(p);

  db.insertTurn = (p: InsertTurnParams) => void insertTurnStmt.run(p);

  db.getTurn = (id: string) =>
    (getTurnStmt.get(id) as TurnRow | undefined) ?? null;

  db.getRecentTurn = (params: GetRecentTurnParams = {}) => {
    const where = explanationWhere(params);
    const stmt = rawDb.prepare(`
      ${getRecentTurnBaseSql}
      ${where.sql}
      ORDER BY created_at DESC, turn_number DESC, id DESC
      LIMIT 1
    `);
    return (stmt.get(where.bindings) as TurnRow | undefined) ?? null;
  };

  db.getTurnByNumber = (
    workspaceId: string,
    sessionId: string,
    turnNumber: number,
  ) =>
    (getTurnByNumberStmt.get(workspaceId, sessionId, turnNumber) as
      | TurnRow
      | undefined) ?? null;

  db.updateTurnUsage = (p: UpdateTurnUsageParams) => {
    updateTurnUsageStmt.run(p);
    updateTurnExplanationUsageStmt.run(p);
  };

  db.insertBlockReference = (p: InsertBlockReferenceParams): number => {
    const info = insertBlockReferenceStmt.run(p);
    return Number(info.lastInsertRowid);
  };

  db.insertBlockReferences = rawDb.transaction(
    (params: InsertBlockReferenceParams[]): number[] =>
      params.map((p) => {
        const info = insertBlockReferenceStmt.run(p);
        return Number(info.lastInsertRowid);
      }),
  ) as (params: InsertBlockReferenceParams[]) => number[];

  db.getBlockReferencesForTurn = (turnId: string) =>
    getBlockReferencesForTurnStmt.all(turnId) as BlockReferenceRow[];

  db.insertTurnExplanation = (p: InsertTurnExplanationParams) => {
    const usage = normalizeUsage(p.usage);
    insertTurnExplanationStmt.run({
      turn_id: p.turn_id,
      workspace_id: p.workspace_id,
      session_id: p.session_id,
      turn_number: p.turn_number,
      model: p.model,
      prefix_breakpoint_hash: p.prefix_breakpoint_hash,
      middle_breakpoint_hash: p.middle_breakpoint_hash,
      mutated: p.mutated ? 1 : 0,
      pruned_blocks_count: p.pruned_blocks_count,
      prune_decisions_json: stableJson(p.prune_decisions),
      block_metadata_json: stableJson(p.block_metadata),
      region_metadata_json: stableJson(p.region_metadata),
      signals_json: stableJson(p.signals),
      usage_input_tokens: usage.input_tokens,
      usage_output_tokens: usage.output_tokens,
      usage_cache_creation_5m_tokens: usage.cache_creation_5m_tokens,
      usage_cache_creation_1h_tokens: usage.cache_creation_1h_tokens,
      usage_cache_read_tokens: usage.cache_read_tokens,
      usage_effective_cost_units: usage.effective_cost_units,
      created_at: p.created_at,
      updated_at: p.updated_at,
    });
  };

  db.getTurnExplanation = (params: GetTurnExplanationParams = {}) => {
    const where = explanationWhere(params);
    const stmt = rawDb.prepare(`
      SELECT * FROM turn_explanations
      ${where.sql}
      ORDER BY turn_number DESC, created_at DESC, id DESC
      LIMIT 1
    `);
    const row = stmt.get(where.bindings) as TurnExplanationRow | undefined;
    return row === undefined ? null : rowToTurnExplanation(row);
  };

  db.getStats = (params: GetStatsParams): CachelaneStats => {
    const where = scopedWhere(params);
    const stmt = rawDb.prepare(`
      SELECT
        COUNT(*) AS turns,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(cache_creation_5m_tokens), 0) AS cache_creation_5m_tokens,
        COALESCE(SUM(cache_creation_1h_tokens), 0) AS cache_creation_1h_tokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
        COALESCE(SUM(effective_cost_units), 0) AS effective_cost_units,
        COALESCE(SUM(pruned_blocks_count), 0) AS pruned_blocks,
        COALESCE(SUM(CASE WHEN pruned_blocks_count > 0 THEN 1 ELSE 0 END), 0) AS turns_with_pruning,
        COALESCE(SUM(keepalive_pings_since_last_turn), 0) AS keepalive_pings,
        COALESCE(SUM(CASE WHEN keepalive_pings_since_last_turn > 0 THEN 1 ELSE 0 END), 0) AS turns_with_keepalive
      FROM turns
      ${where.sql}
    `);
    const row = stmt.get(where.bindings) as {
      turns: number;
      input_tokens: number;
      cache_creation_5m_tokens: number;
      cache_creation_1h_tokens: number;
      cache_read_tokens: number;
      effective_cost_units: number;
      pruned_blocks: number;
      turns_with_pruning: number;
      keepalive_pings: number;
      turns_with_keepalive: number;
    };
    const baseline =
      row.input_tokens +
      row.cache_creation_5m_tokens +
      row.cache_creation_1h_tokens +
      row.cache_read_tokens;
    const cacheEligible =
      row.input_tokens +
      row.cache_creation_5m_tokens +
      row.cache_creation_1h_tokens +
      row.cache_read_tokens;
    const cacheHitRatio =
      cacheEligible === 0 ? 0 : row.cache_read_tokens / cacheEligible;
    const savingsRatio =
      baseline === 0 ? 0 : (baseline - row.effective_cost_units) / baseline;

    return {
      scope: params.scope,
      workspace_id: params.workspace_id ?? null,
      session_id: params.session_id ?? null,
      since_ms: params.since_ms ?? null,
      turns: row.turns,
      cache_hit_ratio: cacheHitRatio,
      effective_cost_units: row.effective_cost_units,
      baseline_cost_units: baseline,
      savings_ratio: savingsRatio,
      pruner_counts: {
        pruned_blocks: row.pruned_blocks,
        turns_with_pruning: row.turns_with_pruning,
      },
      keepalive_counts: {
        pings: row.keepalive_pings,
        turns_with_keepalive: row.turns_with_keepalive,
      },
    };
  };

  db.updateBlockCounters = rawDb.transaction(
    (p: UpdateBlockCountersParams): void => {
      clearReferencedIdsStmt.run();
      for (const id of p.referenced_ids) {
        insertReferencedIdStmt.run(id);
      }
      resetReferencedBlocksStmt.run(p);
      incrementEligibleBlocksStmt.run(p);
    },
  ) as (p: UpdateBlockCountersParams) => void;

  return db;
}
