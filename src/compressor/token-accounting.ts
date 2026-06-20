import { countTokens } from "../tokenizer/index.js";

export function countCompressionTokens(text: string, modelId?: string): number {
  if (modelId !== undefined) {
    try {
      return countTokens(text, modelId);
    } catch {
      // Fall through to conservative approximation for unknown non-Claude models.
    }
  }

  return Math.ceil(text.length / 4);
}
