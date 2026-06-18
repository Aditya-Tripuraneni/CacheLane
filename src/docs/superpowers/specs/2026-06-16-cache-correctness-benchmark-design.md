# CacheLane Cache-Correctness Benchmark — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorming), pending implementation plan
**Topic:** Add deterministic **rehydration recall** and **stale-answer rate** metrics to the
benchmark suite, so the "K-pruning is non-lossy" claim is measured, not just asserted.
**Roadmap:** [Phase 3 roadmap](2026-06-16-phase3-roadmap.md) — theme T2.

## Problem

`benchmark/recorded.ts` (`generateRecordedBenchmarkReport`) measures **token deltas** and
**cache-hit ratio** only. It counts a block as `stub` if `block.kind === "stub"`, but never
checks whether a stubbed block that was *later needed* was correctly restored. The core
correctness promise of K-pruning — *"stubs are refetchable, so pruning loses no information"* —
is currently unverified by any test or metric. This was raised directly by users as a
credibility gap (stale-answer rates).

## Goals

- Add two deterministic, content-free, CI-gating metrics:
  - **rehydration_recall** = `restored_correctly / (stubbed ∩ later_referenced)`
  - **stale_answer_rate** = `needed_but_unavailable / needed`
- Deterministic: byte-comparison over normalized traces, **no LLM judge, no network**, runs in
  CI. (Model-judged equivalence is roadmap R2, opt-in `--judge`, explicitly deferred.)
- Fits the existing recorded-benchmark harness and normalized-trace format; reuses
  `expandStub` / pruner internals so the metric exercises the *real* rehydration path.
- Respects invariants: fail-open, local-only, report stays content-free
  (`content_persisted: false`), `STABLE|SEMI|VOLATILE` vocabulary, snake_case at boundaries.

## Non-goals

- Not model-judged answer equivalence (roadmap R2).
- Not changing pruning behavior — this measures it.
- No new npm deps.

## Definitions (precise, so the metric is unambiguous)

Over a normalized trace session (`NormalizedTraceSession`: turns with `blocks_in_prompt`,
`tool_calls`, plus the scenario's `expected_references`):

- A block is **stubbed** at turn *t* if its `unused_turns ≥ K` per the K-pruning rule, i.e. it
  would be replaced by a stub by `pruneExpiredBlocks` at turn *t*. We replay the real pruning
  decision rather than relying solely on `kind === "stub"` in the trace.
- A block is **later referenced** if, at some turn *u > t*, the assistant references it — by the
  three-signal detector's criteria (file path in a tool call, block id in assistant text, or
  shingle overlap) **or** it appears in `expected_references`.
- A stubbed-then-referenced block is **restored_correctly** if invoking the real rehydration
  path (`expandStub`) returns `ok: true` with a `refetch_request` whose handle resolves to the
  **same block id** as the pre-stub block. *(Note: `expandStub` deliberately returns a refetch
  handle, not content — content is never stored, per the privacy invariant. The byte-identity
  check is performed against the **trace-held content**, which fixtures carry in
  `TraceCorpusBlock.content`: we assert `hash(trace content at refetch turn) == content_hash of
  the original block`. The DB path proves the handle is restorable; the trace path proves the
  restorable content is unchanged.)*
- **needed** = blocks that are referenced at some turn after they entered context.
- **needed_but_unavailable** = needed blocks for which `expandStub` returns `ok: false` (no
  refetch handle / not a stub / ambiguous), OR the trace content at the refetch turn hashes
  differently than the original (a genuine stale answer — content drifted under the stub).

`rehydration_recall = 1.0` and `stale_answer_rate = 0.0` is the passing (non-lossy) state.

## Chosen approach

A new module `src/benchmark/correctness.ts` that consumes the **same**
`NormalizedTraceSession[]` the recorded benchmark already loads, and replays pruning +
rehydration deterministically.

```ts
interface CorrectnessScenarioRow {
  scenario_id: string;
  session_id: string;
  k: number;
  stubbed_blocks: number;
  stubbed_then_referenced: number;
  restored_correctly: number;
  needed_blocks: number;
  needed_but_unavailable: number;
  rehydration_recall: number;   // restored_correctly / stubbed_then_referenced (1.0 if denom 0)
  stale_answer_rate: number;    // needed_but_unavailable / needed_blocks (0.0 if denom 0)
}

interface CorrectnessReport {
  run_id: string;
  generated_at: string;
  k: number;
  source: { kind: "normalized_trace"; provider: string | null; normalized_dir: string | null };
  totals: {
    stubbed_blocks: number;
    stubbed_then_referenced: number;
    restored_correctly: number;
    needed_blocks: number;
    needed_but_unavailable: number;
    rehydration_recall: number;
    stale_answer_rate: number;
  };
  scenarios: CorrectnessScenarioRow[];
  privacy: { content_persisted: false };
}
```

### Reuse, don't reinvent (resolved against code)

- **Pruning replay — use the REAL path, no predicate extraction.** The prune predicate lives in
  SQL (`getPrunableBlocks`, `src/storage/data-access.ts:238`), and it is **age-based OR
  idle-based**: `(@current_turn - added_at_turn) >= @k OR unused_turns >= @k`, gated on
  `is_stub = 0 AND is_pinned = 0 AND volatility != 'STABLE' AND refetch_handle IS NOT NULL`.
  The benchmark seeds an **in-memory better-sqlite3 DB** from the trace blocks and replays the
  production sequence per turn: `getPrunableBlocks` → `pruneExpiredBlocks` (`markStubs`) →
  later `expandStub`. The metric therefore measures exactly what the runtime does — it cannot
  pass while the runtime is broken, or vice versa. The replay must honor *both* prune triggers.
- **Reference detection:** reuse `detectReferences` / `detectDetailedReferences` from
  `src/references/` for the "later referenced" signal — the same detector the runtime uses.
- **Rehydration:** drive the real `expandStub` against that in-memory DB, so the metric tests
  the production refetch path, not a stand-in.

## Section 1 — CLI / npm surface

- New subcommand: `cachelane benchmark correctness <trace>` (mirrors `benchmark compare`),
  emitting `correctness-report.json` + a markdown summary, with `--k <n>` (default from config /
  3) and `--json`.
- New npm script `benchmark:correctness` parallel to `benchmark:recorded`, run in CI.
- Optionally fold a one-line correctness summary into the existing recorded report footer
  (recall %, stale %) so the headline benchmark surfaces correctness too — settle in plan.

## Section 2 — CI gate

Add a CI assertion (cache-stability-style gate): over the committed synthetic + recorded
traces, **`rehydration_recall == 1.0` and `stale_answer_rate == 0.0`**. Any regression where a
needed block can't be losslessly restored **blocks merge**. This converts the non-lossy claim
into an enforced invariant.

## Section 3 — Testing (TDD)

- `correctness.test.ts`: table-driven over fixtures:
  - block stubbed then never referenced → counts as stubbed, not as needed; recall denom 0 → 1.0.
  - block stubbed then referenced and correctly restored → recall 1.0.
  - block stubbed, referenced, but refetch handle missing → stale_answer_rate > 0 (the failing
    case — proves the metric actually detects loss).
  - mixed multi-scenario totals aggregate correctly.
- Fixtures as JSON normalized traces under `src/benchmark/__tests__/fixtures/correctness/`,
  including at least one *deliberately lossy* trace so the metric is proven to fail when it
  should (red test that stays red until pruning would actually lose data).
- Reuse existing corpus/synthetic traces where they already contain stub lifecycles.

## Open questions for implementation plan

- Whether the "lossy" fixture is synthesized by removing a refetch handle, or by a trace where a
  block's content legitimately changed between stub and refetch (file edited) — the latter is
  the more realistic stale case; recommend including both.
- ~~Exact home for the pruning predicate extraction~~ **RESOLVED:** no extraction — replay the
  real `getPrunableBlocks`/`pruneExpiredBlocks`/`expandStub` against an in-memory DB. Honor both
  the age-based and idle-based triggers.
- Whether `expected_references` should be authoritative for "needed", or only the detector
  (recommend: union, with the detector as primary and `expected_references` as a backstop).
- Pricing/markdown summary format alignment with the recorded report.
