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
  signals: string | null;
  request_mutated: number;
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
  signals?: string | null;
  request_mutated?: number;
  created_at: number;
}

export interface AllocateTurnNumberParams {
  workspace_id: string;
  session_id: string;
  updated_at?: number;
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
  current_turn: number;
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

export interface SessionSummaryRow {
  workspace_id: string;
  session_id: string;
  turns: number;
  cache_hit_ratio: number;
  savings_ratio: number;
  last_active_ms: number;
}

export interface CachelaneDb extends Database.Database {
  listSessions(workspaceId?: string): SessionSummaryRow[];
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
    tokenCount: number,
    updatedAt: number
  ): void;
  markStubs(items: Array<{ id: string; workspace_id: string; session_id: string; refetchHandle: string; stubSummary: string | null; tokenCount: number; updatedAt: number }>): void;
  restoreStub(params: RestoreStubParams): void;
  allocateTurnNumber(params: AllocateTurnNumberParams): number;
  insertTurn(params: InsertTurnParams): void;
  getTurn(id: string): TurnRow | null;
  insertBlockReference(params: InsertBlockReferenceParams): number;
  insertBlockReferences(params: InsertBlockReferenceParams[]): number[];
  getBlockReferencesForTurn(turnId: string): BlockReferenceRow[];
  updateBlockCounters(params: UpdateBlockCountersParams): void;

  // M7/M7B addition
  getRecentTurn(params?: GetRecentTurnParams): TurnRow | null;
  getTurnByNumber(workspaceId: string, sessionId: string, turnNumber: number): TurnRow | null;
  updateTurnUsage(params: UpdateTurnUsageParams): void;
  insertTurnExplanation(params: InsertTurnExplanationParams): void;
  getTurnExplanation(params?: GetTurnExplanationParams): TurnExplanationRecord | null;
  updateTurnExplanationUsage(turnId: string, usage: TurnExplanationUsage, regionCost: RegionCostBreakdown | null, updatedAt: number): void;
  getRecentTurnExplanations(params: GetRecentTurnExplanationsParams): TurnExplanationRecord[];
  getStats(params: GetStatsParams): CachelaneStats;
  recordCompressionEvents(
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
      profile_id?: string;
    }>
  ): void;
  recordCompressionOriginal(params: RecordCompressionOriginalParams): string;
  deleteCompressionOriginal(handle: string): void;
  deleteExpiredCompressionOriginals(nowMs: number): number;
  getCompressionOriginal(params: GetCompressionOriginalParams): CompressionOriginalRow | null;
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
  token_count: number;
}

export interface TurnExplanationRegionMetadata {
  message_count: number;
  stable_count: number;
  semi_count: number;
  volatile_count: number;
}

export type TokenTier = "input" | "cache_read" | "cache_creation" | "cache_creation_5m" | "cache_creation_1h";

export interface RegionCost {
  tokens: number;
  tier: TokenTier;
  cost_units: number;
}

export interface RegionCostBreakdown {
  stable: RegionCost;
  semi: RegionCost;
  volatile: RegionCost;
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
  region_cost?: RegionCostBreakdown;
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
  region_cost_json: string | null;
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
  region_cost: RegionCostBreakdown | null;
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

export interface CompressionEventRow {
  id: string;
  turn_id: string;
  session_id: string;
  workspace_id: string;
  tool_use_id: string;
  content_type: string;
  original_tokens: number;
  compressed_tokens: number;
  tokens_saved: number;
  created_at: number;
}

export interface CompressionOriginalRow {
  handle: string;
  turn_id: string;
  session_id: string;
  workspace_id: string;
  tool_use_id: string;
  content_sha256: string;
  original_text: string;
  original_tokens: number;
  created_at: number;
  expires_at: number | null;
}

export interface RecordCompressionOriginalParams {
  turn_id: string;
  session_id: string;
  workspace_id: string;
  tool_use_id: string;
  content_sha256: string;
  original_text: string;
  original_tokens: number;
  created_at: number;
  expires_at: number | null;
}

export interface GetCompressionOriginalParams {
  handle: string;
  workspace_id: string;
  session_id: string;
  now_ms?: number;
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
  pipeline_fallback_turns: number;
  pruner_counts: {
    pruned_blocks: number;
    turns_with_pruning: number;
  };
  keepalive_counts: {
    pings: number;
    turns_with_keepalive: number;
  };
  compression_counts: {
    compressed_blocks: number;
    tokens_saved: number;
    by_profile: { profile_id: string; tokens_saved: number; compressed_blocks: number }[];
  };
}

export interface GetTurnExplanationParams {
  workspace_id?: string;
  session_id?: string;
  turn_number?: number;
}

export interface GetRecentTurnExplanationsParams {
  workspace_id?: string;
  session_id?: string;
  limit: number;
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
