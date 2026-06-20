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
  AllocateTurnNumberParams,
  RestoreStubParams,
  TurnRow,
  UpdateBlockCountersParams,
  TurnExplanationUsage,
  TurnExplanationPruneDecision,
  TurnExplanationBlockMetadata,
  TurnExplanationRegionMetadata,
  InsertTurnExplanationParams,
  TurnExplanationRow,
  TurnExplanationRecord,
  GetStatsParams,
  CachelaneStats,
  GetTurnExplanationParams,
  GetRecentTurnExplanationsParams,
  GetRecentTurnParams,
  UpdateTurnUsageParams,
  RecordCompressionOriginalParams,
  GetCompressionOriginalParams,
  CompressionOriginalRow,
} from "./types.js";
import { isCorruptionError, tryOpen } from "./recovery.js";
import { ulid } from "ulid";

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
      AND (
        -- Age-based: block has been in context for k+ turns regardless of reference count.
        -- This fires even when Claude Code sends full history on every turn (unused_turns
        -- stays 0 because the block is always "present" in the messages array).
        (@current_turn - added_at_turn) >= @k
        -- Idle-based: block explicitly absent from recent turns (future / response-based tracking).
        OR unused_turns >= @k
      )
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
    INSERT OR IGNORE INTO turns
      (id, workspace_id, session_id, turn_number, model,
       input_tokens, output_tokens,
       cache_creation_5m_tokens, cache_creation_1h_tokens, cache_read_tokens,
       effective_cost_units, prefix_breakpoint_hash, middle_breakpoint_hash,
       pruned_blocks_count, keepalive_pings_since_last_turn, signals, request_mutated, created_at)
    VALUES
      (@id, @workspace_id, @session_id, @turn_number, @model,
       @input_tokens, @output_tokens,
       @cache_creation_5m_tokens, @cache_creation_1h_tokens, @cache_read_tokens,
       @effective_cost_units, @prefix_breakpoint_hash, @middle_breakpoint_hash,
       @pruned_blocks_count, @keepalive_pings_since_last_turn, @signals, @request_mutated, @created_at)
  `);

  const getTurnCounterStmt = rawDb.prepare(`
    SELECT next_turn_number FROM turn_counters
    WHERE workspace_id = ?
      AND session_id = ?
  `);

  const getNextTurnFromExistingTurnsStmt = rawDb.prepare(`
    SELECT COALESCE(MAX(turn_number), 0) + 1 AS next_turn_number
    FROM turns
    WHERE workspace_id = ?
      AND session_id = ?
  `);

  const insertTurnCounterStmt = rawDb.prepare(`
    INSERT INTO turn_counters
      (workspace_id, session_id, next_turn_number, updated_at)
    VALUES
      (@workspace_id, @session_id, @next_turn_number, @updated_at)
  `);

  const updateTurnCounterStmt = rawDb.prepare(`
    UPDATE turn_counters
    SET next_turn_number = @next_turn_number,
        updated_at = @updated_at
    WHERE workspace_id = @workspace_id
      AND session_id = @session_id
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
    SET usage_input_tokens = @input_tokens,
        usage_output_tokens = @output_tokens,
        usage_cache_creation_5m_tokens = @cache_creation_5m_tokens,
        usage_cache_creation_1h_tokens = @cache_creation_1h_tokens,
        usage_cache_read_tokens = @cache_read_tokens,
        usage_effective_cost_units = @effective_cost_units,
        updated_at = @updated_at
    WHERE turn_id = @turn_id
  `);

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

  const insertCompressionEventStmt = rawDb.prepare(`
    INSERT INTO compression_events
      (id, turn_id, session_id, workspace_id, tool_use_id,
       content_type, original_tokens, compressed_tokens, tokens_saved,
       compressor_id, mode, lossiness, outcome, latency_ms, token_model,
       retention_handle, created_at)
    VALUES
      (@id, @turn_id, @session_id, @workspace_id, @tool_use_id,
       @content_type, @original_tokens, @compressed_tokens, @tokens_saved,
       @compressor_id, @mode, @lossiness, @outcome, @latency_ms, @token_model,
       @retention_handle, @created_at)
  `);

  const insertCompressionOriginalStmt = rawDb.prepare(`
    INSERT INTO compression_originals
      (handle, turn_id, session_id, workspace_id, tool_use_id,
       content_sha256, original_text, original_tokens, created_at, expires_at)
    VALUES
      (@handle, @turn_id, @session_id, @workspace_id, @tool_use_id,
       @content_sha256, @original_text, @original_tokens, @created_at, @expires_at)
  `);

  const getCompressionOriginalStmt = rawDb.prepare(`
    SELECT *
    FROM compression_originals
    WHERE handle = @handle
      AND workspace_id = @workspace_id
      AND session_id = @session_id
      AND (expires_at IS NULL OR expires_at >= @now_ms)
  `);

  const deleteCompressionOriginalStmt = rawDb.prepare(`
    DELETE FROM compression_originals
    WHERE handle = @handle
  `);

  const deleteExpiredCompressionOriginalsStmt = rawDb.prepare(`
    DELETE FROM compression_originals
    WHERE expires_at IS NOT NULL
      AND expires_at < @now_ms
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

  db.allocateTurnNumber = rawDb.transaction(
    (p: AllocateTurnNumberParams): number => {
      const updatedAt = p.updated_at ?? Date.now();
      const existing = getTurnCounterStmt.get(
        p.workspace_id,
        p.session_id,
      ) as { next_turn_number: number } | undefined;

      if (existing !== undefined) {
        updateTurnCounterStmt.run({
          workspace_id: p.workspace_id,
          session_id: p.session_id,
          next_turn_number: existing.next_turn_number + 1,
          updated_at: updatedAt,
        });
        return existing.next_turn_number;
      }

      const seeded = getNextTurnFromExistingTurnsStmt.get(
        p.workspace_id,
        p.session_id,
      ) as { next_turn_number: number };
      insertTurnCounterStmt.run({
        workspace_id: p.workspace_id,
        session_id: p.session_id,
        next_turn_number: seeded.next_turn_number + 1,
        updated_at: updatedAt,
      });
      return seeded.next_turn_number;
    },
  ) as (p: AllocateTurnNumberParams) => number;

  db.insertTurn = (p: InsertTurnParams) => void insertTurnStmt.run({
    ...p,
    signals: p.signals ?? null,
    request_mutated: p.request_mutated ?? 0,
  });

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

  db.updateTurnExplanationUsage = (turnId: string, usage: TurnExplanationUsage, updatedAt: number) => {
    updateTurnExplanationUsageStmt.run({
      turn_id: turnId,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_5m_tokens: usage.cache_creation_5m_tokens,
      cache_creation_1h_tokens: usage.cache_creation_1h_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      effective_cost_units: usage.effective_cost_units,
      updated_at: updatedAt,
    });
  };

  db.getTurnExplanation = (params: GetTurnExplanationParams = {}) => {
    const where = explanationWhere(params);
    const stmt = rawDb.prepare(`
      SELECT * FROM turn_explanations
      ${where.sql}
      ORDER BY created_at DESC, turn_number DESC, id DESC
      LIMIT 1
    `);
    const row = stmt.get(where.bindings) as TurnExplanationRow | undefined;
    return row === undefined ? null : rowToTurnExplanation(row);
  };

  db.getRecentTurnExplanations = (params: GetRecentTurnExplanationsParams) => {
    const clauses: string[] = [];
    const bindings: Record<string, string | number> = {};

    if (params.workspace_id !== undefined) {
      clauses.push("workspace_id = @workspace_id");
      bindings.workspace_id = params.workspace_id;
    }
    if (params.session_id !== undefined) {
      clauses.push("session_id = @session_id");
      bindings.session_id = params.session_id;
    }
    bindings.limit = params.limit;

    const sql = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;

    const stmt = rawDb.prepare(`
      SELECT * FROM turn_explanations
      ${sql}
      ORDER BY created_at DESC, turn_number DESC, id DESC
      LIMIT @limit
    `);
    const rows = stmt.all(bindings) as TurnExplanationRow[];
    return rows.map(rowToTurnExplanation);
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
        COALESCE(SUM(CASE WHEN keepalive_pings_since_last_turn > 0 THEN 1 ELSE 0 END), 0) AS turns_with_keepalive,
        COALESCE(SUM(CASE WHEN request_mutated = 0 THEN 1 ELSE 0 END), 0) AS pipeline_fallback_turns
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
      pipeline_fallback_turns: number;
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
      pipeline_fallback_turns: row.pipeline_fallback_turns,
      pruner_counts: {
        pruned_blocks: row.pruned_blocks,
        turns_with_pruning: row.turns_with_pruning,
      },
      keepalive_counts: {
        pings: row.keepalive_pings,
        turns_with_keepalive: row.turns_with_keepalive,
      },
      compression_counts: (() => {
        const compRow = rawDb.prepare(`
          SELECT
            COALESCE(SUM(CASE WHEN tokens_saved > 0 THEN 1 ELSE 0 END), 0) AS compressed_blocks,
            COALESCE(SUM(tokens_saved), 0) AS tokens_saved
          FROM compression_events
          ${where.sql}
        `).get(where.bindings) as { compressed_blocks: number; tokens_saved: number } | undefined;
        return {
          compressed_blocks: compRow?.compressed_blocks ?? 0,
          tokens_saved: compRow?.tokens_saved ?? 0,
        };
      })(),
    };
  };

  db.recordCompressionEvents = (
    turnId: string,
    sessionId: string,
    workspaceId: string,
    events: Array<{
      tool_use_id: string;
      content_type: string;
      original_tokens: number;
      compressed_tokens: number;
      tokens_saved: number;
      compressor_id?: string;
      mode?: string;
      lossiness?: string;
      outcome?: string;
      latency_ms?: number;
      token_model?: string;
      retention_handle?: string;
    }>
  ) => {
    const now = Date.now();
    for (const event of events) {
      insertCompressionEventStmt.run({
        id: ulid(),
        turn_id: turnId,
        session_id: sessionId,
        workspace_id: workspaceId,
        tool_use_id: event.tool_use_id,
        content_type: event.content_type,
        original_tokens: event.original_tokens,
        compressed_tokens: event.compressed_tokens,
        tokens_saved: event.tokens_saved,
        compressor_id: event.compressor_id ?? null,
        mode: event.mode ?? null,
        lossiness: event.lossiness ?? null,
        outcome: event.outcome ?? null,
        latency_ms: event.latency_ms ?? null,
        token_model: event.token_model ?? null,
        retention_handle: event.retention_handle ?? null,
        created_at: now,
      });
    }
  };

  db.recordCompressionOriginal = (params: RecordCompressionOriginalParams): string => {
    deleteExpiredCompressionOriginalsStmt.run({ now_ms: params.created_at });
    const handle = `cto_${ulid()}`;
    insertCompressionOriginalStmt.run({
      handle,
      ...params,
    });
    return handle;
  };

  db.deleteCompressionOriginal = (handle: string): void => {
    deleteCompressionOriginalStmt.run({ handle });
  };

  db.deleteExpiredCompressionOriginals = (nowMs: number): number => {
    const result = deleteExpiredCompressionOriginalsStmt.run({ now_ms: nowMs });
    return result.changes;
  };

  db.getCompressionOriginal = (
    params: GetCompressionOriginalParams,
  ): CompressionOriginalRow | null => {
    const row = getCompressionOriginalStmt.get({
      ...params,
      now_ms: params.now_ms ?? Date.now(),
    }) as CompressionOriginalRow | undefined;
    return row ?? null;
  };

  db.listSessions = (workspaceId?: string) => {
    const sql = workspaceId
      ? `SELECT workspace_id, session_id,
               COUNT(*) AS turns,
               COALESCE(SUM(cache_read_tokens), 0) AS cache_read,
               COALESCE(SUM(input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens + cache_read_tokens), 0) AS baseline,
               COALESCE(SUM(effective_cost_units), 0) AS effective,
               MAX(created_at) AS last_active_ms
         FROM turns WHERE workspace_id = ?
         GROUP BY workspace_id, session_id
         ORDER BY last_active_ms DESC`
      : `SELECT workspace_id, session_id,
               COUNT(*) AS turns,
               COALESCE(SUM(cache_read_tokens), 0) AS cache_read,
               COALESCE(SUM(input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens + cache_read_tokens), 0) AS baseline,
               COALESCE(SUM(effective_cost_units), 0) AS effective,
               MAX(created_at) AS last_active_ms
         FROM turns
         GROUP BY workspace_id, session_id
         ORDER BY last_active_ms DESC`;
    const rows = workspaceId
      ? rawDb.prepare(sql).all(workspaceId)
      : rawDb.prepare(sql).all();
    return (rows as Array<{
      workspace_id: string; session_id: string; turns: number;
      cache_read: number; baseline: number; effective: number; last_active_ms: number;
    }>).map((r) => ({
      workspace_id: r.workspace_id,
      session_id: r.session_id,
      turns: r.turns,
      cache_hit_ratio: r.baseline === 0 ? 0 : r.cache_read / r.baseline,
      savings_ratio: r.baseline === 0 ? 0 : (r.baseline - r.effective) / r.baseline,
      last_active_ms: r.last_active_ms,
    }));
  };

  return db;
}
