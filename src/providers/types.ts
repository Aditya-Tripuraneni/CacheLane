export interface NormalizedRequest {
  model: string;
  system: { text: string }[];
  tools: { name: string; schema: unknown }[];
  messages: { role: "user" | "assistant"; content: unknown }[];
  raw: unknown; // original provider body, for lossless denormalize
}

export interface NeutralUsage {
  input: number;
  output: number;
  cacheRead: number;
  // Total cache-write tokens. For tier-less providers (e.g. OpenAI implicit cache)
  // this is the only write figure. For Anthropic it equals cacheWrite5m + cacheWrite1h.
  cacheWrite: number;
  // Anthropic prices cache writes by TTL tier (5m at 1.25x, 1h at 2.0x). These preserve
  // the split so cost math stays lossless; tier-less providers leave them 0.
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export interface CachePolicy {
  tiers: string[];            // [] for implicit-cache providers
  supportsKeepalive: boolean; // false → keepalive worker is a no-op
  // Cache-read price ratio. Anthropic is a flat 0.1x; OpenAI is per-model
  // (gpt-4o 0.5x, gpt-4.1 0.25x, gpt-5+ 0.1x) so this scalar is the weakest
  // (most conservative) factor — use costModel.effectiveUnits(usage, model)
  // for the exact per-model figure.
  discountFactor: number;
}

export interface CostModel {
  // model is optional: tier-less providers whose discount varies by model
  // (OpenAI) use it to pick the right cached-input rate; Anthropic ignores it.
  effectiveUnits(usage: NeutralUsage, model?: string): number;
}

export interface Tokenizer {
  name: string;
  count(text: string, model: string): number;
}

// snake_case here is intentional: these mirror MutatedRequest.prefix_hash /
// middle_hash, an existing API-contract type that crosses the storage boundary.
export interface RegionHashes {
  prefix_hash: string;
  middle_hash: string | null;
}

export interface ProviderAdapter {
  name: string;
  matchRoute(method: string, path: string): boolean;
  normalizeRequest(body: unknown): NormalizedRequest;
  denormalize(normalized: NormalizedRequest): unknown;
  applyCacheHints(normalized: NormalizedRequest, regions: RegionHashes): NormalizedRequest;
  cachePolicy: CachePolicy;
  parseUsage(rawResponse: Buffer, contentType?: string): NeutralUsage | null;
  tokenizer: Tokenizer;
  costModel: CostModel;
}
