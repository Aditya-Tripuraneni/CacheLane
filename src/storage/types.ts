import Database from "better-sqlite3";
import type { Block, BlockKind, Volatility } from "../types/index.js";

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
  restored_at_turn: number | null;
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

export interface UpdateBlockCountersParams {
  workspace_id: string;
  session_id: string;
  turn_number: number;
  referenced_ids: Set<string>;
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
  markStubs(items: Array<{ id: string; workspace_id: string; session_id: string; refetchHandle: string; stubSummary: string | null; updatedAt: number }>): void;
  restoreStub(params: RestoreStubParams): void;
  insertTurn(params: InsertTurnParams): void;
  getTurn(id: string): TurnRow | null;
  insertBlockReference(params: InsertBlockReferenceParams): number;
  insertBlockReferences(params: InsertBlockReferenceParams[]): number[];
  getBlockReferencesForTurn(turnId: string): BlockReferenceRow[];
  updateBlockCounters(params: UpdateBlockCountersParams): void;
}
