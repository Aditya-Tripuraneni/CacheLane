// $ per million input tokens, Anthropic first-party API list prices (cached 2026-10-06).
// `read` (cache-read $/MTok) is listed only where it differs from the default 0.1x of input.
// Haiku 5.5's price is for prompts up to 100K tokens. Bedrock/Vertex pricing differs.
export const PRICES: Record<string, { input: number; read?: number }> = {
  "claude-fable-5-1": { input: 10, read: 0.25 },
  "claude-fable-5": { input: 10 },
  "claude-opus-5-5": { input: 4, read: 0.2 },
  "claude-opus-5": { input: 5 },
  "claude-opus-4-8": { input: 5 },
  "claude-opus-4-7": { input: 5 },
  "claude-opus-4-6": { input: 5 },
  "claude-sonnet-5-5": { input: 2, read: 0.2 },
  "claude-sonnet-5": { input: 2 },
  "claude-sonnet-4-6": { input: 3 },
  "claude-haiku-5-5": { input: 0.1 },
  "claude-haiku-4-5": { input: 1 },
};
