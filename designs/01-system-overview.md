# 01 — System Overview

**Purpose:** High-level product summary, goals, non-goals, and full glossary.  
**Scope:** Product-level understanding; no implementation details.  
**Sources:** All five source documents.

---

## What Cachelane Is

Cachelane is a **local MCP server + Claude Code hooks** (PreRequest/PostResponse) that intercepts
every conversation turn between Claude Code and `api.anthropic.com`. It does two things:

1. **Cache-aware prompt orchestration** — classifies each content block by volatility and reorders
   the prompt into three regions (stable prefix, semi-stable middle, volatile suffix), placing two
   `cache_control` breakpoints so Anthropic's prompt cache fires at **0.1×** the normal input cost
   on cache hits instead of paying **1.0×** every turn.

2. **K-pruning** — after each turn, any tool-call result block that has been idle for ≥ K
   consecutive turns is replaced with a compact stub that preserves its identifier and is
   refetchable on demand. This flattens token growth in long sessions without discarding any
   information.

Cachelane is **a complement to, not a replacement for**, existing context tools (Context Mode,
Code Graph, Token Savior, etc.). It operates on the final assembled prompt, after every other tool
has shaped its portion of context.

**Positioning tag:** "A cache-discipline layer for Claude Code."

---

## Goals

| # | Goal |
|---|------|
| G1 | Reduce input-token costs on every subsequent turn via K-pruning |
| G2 | Maximize Anthropic prompt-cache hit rate by reordering blocks into stable/semi/volatile regions with two `cache_control` breakpoints |
| G3 | Refresh prompt-cache TTL via a keepalive worker so users don't pay full re-write penalties after idle periods |
| G4 | Fail open: never make Claude Code slower or less reliable than without Cachelane |
| G5 | Provide local-only operation — zero-cost regime, per-user, no shared backend |
| G6 | Respect Anthropic workspace cache isolation (effective Feb 5, 2026) |

---

## Non-Goals

| # | Non-Goal | Disposition |
|---|----------|-------------|
| NG1 | Tokenizer-aware content rewriting | Deferred to v1.1 (Phase 1 M3) |
| NG2 | Speculative / budgeted block inclusion | Deferred (overlaps Token Savior) |
| NG3 | Cross-session decision distillation | Rejected (overlaps memsearch) |
| NG4 | Shared team caches / multi-user fleet | Out of scope; would leave the zero-cost regime |
| NG5 | Hosted backend or cloud infrastructure | Explicitly rejected (see [ADR-007](decisions/ADR-007-local-only.md)) |
| NG6 | Retry of Anthropic API 5xx errors | That is the API client's responsibility |
| NG7 | Tracker reconstruction on process restart | Deferred to v1.1 (one cache-write penalty on cold start is acceptable) |

---

## Product Positioning

**The gap Cachelane fills.** Seven major Claude Code token-reduction tools converged on four
reduction axes: upstream filtering, structural pre-indexing, progressive disclosure, and
output-side compression. None of them addresses the **prompt cache** — the largest single
unexploited cost lever in the Claude API.

Reported real-world cache-hit ratios *after deliberate prefix design* are **50–84%**
(Helicone, Vellum, ProjectDiscovery). Rates below 20% are classified as a prefix-design failure,
not a model limitation. The naively-routed prompt pays 1.0× input cost every turn instead of 0.1×
on cache reads — a missed ~10× discount on the largest cost surface.

**Expected impact (v1):**
- Cache-aware orchestration (M1): **30–60% savings** on cacheable workloads
- K-pruning (M2): additional **+10–15 percentage points** on 15-turn sessions at K=3
- Combined target: ≥ 40% effective input-cost reduction vs. the B1 starter stack baseline

---

## Anthropic Prompt Cache Mechanics

| Operation | Price multiplier | Notes |
|-----------|-----------------|-------|
| Cache read | **0.1×** base input | 90% discount |
| 5-minute cache write | **1.25×** base input | Default TTL |
| 1-hour cache write | **2.0×** base input | Break-even at 2 reads |
| Cache match requirement | byte-identical prefix to `cache_control` breakpoint | Any change invalidates from that point |
| Workspace isolation | per-workspace | Enforced by Anthropic since Feb 5, 2026 |

**Worked example:** 30k-token prefix reused across 10 turns.
- Naïve (no cache): 1.0× × 10 = **10.0 prefix-units**
- Cache-aware: 1.25× (one write) + 0.1× × 9 (nine reads) = **2.15 prefix-units** → **4.6× reduction**

---

## Glossary

| Term | Definition |
|------|------------|
| **Turn** | One user message plus the assistant's full reply (tool calls inside the reply do not split the turn). |
| **Tool call** | An assistant-initiated function invocation. Multiple tool calls per turn are allowed; they do not advance the turn counter. |
| **Content block** | A single tool-call result; the atomic unit that K-pruning operates on. |
| **Block** | The smallest unit Cachelane reorders. One block = one logical content unit: a system prompt, a tool schema, one prior turn, one file read, one tool output, or a user message. Never split or merged. |
| **Volatility class** | One of `STABLE`, `SEMI`, or `VOLATILE`. **This is the canonical vocabulary — no other naming.** |
| `STABLE` | Block that changes rarely: system prompt, tool schemas, CLAUDE.md, pinned project rules. |
| `SEMI` | Block that changes turn-to-turn but follows a predictable pattern: recent-turn window. |
| `VOLATILE` | Default classification; changes every turn: current retrieval results, tool outputs, user message. |
| **Prefix region** | The `STABLE` blocks placed at the start of the prompt with a `cache_control` breakpoint. Cached at 0.1× on every re-read. |
| **Middle region** | The `SEMI` blocks (recent-turns window) between the two breakpoints. Conditionally cached if byte-stable. |
| **Suffix region** | The `VOLATILE` blocks at the end. Always paid in full at 1.0×. |
| **`cache_control` breakpoint** | Anthropic API marker that delimits where the cache prefix ends. Cachelane places two: end-of-prefix and end-of-middle. |
| **K-pruning** | Age-based pruning: each non-pinned content block's `unused_turns` counter increments each turn it is not referenced; at `unused_turns ≥ K` the block is replaced with a stub. |
| **Stub** | A compact placeholder that replaces a pruned block. Retains the block's identifier, carries a one-line summary and a refetch handle. Stubs never expire further. |
| **Idle N** | A content block whose `unused_turns` counter is N (i.e., has not been referenced for N consecutive turns). |
| **K** | Configurable pruning threshold (turns). Defaults: 3 (default), 2 (aggressive), 5 (conservative). |
| **Pinned block** | Any block in the stable prefix (CLAUDE.md, tool schemas, system prompt, explicitly pinned files). Exempt from K-pruning — never ticks. |
| **Refetch / `cachelane:expand`** | The mechanism by which the model restores a stubbed block. The orchestrator re-issues the original tool call; restored content enters the suffix. |
| **Keepalive ping** | A synthetic minimal API call (`max_tokens=1`, one-token user message, same prefix) that resets the cache TTL. Fires only when idle and cache is approaching expiry. |
| **Idle-only triggering** | Keepalive heuristic: never fire a ping when a real turn recently touched the cache. |
| **Hybrid keepalive policy** | Default v1 policy: adaptive 4-minute idle trigger for short prefixes; auto-switch to 1-hour TTL when prefix > 50k tokens. |
| **Cache-stability test** | Gating CI test that asserts the SHA-256 of the prefix region is byte-identical across 3 consecutive identical-input runs. Blocks merge on failure. |
| **Reference detection** | Three-signal deterministic detection of which blocks the assistant referenced in a turn: (1) file paths in tool calls, (2) block IDs in assistant text, (3) 40-char shingle exact-match overlap. |
| **Reference log** | The SQLite store (`~/.cachelane/cachelane.db`) holding per-block usage counters. Block **contents are never stored here**. |
| **Cache state tracker** | In-memory per-prefix state: `prefix_hash`, `expected_expiry_ms`, etc. Resets on process restart (one cache-write penalty). |
| **Fail-open** | Cachelane's reliability principle: any error returns the unmutated request to Claude Code. Never break the user's workflow. |
| **`/compact`** | Claude Code's built-in command that rewrites conversation history in place. Cachelane detects this and resets the middle region. |
| **B0/B1/B2/B3** | Validation baselines: B0=no tools; B1=Context Mode+Code Graph+Caveman; B2=B1+Cachelane M1; B3=B2+K-pruner. |
| **Effective cost formula** | `input_tokens + 1.25×cache_write_5m + 2.0×cache_write_1h + 0.1×cache_read` (in base-input-token units). |
| **M1–M9** | Implementation milestones (see [designs/06-systems-design.md §Milestones](06-systems-design.md#milestones)). |

---

## Open Questions

See [`07-open-questions.md`](07-open-questions.md) for the full list with owners and status.

Critical unresolved items:
- **Q001** — Reference-detection precision/recall on real sessions (blocks M4)
- **Q003** — Optimal K value per scenario (needs experiment)
- **Q007** — Telemetry default (pending project-lead decision)
