import type { MutatedRequest, OrchestratorInput } from "./types.js";
import { CacheStateTracker } from "./cache-state-tracker.js";
import { reorder } from "./reorderer.js";
import { placeBreakpoints } from "./breakpoint-placer.js";
import { mutateRequest } from "./request-mutator.js";

export type {
  AnthropicCacheControl,
  AnthropicMessage,
  AnthropicMessageContent,
  AnthropicMessagesRequest,
  AnthropicSystemBlock,
  AnthropicTool,
  Breakpoints,
  Classification,
  MutatedRequest,
  OrchestratorInput,
  RegionBoundaries,
} from "./types.js";

export { CacheStateTracker } from "./cache-state-tracker.js";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function orchestrate(
  input: OrchestratorInput,
  tracker: CacheStateTracker,
): MutatedRequest {
  try {
    const boundaries = reorder(input.message_classifications);
    const prevState = tracker.get(input.workspace_id);
    const breakpoints = placeBreakpoints(
      input.original_request,
      boundaries,
      prevState,
    );
    const mutated = mutateRequest(
      input.original_request,
      boundaries,
      breakpoints,
    );

    const now = Date.now();
    tracker.update(input.workspace_id, {
      workspace_id: input.workspace_id,
      prefix_hash: breakpoints.prefix_hash,
      middle_hash: breakpoints.middle_hash,
      prefix_token_count: 0,
      ttl_class: "5m",
      cached_at_ms: now,
      last_read_at_ms: now,
      expected_expiry_ms: now + FIVE_MINUTES_MS,
    });

    return {
      request: mutated,
      mutated: true,
      prefix_hash: breakpoints.prefix_hash,
      middle_hash: breakpoints.middle_hash,
      signals: ["ok"],
    };
  } catch (err) {
    // orchestrate must never throw; log and fail-open with the unmutated
    // request. M7 will swap console.error for the structured logger so ops
    // can alert on `error:fallback` signal rate. Mirrors the classifier
    // pattern landed in M2 (commit 546b32a).
    console.error("[cachelane] orchestrate error", err);
    return {
      request: input.original_request,
      mutated: false,
      prefix_hash: "",
      middle_hash: null,
      signals: ["error:fallback"],
    };
  }
}
