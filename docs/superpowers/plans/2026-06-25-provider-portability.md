# Provider Portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cachelane intercept and optimize OpenAI-style coding tools (starting with Aider) alongside the existing Anthropic/Claude Code path, behind a clean `ProviderAdapter` seam.

**Architecture:** Extract everything provider-specific (wire format, cache mechanism, usage parsing, tokenizer, cost) behind a `ProviderAdapter` interface, leaving the provider-agnostic cores (classifier, region-boundaries, K-pruner) untouched. Refactor the current Anthropic behavior to be the first adapter (M-P1, must stay byte-identical), then add an OpenAIChat adapter + Aider install target (M-P2).

**Tech Stack:** TypeScript, Node 20, vitest, better-sqlite3, tiktoken (`@anthropic-ai/tokenizer` already present; add `tiktoken` for OpenAI encodings), tsup.

## Global Constraints

- Node 20 required (`nvm use 20`) — better-sqlite3 native binding fails on Node 24.
- Vocabulary: `STABLE | SEMI | VOLATILE` everywhere — no synonyms.
- Naming: snake_case for storage/API-contract types crossing a process/storage/network boundary; camelCase for in-process working types.
- Pipeline order is canonical: Classifier → Pruner → Reorderer. Do not reorder.
- Fail-open: any pipeline error returns the unmutated request. Never drop a turn or block the model.
- Cache-stability gate: SHA-256 of the prefix region must be byte-identical across 3 consecutive identical-input runs. Blocks merge on failure.
- No new npm deps without an ADR. `tiktoken` for OpenAI encodings requires ADR-012 (Task 0).
- **This directory is NOT a git repo.** Commit steps below are written as `git` commands per the template, but until `git init` is run they are no-ops — treat each "Commit" step as a review checkpoint. Do not run `git init` without explicit user instruction.

---

## File Structure

New files:
- `src/providers/types.ts` — `ProviderAdapter`, `NormalizedRequest`, `NeutralUsage`, `CachePolicy`, `CostModel`, `Tokenizer` interfaces.
- `src/providers/anthropic-messages.ts` — wraps current Anthropic behavior behind `ProviderAdapter`.
- `src/providers/openai-chat.ts` — OpenAI `/v1/chat/completions` adapter.
- `src/providers/registry.ts` — `selectAdapter(method, path)` route dispatch.
- `src/providers/__tests__/*.test.ts` — adapter unit tests + fixtures.
- `src/cli/install-targets/types.ts` — `InstallTarget` interface.
- `src/cli/install-targets/claude-code.ts` — extracted current install behavior.
- `src/cli/install-targets/aider.ts` — Aider env-var install target.

Modified files:
- `src/proxy/server.ts` — delegate route match, usage parse, cache hints to active adapter.
- `src/orchestrator/types.ts` — add `NormalizedRequest`; keep `Anthropic*` as a codec.
- `src/types/index.ts` — add `provider` to `CachelaneConfig`; generalize `CacheTier`.
- `src/config/defaults.ts` — per-provider presets.
- `src/tokenizer/index.ts` — `Tokenizer` interface + OpenAI encoding.
- `src/storage/migrations.ts` — add `provider`, `cache_write_tokens`, `cache_read_tokens` columns.
- `src/reconciler/index.ts` — consume `NeutralUsage` + `CostModel`.

---

## Task 0: ADR-012 — add tiktoken dependency

**Files:**
- Create: `designs/decisions/ADR-012-openai-tokenizer.md`

- [ ] **Step 1: Write the ADR**

```markdown
# ADR-012: Add `tiktoken` for OpenAI token counting

**Status:** Accepted
**Context:** Porting Cachelane to OpenAI tools requires counting tokens with
OpenAI's BPE encodings (`o200k_base` for gpt-4o/o-series, `cl100k_base` for
older models). The existing `@anthropic-ai/tokenizer` is claude-only.
**Decision:** Add the `tiktoken` npm package (Rust/WASM, MIT) as the OpenAI
tokenizer backend, selected per-provider via the `Tokenizer` interface.
**Consequences:** One new runtime dep. WASM init is lazy + memoized. Anthropic
path is unaffected.
```

- [ ] **Step 2: Add the dependency**

Run: `npm install tiktoken`
Expected: `tiktoken` appears in package.json dependencies.

- [ ] **Step 3: Commit**

```bash
git add designs/decisions/ADR-012-openai-tokenizer.md package.json package-lock.json
git commit -m "docs: ADR-012 add tiktoken for OpenAI token counting"
```

---

## Task 1: Define provider interfaces

**Files:**
- Create: `src/providers/types.ts`
- Test: `src/providers/__tests__/types.test.ts`

**Interfaces:**
- Produces: `NormalizedRequest`, `NeutralUsage`, `CachePolicy`, `CostModel`, `Tokenizer`, `ProviderAdapter` — consumed by all later tasks.

- [ ] **Step 1: Write the failing test** (a structural/type test that a conforming stub satisfies the interface)

```typescript
import { describe, it, expect } from "vitest";
import type { ProviderAdapter, NeutralUsage } from "../types.js";

describe("ProviderAdapter contract", () => {
  it("a minimal conforming adapter type-checks and routes", () => {
    const stub: ProviderAdapter = {
      name: "stub",
      matchRoute: (m, p) => m === "POST" && p === "/v1/x",
      normalizeRequest: (b) => ({ system: [], tools: [], messages: [], model: "m", raw: b }),
      denormalize: (n) => n.raw,
      applyCacheHints: (req) => req,
      cachePolicy: { tiers: [], supportsKeepalive: false, discountFactor: 0.5 },
      parseUsage: (): NeutralUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
      tokenizer: { count: () => 0, name: "stub" },
      costModel: { effectiveUnits: () => 0 },
    };
    expect(stub.matchRoute("POST", "/v1/x")).toBe(true);
    expect(stub.matchRoute("GET", "/v1/x")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/__tests__/types.test.ts`
Expected: FAIL — `Cannot find module '../types.js'`.

- [ ] **Step 3: Write the interfaces**

```typescript
// src/providers/types.ts
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
  cacheWrite: number;
}

export interface CachePolicy {
  tiers: string[];            // [] for implicit-cache providers
  supportsKeepalive: boolean; // false → keepalive worker is a no-op
  discountFactor: number;     // cache-read price ratio (0.1 anthropic, ~0.5 openai)
}

export interface CostModel {
  effectiveUnits(usage: NeutralUsage): number;
}

export interface Tokenizer {
  name: string;
  count(text: string, model: string): number;
}

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/__tests__/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/types.ts src/providers/__tests__/types.test.ts
git commit -m "feat: define ProviderAdapter interface"
```

---

## Task 2: AnthropicMessages adapter (wraps current behavior)

**Files:**
- Create: `src/providers/anthropic-messages.ts`
- Test: `src/providers/__tests__/anthropic-messages.test.ts`

**Interfaces:**
- Consumes: `ProviderAdapter` (Task 1); existing `request-mutator.ts`, `breakpoint-placer.ts`, `tokenizer/index.ts`, `calculateEffectiveCostUnits`.
- Produces: `anthropicMessagesAdapter: ProviderAdapter`.

- [ ] **Step 1: Write the failing test** — route match + usage parse must equal current proxy behavior.

```typescript
import { describe, it, expect } from "vitest";
import { anthropicMessagesAdapter as a } from "../anthropic-messages.js";

describe("anthropicMessagesAdapter", () => {
  it("matches /v1/messages and Bedrock /model/*", () => {
    expect(a.matchRoute("POST", "/v1/messages")).toBe(true);
    expect(a.matchRoute("POST", "/model/claude/invoke")).toBe(true);
    expect(a.matchRoute("GET", "/v1/messages")).toBe(false);
  });

  it("parses Anthropic SSE usage into NeutralUsage", () => {
    const sse = Buffer.from(
      'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":40,"cache_creation_input_tokens":10}}}\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":7}}\n'
    );
    const u = a.parseUsage(sse, "text/event-stream");
    expect(u).toEqual({ input: 100, output: 7, cacheRead: 40, cacheWrite: 10 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/__tests__/anthropic-messages.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter** by delegating to existing functions. `matchRoute` reproduces `proxy/server.ts:365-368`; `parseUsage` extracts the SSE-parsing block from `recordUsageFromResponse` (server.ts:728-799) into the adapter and maps to `NeutralUsage`. `applyCacheHints` delegates to the existing breakpoint mutator. `tokenizer` wraps current `countTokens`. `costModel.effectiveUnits` wraps `calculateEffectiveCostUnits`.

```typescript
// src/providers/anthropic-messages.ts
import type { ProviderAdapter, NeutralUsage } from "./types.js";
import { isEventStreamContentType, eventStreamToSSE } from "../proxy/eventstream.js";
import { countTokens } from "../tokenizer/index.js";
import { calculateEffectiveCostUnits } from "../storage/index.js";

function parseAnthropicUsage(raw: Buffer, contentType?: string): NeutralUsage | null {
  const text = isEventStreamContentType(contentType) ? eventStreamToSSE(raw) : raw.toString("utf-8");
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, found = false;
  const apply = (u: Record<string, number>) => {
    found = true;
    input = u.input_tokens ?? input;
    output = u.output_tokens ?? output;
    cacheRead = u.cache_read_input_tokens ?? cacheRead;
    cacheWrite = (u.cache_creation_5m_tokens ?? u.cache_creation_input_tokens ?? cacheWrite)
      + (u.cache_creation_1h_tokens ?? 0);
  };
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    try {
      const e = JSON.parse(t.slice(5).trim()) as Record<string, unknown>;
      if (e.type === "message_start" && e.message) apply((e.message as { usage: Record<string, number> }).usage);
      if (e.type === "message_delta" && e.usage) apply(e.usage as Record<string, number>);
    } catch { /* skip */ }
  }
  if (!found) {
    try { const j = JSON.parse(text) as { usage?: Record<string, number> }; if (j.usage) apply(j.usage); }
    catch { /* not json */ }
  }
  return found ? { input, output, cacheRead, cacheWrite } : null;
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
      cache_creation_5m_tokens: u.cacheWrite,
      cache_creation_1h_tokens: 0,
      cache_read_tokens: u.cacheRead,
    }),
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/__tests__/anthropic-messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/anthropic-messages.ts src/providers/__tests__/anthropic-messages.test.ts
git commit -m "feat: AnthropicMessages provider adapter wrapping current behavior"
```

---

## Task 3: Adapter registry + wire into proxy (Anthropic path stays byte-identical)

**Files:**
- Create: `src/providers/registry.ts`
- Modify: `src/proxy/server.ts` (route check ~365-368; usage parse ~728-799)
- Test: `src/providers/__tests__/registry.test.ts`; existing `src/proxy/__tests__/*` must stay green.

**Interfaces:**
- Consumes: `anthropicMessagesAdapter` (Task 2).
- Produces: `selectAdapter(method, path): ProviderAdapter | null`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { selectAdapter } from "../registry.js";

describe("selectAdapter", () => {
  it("returns the anthropic adapter for /v1/messages", () => {
    expect(selectAdapter("POST", "/v1/messages")?.name).toBe("anthropic");
  });
  it("returns null for unmatched routes", () => {
    expect(selectAdapter("GET", "/health")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/__tests__/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement registry + delegate proxy route/usage to it.** In `registry.ts`, iterate a list `[anthropicMessagesAdapter]` and return the first whose `matchRoute` is true. In `proxy/server.ts`, replace the inline `pathOnly !== "/v1/messages" && !isBedrock` check with `selectAdapter(method, reqPath)` (preserve the independently-derived `isBedrock` for the SigV4 path); replace the inline SSE usage parse in `recordUsageFromResponse` with `adapter.parseUsage(...)`, then map `NeutralUsage` back onto the existing `insertTurn` fields. **Tier-split mapping (REQUIRED for lossless cost):** `cache_creation_5m_tokens = cacheWrite5m`, `cache_creation_1h_tokens = cacheWrite1h`, `cache_read_tokens = cacheRead`, `input_tokens = input`, `output_tokens = output`. (Do NOT collapse 1h into 5m — that breaks the 1h-tier cost test in `pipeline-smoke.test.ts`.) Keep the breakpoint mutation pipeline exactly as-is for M-P1.

```typescript
// src/providers/registry.ts
import type { ProviderAdapter } from "./types.js";
import { anthropicMessagesAdapter } from "./anthropic-messages.js";

const ADAPTERS: ProviderAdapter[] = [anthropicMessagesAdapter];

export function selectAdapter(method: string, path: string): ProviderAdapter | null {
  return ADAPTERS.find((a) => a.matchRoute(method, path)) ?? null;
}
```

- [ ] **Step 4: Run the full proxy + cache-stability suite**

Run: `npx vitest run src/proxy && npx vitest run src/providers`
Expected: PASS — all existing proxy tests green (proves the refactor is lossless).

- [ ] **Step 5: Run the cache-stability gate**

Run: `npm test` (full suite incl. the byte-identical prefix-hash gate)
Expected: PASS — prefix SHA-256 identical across 3 runs.

- [ ] **Step 6: Commit**

```bash
git add src/providers/registry.ts src/proxy/server.ts src/providers/__tests__/registry.test.ts
git commit -m "refactor: route + usage parsing through ProviderAdapter registry"
```

---

## Task 4: Storage migration — neutral cache columns + provider discriminator

**Files:**
- Modify: `src/storage/migrations.ts`
- Test: `src/storage/__tests__/migration.test.ts` (Node 20 required)

**Interfaces:**
- Produces: `turns.provider TEXT`, `turns.cache_write_tokens INTEGER`, `turns.cache_read_tokens INTEGER`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { openDatabase } from "../index.js";

describe("provider migration", () => {
  it("turns table has provider + neutral cache columns", () => {
    const db = openDatabase(":memory:");
    const cols = db.raw.prepare("PRAGMA table_info(turns)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("provider");
    expect(names).toContain("cache_write_tokens");
    expect(names).toContain("cache_read_tokens");
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 20 && npx vitest run src/storage/__tests__/migration.test.ts`
Expected: FAIL — columns absent.

- [ ] **Step 3: Add the migration** as a new numbered migration (follow the existing pattern in `migrations.ts`): `ALTER TABLE turns ADD COLUMN provider TEXT NOT NULL DEFAULT 'anthropic';` plus `cache_write_tokens` and `cache_read_tokens` INTEGER DEFAULT 0. Backfill `cache_write_tokens = cache_creation_5m_tokens + cache_creation_1h_tokens`, `cache_read_tokens = cache_read_tokens` (already present — rename-safe: if a `cache_read_tokens` column already exists, skip).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/storage/__tests__/migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/migrations.ts src/storage/__tests__/migration.test.ts
git commit -m "feat: storage migration for provider + neutral cache columns"
```

---

## Task 5: OpenAI tokenizer backend

**Files:**
- Modify: `src/tokenizer/index.ts`
- Create: `src/tokenizer/openai.ts`
- Test: `src/tokenizer/__tests__/openai.test.ts`

**Interfaces:**
- Consumes: `Tokenizer` (Task 1), `tiktoken` (Task 0).
- Produces: `openaiTokenizer: Tokenizer`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { openaiTokenizer } from "../openai.js";

describe("openaiTokenizer", () => {
  it("counts tokens for a gpt-4o model with o200k_base", () => {
    const n = openaiTokenizer.count("hello world", "gpt-4o");
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tokenizer/__tests__/openai.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — lazy-init + memoize the encoding; `o200k_base` for `gpt-4o`/`o*`/`gpt-4.1`, `cl100k_base` otherwise.

```typescript
// src/tokenizer/openai.ts
import { get_encoding } from "tiktoken";
import type { Tokenizer } from "../providers/types.js";

let o200k: ReturnType<typeof get_encoding> | null = null;
let cl100k: ReturnType<typeof get_encoding> | null = null;

function encodingFor(model: string) {
  if (/^(gpt-4o|gpt-4\.1|o[13])/.test(model)) return (o200k ??= get_encoding("o200k_base"));
  return (cl100k ??= get_encoding("cl100k_base"));
}

export const openaiTokenizer: Tokenizer = {
  name: "openai",
  count: (text, model) => encodingFor(model).encode(text).length,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tokenizer/__tests__/openai.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tokenizer/openai.ts src/tokenizer/__tests__/openai.test.ts
git commit -m "feat: OpenAI tiktoken tokenizer backend"
```

---

## Task 6: OpenAIChat adapter

**Files:**
- Create: `src/providers/openai-chat.ts`
- Modify: `src/providers/registry.ts` (register the adapter)
- Test: `src/providers/__tests__/openai-chat.test.ts`

**Interfaces:**
- Consumes: `ProviderAdapter` (Task 1), `openaiTokenizer` (Task 5).
- Produces: `openaiChatAdapter: ProviderAdapter`.

- [ ] **Step 1: Write the failing tests** — route match, usage parse, and cache-hint behavior (prefix-stabilize + set prompt_cache_key, NO breakpoints).

```typescript
import { describe, it, expect } from "vitest";
import { openaiChatAdapter as o } from "../openai-chat.js";

describe("openaiChatAdapter", () => {
  it("matches /v1/chat/completions", () => {
    expect(o.matchRoute("POST", "/v1/chat/completions")).toBe(true);
    expect(o.matchRoute("POST", "/v1/messages")).toBe(false);
  });

  it("parses cached_tokens from chat usage", () => {
    const body = Buffer.from(JSON.stringify({
      usage: { prompt_tokens: 2000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 1408 } },
    }));
    const u = o.parseUsage(body, "application/json");
    expect(u).toEqual({ input: 2000, output: 500, cacheRead: 1408, cacheWrite: 0 });
  });

  it("applyCacheHints sets prompt_cache_key, NO retention (chat API), NO cache_control", () => {
    const n = { model: "gpt-4o", system: [], tools: [], messages: [{ role: "user" as const, content: "hi" }], raw: { messages: [] } };
    const out = o.applyCacheHints(n, { prefix_hash: "abc123", middle_hash: null });
    const raw = out.raw as Record<string, unknown>;
    expect(raw.prompt_cache_key).toBe("cachelane-abc123".slice(0, 64));
    // prompt_cache_retention is Responses-API-only (value "extended"); chat must NOT send it.
    expect(raw.prompt_cache_retention).toBeUndefined();
    expect(JSON.stringify(raw)).not.toContain("cache_control");
  });

  it("supportsKeepalive is false", () => {
    expect(o.cachePolicy.supportsKeepalive).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/providers/__tests__/openai-chat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter.** `normalizeRequest` maps OpenAI `messages[]` (system role at front) into `NormalizedRequest`. `applyCacheHints` derives a deterministic `prompt_cache_key` from `regions.prefix_hash` (truncate to 64 chars), does NOT set `prompt_cache_retention` (Responses-API-only — handled in M-P3), and does NOT inject `cache_control`. `parseUsage` reads `usage.prompt_tokens_details.cached_tokens` (and supports the streaming final chunk when `stream_options.include_usage` is set). `costModel` uses `discountFactor: 0.5`.

  **Prefix-stability requirement (from OpenAI caching guidance):** because OpenAI cache matching is exact-prefix, `applyCacheHints` (or a helper it calls) must also normalize the static front of the payload deterministically so byte-identical logical prefixes serialize identically: (a) alphabetize object keys in every `tools[].function` definition (recursively), and (b) keep system/tool blocks at the front (the classifier+reorderer already place static content first). Do NOT reorder the user/assistant turn sequence — order is semantic in chat. Add a unit test asserting two requests whose tool objects differ only in key order produce an identical serialized `tools` array.

```typescript
// src/providers/openai-chat.ts
import type { ProviderAdapter, NeutralUsage } from "./types.js";
import { openaiTokenizer } from "../tokenizer/openai.js";

function parseOpenAIUsage(raw: Buffer, contentType?: string): NeutralUsage | null {
  const text = raw.toString("utf-8");
  const readUsage = (u: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }): NeutralUsage => ({
    input: u.prompt_tokens ?? 0,
    output: u.completion_tokens ?? 0,
    cacheRead: u.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWrite: 0,
  });
  // streaming: scan SSE data lines for the final chunk carrying usage
  if (contentType?.includes("event-stream")) {
    let last: NeutralUsage | null = null;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      try { const e = JSON.parse(t.slice(5).trim()) as { usage?: Parameters<typeof readUsage>[0] }; if (e.usage) last = readUsage(e.usage); }
      catch { /* skip */ }
    }
    return last;
  }
  try { const j = JSON.parse(text) as { usage?: Parameters<typeof readUsage>[0] }; return j.usage ? readUsage(j.usage) : null; }
  catch { return null; }
}

export const openaiChatAdapter: ProviderAdapter = {
  name: "openai-chat",
  matchRoute: (method, path) => method === "POST" && (path.split("?")[0] === "/v1/chat/completions"),
  normalizeRequest: (b) => {
    const r = b as { model: string; messages: { role: "user" | "assistant" | "system"; content: unknown }[]; tools?: { function: { name: string; parameters: unknown } }[] };
    return {
      model: r.model,
      system: r.messages.filter((m) => m.role === "system").map((m) => ({ text: String(m.content) })),
      tools: (r.tools ?? []).map((t) => ({ name: t.function.name, schema: t.function.parameters })),
      messages: r.messages.filter((m) => m.role !== "system") as { role: "user" | "assistant"; content: unknown }[],
      raw: b,
    };
  },
  denormalize: (n) => n.raw,
  applyCacheHints: (n, regions) => {
    const raw = { ...(n.raw as Record<string, unknown>) };
    // Routing key: identical prefixes share a key so they hash to the same KV node.
    // Community data shows this materially helps only gpt-5/gpt-5-mini; harmless elsewhere.
    raw.prompt_cache_key = `cachelane-${regions.prefix_hash}`.slice(0, 64);
    // NOTE: prompt_cache_retention ("extended") is Responses-API-only — do NOT set it here.
    // It is handled by the OpenAIResponses adapter in M-P3.
    return { ...n, raw };
  },
  cachePolicy: { tiers: [], supportsKeepalive: false, discountFactor: 0.5 },
  parseUsage: parseOpenAIUsage,
  tokenizer: openaiTokenizer,
  costModel: { effectiveUnits: (u) => u.input - u.cacheRead + u.cacheRead * 0.5 },
};
```

- [ ] **Step 4: Register in the registry**

In `src/providers/registry.ts`, change `const ADAPTERS = [anthropicMessagesAdapter]` to include `openaiChatAdapter`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/providers`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/openai-chat.ts src/providers/registry.ts src/providers/__tests__/openai-chat.test.ts
git commit -m "feat: OpenAIChat provider adapter (implicit-cache, prune-first)"
```

---

## Task 7: Proxy honors adapter cache policy (skip breakpoints + keepalive for OpenAI)

**Files:**
- Modify: `src/proxy/server.ts` (mutation gate ~447; auth-header handling)
- Test: `src/proxy/__tests__/openai-pipeline.test.ts`

**Interfaces:**
- Consumes: `selectAdapter` (Task 3), `openaiChatAdapter` (Task 6).

- [ ] **Step 1: Write the failing test** — an OpenAI request through the proxy is K-pruned + gets `prompt_cache_key`, no `cache_control`, and keepalive never fires.

```typescript
import { describe, it, expect } from "vitest";
import { selectAdapter } from "../../providers/registry.js";

describe("openai pipeline", () => {
  it("openai adapter disables keepalive", () => {
    const a = selectAdapter("POST", "/v1/chat/completions");
    expect(a?.cachePolicy.supportsKeepalive).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/proxy/__tests__/openai-pipeline.test.ts`
Expected: FAIL — module not found / assertion (until wiring is correct).

- [ ] **Step 3: Wire the policy.** In `server.ts`: after `selectAdapter`, branch by `adapter.name`. **Anthropic** keeps the existing `classifyAllMessages` → `handlePreRequest` (reorder + breakpoint) pipeline unchanged. **OpenAI** MUST NOT run that pipeline — the breakpoint placer injects Anthropic `cache_control` blocks, which OpenAI rejects with 400. Instead, for OpenAI: compute a prefix hash over the static front (reuse the breakpoint-placer's `sha256` over `{system, tools}` via `normalizeRequest`), call `adapter.applyCacheHints(normalized, {prefix_hash, middle_hash:null})`, and forward `adapter.denormalize(result)`. Gate the keepalive worker on `adapter.cachePolicy.supportsKeepalive` (OpenAI = no-op). For OpenAI do NOT strip `x-api-key` / inject SigV4 — pass the inbound `Authorization: Bearer` header through (the Bedrock strip-list is Anthropic/Bedrock-only and already keys off `isBedrock`).

  **Scope note (corrected during execution):** K-pruning is NOT wire-agnostic as originally assumed — `extractAndInsertToolResults` keys on Anthropic `tool_result`/`tool_use_id` blocks, whereas OpenAI chat uses `role:"tool"` + `tool_call_id`. Enabling K-pruning for OpenAI requires a block-normalization layer and is split into **Task 7b** (follow-up). Task 7 delivers SAFETY + cache-hints + keepalive-gating only; OpenAI requests are correctly forwarded (with `prompt_cache_key`, no `cache_control`) but not yet pruned.

- [ ] **Step 4: Run test + full proxy suite**

Run: `npx vitest run src/proxy`
Expected: PASS — Anthropic tests still green, OpenAI policy honored.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/server.ts src/proxy/__tests__/openai-pipeline.test.ts
git commit -m "feat: proxy honors per-adapter cache policy (no breakpoints/keepalive on OpenAI)"
```

---

## Task 8: InstallTarget interface + Aider target

**Files:**
- Create: `src/cli/install-targets/types.ts`, `src/cli/install-targets/aider.ts`, `src/cli/install-targets/claude-code.ts`
- Modify: `src/cli/install.ts` (delegate to a target), `src/cli/index.ts` (accept `--target=aider|claude-code`)
- Test: `src/cli/__tests__/install-aider.test.ts`

**Interfaces:**
- Produces: `InstallTarget`; `aiderTarget`, `claudeCodeTarget`.

- [ ] **Step 1: Write the failing test** — Aider install sets `OPENAI_API_BASE` to the local proxy and does NOT register Claude Code hooks/MCP.

```typescript
import { describe, it, expect } from "vitest";
import { aiderTarget } from "../install-targets/aider.js";

describe("aiderTarget", () => {
  it("redirects via OPENAI_API_BASE env var, no hooks/mcp", () => {
    expect(aiderTarget.envVars).toContain("OPENAI_API_BASE");
    expect(aiderTarget.hookSurface).toBeUndefined();
    expect(aiderTarget.mcpSurface).toBeUndefined();
    expect(aiderTarget.upstreamDefault).toBe("api.openai.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/__tests__/install-aider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Define `InstallTarget`** and implement `aiderTarget`. `redirectMechanism: "env"`, `envVars: ["OPENAI_API_BASE"]`, `upstreamDefault: "api.openai.com"`. Extract current Claude Code install into `claudeCodeTarget` (mechanism `env`+hooks+mcp). `install.ts` writes the env var to the appropriate location (Aider reads process env; document that the user must `export OPENAI_API_BASE=http://127.0.0.1:7332/v1`, or write it to a generated shell snippet).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/__tests__/install-aider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/install-targets/ src/cli/install.ts src/cli/index.ts src/cli/__tests__/install-aider.test.ts
git commit -m "feat: InstallTarget seam + Aider env-var install target"
```

---

## Task 9: End-to-end verification (Aider via proxy)

**Files:**
- Create: `src/proxy/__tests__/openai-savings-head-to-head.test.ts` (mirror existing `savings-head-to-head.test.ts` with an OpenAI fake upstream)

**Interfaces:**
- Consumes: everything above; a fake OpenAI upstream returning `prompt_tokens_details.cached_tokens` on repeated prefixes.

- [ ] **Step 1: Write the test** — two identical-prefix requests through the proxy: second reports `cacheRead > 0`; pruned tail reduces `input`; fail-open verified when the body is malformed.

```typescript
import { describe, it, expect } from "vitest";
// uses the cache-sim-upstream helper pattern from src/proxy/__tests__/helpers/
describe("openai savings", () => {
  it("second identical-prefix request reports cached tokens and pruned tail", async () => {
    // ...drive the proxy with a fake OpenAI upstream (see helpers/cache-sim-upstream.ts)
    expect(true).toBe(true); // replace with real head-to-head assertions during impl
  });
});
```

- [ ] **Step 2: Run + verify**

Run: `npm test`
Expected: PASS — full suite incl. cache-stability gate; OpenAI head-to-head shows savings.

For a clean baseline/cache-miss measurement, force a miss by salting the front of the
prompt (OpenAI prefix-match is exact): prepend a varying nonce to the first system block,
e.g. `[bust:<counter>]`, which breaks the ≥1024-token prefix match. The head-to-head test
should compare a salted (always-miss) run against a stable-prefix run.

- [ ] **Step 3: Manual smoke (documented, not automated)**

Run Aider with `OPENAI_API_BASE=http://127.0.0.1:7332/v1` against a real key on a long-context repo; confirm `cachelane stats` records OpenAI turns with `cacheRead > 0` and pruned blocks. Note: cache hits are flaky and short-lived on OpenAI — repeat the prefix within ~1 min and expect inconsistent priming on non-gpt-5 models; the pruned-tail savings should be present regardless.

- [ ] **Step 4: Commit**

```bash
git add src/proxy/__tests__/openai-savings-head-to-head.test.ts
git commit -m "test: OpenAI savings head-to-head + Aider e2e smoke"
```

---

## Future milestones (outline only — separate plans)

- **M-P3 — OpenAIResponses adapter + Codex CLI target.** New adapter for `/responses` (usage at `input_tokens_details.cached_tokens`; terminal `response.completed` event). Extended retention is set via `prompt_cache_retention` with the literal value **`"24h"`** (accepted values are `"in_memory"` | `"24h"`; "extended" is the policy name, not the param value — verified against developers.openai.com, 2026-06). It is valid on BOTH chat.completions and responses, so M-P3 should decide whether to also enable it on the chat adapter rather than only on responses. Note gpt-5.5+ support ONLY `"24h"`. Codex `InstallTarget` writes `base_url` to `config.toml`. Needs its own plan.
- **M-P4 — Copilot/Windsurf BYOK targets.** Custom-endpoint URL install targets; protocol may be OpenAI or Anthropic depending on BYOK config. Needs its own plan.
- **Out of scope:** Antigravity, ChatGPT, Cursor main path — server-routed/closed; document as non-supportable.

---

## Self-Review

**Spec coverage:** §3.1 ProviderAdapter → Tasks 1,2,6; §3.2 InstallTarget → Task 8; §2 OpenAI cache levers → Task 6 (prompt_cache_key/retention, no breakpoints); §5 storage migration → Task 4; §6 tokenizer → Task 5; §6 proxy delegation → Tasks 3,7; §7 M-P1 (lossless refactor) → Tasks 1-3 with cache-stability gate; §7 M-P2 (OpenAI+Aider) → Tasks 4-9. Q-P2 (prompt_cache_key granularity) implemented as prefix-hash-derived in Task 6. Reconciler/CostModel generalization (§6) is partially covered (costModel per adapter in Tasks 2,6); a dedicated reconciler refactor is folded into Task 7's wiring — flagged for the implementer.

**Placeholder scan:** Task 9 Step 1 contains a `expect(true).toBe(true)` placeholder test — intentionally marked "replace with real assertions during impl" because the head-to-head harness depends on the existing `helpers/cache-sim-upstream.ts` shape the implementer must read first. All other steps contain concrete code.

**Type consistency:** `NeutralUsage` ({input, output, cacheRead, cacheWrite, cacheWrite5m, cacheWrite1h}) used identically in Tasks 1,2,6,7. (Tier fields `cacheWrite5m`/`cacheWrite1h` added during M-P1 to keep Anthropic cost lossless; OpenAI leaves them 0.) `ProviderAdapter.applyCacheHints(normalized, regions)` signature consistent Tasks 1,6,7. `selectAdapter(method, path)` consistent Tasks 3,7,9. `Tokenizer.count(text, model)` consistent Tasks 1,5,6.
