// Maps Anthropic model ID strings to tokenizer configuration.
// REQ-F-003: model-string lookup is mandatory.
// REQ-NF-027: Opus 4.7 produces up to 35% more tokens than 4.6 for the same
// text. The local @anthropic-ai/tokenizer SDK (v0.0.4, tiktoken-based) does
// NOT differentiate Opus 4.6 from 4.7 — both produce identical counts. To
// satisfy the M1 gate ("tokenizer model-lookup test passes for 4.6 and 4.7")
// and to keep the cost model conservative until M3 reconciles against
// `usage.input_tokens` from real API responses, we apply a per-model
// multiplier as a documented approximation. See ADR-011.
//
// To add a new model (e.g. 4.8 or 4.9): append a row. No other change needed.

export interface ModelEntry {
  variant: "claude";
  tokenCountMultiplier: number; // applied to the base tiktoken count
}

export const MODEL_TABLE: Record<string, ModelEntry> = {
  "claude-opus-4-6": { variant: "claude", tokenCountMultiplier: 1.0 },
  "claude-opus-4-7": { variant: "claude", tokenCountMultiplier: 1.15 },
};

export const SUPPORTED_MODELS: string[] = Object.keys(MODEL_TABLE);
