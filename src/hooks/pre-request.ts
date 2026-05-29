import type { Classification } from "../classifier/index.js";
import type { CachelaneConfig } from "../types/index.js";
import type {
  CachelaneDb,
  TurnExplanationBlockMetadata,
  TurnExplanationRegionMetadata,
} from "../storage/index.js";
import {
  materializePrunedBlocks,
  pruneExpiredBlocks,
  type PromptBlockPlacement,
  type PruneDecision,
} from "../pruner/index.js";
import {
  orchestrate,
  type AnthropicMessagesRequest,
  type CacheStateTracker,
  type MutatedRequest,
} from "../orchestrator/index.js";
import { logger } from "../logger/index.js";

export interface PreRequestInput {
  db: CachelaneDb;
  tracker: CacheStateTracker;
  workspace_id: string;
  session_id: string;
  turn_id?: string;
  current_turn: number;
  original_request: AnthropicMessagesRequest;
  message_classifications: Classification[];
  block_placements: PromptBlockPlacement[];
  pruner: CachelaneConfig["pruner"];
  now_ms?: number;
}

export interface PreRequestResult extends MutatedRequest {
  pruned_blocks_count: number;
  prune_decisions: PruneDecision[];
  effective_message_classifications: Classification[];
}

function fallbackResult(input: PreRequestInput): PreRequestResult {
  return {
    request: input.original_request,
    mutated: false,
    prefix_hash: "",
    middle_hash: null,
    signals: ["error:fallback"],
    pruned_blocks_count: 0,
    prune_decisions: [],
    effective_message_classifications: input.message_classifications,
    keepalive_pings_since_last_turn: 0,
  };
}

function applyOneTurnSuffixWarming(
  input: PreRequestInput,
): Classification[] {
  const warmedMessageIndexes = new Set<number>();

  for (const placement of input.block_placements) {
    const row = input.db.getBlock(placement.block_id);
    if (
      row !== null &&
      row.workspace_id === input.workspace_id &&
      row.session_id === input.session_id &&
      row.restored_at_turn === input.current_turn - 1
    ) {
      warmedMessageIndexes.add(placement.message_index);
    }
  }

  if (warmedMessageIndexes.size === 0) {
    return input.message_classifications;
  }

  return input.message_classifications.map((classification, index) => {
    if (!warmedMessageIndexes.has(index)) return classification;
    return {
      ...classification,
      volatility: "VOLATILE",
    };
  });
}

function fallbackTurnId(input: PreRequestInput): string {
  return `${input.workspace_id}:${input.session_id}:${input.current_turn}`;
}

function explainBlockMetadata(
  placements: PromptBlockPlacement[],
): TurnExplanationBlockMetadata[] {
  return placements.map((placement) => ({
    block_id: placement.block_id,
    message_index: placement.message_index,
    content_index: placement.content_index,
    kind: placement.kind,
    volatility: placement.volatility,
    is_pinned: placement.is_pinned,
    has_refetch_handle: placement.refetch_handle !== null,
    restored_at_turn: placement.restored_at_turn ?? null,
  }));
}

function explainRegionMetadata(
  classifications: Classification[],
): TurnExplanationRegionMetadata {
  let stable_count = 0;
  let semi_count = 0;
  let volatile_count = 0;

  for (const classification of classifications) {
    if (classification.volatility === "STABLE") {
      stable_count++;
    } else if (classification.volatility === "SEMI") {
      semi_count++;
    } else {
      volatile_count++;
    }
  }

  return {
    message_count: classifications.length,
    stable_count,
    semi_count,
    volatile_count,
  };
}

function recordExplanation(
  input: PreRequestInput,
  result: PreRequestResult,
): void {
  if (typeof input.db.insertTurnExplanation !== "function") return;

  const now = input.now_ms ?? Date.now();
  try {
    input.db.insertTurnExplanation({
      turn_id: input.turn_id ?? fallbackTurnId(input),
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      turn_number: input.current_turn,
      model: input.original_request.model,
      prefix_breakpoint_hash: result.prefix_hash || null,
      middle_breakpoint_hash: result.middle_hash,
      mutated: result.mutated,
      pruned_blocks_count: result.pruned_blocks_count,
      prune_decisions: result.prune_decisions.map((decision) => ({
        block_id: decision.block_id,
        action: decision.action,
        reason: decision.reason,
        kind: decision.kind,
        stub_summary: decision.stub_summary,
        has_refetch_handle: decision.refetch_handle.length > 0,
      })),
      block_metadata: explainBlockMetadata(input.block_placements),
      region_metadata: explainRegionMetadata(
        result.effective_message_classifications,
      ),
      signals: result.signals,
      created_at: now,
      updated_at: now,
    });
  } catch (err) {
    console.error("[cachelane] pre-request explain log error", err);
  }
}

function recordAndReturnFallback(input: PreRequestInput): PreRequestResult {
  const result = fallbackResult(input);
  recordExplanation(input, result);
  return result;
}

export function handlePreRequest(input: PreRequestInput): PreRequestResult {
  try {
    if (
      !Array.isArray(input.message_classifications) ||
      input.message_classifications.length !==
        input.original_request.messages.length
    ) {
      console.error(
        "[cachelane] pre-request: message_classifications length mismatch — failing open",
        {
          classifications: Array.isArray(input.message_classifications)
            ? input.message_classifications.length
            : typeof input.message_classifications,
          messages: input.original_request.messages.length,
        }
      );
      return recordAndReturnFallback(input);
    }

    const pruneResult = pruneExpiredBlocks(input.db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      k: input.pruner.k,
      current_turn: input.current_turn,
      enabled: input.pruner.enabled,
      now_ms: input.now_ms,
    });

    // Only materialize blocks that have a placement in the current request.
    // Blocks without placements (e.g. they've dropped out of the conversation
    // context) are still marked as stubs in the DB by pruneExpiredBlocks, but
    // the request body can't be mutated for them since there's no content slot
    // to replace.
    const placementIds = new Set(input.block_placements.map((p) => p.block_id));
    const actionableDecisions = pruneResult.decisions.filter((d) =>
      placementIds.has(d.block_id),
    );

    // DEBUG: log pruner decision details to diagnose pruned_blocks_count=0
    if (pruneResult.decisions.length > 0 || input.block_placements.length > 0) {
      logger.info("pruner debug", JSON.stringify({
        session_id: input.session_id,
        turn: input.current_turn,
        k: input.pruner.k,
        decisions: pruneResult.decisions.length,
        placements: input.block_placements.length,
        placementIds: [...placementIds].slice(0, 5),
        decisionIds: pruneResult.decisions.slice(0, 5).map(d => d.block_id),
        actionable: actionableDecisions.length,
      }));
    }

    const requestWithStubs =
      actionableDecisions.length === 0
        ? input.original_request
        : materializePrunedBlocks({
            request: input.original_request,
            decisions: actionableDecisions,
            block_placements: input.block_placements,
          });

    const effectiveClassifications = applyOneTurnSuffixWarming(input);
    const orchestrated = orchestrate(
      {
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        current_turn: input.current_turn,
        message_classifications: effectiveClassifications,
        original_request: requestWithStubs,
      },
      input.tracker,
    );

    const result = {
      ...orchestrated,
      // Only count blocks that were actually materialized (had a placement).
      // Blocks marked as stubs in the DB but absent from the request are
      // already gone from context; they don't reduce the forwarded request.
      pruned_blocks_count: actionableDecisions.length,
      prune_decisions: actionableDecisions,
      effective_message_classifications: effectiveClassifications,
    };
    recordExplanation(input, result);
    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[cachelane] pre-request: pipeline error — failing open", errMsg);
    logger.error("pre-request pipeline error", errMsg, err);
    return recordAndReturnFallback(input);
  }
}
