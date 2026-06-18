# M3 Orchestrator Core — Implementation Plan

> **Workflow:** `superpowers:executing-plans` drives `superpowers:subagent-driven-development`, with `superpowers:test-driven-development` enforced per task, `superpowers:verification-before-completion` gating completion, and `superpowers:finishing-a-development-branch` for PR. Plan file lives at `docs/superpowers/plans/2026-05-18-m3-orchestrator-core.md` once execution starts (per `CLAUDE.md` workflow).

---

## Context

**Why this change.** M2 (PR #2) tagged blocks with `kind`, `volatility`, and `is_pinned`. Nothing yet uses the tags. M3 makes them load-bearing: reorders blocks into the three regions (`prefix`/`middle`/`suffix`), places two `cache_control` breakpoints (per ADR-006), and mutates the outgoing Anthropic Messages request body. **The cache-stability gate activates for the first time** — SHA-256 of the prefix region must be byte-identical across 3 consecutive identical-input runs (REQ-NF-010, AC-1, AC-3) — and **failure blocks merge with no exceptions**.

**Branch base.** Stacked off `feat/m2-classifier` (PR #2 still open). The M3 PR will be re-targeted to `main` after M2 merges. Branch name: `feat/m3-orchestrator` (follows the M1/M2 convention).

**Intended outcome.** A pure `orchestrate(input)` function in `src/orchestrator/` that takes raw blocks + classifications + prior `PrefixState` and returns a mutated request body. No persistence side-effects (M4's job). Fail-open on any error — return the original unmutated request, never throw, never block a turn.

**KPIs (M3 milestone gate, `designs/06-systems-design.md` line 363):**
- **Cache-stability test passes 5 scenarios** (AC-2): empty schemas / large schemas / middle included / middle empty / active-pruning stub-just-created.
- All 11 BlockKind values correctly placed in the right region (STABLE→prefix, SEMI→middle, VOLATILE→suffix, stub→prefix).
- `tool_use_result_pair` blocks remain atomic (never split — REQ-F-028, ADR-006).
- `npm test`, `npm run lint`, `npx tsc --noEmit` all clean.
- Fail-open verified: orchestrator throw → returns the original request bytes unchanged.

---

## Lessons applied from M1 + M2

| Prior issue | M3 mitigation |
|---|---|
| Node 24 storage-test breakage | PR body restates Node 20 requirement; CI must pin `actions/setup-node@v4` to 20 |
| Paper gates (ADR-011) | Cache-stability test has a concrete SHA-256 assertion across 3 runs for each of 5 scenarios |
| No .gitignore in M1 | Already added in M2; M3 inherits |
| Late spec consult | 4 open questions flagged in the plan upfront for reviewer to confirm against the binding .docx |

---

## Decisions resolved before implementation

1. **Branch off `feat/m2-classifier`** (stacked PR); re-target to `main` after M2 merges.
2. **No new npm deps** — define a minimal local `AnthropicMessagesRequest` type in `src/orchestrator/types.ts` instead of installing `@anthropic-ai/sdk` (deferred to M7).
3. **Scenario #5 of cache-stability** ("stub-just-created") covered by hand-constructing a `Block` with `kind: "stub"` in the fixture. Real pruner integration arrives in M5.
4. **`tool_use_result_pair` atomicity** — these blocks come pre-paired by upstream (the orchestrator does not pair). The reorderer treats them as one unit (single sort key, single move).
5. **Middle breakpoint placement** (ADR-006): only inserted when the current middle-region hash matches the prior turn's middle hash — i.e., "seen byte-identical twice consecutively". First turn always omits the middle breakpoint.
6. **TTL class** hardcoded to `"5m"` for M3. The `"1h"` heuristic (prefix size ≥ `large_prefix_threshold_tokens`) is wired in M6 keepalive logic.
7. **No persistence in M3.** `db.insertTurn(...)` is M4 PostResponse work. The orchestrator returns metadata for M4 to consume, but does not write.
8. **Module layering** (confirmed via `eslint.config.js` lines 35–49 and `designs/06-systems-design.md` lines 50–62): `src/orchestrator/` imports `types`, `classifier`, `config`, `storage`, `tokenizer` directly. Downward imports only. No new lint zones needed (the M1 zones already block upward imports).

---

## Critical invariants (must not violate)

1. **Vocabulary** — `STABLE | SEMI | VOLATILE` only. Wire types in snake_case.
2. **Fail-open** — any throw inside `orchestrate()` is caught at the top level; returns `{ request: input.original_request, mutated: false, signals: ["error:fallback"] }`.
3. **Stateless per call** — the function is pure given inputs + prior `PrefixState`. `CacheStateTracker` holds state across calls but is passed in explicitly.
4. **Atomic pairs** — `(tool_use, tool_result)` pairs (already merged into one `tool_use_result_pair` block by upstream) are moved as one unit. Never split.
5. **Cache-stability** — same logical input + same prior `PrefixState` → byte-identical prefix bytes (SHA-256). Across 3 identical runs. For all 5 AC-2 scenarios.
6. **No upward imports** — orchestrator imports downward only; eslint blocks anyone importing FROM `orchestrator` into `classifier`/`storage`/etc.

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/orchestrator/types.ts` | `OrchestratorInput`, `AnthropicMessagesRequest` (minimal local), `RegionBoundaries`, `Breakpoints`, `MutatedRequest` |
| Create | `src/orchestrator/reorderer.ts` | Pure: sort classified blocks into STABLE/SEMI/VOLATILE buckets; preserve intra-bucket order; respect pair atomicity |
| Create | `src/orchestrator/breakpoint-placer.ts` | Pure: compute prefix end + middle end indexes; compute SHA-256 of each region's canonical bytes |
| Create | `src/orchestrator/request-mutator.ts` | Pure: assemble `AnthropicMessagesRequest` with `cache_control` markers at breakpoints |
| Create | `src/orchestrator/cache-state-tracker.ts` | `Map<workspace_id, PrefixState>` wrapper with `get`/`update`/`reset` |
| Create | `src/orchestrator/index.ts` | Public `orchestrate(input, tracker, config)`; top-level try/catch fail-open |
| Create | `src/orchestrator/__tests__/reorderer.test.ts` | 6 tests |
| Create | `src/orchestrator/__tests__/breakpoint-placer.test.ts` | 5 tests |
| Create | `src/orchestrator/__tests__/request-mutator.test.ts` | 4 tests |
| Create | `src/orchestrator/__tests__/cache-state-tracker.test.ts` | 4 tests |
| Create | `src/orchestrator/__tests__/orchestrator.test.ts` | 3 integration tests (happy path, fail-open, unmutated bytes on error) |
| Create | `src/orchestrator/__tests__/cache-stability.test.ts` | 5 AC-2 scenarios |
| Create | `src/orchestrator/__tests__/fixtures/scenario-*.json` | 5 cache-stability fixtures (one per AC-2 scenario) |
| Create | `docs/superpowers/plans/2026-05-18-m3-orchestrator-core.md` | Plan file in repo per CLAUDE.md workflow |
| Modify | `eslint.config.js` | No edits expected — verify the existing `src/orchestrator` zones still hold |

---

## Sub-component contracts (TypeScript signatures)

```ts
// src/orchestrator/types.ts
import type { Block, PrefixState, TtlClass } from "../types/index.js";
import type { Classification } from "../classifier/index.js";

export type AnthropicCacheControl = { type: "ephemeral"; ttl: TtlClass };

export type AnthropicMessage = {
  role: "user" | "assistant";
  content: Array<
    | { type: "text"; text: string; cache_control?: AnthropicCacheControl }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: "tool_result"; tool_use_id: string; content: unknown; cache_control?: AnthropicCacheControl }
  >;
};

export type AnthropicMessagesRequest = {
  model: string;
  system?: Array<{ type: "text"; text: string; cache_control?: AnthropicCacheControl }>;
  tools?: Array<{ name: string; input_schema: unknown; cache_control?: AnthropicCacheControl }>;
  messages: AnthropicMessage[];
  max_tokens: number;
};

export type OrchestratorInput = {
  workspace_id: string;
  session_id: string;
  current_turn: number;
  blocks: Block[];
  classifications: Classification[]; // index-aligned with blocks[]
  original_request: AnthropicMessagesRequest; // for fail-open return
};

export type RegionBoundaries = {
  prefix_end: number; // index after last STABLE block
  middle_end: number | null; // index after last SEMI block; null if middle empty
};

export type Breakpoints = {
  prefix_hash: string;     // SHA-256 of prefix region bytes (canonical)
  middle_hash: string | null;
  include_middle_breakpoint: boolean; // true only when middle_hash matches prior state
};

export type MutatedRequest = {
  request: AnthropicMessagesRequest;
  mutated: boolean;
  prefix_hash: string;
  middle_hash: string | null;
  signals: string[];
};
```

```ts
// src/orchestrator/index.ts
export function orchestrate(
  input: OrchestratorInput,
  tracker: CacheStateTracker,
  config: { sliding_window_turns: number },
): MutatedRequest;
```

On error → returns `{ request: input.original_request, mutated: false, prefix_hash: "", middle_hash: null, signals: ["error:fallback"] }`.

---

## Tasks (TDD per task — red → green → refactor)

### Task 0 — Worktree setup
- [ ] Create worktree off `feat/m2-classifier`: `git worktree add .claude/worktrees/m3-orchestrator -b feat/m3-orchestrator feat/m2-classifier`
- [ ] In new worktree: Node 20 (`$HOME/.local/node20/.../bin` in PATH), `npm install`, `npm test` → expect 57/57 green baseline
- [ ] Copy this plan to `docs/superpowers/plans/2026-05-18-m3-orchestrator-core.md` (in-repo execution artifact)

**Gate:** baseline tests green; plan committed in-repo.

### Task 1 — Scaffold types + stub index
- [ ] `src/orchestrator/types.ts` with the 7 types above
- [ ] `src/orchestrator/index.ts` exporting `orchestrate` that throws `not implemented`
- [ ] Empty stub files for each sub-component
- [ ] `npx tsc --noEmit` clean

### Task 2 — Write all red tests + fixtures
- [ ] `reorderer.test.ts` — 6: regions sorted, intra-region order preserved, pair atomicity, stub→prefix, sliding-window filters SEMI, empty input
- [ ] `breakpoint-placer.test.ts` — 5: prefix hash deterministic, middle hash null when empty, breakpoint included when middle_hash matches prior, breakpoint omitted on first turn, prior state seeds correctly
- [ ] `request-mutator.test.ts` — 4: cache_control marker shape, marker at prefix end, marker at middle end (when included), original fields preserved
- [ ] `cache-state-tracker.test.ts` — 4: get-unknown returns undefined, update creates, update overwrites, per-workspace isolation
- [ ] `orchestrator.test.ts` — 3: happy path returns mutated, error returns original, error sets `mutated: false`
- [ ] `cache-stability.test.ts` — 5 scenarios (empty schemas, large schemas, middle included, middle empty, stub-just-created). Each scenario: run `orchestrate()` 3× with identical inputs (same fixture, same prior `PrefixState`) and assert `sha256(prefix_bytes)` identical across all 3 runs.
- [ ] 5 fixture JSONs under `__tests__/fixtures/`
- [ ] Run `npx vitest run src/orchestrator` → all 27 tests red for right reasons

### Task 3 — `reorderer.ts` (green for reorderer)
- [ ] Pure function: `reorder(blocks, classifications, currentTurn, slidingWindow)` → `{ ordered: Block[], boundaries: RegionBoundaries }`
- [ ] Stable sort by volatility (STABLE → SEMI → VOLATILE)
- [ ] Filter SEMI: keep only blocks where `currentTurn - block.added_at_turn < slidingWindow`
- [ ] Stubs (kind==="stub") land in prefix (STABLE volatility per M2 mapping)

### Task 4 — `breakpoint-placer.ts` (green for placer)
- [ ] Canonical serialization helper: stable JSON stringify (sorted keys) per block
- [ ] `placeBreakpoints(ordered, boundaries, prevState)` → `Breakpoints`
- [ ] `prefix_hash = sha256(concat(canonical(block) for block in prefix region))`
- [ ] `middle_hash = sha256(...)` or `null` if middle empty
- [ ] `include_middle_breakpoint = prevState !== undefined && prevState.middle_hash === middle_hash && middle_hash !== null`

### Task 5 — `request-mutator.ts` (green for mutator)
- [ ] `mutate(orderedBlocks, boundaries, breakpoints, originalRequest)` → `AnthropicMessagesRequest`
- [ ] Insert `cache_control: { type: "ephemeral", ttl: "5m" }` on the last block of the prefix region
- [ ] If `include_middle_breakpoint`, insert another `cache_control` on the last block of the middle region
- [ ] Preserve `model`, `max_tokens`, `system`, `tools` from `originalRequest` (just reordering messages)

### Task 6 — `cache-state-tracker.ts` (green for tracker)
- [ ] Class with private `Map<string, PrefixState>`
- [ ] `get(workspace_id): PrefixState | undefined`
- [ ] `update(workspace_id, state: PrefixState): void`
- [ ] `reset(workspace_id): void` (for test isolation)
- [ ] No persistence (process-restart resets per `designs/06 §Storage Tiers`)

### Task 7 — `index.ts` (green for integration + cache-stability)
- [ ] `orchestrate(input, tracker, config)` composes: reorder → place breakpoints → mutate → tracker.update
- [ ] Top-level try/catch: any throw returns `{ request: input.original_request, mutated: false, ... }`
- [ ] All 27 tests green

### Task 8 — Verification gates (`verification-before-completion`)
- [ ] `npm test` → 84/84 green (57 M1+M2 + 27 M3)
- [ ] `npm run lint` → clean
- [ ] `npx tsc --noEmit` → clean
- [ ] Manually grep test output for all 5 cache-stability scenario names

### Task 9 — PR creation (`finishing-a-development-branch`)
- [ ] Commit: `feat(orchestrator): M3 reorderer + breakpoint placement + cache-stability gate`
- [ ] Push `feat/m3-orchestrator` → upstream
- [ ] Open stacked PR with base `feat/m2-classifier`; mention re-target to main after M2 merges
- [ ] PR body must paste the 5 cache-stability scenario hashes and the 84/84 green test output
- [ ] List open questions for reviewer

---

## Verification (paste in PR body)

```bash
nvm use 20  # or $HOME/.local/node20/...

npm install
npx vitest run src/orchestrator   # expect 27/27 green
npm test                           # expect 84/84 green
npm run lint                       # clean
npx tsc --noEmit                   # clean
```

Per-PR M3 gate: cache-stability test must list all 5 scenarios green by name (`scenario-1-empty-schemas`, `scenario-2-large-schemas`, `scenario-3-middle-included`, `scenario-4-middle-empty`, `scenario-5-stub-just-created`). Each scenario's assertion: SHA-256 of prefix bytes identical across 3 consecutive runs.

---

## Critical files referenced during execution

- `designs/02-architecture.md` §D2 lines 78-102 — three-region diagram
- `designs/03-engineering-specs.md` §C-1 lines 124-133 — Anthropic Messages API contract
- `designs/03-engineering-specs.md` §AC-1 through §AC-3 lines 350-352 — cache-stability gate
- `designs/06-systems-design.md` lines 50-62 — module layering
- `designs/06-systems-design.md` line 363 — M3 milestone gate
- `designs/decisions/ADR-006-three-region-two-breakpoints.md` — full file
- `src/classifier/index.ts` — `classifyBlocks` API M3 consumes
- `src/types/index.ts` — `Block`, `PrefixState`, `Volatility` types
- `src/storage/index.ts` — reviewed but NOT called in M3
- `eslint.config.js` lines 35-49 — confirms orchestrator layering

---

## Open questions (flag in PR body)

1. **`/compact` middle-reset semantics** — does M3 detect the middle change explicitly, or rely on middle-hash mismatch in `CacheStateTracker`? Plan defaults to implicit detection via hash mismatch (no explicit `/compact` plumbing). Confirm binding `.docx` is comfortable with this.
2. **SEMI sliding-window filter location** — applied at reorder time (M3) using `block.added_at_turn`. Alternative: classifier (M2) could filter at classification time. Chose M3 because the classifier is stateless per-block; reorderer sees the full set at once. Confirm preference.
3. **TTL class** hardcoded `"5m"` in M3. The `"1h"` heuristic lives in M6 keepalive logic. Acceptable for M3 gate?
4. **`AnthropicMessagesRequest` shape** — hand-defined locally. Will need cross-check against `@anthropic-ai/sdk` types when wired in M7. Plan: M7 PR includes a one-shot reconciliation step.

---

## What NOT to build (YAGNI for M3)

- No K-pruning (M5).
- No PostResponse hook (M4).
- No reference detection (M4).
- No `db.insertTurn(...)` writes from M3 — that's M4.
- No keepalive (M6).
- No MCP/CLI/server (M7).
- No telemetry emission (M8).
- No `/compact` explicit plumbing (rely on hash mismatch).
- No `@anthropic-ai/sdk` install (defer to M7).
- No new lint zones (existing M1 zones cover orchestrator's allowed imports).

---

## Definition of done

- 84/84 tests green on Node 20 (57 M1+M2 + 27 M3) — paste output in PR.
- `npm run lint` and `npx tsc --noEmit` clean.
- Cache-stability test passes for all 5 AC-2 scenarios with deterministic SHA-256 hashes (paste hashes in PR).
- PR `feat/m3-orchestrator` open against `feat/m2-classifier` (stacked); will re-target to main after M2 merges.
- `docs/superpowers/plans/2026-05-18-m3-orchestrator-core.md` committed to repo.
- No history rewrites, no force-pushes, no `--no-verify` commits.
