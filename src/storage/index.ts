import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Block, BlockKind, Volatility } from "../types/index.js";

const MIGRATION_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations"
);

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
  markStub(
    id: string,
    refetchHandle: string,
    stubSummary: string | null,
    updatedAt: number
  ): void;
  restoreStub(params: RestoreStubParams): void;
  insertTurn(params: InsertTurnParams): void;
  getTurn(id: string): TurnRow | null;
  insertBlockReference(params: InsertBlockReferenceParams): number;
  insertBlockReferences(params: InsertBlockReferenceParams[]): number[];
  getBlockReferencesForTurn(turnId: string): BlockReferenceRow[];
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

  const files = fs
    .readdirSync(MIGRATION_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const id = path.basename(file, ".sql");
    if (applied.has(id)) continue;

    const sql = fs.readFileSync(path.join(MIGRATION_DIR, file), "utf-8");
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
      AND id LIKE @block_id_prefix || '%'
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

  const insertBlockReferenceStmt = rawDb.prepare(`
    INSERT INTO block_references (block_id, turn_id, reference_type, evidence, created_at)
    VALUES (@block_id, @turn_id, @reference_type, @evidence, @created_at)
  `);

  const getBlockReferencesForTurnStmt = rawDb.prepare(
    "SELECT * FROM block_references WHERE turn_id = ? ORDER BY id"
  );

  const resetReferencedBlockStmt = rawDb.prepare(`
    UPDATE blocks
    SET unused_turns = 0,
        last_referenced_at_turn = ?,
        updated_at = ?
    WHERE workspace_id = ?
      AND session_id = ?
      AND id = ?
  `);

  const incrementEligibleBlockStmt = rawDb.prepare(`
    UPDATE blocks
    SET unused_turns = unused_turns + 1,
        updated_at = ?
    WHERE workspace_id = ?
      AND session_id = ?
      AND id = ?
      AND is_stub = 0
      AND is_pinned = 0
      AND volatility != 'STABLE'
  `);

  const getSessionBlockIdsStmt = rawDb.prepare(`
    SELECT id FROM blocks
    WHERE workspace_id = ?
      AND session_id = ?
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

  db.updateBlockCounters = rawDb.transaction(
    (p: UpdateBlockCountersParams): void => {
      const rows = getSessionBlockIdsStmt.all(p.workspace_id, p.session_id) as {
        id: string;
      }[];
      for (const row of rows) {
        if (p.referenced_ids.has(row.id)) {
          resetReferencedBlockStmt.run(
            p.turn_number,
            p.updated_at,
            p.workspace_id,
            p.session_id,
            row.id,
          );
        } else {
          incrementEligibleBlockStmt.run(
            p.updated_at,
            p.workspace_id,
            p.session_id,
            row.id,
          );
        }
      }
    },
  ) as (p: UpdateBlockCountersParams) => void;

  return db;
}
