import fs from "node:fs";
import path from "node:path";
import type {
  BlockReferenceRow,
  BlockRow,
  CachelaneDb,
  GetBlocksByIdPrefixParams,
  GetPrunableBlocksParams,
  InsertBlockParams,
  InsertBlockReferenceParams,
  InsertTurnParams,
  RestoreStubParams,
  TurnRow,
  UpdateBlockCountersParams,
} from "./types.js";
import { isCorruptionError, tryOpen } from "./recovery.js";

export function openDatabase(dbPath: string): CachelaneDb {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  let rawDb;
  try {
    rawDb = tryOpen(dbPath);
    const result = rawDb.pragma("integrity_check") as {
      integrity_check: string;
    }[];
    if (result[0]?.integrity_check !== "ok") {
      rawDb.close();
      throw new Error("integrity_check failed");
    }
  } catch (err) {
    if (!isCorruptionError(err)) {
      throw err;
    }
    console.error("[cachelane] database corruption detected, recovering", err);
    const corruptPath = `${dbPath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(dbPath, corruptPath);
    } catch (renameErr) {
      console.warn("[cachelane] could not rename corrupt database file", renameErr);
    }
    try {
      rawDb = tryOpen(dbPath);
    } catch (recoveryErr) {
      throw new Error(
        `[cachelane] database recovery failed after corruption: ${String(recoveryErr)}`,
      );
    }
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

  const insertBlockReferenceStmt = rawDb.prepare(`
    INSERT INTO block_references (block_id, turn_id, reference_type, evidence, created_at)
    VALUES (@block_id, @turn_id, @reference_type, @evidence, @created_at)
  `);

  const getBlockReferencesForTurnStmt = rawDb.prepare(
    "SELECT * FROM block_references WHERE turn_id = ? ORDER BY id"
  );

  const resetReferencedBlocksStmt = rawDb.prepare(`
    UPDATE blocks
    SET unused_turns = 0,
        last_referenced_at_turn = @turn_number,
        updated_at = @updated_at
    WHERE workspace_id = @workspace_id
      AND session_id = @session_id
      AND id IN (SELECT value FROM json_each(@ids_json))
  `);

  const incrementEligibleBlocksStmt = rawDb.prepare(`
    UPDATE blocks
    SET unused_turns = unused_turns + 1,
        updated_at = @updated_at
    WHERE workspace_id = @workspace_id
      AND session_id = @session_id
      AND id NOT IN (SELECT value FROM json_each(@ids_json))
      AND is_stub = 0
      AND is_pinned = 0
      AND volatility != 'STABLE'
  `);

  const db = rawDb as unknown as CachelaneDb;

  db.insertBlock = (p: InsertBlockParams) =>
    void insertBlockStmt.run({
      ...p,
      is_pinned: p.is_pinned ? 1 : 0,
      is_stub: p.is_stub ? 1 : 0,
      restored_at_turn: p.restored_at_turn,
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

  db.markStubs = rawDb.transaction(
    (items: Array<{ id: string; workspace_id: string; session_id: string; refetchHandle: string; stubSummary: string | null; updatedAt: number }>) => {
      for (const { id, refetchHandle, stubSummary, updatedAt } of items) {
        markStubStmt.run(refetchHandle, stubSummary, updatedAt, id);
      }
    },
  ) as (items: Array<{ id: string; workspace_id: string; session_id: string; refetchHandle: string; stubSummary: string | null; updatedAt: number }>) => void;

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
      const ids_json = JSON.stringify([...p.referenced_ids]);
      const params = {
        workspace_id: p.workspace_id,
        session_id: p.session_id,
        turn_number: p.turn_number,
        updated_at: p.updated_at,
        ids_json,
      };
      resetReferencedBlocksStmt.run(params);
      incrementEligibleBlocksStmt.run(params);
    },
  ) as (p: UpdateBlockCountersParams) => void;

  return db;
}
