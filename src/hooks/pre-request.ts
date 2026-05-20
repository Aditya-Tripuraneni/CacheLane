import type { Classification } from "../classifier/index.js";
import type { CachelaneConfig } from "../types/index.js";
import type { CachelaneDb } from "../storage/index.js";
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

export interface PreRequestInput {
  db: CachelaneDb;
  tracker: CacheStateTracker;
  workspace_id: string;
  session_id: string;
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

export function handlePreRequest(input: PreRequestInput): PreRequestResult {
  try {
    const pruneResult = pruneExpiredBlocks(input.db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      k: input.pruner.k,
      enabled: input.pruner.enabled,
      now_ms: input.now_ms,
    });

    const requestWithStubs =
      pruneResult.decisions.length === 0
        ? input.original_request
        : materializePrunedBlocks({
            request: input.original_request,
            decisions: pruneResult.decisions,
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

    return {
      ...orchestrated,
      pruned_blocks_count: pruneResult.pruned_blocks_count,
      prune_decisions: pruneResult.decisions,
      effective_message_classifications: effectiveClassifications,
    };
  } catch (err) {
    console.error("[cachelane] pre-request error", err);
    return fallbackResult(input);
  }
}
