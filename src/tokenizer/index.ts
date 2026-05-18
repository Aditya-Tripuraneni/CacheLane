import { countTokens as _countTokens } from "@anthropic-ai/tokenizer";
import { MODEL_TABLE, SUPPORTED_MODELS } from "./model-table.js";

export { SUPPORTED_MODELS } from "./model-table.js";

/**
 * Count tokens in `text` for the given Anthropic model ID. Throws for
 * unknown model IDs so callers can't silently miscost a request (REQ-F-003).
 * Applies a per-model multiplier (see model-table.ts and ADR-011) so 4.6
 * and 4.7 produce distinct counts as the M1 gate requires.
 */
export function countTokens(text: string, modelId: string): number {
  const entry = MODEL_TABLE[modelId];
  if (!entry) {
    throw new Error(
      `unsupported model "${modelId}" — add it to src/tokenizer/model-table.ts. ` +
        `Supported: ${SUPPORTED_MODELS.join(", ")}`
    );
  }
  if (text.length === 0) {
    return 0;
  }
  return Math.round(_countTokens(text) * entry.tokenCountMultiplier);
}
