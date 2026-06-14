export interface BilledTokens {
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

// Anthropic Sonnet pricing, dollars per token.
export const SONNET_PRICING = {
  input: 3.0 / 1_000_000,
  cache_read: 0.3 / 1_000_000,
  cache_write: 3.75 / 1_000_000,
} as const;

export function priceUsd(tokens: BilledTokens): number {
  return (
    tokens.input_tokens * SONNET_PRICING.input +
    tokens.cache_read_tokens * SONNET_PRICING.cache_read +
    tokens.cache_creation_tokens * SONNET_PRICING.cache_write
  );
}
