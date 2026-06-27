# Cachelane Provider Portability — Design

**Date:** 2026-06-25
**Status:** Design (brainstorming output) — pending user review before writing implementation plan
**Author:** Agent session (goal-driven, autonomous)

---

## 1. Problem & Goal

Cachelane today is a local proxy + Claude Code hooks that intercepts traffic to
`api.anthropic.com` (and Bedrock) and reduces input-token cost via (a) cache-aware
reordering with two explicit `cache_control` breakpoints, and (b) K-pruning of idle
tool-result blocks.

**Goal:** make Cachelane portable across other agentic coding tools — Aider, OpenAI
Codex CLI, Continue, Cline/Roo, GitHub Copilot (BYOK), Windsurf (BYOK) — which speak
OpenAI-style APIs, while preserving the existing Claude Code/Anthropic path unchanged.

**Non-goals:** supporting tools whose traffic is server-routed or closed and therefore
cannot be intercepted by a local proxy — Google Antigravity, ChatGPT web/desktop, and
Cursor's main (server-routed) path. Documented as non-supportable; no work planned.

---

## 2. Pivotal Constraint (from research)

OpenAI prompt caching is **implicit**, not explicit:

- Caching matches the **longest byte-identical prefix** automatically. There is **no way
  to declare where the cached prefix ends** — the Anthropic `cache_control` breakpoint
  has no analog.
- **Two distinct thresholds — do not conflate them:**
  - **Cache eligibility:** prefix must be ≥ **1024 tokens**; hits extend in **128-token** increments.
  - **Routing hash:** `prompt_cache_key` + roughly the **first ~256 tokens** are hashed to
    pick the backend node holding the KV cache. (Community-reported, not in the eligibility math.)
- The only proxy levers are: keep the **front of the prompt byte-stable**, set
  **`prompt_cache_key`** (routes requests to the same KV-cache node), and — **on the
  Responses API only** — set **`prompt_cache_retention: "extended"`** to request up to
  ~24h retention vs the default ~5–10 min ephemeral window. The value is the literal
  string `"extended"`, NOT `"24h"`. Chat/completions has no documented retention knob, so
  the OpenAIChat adapter must NOT send it.
- **`prompt_cache_key` is effectively model-gated (community-reported, 2025-09):** it
  primes the cache fast and lifts hit rate to ~95% on **gpt-5 / gpt-5-mini**, but makes
  **no measurable difference on gpt-5-nano or older models (gpt-4o, gpt-4.1, etc.)**, which
  still reach only ~80% hit rate after manual priming. Savings estimates MUST NOT assume
  the key buys anything outside the gpt-5/gpt-5-mini family.
- **Cache persistence is short and inconsistent.** Community testers saw a primed cache
  evaporate within seconds-to-minutes and could not derive a reliable priming formula. Do
  not architect savings around durable cache hits.
- Cached-input discount is only **~0.5–0.75x** vs Anthropic's **0.1x** — materially weaker.
- **No zero-cost keepalive** trick exists; keepalive is meaningless on OpenAI.

**Design consequence:** On OpenAI targets, the breakpoint-placer degenerates to a no-op
and keepalive is disabled. Because the cache discount is weak, the cache itself is flaky,
and the routing key only helps two models, the headline savings mechanism becomes
**K-pruning** (it cuts full-price dynamic-tail tokens regardless of cache state). Prefix
stabilization + `prompt_cache_key` are a best-effort secondary layer that pays off mostly
on gpt-5/gpt-5-mini. This is the user-approved "prune-first + prefix-stabilize" strategy.

> Research caveat: my environment also blocks web access, so the OpenAI numbers below
> remain UNVERIFIED against official docs. The thresholds, model-gating, and persistence
> notes above are corroborated by the OpenAI Developer Community thread "How is
> prompt_cache_key actually used in API calls?" (Sep 2025). Re-confirm against
> `platform.openai.com/docs/guides/prompt-caching`, the chat + responses API reference,
> and the pricing page before implementation. Most-likely-to-drift / needs official
> confirmation: (1) exact `prompt_cache_retention` accepted values and whether it is GA;
> (2) per-model cached discount; (3) the ~256-token routing-hash figure.

---

## 3. Architecture: two adapter seams

The valuable cores are already provider-agnostic and STAY UNCHANGED:
`classifier/` (operates on volatility/kind/filePath), `orchestrator/region-boundaries.ts`
(operates on `Classification[].volatility`), and `pruner/*` (K-counter logic).

Two new interfaces isolate everything provider-specific.

### 3.1 `ProviderAdapter` — the wire/cache seam

```
interface ProviderAdapter {
  // Routing
  matchRoute(method, path): boolean          // is this a cacheable LLM request?

  // Wire format normalization (provider ⇄ neutral)
  normalizeRequest(body): NormalizedRequest   // → blocks + roles the cores understand
  denormalize(normalized): body               // → provider-specific request body

  // Cache strategy
  applyCacheHints(request, regions): request   // Anthropic: 2 cache_control breakpoints
                                               // OpenAI: no-op + stable prefix order +
                                               //         prompt_cache_key + retention
  cachePolicy: { tiers, supportsKeepalive, discountFactor }

  // Usage + accounting
  parseUsage(responseStream): NeutralUsage     // { input, output, cacheRead, cacheWrite }
  tokenizer: Tokenizer                         // claude tiktoken | o200k_base/cl100k_base
  costModel: CostModel                         // per-provider price ratios
}
```

Concrete adapters:

| Adapter | Route(s) | Cache mechanism | Usage field |
|---|---|---|---|
| **AnthropicMessages** (current) | `/v1/messages`, Bedrock `/model/*` | explicit `cache_control` breakpoints | `cache_read_input_tokens`, `cache_creation_*` |
| **OpenAIChat** | `/v1/chat/completions` | implicit prefix + `prompt_cache_key` | `usage.prompt_tokens_details.cached_tokens` |
| **OpenAIResponses** | `/responses` | implicit prefix + `prompt_cache_key` | `usage.input_tokens_details.cached_tokens` |

### 3.2 `InstallTarget` — the host-tool seam

```
interface InstallTarget {
  redirectMechanism: "env" | "config-file" | "ui-manual"
  envVars: string[]                  // e.g. ["OPENAI_API_BASE"] | ["ANTHROPIC_BASE_URL"]
  upstreamDefault: string            // api.openai.com | api.anthropic.com
  hookSurface?: ClaudeCodeHooks      // Claude Code only
  mcpSurface?: ClaudeCodeMcp         // Claude Code only
}
```

| Target | Mechanism | Protocol | Interceptable |
|---|---|---|---|
| Claude Code (current) | `ANTHROPIC_BASE_URL` + hooks + MCP | Anthropic Messages | yes |
| **Aider** (first new target) | `OPENAI_API_BASE` env var | OpenAI chat/completions | easy |
| Codex CLI | config `base_url` | OpenAI Responses | easy |
| Continue.dev | `apiBase` config | OpenAI chat/completions | easy |
| Cline / Roo | UI Base URL field | OpenAI or Anthropic | easy (manual) |
| Copilot / Windsurf BYOK | custom endpoint URL | OpenAI or Anthropic | medium (BYOK only) |
| Antigravity / ChatGPT / Cursor-main | — | server-routed/closed | **no — out of scope** |

---

## 4. Selecting the active adapter

The proxy can serve multiple tools at once. Adapter selection is **per request**, by
route + body shape:

1. `matchRoute` over the request path picks the candidate adapter
   (`/v1/messages` → Anthropic; `/v1/chat/completions` → OpenAIChat; `/responses` → OpenAIResponses).
2. Fail-open invariant preserved: if no adapter matches or normalization throws, forward
   the **unmutated** request (existing behavior in `proxy/server.ts`).

A `provider` field is added to `CachelaneConfig` (default `"anthropic"`) with per-provider
presets (upstream host/port, cache tiers, keepalive on/off, cost model).

---

## 5. Storage migration

Current schema bakes in Anthropic tiers: `cache_creation_5m_tokens`,
`cache_creation_1h_tokens`, `prefix_breakpoint_hash`, `middle_breakpoint_hash`.

Migration:
- Add neutral columns `cache_write_tokens`, `cache_read_tokens` (+ optional `cache_tier_json`).
- Add `provider` discriminator column to the `turns` table.
- Keep existing columns for back-compat on the Anthropic path during transition; new
  adapters write only neutral columns.

`reconciler/` and `calculateEffectiveCostUnits` consume neutral `{cacheRead, cacheWrite,
input}` + a per-provider `CostModel` (price ratios) instead of hard-coded 1.25/2.0/0.1.

---

## 6. What changes per module

| Module | Action |
|---|---|
| `classifier/*`, `region-boundaries.ts`, `pruner/*` | **unchanged** (move tool-name/glob lists into `ToolProfile` config) |
| `orchestrator/request-mutator.ts` | extract breakpoint logic into `AnthropicMessages.applyCacheHints`; OpenAI impl is no-op + prefix-stabilize + set cache key |
| `orchestrator/types.ts` | introduce `NormalizedRequest`; `Anthropic*` types become one codec |
| `orchestrator/breakpoint-placer.ts` | called only by Anthropic adapter |
| `keepalive/*`, `cache-state-tracker.ts` | gated on `cachePolicy.supportsKeepalive` (no-op for OpenAI) |
| `tokenizer/*` | `Tokenizer` interface; OpenAI uses tiktoken `o200k_base`/`cl100k_base` |
| `proxy/server.ts` | route + usage parsing + auth-header handling delegated to active adapter |
| `proxy/eventstream.ts` | Bedrock event-stream decoder reused as transport; inner parse moves to adapter |
| `reconciler/*`, `hooks/post-response.ts` | consume `NeutralUsage` + `CostModel` |
| `storage/*` | migration (section 5) |
| `cli/install.ts`, `paths.ts` | extract `InstallTarget`; add Aider target |
| `config/defaults.ts`, `types/index.ts` | add `provider` + per-provider presets; `CacheTier` becomes adapter-defined |

---

## 7. Phased delivery

- **M-P1 — Extract `ProviderAdapter` behind current Anthropic behavior.** Pure refactor,
  no new tool. **Acceptance:** cache-stability gate (SHA-256 of prefix byte-identical
  across 3 identical runs) still passes — proves the refactor is lossless. All existing
  tests green.
- **M-P2 — OpenAIChat adapter + Aider `InstallTarget`.** First non-Anthropic target
  (user-selected; pure env var). **Acceptance:** an Aider session through the proxy gets
  K-pruned tail + stable prefix + `prompt_cache_key`; `cached_tokens` observed > 0 on a
  repeated long prefix; fail-open verified.
- **M-P3 — OpenAIResponses adapter + Codex CLI target.** Second wire format.
- **M-P4 — Copilot/Windsurf BYOK custom-endpoint targets.**
- **Out of scope:** Antigravity, ChatGPT, Cursor main path — document as non-supportable.

---

## 8. Open questions

| # | Question |
|---|---|
| Q-P1 | Is reordering chat/completions `messages` safe? Order carries semantic meaning in chat, unlike Anthropic intra-turn blocks. Likely: only reorder system/tool-def blocks to the front; never reorder the user/assistant turn sequence. Needs validation. |
| Q-P2 | `prompt_cache_key` granularity: per static-prefix-identity (recommended) vs per-session. Community note: load per cached host rolls over after ~15 req/min. How does Cachelane derive a stable key from the prefix hash it already computes? Resolved direction: derive `cachelane-<prefix_hash>` so identical prefixes share a key. |
| Q-P3 | Multi-provider single proxy instance vs one instance per provider/port. Current design: one instance, per-request adapter selection. Confirm SQLite `provider` column is enough to keep stats separate. |
| Q-P4 | Does the cache-stability merge gate apply to OpenAI adapters, where "prefix" is implicit? Proposed: gate on byte-stability of the normalized-then-denormalized prefix region. |
| Q-P5 | Should `prompt_cache_key` be set only for gpt-5/gpt-5-mini (where community data shows it helps) and omitted elsewhere, or always set (harmless when ignored)? Leaning: always set it (no downside reported), but gate *savings projections* on the model family so we don't overstate ROI. Needs confirmation once official docs are reachable. |
| Q-P6 | Is `prompt_cache_retention` GA, and what values does it accept? Unconfirmed by community thread. Treat as optional/feature-detected; do not hard-depend on it. |

---

## 9. Persistence note

This working directory is **not a git repo** (per user decision 2026-06-25, spec is
written but NOT committed; no `git init` performed without explicit instruction).
