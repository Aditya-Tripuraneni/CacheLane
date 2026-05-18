# 05 — Token Reduction Research & Design Rationale

**Purpose:** Research findings, methodology evaluation, ADRs, and performance targets.  
**Scope:** The "why" behind the chosen approach — institutional knowledge for future decisions.  
**Source:** `Cachelane_Token_Reduction_Research_and_Design.docx` (Phase 1 research, May 2026).

---

## Document Overview

Phase 1 research deliverable that: (1) benchmarks the existing 7-tool ecosystem, (2) evaluates
5 candidate token-reduction methodologies, and (3) recommends the Cachelane architecture
(M1 + M2) with supporting ADRs. The headline finding: the existing ecosystem ignores the prompt
cache — the largest unexploited cost-reduction surface on the Claude API.

---

## Problem Statement & Motivation

### What's Being Solved

Claude Code conversations accumulate billed tokens rapidly because:

1. **Cache invalidation waste** — dynamic content injected into the prompt prefix silently
   invalidates Anthropic's prompt cache, forfeiting the 10× cache-read discount
2. **Context defocus / bloat** — long sessions accumulate stale tool-output blocks the model never
   references again, but keeps paying for on every turn
3. **Tokenizer inflation** — Opus 4.7 produces up to **35% more tokens** for the same input text
   vs. Opus 4.6, especially on identifier-heavy code, JSON, and base64

### Cost of Doing Nothing

Naively-routed prompts pay 1.0× base input cost on every turn instead of 0.1× for cacheable
prefixes — a missed ~10× discount. Reported real-world cache-hit ratios *after deliberate prefix
design* sit at **50–84%** (Helicone, Vellum, ProjectDiscovery); rates below 20% are classified as
a "prefix-design failure, not a model limitation."

### Why Now

- Anthropic's prompt cache is documented, stable, and workspace-isolated (Feb 5, 2026)
- The seven-tool ecosystem has converged on four reduction axes, leaving cache discipline untouched
- Opus 4.7's tokenizer inflation compounds the urgency

---

## Research Findings

### Anthropic Prompt Cache Mechanics (April 2026 Pricing)

| Operation | Price multiplier | Notes |
|-----------|-----------------|-------|
| Cache read | **0.1×** base input | 90% discount |
| 5-minute cache write | **1.25×** base input | Default TTL |
| 1-hour cache write | **2.0×** base input | Break-even at 2 reads |
| Cache match requirement | Byte-identical prefix to `cache_control` breakpoint | Any change invalidates |
| Workspace isolation | Per-workspace | Since Feb 5, 2026 |

### Real-World Cache-Hit Ratios (After Deliberate Prefix Design)

| Source | Range |
|--------|-------|
| ProjectDiscovery, Helicone, Vellum | **50–84%** |
| Sub-20% rates | Classified as prefix-design failure |

### Context Mode (Existing Tool) Benchmarks

| Input | Output | Reduction |
|-------|--------|-----------|
| 56 KB Playwright snapshot | 299 bytes | ~99.5% |
| 46 KB access log | 155 bytes | ~99.7% |
| 315 KB session | ~5 KB total | ~98% |

### Code Graph (Existing Tool) Benchmarks

| Metric | Value |
|--------|-------|
| Small repo (125-file) reduction | ~4.6× |
| Large monorepo (27k-file) reduction | ~49× |
| Average on review tasks | 6.8× |
| Blast-radius summary size | 156–207 tokens |
| Code-review quality score (10-point scale) | 7.2 → **8.8** |
| Initial graph build cost | ~10s per 500 files |
| Incremental update | typically < 2 seconds |

### Opus 4.7 Tokenizer Inflation

| Property | Value |
|----------|-------|
| Token inflation vs. Opus 4.6 | Up to **35%** more for same input |
| Most-affected content | Identifier-heavy code, JSON, base64 |

### Worked Cache-Arithmetic Example

Prefix = 30k tokens, reused across 10 turns:
- **Naïve (no cache):** 1.0× × 10 = **10.0 prefix-units**
- **Cache-aware:** 1.25× (one write) + 0.1× × 9 (nine reads) = **2.15 prefix-units**
- → **4.6× reduction** on the cached portion alone

---

## Approaches Evaluated

### M1 — Cache-Aware Context Orchestration

**Verdict: CHOSEN — core product.**

| Dimension | Value |
|-----------|-------|
| Feasibility | 5/5 |
| Differentiation | 5/5 |
| Score | 100 |
| Expected savings | **30–60%** on cacheable workloads |

**Mechanism:** Middleware that classifies each prompt block by volatility, reorders into three regions
(stable prefix → semi-stable middle → volatile suffix), and places two `cache_control` breakpoints.
A keepalive worker pings every ~4 minutes to prevent TTL expiry.

**Why chosen:**
- Targets the largest unexploited cost lever
- Compounds with every existing tool rather than competing
- Directly verifiable on the user's own Anthropic invoice (`cache_read_input_tokens`)
- Low technical risk — uses a documented, stable cache primitive

**Cons:** Requires correct block classification; keepalive pings add small cost; workspace isolation
complicates multi-workspace setup.

---

### M2 — Trajectory-Aware Retrospective Pruning

**Verdict: CHOSEN — closely coupled second feature.**

| Dimension | Value |
|-----------|-------|
| Feasibility | 3/5 |
| Differentiation | 5/5 |
| Score | 75 |
| Expected savings | **30–50%** of mid-conversation tokens on long sessions |
| Pruner delta on 15-turn session (K=3) | **+10–15 pp** over M1 alone |

**Mechanism:** After each completed assistant turn, parse tool-call sequence and final answer to
identify which previously-injected blocks were actually referenced. Replace blocks unreferenced for
≥ K consecutive turns with one-line stubs + re-fetch handles.

**Why chosen:**
- Strong differentiation (no public tool prunes per-block on a usage signal)
- Conservative K=3 policy bounds the downside (re-fetch cost)
- Non-lossy because stubs are refetchable

**Cons:** Reference-detection accuracy matters; false negatives cost a re-fetch round-trip; savings
depend on session length and noise rate.

---

### M3 — Tokenizer-Aware Content Rewriting

**Verdict: DEFERRED — fast-follow.**

| Dimension | Value |
|-----------|-------|
| Feasibility | 4/5 |
| Differentiation | 3/5 |
| Score | 45 |
| Expected savings | **10–25%** on identifier-heavy or JSON-heavy turns |

**Mechanism:** Before sending, measure content with the target tokenizer and apply
equivalence-preserving transforms: minify JSON, strip non-significant whitespace, alias verbose
identifiers (with reversible mapping), prefer line-oriented diffs over full-file dumps.

**Rejected from v1 because:** Identifier aliasing may degrade quality on code-edit tasks; best
shipped as per-block opt-in, not default.

---

### M4 — Speculative / Budgeted Inclusion

**Verdict: DEFERRED.**

| Dimension | Value |
|-----------|-------|
| Feasibility | 3/5 |
| Differentiation | 3/5 |
| Score | 55 |
| Expected savings | **20–40%** vs. include-everything |

**Mechanism:** Score every candidate block by relevance within a token budget; include
high-confidence blocks in full, low-confidence blocks as stubs with "expand-on-demand."

**Rejected from v1 because:** Depends on an existing retrieval tool (claude-context, Code Graph);
conceptually similar to Token Savior; not as concentrated a lever as M1/M2.

---

### M5 — Cross-Session Decision Distillation

**Verdict: REJECTED.**

| Dimension | Value |
|-----------|-------|
| Feasibility | 4/5 |
| Differentiation | 2/5 |
| Score | 30 |

**Mechanism:** At session end, distill durable decisions into compact structured Markdown. Only
relevant decision notes load on session start.

**Rejected because:** "Differentiation against memsearch is thin" — overlaps an existing mature
tool without meaningful improvement.

---

### Evaluation Matrix

| Methodology | Feasibility | Differentiation | Est. savings | Compounds? | Score |
|-------------|------------|----------------|-------------|------------|-------|
| M1 Cache-aware orchestration | 5 | 5 | 30–60% on cacheable workloads | Yes — independent layer | **100** |
| M2 Trajectory-aware pruning | 3 | 5 | 25–45% on long sessions | Yes — operates on retained context | **75** |
| M4 Speculative inclusion | 3 | 3 | 20–40% | Partially — relies on existing retrievers | 55 |
| M3 Tokenizer-aware rewriting | 4 | 3 | 10–25% | Yes — pre-send transformation | 45 |
| M5 Decision distillation | 4 | 2 | Variable; mostly cross-session | Overlaps memsearch | 30 |

---

## Architecture Decision Records

### ADR-001: Build a Cache-Discipline Layer, Not Another Retrieval/Filter Tool

**Status:** Accepted  
**Context:** The seven-tool ecosystem already covers four reduction axes. Adding an eighth tool on
those axes invites direct competition with mature incumbents.  
**Decision:** Target the prompt cache — a fifth, untouched axis. Build Cachelane as a cache-aware
orchestrator that reorders content into `STABLE | SEMI | VOLATILE` regions with `cache_control`
breakpoints.  
**Alternatives considered:**
- Compete with Context Mode on upstream filtering — rejected (mature incumbent)
- Compete with Code Graph on structural indexing — rejected (mature incumbent)
- Build a memsearch-like distillation tool (M5) — rejected (thin differentiation)

**Consequences:**
- (+) Compounds multiplicatively with the existing stack rather than competing
- (+) Directly verifiable on user's own API invoice
- (−) Requires careful block classification
- (−) Workspace-level isolation complicates multi-workspace setups

**Source:** Research doc §Executive Summary, §1.3, §2.5, §3.1

---

### ADR-002: Pair M1 (Cache Orchestration) with M2 (Trajectory Pruning) in v1

**Status:** Accepted  
**Context:** M1 addresses cache invalidation but not long-session context bloat. M2 addresses
bloat but is not as concentrated a lever as M1 alone.  
**Decision:** Ship both in v1.  
**Alternatives:** Ship M1 alone (leaves bloat); ship M2 alone (misses the cache lever); ship
M1+M3 (M3's differentiation weaker than M2's).  
**Consequences:** (+) Targets two distinct surfaces. (+) Both measurable on API usage fields.
(−) Increases v1 scope. (−) Pruner adds quality-regression risk.  
**Source:** §2.5

---

### ADR-003: Defer Tokenizer-Aware Rewriting (M3) to Fast-Follow

**Status:** Deferred  
**Context:** M3 yields 10–25% on identifier-heavy turns (relevant under Opus 4.7's 35% inflation)
but identifier aliasing risks degrading code-edit quality.  
**Decision:** Ship M3 as optional per-block opt-in, never default, post-v1.  
**Consequences:** (+) Keeps v1 surface area smaller. (−) Leaves 10–25% on the table until
follow-up.  
**Source:** §2.5

---

### ADR-004: Reject Speculative Inclusion (M4) and Decision Distillation (M5)

**Status:** Rejected  
**Context:** Both score below M2 on the combined matrix.  
**Decision:** Defer M4; reject M5 due to overlap with memsearch.  
**Consequences:** (−) Foregoes 20–40% potential savings from M4 in scoped scenarios.
(+) Preserves clear product positioning.  
**Source:** §2.3 (M4, M5), §2.4 matrix

---

### ADR-005: Deploy as MCP Server + Claude Code Hooks

**Status:** Accepted  
**Context:** Existing Claude Code tools deploy as MCP servers — this is the ecosystem-native pattern.  
**Decision:** MCP server (primary) + PreRequest hook (reordering) + PostResponse hook (reference-log
update) + CLI.  
**Alternatives:** API proxy at network layer (rejected — heavier integration); pure CLI
(rejected — can't intercept per-turn).  
**Consequences:** (+) Familiar for Claude Code users. (+) Coexists with all other MCP tools.
(−) Two hook surfaces to maintain.  
**Source:** §3.2, §3.3, §3.4

---

### ADR-006: Three-Region Prompt Layout with Two Cache Breakpoints

**Status:** Accepted  
**Context:** Cache hits require byte-identical prefixes to a `cache_control` breakpoint.
Single-breakpoint designs force a binary stable/volatile choice.  
**Decision:** Reorder into prefix (STABLE), middle (SEMI), suffix (VOLATILE); place breakpoints at
end-of-prefix and end-of-middle.  
**Alternatives:** Single breakpoint (too coarse); no breakpoints (defeats the design).  
**Consequences:** (+) Mid-section gets partial cache benefit. (−) Classifier complexity increases.  
**Source:** §3.2 steps 2–3

---

### ADR-007: Local-Only Architecture — No Hosted Backend

**Status:** Accepted  
**Context:** A hosted backend would add cost, privacy risk, and operational complexity.  
**Decision:** Everything runs locally. The only network call is the direct HTTPS path to
`api.anthropic.com`.  
**Alternatives:** SaaS gateway (rejected — cost, privacy); analytics endpoint (deferred to opt-in
telemetry only).  
**Consequences:** (+) Zero marginal infra cost. (+) No privacy risk. (−) No centralised analytics.  
**Source:** §3.3, D7

---

### ADR-008: Conservative Pruner Default of K=3

**Status:** Accepted (empirical tuning planned)  
**Context:** Aggressive pruning costs re-fetches when a stubbed block becomes relevant again;
conservative pruning leaves more bloat.  
**Decision:** Default K=3; `--aggressive` K=2; `--conservative` K=5.  
**Alternatives:** K=1 (rejected — high false-negative cost); K=5+ (rejected — loses too much benefit).  
**Consequences:** (+) Bounded downside. (−) Sub-optimal until per-scenario tuning lands.  
**Source:** §2.3 M2, §3.4, §3.6

---

### ADR-009: Measure Success on Directly-Billed API Fields

**Status:** Accepted  
**Context:** Claims must be verifiable on the user's own Anthropic invoice.  
**Decision:** Primary metrics: `cache_read_input_tokens`, `cache_creation_input_tokens`,
`input_tokens` from every API response, plus wall-clock latency and LLM-judge quality regression
check (tolerance ≤ 5%).  
**Alternatives:** Self-reported reduction percentages (rejected — not externally verifiable);
character-count metrics (rejected — Opus 4.7 tokenizer divergence makes them misleading).  
**Source:** §3.5

---

### ADR-010: MIT License, Distribute via npm + Claude Code Plugin Marketplace

**Status:** Accepted  
**Context:** Adoption depends on frictionless install alongside existing tools.  
**Decision:** MIT license, public GitHub, dual distribution (`npm install -g cachelane` and
`claude plugin add`). Reproducible `BENCHMARK.md`.  
**Alternatives:** Commercial license (rejected — friction); single-channel distribution
(rejected — fewer users).  
**Source:** §3.7

---

## Performance Targets

| Metric | Baseline | v1.0 Target | Stretch |
|--------|----------|-------------|---------|
| Cache-hit ratio (avg across 5 scenarios, B2) | ~0% (no cache-aware reordering) | **≥ 0.55** | 0.50–0.84 (in line with real-world reports) |
| Effective input cost reduction vs. B1 | 1.0× B1 | **≥ 40% reduction** | 30–60% (M1's expected range) |
| Quality regression (LLM-judge) | identical task | **≤ 5% noise tolerance** | 0% degradation expected |
| Additional pruner savings (15-turn, K=3) | 0 pp | **+10–15 pp** | upper end of 25–45% M2 range |
| Cache-read price multiplier | 1.0× base input | 0.1× (Anthropic-defined) | — |
| Worked-example prefix cost (10 turns) | 10.0 prefix-units | **2.15 prefix-units (4.6× reduction)** | — |

**Validation baselines:**
- **B0** — Claude Code, no third-party tools
- **B1** — Claude Code + Context Mode + Code Graph + Caveman (published "starter stack")
- **B2** — B1 + Cachelane (M1 only)
- **B3** — B2 + K-pruner (M2) enabled

---

## Validation Plan

**Metrics (§3.5):**
- Cache-hit ratio = `cache_read_input_tokens / (input + cache_creation + cache_read)` per turn, averaged per session
- Effective input cost per turn = `1.0×input + 1.25×cache_creation_5m + 2.0×cache_creation_1h + 0.1×cache_read`
- Wall-clock time-to-first-token (cache hits reduce latency)
- Quality regression: same task + same final user prompt, with vs. without Cachelane; LLM-judge scoring

**Five test scenarios:**
1. Code review of a 200-line commit on a 5k-file Python repo (FastAPI fork)
2. Bug fix requiring 3–5 file edits across modules on a TypeScript monorepo
3. Multi-turn refactor: 15-turn session on a 500-file Rust project (context-bloat-dominant)
4. Plain Q&A about a documented codebase: 5 turns, no edits (read-mostly)
5. Long-running session held open with sparse input over 30 minutes (tests keepalive)

**Distribution:** Reproducible scripts in `BENCHMARK.md`; optional anonymised telemetry for
cache-hit ratios.

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Misclassification — "stable" block varies turn-to-turn, invalidates cache | High | `cachelane explain` exposes per-turn classifier reasoning; `pin`/`exclude` CLI overrides; PostResponse detects cache miss vs. expected hit |
| Pruner false negatives (stubbing a block that becomes relevant) | Medium | Conservative K=3 default; re-fetch handle on every stub; transitive "used"-flag propagation; `--aggressive` is opt-in |
| Cache breakpoint design failure (< 20% hit ratio) | High | Direct measurement on `cache_read_input_tokens`; explicit benchmarks; documented recommended prefix pattern |
| Workspace isolation breaks cross-workspace prefix sharing | Medium | Key by workspace ID; document multi-workspace pattern in README |
| 5-min TTL kills cache on sparse sessions | Medium | Keepalive worker; consider auto-1-hour TTL for prefixes > 50k tokens |
| Opus 4.7 tokenizer inflates "stable" prefix beyond cache benefit | Low | Per-tokenizer measurement before reorder; M3 fast-follow addresses directly |
| Quality regression from identifier aliasing in M3 | Medium | M3 deferred from v1; will ship as per-block opt-in |
| Anthropic ships native cache orchestration | Strategic | Open-source, MIT, no telemetry dependency; pivot pruner forward if needed |
| Cache-state tracker drift between Cachelane and Anthropic | Medium | Reconcile against `usage` block every API response; API response is source of truth |

---

## Citations / Prior Art

| Tool | Reduction axis |
|------|---------------|
| RTK | Upstream filtering — verbose shell/CLI output |
| Context Mode | Upstream filtering — raw tool output |
| code-review-graph | Structural pre-indexing — blind file reads in large repos |
| Token Savior | Progressive disclosure — full-file reads |
| Caveman | Output-side compression — Claude's own verbose responses |
| claude-context | Semantic retrieval — repeated codebase exploration |
| memsearch | Cross-session memory — re-explained project decisions |
| **Cachelane** | **Cache discipline + trajectory pruning** — cache-prefix invalidation and stale retained context |

**Key numeric references:**
- Anthropic prompt-cache pricing (April 2026) — cited above
- 50–84% real-world cache-hit ratios — Helicone, Vellum, ProjectDiscovery
- Opus 4.7 tokenizer increase: up to 35% — research doc Appendix B
- Context Mode 98% reduction on tool output — research doc Appendix B
- Code Graph 4.6× to 49× reduction — research doc Appendix B
- Milvus "context defocus" analysis — basis for ~60% unreferenced-block estimate driving M2

---

## Open Questions

| ID | Question |
|----|----------|
| Q003 | Optimal K value per scenario — K=3 is a starting guess; empirical experiment planned |
| Q_A | Keepalive experiment funding path: Pro/Max-paced ($0, ~2 weeks), analytical-only ($0, no benchmarks), or separate API account (~$80) — awaiting project-lead decision |
