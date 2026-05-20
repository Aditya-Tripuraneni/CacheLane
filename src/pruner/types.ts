import type { BlockKind, Volatility } from "../types/index.js";

export interface PruneExpiredBlocksParams {
  workspace_id: string;
  session_id: string;
  k: number;
  enabled?: boolean;
  now_ms?: number;
}

export interface PruneDecision {
  block_id: string;
  action: "stubbed";
  reason: string;
  stub_summary: string;
  refetch_handle: string;
  kind: BlockKind;
}

export interface PruneResult {
  pruned_blocks_count: number;
  decisions: PruneDecision[];
}

export interface PromptBlockPlacement {
  block_id: string;
  message_index: number;
  content_index: number;
  kind: BlockKind;
  volatility: Volatility;
  is_pinned: boolean;
  refetch_handle: string | null;
  restored_at_turn?: number | null;
}

export interface MaterializableContentItem {
  type: string;
  cache_control?: unknown;
  [key: string]: unknown;
}

export interface MaterializableMessage {
  content: MaterializableContentItem[];
  [key: string]: unknown;
}

export interface MaterializableRequest {
  messages: MaterializableMessage[];
  [key: string]: unknown;
}

export interface MaterializePrunedBlocksParams<
  TRequest extends MaterializableRequest = MaterializableRequest,
> {
  request: TRequest;
  decisions: PruneDecision[];
  block_placements: PromptBlockPlacement[];
}

export interface ExpandStubParams {
  workspace_id: string;
  session_id: string;
  block_id: string;
  turn_number: number;
  updated_at?: number;
}

export interface TrustedRefetchRequest {
  type: "trusted_refetch";
  refetch_handle: string;
}

export type ExpandStubErrorCode =
  | "invalid_block_id"
  | "missing_block"
  | "ambiguous_prefix"
  | "not_stub"
  | "missing_refetch_handle";

export interface ExpandStubFailure {
  ok: false;
  error: {
    code: ExpandStubErrorCode;
    message: string;
  };
}

export interface ExpandStubSuccess {
  ok: true;
  block_id: string;
  refetch_request: TrustedRefetchRequest;
  stub_summary: string | null;
}

export type ExpandStubResult = ExpandStubSuccess | ExpandStubFailure;

export interface RestoreExpandedBlockParams {
  workspace_id: string;
  session_id: string;
  block_id: string;
  turn_number: number;
  updated_at?: number;
}
