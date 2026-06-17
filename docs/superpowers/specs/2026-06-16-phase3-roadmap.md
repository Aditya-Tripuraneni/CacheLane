# CacheLane Phase 3 — Observability, Reliability & Correctness Roadmap

**Date:** 2026-06-16
**Status:** Roadmap (brainstorming). Deep specs linked per theme.
**Topic:** Next major development phase after early traction — make CacheLane's value
*visible*, *trustworthy*, and *provable*.

---

## Why this phase

CacheLane works (proxy + classifier + pruner + reorderer + keepalive, all fail-open, all
local). But three credibility gaps surfaced from real users and public threads:

1. **"I can't see what it's doing for me."** Observability is terminal-only (`cachelane stats`,
   `explain`, `sessions`, a TUI dashboard). There is no shareable, visual view of token usage,
   savings vs. baseline, or per-turn decisions.
2. **"Is this any different from Anthropic's own prefix cache?"** (Reddit). We have no artifact
   that *shows* the long-session divergence — the "CacheLane curve" — or defines what a "long
   session" even is.
3. **"How do I know pruning didn't lose information?"** `benchmark:recorded` measures token
   deltas + hit rate only. There is **no** cache-correctness metric (rehydration recall /
   stale-answer rate). The non-lossy claim is currently asserted, not measured.

Plus an onboarding/reliability concern: proxy chaining (GitHub issue #22 — Headroom) works via
config, but nothing *verifies* a chained setup is actually healthy; CacheLane can silently
fail-open and the user never knows.

## Invariants (unchanged — every item below must honor these)

- **Fail-open**: any error returns the unmutated request. New code never blocks the model.
- **Local-only**: no content leaves the Anthropic request path; no hosted backend.
- **No block content persisted**: SQLite stores hashes/metadata/counts only. Reports inherit this.
- **Vocabulary**: `STABLE | SEMI | VOLATILE` everywhere.
- **Naming**: snake_case at storage/API/network boundaries; camelCase for in-process helpers.
- **Pipeline order**: Classifier → Pruner → Reorderer (canonical).
- **No new npm deps without an ADR.** Charts/HTML are generated as strings in Node.
- **Cache-stability gate** still blocks merge.

---

## Themes, priority & sequencing

| # | Theme | Deep spec? | Priority | Rationale |
|---|-------|-----------|----------|-----------|
| T1 | **Observability web UI** (`cachelane report` → self-contained HTML) | ✅ [spec](2026-06-16-observability-web-ui-design.md) | P0 | Highest leverage; absorbs the Reddit-curve (T4) and per-turn viz (T5) as *views*. Makes value visible + shareable. |
| T2 | **Cache-correctness benchmarking** (rehydration recall + stale-answer rate) | ✅ [spec](2026-06-16-cache-correctness-benchmark-design.md) | P0 | Directly answers a raised credibility concern; the non-lossy claim is currently unmeasured. Deterministic, CI-gating. |
| T3 | **Reliability & onboarding** (chain-aware doctor, first-run verify, fail-open visibility) | ✅ [spec](2026-06-16-reliability-onboarding-design.md) | P1 | Turns GH #22 prose into automated checks; catches silent degradation. Mostly extends `doctor`. |
| T4 | **Prefix-cache differentiation / "the CacheLane curve"** | Folded into T1 | P0 (via T1) | Not a standalone build — it is a *view* in the web UI plus a written analysis section. See T1 spec §curve. |
| T5 | **Per-turn decision-record visualization** | Folded into T1 | P0 (via T1) | The visual form of `cachelane explain`; a view in the web UI sourced from `turn_explanations`. See T1 spec §per-turn. |

**Build order:** T2 first or in parallel with T1 (T2 is self-contained and unblocks a
correctness number the web UI can surface). T1 next (the big visible win). T3 last (smallest,
extends existing `doctor`/`format`). T4/T5 ship inside T1.

### Why T4 and T5 fold into T1

Both T4 (long-session curve) and T5 (per-turn decision record) are fundamentally *rendering*
problems over data the DB already holds (`turns`, `turn_explanations`). Building a second
surface for them would duplicate the report harness. They become two of the web UI's views.
The *investigation* half of T4 (why people think CacheLane ≈ prefix cache, what defines a long
session) is written analysis, captured in the T1 spec's curve section and summarized below.

---

## T4 investigation summary (the Reddit critique)

**Claim:** "CacheLane is no different from Anthropic's prefix cache."

**Why the claim feels true on short sessions:** Anthropic's prompt cache already discounts a
byte-identical prefix to 0.1×. On a short, stable session the *naive* prefix is already mostly
cacheable, so CacheLane's reordering adds little — the curves nearly overlap. CacheLane's value
is **conditional on the prompt being cache-hostile** (volatile content interleaved into the
prefix, which invalidates the cache from the first changed byte) **and on session length**.

**Where CacheLane diverges (and the curve shows it):**
- **Reordering** rescues cache hits that the naive layout *loses* whenever a volatile block sits
  before a stable one — Anthropic's cache invalidates from the first differing byte, so a single
  early-placed volatile block can drop the hit rate to ~0. CacheLane moves volatility to the
  suffix so the stable prefix stays byte-identical.
- **K-pruning** flattens token *growth*: prefix caching never shrinks the prompt, so input
  tokens grow unboundedly with session length; pruning replaces idle blocks with stubs. This is
  a lever Anthropic's cache simply does not have.

**Definition of "long session" (to be stated in product copy + the curve view):** a session is
**long** once K-pruning and middle-region reuse begin to compound — operationally **≥ 15 turns**
(matching the M2 framing in `01-system-overview.md`: K-pruning adds +10–15pp on 15-turn sessions
at K=3). The curve view annotates the turn at which the ON/OFF lines diverge and where the first
prune fires.

**Observability implication:** the differentiation is not a slogan, it is a *measurement*. The
`cachelane report` curve view is the artifact that settles the argument with the user's own data.

---

## Roadmap entries that are NOT deep-spec'd this cycle (future cycles)

- **R1 — Guided chain setup command** (`cachelane chain <downstream>`): interactive writer for
  upstream config to a named downstream proxy (Headroom on :8787). Nice-to-have; the chain-aware
  doctor (T3) covers the verification need first.
- **R2 — Model-judged answer equivalence** (opt-in `--judge` benchmark mode): LLM-as-judge that
  pruning-ON vs OFF final answers are equivalent. Realistic but non-deterministic, costs tokens,
  can't gate CI. Roadmap after T2's deterministic recall lands.
- **R3 — Live/auto-refresh report server** (`cachelane report --serve`): localhost server with
  live SQLite querying. Deferred in favor of the static-bundle approach (zero server surface).
- **R4 — Telemetry-backed community benchmarks**: opt-in aggregate of savings curves to publish
  real distributions ("p50 savings at 30 turns"). Gated on the telemetry opt-in decision (Q007).

---

## Cross-cutting acceptance for the phase

- Every new CLI command is fail-open and prints a clear error rather than throwing.
- Every new report/output asserts `content_persisted: false` and is auditably content-free.
- New benchmark metrics run in CI with `--estimate-only`-equivalent determinism.
- `npm test`, `npm run lint`, `npx tsc --noEmit` green; output pasted before "done"
  (verification-before-completion).
