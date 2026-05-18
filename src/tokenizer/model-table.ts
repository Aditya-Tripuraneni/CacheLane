// Maps Anthropic model ID strings to tokenizer configuration.
// REQ-F-003: model-string lookup is mandatory.
// REQ-NF-027: Opus 4.7 produces up to 35% more tokens than 4.6 for same text;
// both entries ensure callers supply the correct model ID before cost accounting.
export const MODEL_TABLE: Record<string, { variant: "claude" }> = {
  "claude-opus-4-6": { variant: "claude" },
  "claude-opus-4-7": { variant: "claude" },
};

export const SUPPORTED_MODELS: string[] = Object.keys(MODEL_TABLE);
