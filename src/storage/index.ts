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
  kind: string;
  volatility: string;
  token_count: number;
  content_hash: string;
  unused_turns: number;
  is_stub: number;
  refetch_handle: string | null;
  created_at: number;
  updated_at: number;
}

export interface TurnRow {
  id: string;
  workspace_id: string;
  session_id: string;
  turn_number: number;
  cache_write_short_tokens: number;
  cache_write_long_tokens: number;
  cache_read_tokens: number;
  input_tokens: number;
  effective_cost_units: number;
  prefix_breakpoint_hash: string | null;
  middle_breakpoint_hash: string | null;
  pruned_blocks_count: number;
  keepalive_pings_since_last_turn: number;
  created_at: number;
}

export interface InsertBlockParams {
  id: string;
  workspaceId: string;
  sessionId: string;
  kind: string;
  volatility: string;
  tokenCount: number;
  contentHash: string;
  unusedTurns: number;
  isStub: boolean;
  refetchHandle: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface InsertTurnParams {
  id: string;
  workspaceId: string;
  sessionId: string;
  turnNumber: number;
  cacheWriteShortTokens: number;
  cacheWriteLongTokens: number;
  cacheReadTokens: number;
  inputTokens: number;
  effectiveCostUnits: number;
  prefixBreakpointHash: string | null;
  middleBreakpointHash: string | null;
  prunedBlocksCount: number;
  keepalivePingsSinceLastTurn: number;
  createdAt: number;
}

export interface BlockReferenceRow {
  id: string;
  block_id: string;
  turn_id: string;
  reference_type: string;
}

export interface InsertBlockReferenceParams {
  id: string;
  blockId: string;
  turnId: string;
  referenceType: string;
}

export interface CachelaneDb extends Database.Database {
  insertBlock(params: InsertBlockParams): void;
  getBlock(id: string): BlockRow | null;
  incrementUnusedTurns(id: string, updatedAt: number): void;
  markStub(id: string, refetchHandle: string, updatedAt: number): void;
  insertTurn(params: InsertTurnParams): void;
  getTurn(id: string): TurnRow | null;
  insertBlockReference(params: InsertBlockReferenceParams): void;
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
      // ignore if rename fails
    }
    rawDb = tryOpen(dbPath);
  }

  const insertBlockStmt = rawDb.prepare(`
    INSERT INTO blocks
      (id, workspace_id, session_id, kind, volatility, token_count,
       content_hash, unused_turns, is_stub, refetch_handle, created_at, updated_at)
    VALUES
      (@id, @workspaceId, @sessionId, @kind, @volatility, @tokenCount,
       @contentHash, @unusedTurns, @isStub, @refetchHandle, @createdAt, @updatedAt)
  `);

  const getBlockStmt = rawDb.prepare("SELECT * FROM blocks WHERE id = ?");

  const incrementUnusedTurnsStmt = rawDb.prepare(
    "UPDATE blocks SET unused_turns = unused_turns + 1, updated_at = ? WHERE id = ?"
  );

  const markStubStmt = rawDb.prepare(
    "UPDATE blocks SET is_stub = 1, refetch_handle = ?, updated_at = ? WHERE id = ?"
  );

  const insertTurnStmt = rawDb.prepare(`
    INSERT INTO turns
      (id, workspace_id, session_id, turn_number,
       cache_write_short_tokens, cache_write_long_tokens, cache_read_tokens,
       input_tokens, effective_cost_units, prefix_breakpoint_hash,
       middle_breakpoint_hash, pruned_blocks_count, keepalive_pings_since_last_turn,
       created_at)
    VALUES
      (@id, @workspaceId, @sessionId, @turnNumber,
       @cacheWriteShortTokens, @cacheWriteLongTokens, @cacheReadTokens,
       @inputTokens, @effectiveCostUnits, @prefixBreakpointHash,
       @middleBreakpointHash, @prunedBlocksCount, @keepalivePingsSinceLastTurn,
       @createdAt)
  `);

  const getTurnStmt = rawDb.prepare("SELECT * FROM turns WHERE id = ?");

  const insertBlockReferenceStmt = rawDb.prepare(`
    INSERT INTO block_references (id, block_id, turn_id, reference_type)
    VALUES (@id, @blockId, @turnId, @referenceType)
  `);

  const getBlockReferencesForTurnStmt = rawDb.prepare(
    "SELECT * FROM block_references WHERE turn_id = ?"
  );

  const db = rawDb as CachelaneDb;

  db.insertBlock = (p: InsertBlockParams) =>
    void insertBlockStmt.run({ ...p, isStub: p.isStub ? 1 : 0 });

  db.getBlock = (id: string) =>
    (getBlockStmt.get(id) as BlockRow | undefined) ?? null;

  db.incrementUnusedTurns = (id: string, updatedAt: number) =>
    void incrementUnusedTurnsStmt.run(updatedAt, id);

  db.markStub = (id: string, refetchHandle: string, updatedAt: number) =>
    void markStubStmt.run(refetchHandle, updatedAt, id);

  db.insertTurn = (p: InsertTurnParams) => void insertTurnStmt.run(p);

  db.getTurn = (id: string) =>
    (getTurnStmt.get(id) as TurnRow | undefined) ?? null;

  db.insertBlockReference = (p: InsertBlockReferenceParams) =>
    void insertBlockReferenceStmt.run(p);

  db.getBlockReferencesForTurn = (turnId: string) =>
    getBlockReferencesForTurnStmt.all(turnId) as BlockReferenceRow[];

  return db;
}
