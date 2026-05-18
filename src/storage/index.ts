import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations"
);

export interface BlockRow {
  id: string;
  workspace_id: string;
  session_id: string;
  content_hash: string;
  kind: string;
  volatility: string;
  is_pinned: number;
  token_count: number;
  added_at_turn: number;
  last_referenced_at_turn: number;
  unused_turns: number;
  is_stub: number;
  stub_summary: string | null;
  refetch_handle: string | null;
  created_at: number;
  updated_at: number;
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

export interface CachelaneDb extends Database.Database {
  insertBlock(params: InsertBlockParams): void;
  getBlock(id: string): BlockRow | null;
  incrementUnusedTurns(id: string, updatedAt: number): void;
  markStub(
    id: string,
    refetchHandle: string,
    stubSummary: string | null,
    updatedAt: number
  ): void;
  insertTurn(params: InsertTurnParams): void;
  getTurn(id: string): TurnRow | null;
  insertBlockReference(params: InsertBlockReferenceParams): number;
  getBlockReferencesForTurn(turnId: string): BlockReferenceRow[];
}

function applyMigrations(db: Database.Database): void {
  const sql = fs.readFileSync(
    path.join(MIGRATION_DIR, "001_initial.sql"),
    "utf-8"
  );
  db.exec(sql);
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
       created_at, updated_at)
    VALUES
      (@id, @workspace_id, @session_id, @content_hash, @kind, @volatility,
       @is_pinned, @token_count, @added_at_turn, @last_referenced_at_turn,
       @unused_turns, @is_stub, @stub_summary, @refetch_handle,
       @created_at, @updated_at)
  `);

  const getBlockStmt = rawDb.prepare("SELECT * FROM blocks WHERE id = ?");

  const incrementUnusedTurnsStmt = rawDb.prepare(
    "UPDATE blocks SET unused_turns = unused_turns + 1, updated_at = ? WHERE id = ?"
  );

  const markStubStmt = rawDb.prepare(
    "UPDATE blocks SET is_stub = 1, refetch_handle = ?, stub_summary = ?, updated_at = ? WHERE id = ?"
  );

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

  const db = rawDb as CachelaneDb;

  db.insertBlock = (p: InsertBlockParams) =>
    void insertBlockStmt.run({
      ...p,
      is_pinned: p.is_pinned ? 1 : 0,
      is_stub: p.is_stub ? 1 : 0,
    });

  db.getBlock = (id: string) =>
    (getBlockStmt.get(id) as BlockRow | undefined) ?? null;

  db.incrementUnusedTurns = (id: string, updatedAt: number) =>
    void incrementUnusedTurnsStmt.run(updatedAt, id);

  db.markStub = (
    id: string,
    refetchHandle: string,
    stubSummary: string | null,
    updatedAt: number
  ) => void markStubStmt.run(refetchHandle, stubSummary, updatedAt, id);

  db.insertTurn = (p: InsertTurnParams) => void insertTurnStmt.run(p);

  db.getTurn = (id: string) =>
    (getTurnStmt.get(id) as TurnRow | undefined) ?? null;

  db.insertBlockReference = (p: InsertBlockReferenceParams): number => {
    const info = insertBlockReferenceStmt.run(p);
    return Number(info.lastInsertRowid);
  };

  db.getBlockReferencesForTurn = (turnId: string) =>
    getBlockReferencesForTurnStmt.all(turnId) as BlockReferenceRow[];

  return db;
}
