import type { MutatedRequest, OrchestratorInput } from "./types.js";
import { CacheStateTracker } from "./cache-state-tracker.js";
import { findRegionBoundaries } from "./region-boundaries.js";
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
    const boundaries = findRegionBoundaries(input.message_classifications);
    const prevState = tracker.get(input.workspace_id, input.session_id);
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
    tracker.update(input.workspace_id, input.session_id, {
      workspace_id: input.workspace_id,
      prefix_hash: breakpoints.prefix_hash,
      middle_hash: breakpoints.middle_hash,
      prefix_token_count: 0, // TODO(M6): replace with real token count
      ttl_class: "5m", // TODO(M6): derive from token count + config
      cached_at_ms: now,
      last_read_at_ms: now,
      expected_expiry_ms: now + FIVE_MINUTES_MS,
    });

    const didMutate =
      mutated.tools?.at(-1)?.cache_control !== undefined ||
      mutated.system?.at(-1)?.cache_control !== undefined;

    return {
      request: mutated,
      mutated: didMutate,
      prefix_hash: breakpoints.prefix_hash,
      middle_hash: breakpoints.middle_hash,
      signals: breakpoints.include_middle_breakpoint
        ? ["prefix_cached", "middle_cached"]
        : ["prefix_cached"],
    };
  } catch (err) {
    // Fail-open: never let an orchestration error block the model call.
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
