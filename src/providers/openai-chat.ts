import type { ProviderAdapter, NeutralUsage, NormalizedRequest } from "./types.js";
import { openaiTokenizer } from "../tokenizer/openai.js";

/** Shape of the OpenAI chat `usage` object we read for accounting. */
interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

/**
 * Map an OpenAI chat `usage` object to NeutralUsage. OpenAI has no cache-write
 * tier concept (implicit cache, READ-only billing), so every write figure is 0.
 */
function readUsage(u: OpenAIUsage): NeutralUsage {
  return {
    input: u.prompt_tokens ?? 0,
    output: u.completion_tokens ?? 0,
    cacheRead: u.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWrite: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
  };
}

function hasUsage(v: unknown): v is { usage?: OpenAIUsage } {
  return typeof v === "object" && v !== null;
}

function parseOpenAIChatUsage(raw: Buffer, contentType?: string): NeutralUsage | null {
  const text = raw.toString("utf-8");

  // Streaming: when stream_options.include_usage is set, OpenAI emits a final
  // SSE chunk carrying `usage` (earlier chunks carry usage:null). Take the last
  // data: line that actually carries a usage object.
  if (contentType?.includes("event-stream")) {
    let last: NeutralUsage | null = null;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const e: unknown = JSON.parse(payload);
        if (hasUsage(e) && e.usage) last = readUsage(e.usage);
      } catch {
        /* skip malformed chunk */
      }
    }
    return last;
  }

  try {
    const j: unknown = JSON.parse(text);
    return hasUsage(j) && j.usage ? readUsage(j.usage) : null;
  } catch {
    return null;
  }
}

/**
 * Recursively sort object keys so logically-identical structures serialize
 * byte-identically. Arrays preserve order (semantic), objects get alphabetized
 * keys. Used only on the `tools` array to keep OpenAI exact-prefix cache matching
 * stable across reorderings of tool-schema keys.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortKeysDeep(v);
    return out;
  }
  return value;
}

/**
 * Per-model cached-input discount (cached price ÷ uncached input price), sourced
 * from OpenAI's per-model pricing pages (developers.openai.com, 2026-06):
 *   gpt-4o  $2.50 →$1.25  = 0.5x
 *   gpt-4.1 $2.00 →$0.50  = 0.25x
 *   gpt-5+  $1.25 →$0.125 = 0.1x  (90% off — the documented headline max)
 * Matched longest-prefix so family variants (-mini, -pro, dated suffixes) inherit
 * the family rate. Unknown models fall back to the WEAKEST discount (0.5x) so we
 * never overstate cache savings for a model we haven't priced.
 */
const OPENAI_CACHED_DISCOUNTS: ReadonlyArray<readonly [string, number]> = [
  ["gpt-5", 0.1],
  ["gpt-4.1", 0.25],
  ["gpt-4o", 0.5],
];
const OPENAI_DEFAULT_DISCOUNT = 0.5;

export function openaiCachedDiscount(model: string): number {
  for (const [prefix, factor] of OPENAI_CACHED_DISCOUNTS) {
    if (model.startsWith(prefix)) return factor;
  }
  return OPENAI_DEFAULT_DISCOUNT;
}

export const openaiChatAdapter: ProviderAdapter = {
  name: "openai-chat",
  matchRoute: (method, path) => method === "POST" && (path.split("?")[0] ?? "") === "/v1/chat/completions",
  normalizeRequest: (b): NormalizedRequest => {
    const r = b as {
      model: string;
      messages: { role: "user" | "assistant" | "system"; content: unknown }[];
      tools?: { function: { name: string; parameters: unknown } }[];
    };
    return {
      model: r.model,
      system: r.messages.filter((m) => m.role === "system").map((m) => ({ text: String(m.content) })),
      tools: (r.tools ?? []).map((t) => ({ name: t.function.name, schema: t.function.parameters })),
      // Order is semantic in chat — preserve the user/assistant sequence as-is.
      messages: r.messages.filter((m) => m.role !== "system") as {
        role: "user" | "assistant";
        content: unknown;
      }[],
      raw: b,
    };
  },
  denormalize: (n) => n.raw,
  applyCacheHints: (n, regions) => {
    const raw = { ...(n.raw as Record<string, unknown>) };

    // Prefix-stability: OpenAI cache matching is exact-prefix, so normalize the
    // static tool definitions deterministically (recursive key sort). Confined to
    // `tools` — message order is semantic and must not be reordered.
    if (Array.isArray(raw.tools)) raw.tools = sortKeysDeep(raw.tools);

    // Routing key: identical prefixes share a key so they hash to the same KV node.
    raw.prompt_cache_key = `cachelane-${regions.prefix_hash}`.slice(0, 64);
    // NOTE: extended retention uses the literal value "24h" (NOT "extended" — that
    // is the policy name; the accepted param values are "in_memory" | "24h"). It is
    // valid on BOTH chat.completions and responses, but we defer it to M-P3 so the
    // chat adapter stays minimal and the retention policy is decided in one place.
    return { ...n, raw };
  },
  cachePolicy: { tiers: [], supportsKeepalive: false, discountFactor: OPENAI_DEFAULT_DISCOUNT },
  parseUsage: parseOpenAIChatUsage,
  tokenizer: openaiTokenizer,
  costModel: {
    effectiveUnits: (u, model) =>
      u.input - u.cacheRead + u.cacheRead * openaiCachedDiscount(model ?? ""),
  },
};
