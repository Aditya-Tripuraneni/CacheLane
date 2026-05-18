import { countTokens as _countTokens } from "@anthropic-ai/tokenizer";
import { MODEL_TABLE, SUPPORTED_MODELS } from "./model-table.js";

export { SUPPORTED_MODELS } from "./model-table.js";

/**
 * Count tokens in `text` for the given Anthropic model ID.
 * Throws for unknown model IDs so callers can't silently miscost a request (REQ-F-003).
 */
export function countTokens(text: string, modelId: string): number {
  if (!MODEL_TABLE[modelId]) {
    throw new Error(
      `unsupported model "${modelId}" — add it to src/tokenizer/model-table.ts. ` +
        `Supported: ${SUPPORTED_MODELS.join(", ")}`
    );
  }
  if (text.length === 0) {
    return 0;
  }
  return _countTokens(text);
}
