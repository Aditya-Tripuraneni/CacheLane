import type { ProviderAdapter, NeutralUsage } from "./types.js";
import { isEventStreamContentType, eventStreamToSSE } from "../proxy/eventstream.js";
import { countTokens } from "../tokenizer/index.js";
import { calculateEffectiveCostUnits } from "../storage/index.js";

function parseAnthropicUsage(raw: Buffer, contentType?: string): NeutralUsage | null {
  const text = isEventStreamContentType(contentType) ? eventStreamToSSE(raw) : raw.toString("utf-8");
  // Track 5m and 1h separately and replace field-by-field (never re-sum), matching
  // the canonical parser in proxy/server.ts so multi-event streams don't double-count.
  let input = 0, output = 0, cacheRead = 0, write5m = 0, write1h = 0, found = false;
  const apply = (u: Record<string, number> | undefined) => {
    if (!u) return;
    found = true;
    input = u.input_tokens ?? input;
    output = u.output_tokens ?? output;
    cacheRead = u.cache_read_input_tokens ?? cacheRead;
    write5m = u.cache_creation_5m_tokens ?? u.cache_creation_input_tokens ?? write5m;
    write1h = u.cache_creation_1h_tokens ?? write1h;
  };
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    try {
      const e = JSON.parse(t.slice(5).trim()) as Record<string, unknown>;
      if (e.type === "message_start" && e.message) {
        apply((e.message as { usage?: Record<string, number> }).usage);
      }
      if (e.type === "message_delta" && e.usage) apply(e.usage as Record<string, number>);
    } catch { /* skip */ }
  }
  if (!found) {
    try { const j = JSON.parse(text) as { usage?: Record<string, number> }; apply(j.usage); }
    catch { /* not json */ }
  }
  return found
    ? { input, output, cacheRead, cacheWrite: write5m + write1h, cacheWrite5m: write5m, cacheWrite1h: write1h }
    : null;
}

export const anthropicMessagesAdapter: ProviderAdapter = {
  name: "anthropic",
  matchRoute: (method, path) => {
    if (method !== "POST") return false;
    const p = path.split("?")[0] ?? "";
    return p === "/v1/messages" || p.startsWith("/model/");
  },
  normalizeRequest: (b) => {
    const r = b as { model: string; system?: { text: string }[]; tools?: { name: string; input_schema: unknown }[]; messages: { role: "user" | "assistant"; content: unknown }[] };
    return {
      model: r.model,
      system: r.system ?? [],
      tools: (r.tools ?? []).map((t) => ({ name: t.name, schema: t.input_schema })),
      messages: r.messages,
      raw: b,
    };
  },
  denormalize: (n) => n.raw,
  applyCacheHints: (n) => n, // breakpoint placement stays in the existing mutator pipeline for M-P1
  cachePolicy: { tiers: ["5m", "1h"], supportsKeepalive: true, discountFactor: 0.1 },
  parseUsage: parseAnthropicUsage,
  tokenizer: { name: "anthropic", count: (text, model) => countTokens(text, model) },
  costModel: {
    effectiveUnits: (u) => calculateEffectiveCostUnits({
      input_tokens: u.input,
      cache_creation_5m_tokens: u.cacheWrite5m,
      cache_creation_1h_tokens: u.cacheWrite1h,
      cache_read_tokens: u.cacheRead,
    }),
  },
};
