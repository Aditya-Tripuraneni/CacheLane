# Cache-Correctness Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic `rehydration_recall` and `stale_answer_rate` metrics to the benchmark suite, proving K-pruning is non-lossy, with a CI gate that blocks merge on regression.

**Architecture:** A new `src/benchmark/correctness.ts` module consumes the existing `NormalizedTraceSession[]`, seeds an in-memory better-sqlite3 DB from each session's blocks, replays the production prune path (`getPrunableBlocks` → `pruneExpiredBlocks` → `expandStub`) per turn, and measures whether stubbed-then-referenced blocks are losslessly restorable. Reuses `detectReferences` for the "referenced" signal. No LLM, no network.

**Tech Stack:** TypeScript, vitest, better-sqlite3 (in-memory), existing `src/storage`, `src/pruner`, `src/references`, `src/agent-traces` modules. Node 20 (better-sqlite3 native binding).

**Spec:** [docs/superpowers/specs/2026-06-16-cache-correctness-benchmark-design.md](../specs/2026-06-16-cache-correctness-benchmark-design.md)

---

## File Structure

- Create: `src/benchmark/correctness.ts` — metric computation + report generation.
- Create: `src/benchmark/__tests__/correctness.test.ts` — unit tests.
- Create: `src/benchmark/__tests__/fixtures/correctness/*.json` — normalized-trace fixtures, including a deliberately-lossy one.
- Modify: `src/benchmark/types.ts` — add `CorrectnessScenarioRow`, `CorrectnessReport`.
- Modify: `src/benchmark/index.ts` — re-export correctness symbols.
- Modify: `src/cli/index.ts` — add `cachelane benchmark correctness <trace>` subcommand.
- Create: `scripts/benchmark/run-correctness.ts` — CI entrypoint (mirrors `run-recorded.ts`).
- Modify: `package.json` — add `benchmark:correctness` script.

### Key ground-truth facts (verified in code)

- `openDatabase(dbPath)` (`src/storage/data-access.ts:162`) — pass `":memory:"` for an in-memory DB.
- Prune predicate is SQL in `getPrunableBlocks` (`data-access.ts:238`): fires when `(current_turn - added_at_turn) >= k OR unused_turns >= k`, AND `is_stub=0 AND is_pinned=0 AND volatility!='STABLE' AND refetch_handle IS NOT NULL`. Replay must honor BOTH triggers.
- `pruneExpiredBlocks(db, {workspace_id, session_id, k, current_turn, enabled, now_ms})` (`src/pruner/k-pruning.ts:5`) — marks stubs, returns `{ pruned_blocks_count, decisions }`.
- `expandStub(db, {workspace_id, session_id, block_id, turn_number, updated_at})` returns `ExpandStubResult` = `{ ok:true, block_id, refetch_request, stub_summary }` or `{ ok:false, error }` (`src/pruner/tools.ts:18`, `src/pruner/types.ts:75-97`). **It returns a refetch handle, not content.**
- `NormalizedTraceSession.turns[].blocks_in_prompt` are `TraceCorpusBlock { id, id_token, kind, file_path?, content }` (`src/agent-traces/types.ts:37`). Content IS present in traces (not in the DB).
- `detectReferences` exported from `src/references/index.ts`.
- `insertBlock(params: InsertBlockParams)` requires snake_case fields incl. `refetch_handle`, `volatility`, `is_pinned`, `is_stub`, `added_at_turn`, `unused_turns` (`src/storage/types.ts:56`).

---

## Task 1: Report types

**Files:**
- Modify: `src/benchmark/types.ts`

- [ ] **Step 1: Add the correctness types**

Append to `src/benchmark/types.ts`:

```ts
export interface CorrectnessScenarioRow {
  scenario_id: string;
  session_id: string;
  k: number;
  stubbed_blocks: number;
  stubbed_then_referenced: number;
  restored_correctly: number;
  needed_blocks: number;
  needed_but_unavailable: number;
  rehydration_recall: number;
  stale_answer_rate: number;
}

export interface CorrectnessReport {
  run_id: string;
  generated_at: string;
  k: number;
  source: {
    kind: "normalized_trace";
    provider: string | null;
    normalized_dir: string | null;
  };
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

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/benchmark/types.ts
git commit -m "feat(benchmark): add cache-correctness report types"
```

---

## Task 2: Fixtures (including a deliberately-lossy one)

**Files:**
- Create: `src/benchmark/__tests__/fixtures/correctness/clean-rehydration.json`
- Create: `src/benchmark/__tests__/fixtures/correctness/lossy-missing-handle.json`
- Create: `src/benchmark/__tests__/fixtures/correctness/stub-never-referenced.json`

- [ ] **Step 1: Create the clean (non-lossy) fixture**

A 3-turn session where a tool_output block enters at turn 0, idles, is stubbed by K=3 age rule, then is referenced again at a later turn. `id` must be an 8-char alphanumeric prefix (matches `EXPAND_BLOCK_ID_PREFIX_RE`).

Create `src/benchmark/__tests__/fixtures/correctness/clean-rehydration.json`:

```json
{
  "session_id": "corr-clean",
  "provider": "fake",
  "scenario_id": "clean-rehydration",
  "source": {},
  "turns": [
    {
      "turn_number": 0,
      "assistant_text": "Reading config.ts",
      "tool_calls": [{ "name": "Read", "input": { "file_path": "src/config.ts" } }],
      "blocks_in_prompt": [
        { "id": "blockaaa", "id_token": "blockaaa", "kind": "tool_output", "file_path": "src/config.ts", "content": "export const TTL = 300;" }
      ]
    },
    {
      "turn_number": 1,
      "assistant_text": "Unrelated work",
      "tool_calls": [{ "name": "Read", "input": { "file_path": "src/other.ts" } }],
      "blocks_in_prompt": [
        { "id": "blockaaa", "id_token": "blockaaa", "kind": "tool_output", "file_path": "src/config.ts", "content": "export const TTL = 300;" },
        { "id": "blockbbb", "id_token": "blockbbb", "kind": "tool_output", "file_path": "src/other.ts", "content": "export const X = 1;" }
      ]
    },
    {
      "turn_number": 4,
      "assistant_text": "Back to src/config.ts to check TTL",
      "tool_calls": [{ "name": "Read", "input": { "file_path": "src/config.ts" } }],
      "blocks_in_prompt": [
        { "id": "blockaaa", "id_token": "blockaaa", "kind": "tool_output", "file_path": "src/config.ts", "content": "export const TTL = 300;" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Create the stub-never-referenced fixture**

A block that gets stubbed but is never referenced again — should count as stubbed, NOT as needed; recall denominator 0 → recall 1.0.

Create `src/benchmark/__tests__/fixtures/correctness/stub-never-referenced.json`:

```json
{
  "session_id": "corr-noref",
  "provider": "fake",
  "scenario_id": "stub-never-referenced",
  "source": {},
  "turns": [
    {
      "turn_number": 0,
      "assistant_text": "Reading temp.ts",
      "tool_calls": [{ "name": "Read", "input": { "file_path": "src/temp.ts" } }],
      "blocks_in_prompt": [
        { "id": "blockccc", "id_token": "blockccc", "kind": "tool_output", "file_path": "src/temp.ts", "content": "scratch" }
      ]
    },
    {
      "turn_number": 5,
      "assistant_text": "Done, unrelated final answer",
      "tool_calls": [],
      "blocks_in_prompt": []
    }
  ]
}
```

- [ ] **Step 3: Create the deliberately-lossy fixture**

A block referenced after stubbing whose content DRIFTS (file edited) between stub and refetch — proves `stale_answer_rate` actually detects loss.

Create `src/benchmark/__tests__/fixtures/correctness/lossy-missing-handle.json`:

```json
{
  "session_id": "corr-lossy",
  "provider": "fake",
  "scenario_id": "lossy-content-drift",
  "source": {},
  "turns": [
    {
      "turn_number": 0,
      "assistant_text": "Reading drift.ts",
      "tool_calls": [{ "name": "Read", "input": { "file_path": "src/drift.ts" } }],
      "blocks_in_prompt": [
        { "id": "blockddd", "id_token": "blockddd", "kind": "tool_output", "file_path": "src/drift.ts", "content": "VERSION = 1" }
      ]
    },
    {
      "turn_number": 4,
      "assistant_text": "Re-reading src/drift.ts after an edit",
      "tool_calls": [{ "name": "Read", "input": { "file_path": "src/drift.ts" } }],
      "blocks_in_prompt": [
        { "id": "blockddd", "id_token": "blockddd", "kind": "tool_output", "file_path": "src/drift.ts", "content": "VERSION = 2" }
      ]
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add src/benchmark/__tests__/fixtures/correctness/
git commit -m "test(benchmark): add cache-correctness trace fixtures"
```

---

## Task 3: Core metric — seed DB, replay prune, measure recall

**Files:**
- Create: `src/benchmark/correctness.ts`
- Test: `src/benchmark/__tests__/correctness.test.ts`

- [ ] **Step 1: Write the failing test (clean fixture → recall 1.0, stale 0.0)**

Create `src/benchmark/__tests__/correctness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NormalizedTraceSession } from "../../agent-traces/types.js";
import { computeCorrectnessForSession } from "../correctness.js";

function load(name: string): NormalizedTraceSession {
  const p = resolve(__dirname, "fixtures", "correctness", `${name}.json`);
  return JSON.parse(readFileSync(p, "utf8")) as NormalizedTraceSession;
}

describe("computeCorrectnessForSession", () => {
  it("clean rehydration: recall 1.0, stale 0.0", () => {
    const row = computeCorrectnessForSession(load("clean-rehydration"), 3);
    expect(row.stubbed_blocks).toBeGreaterThanOrEqual(1);
    expect(row.stubbed_then_referenced).toBe(1);
    expect(row.restored_correctly).toBe(1);
    expect(row.rehydration_recall).toBe(1);
    expect(row.stale_answer_rate).toBe(0);
  });

  it("stub never referenced: recall 1.0 (empty denom), needed 0", () => {
    const row = computeCorrectnessForSession(load("stub-never-referenced"), 3);
    expect(row.stubbed_then_referenced).toBe(0);
    expect(row.rehydration_recall).toBe(1);
    expect(row.needed_blocks).toBe(0);
    expect(row.stale_answer_rate).toBe(0);
  });

  it("content drift under stub: stale_answer_rate > 0", () => {
    const row = computeCorrectnessForSession(load("lossy-content-drift"), 3);
    expect(row.needed_but_unavailable).toBeGreaterThanOrEqual(1);
    expect(row.stale_answer_rate).toBeGreaterThan(0);
  });
});
```

Note: the lossy fixture's `scenario_id` is `lossy-content-drift`; load by file name `lossy-missing-handle` but it carries that scenario_id — the test loads by file name.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/benchmark/__tests__/correctness.test.ts`
Expected: FAIL — `computeCorrectnessForSession` is not defined / module missing.

- [ ] **Step 3: Implement `correctness.ts`**

Create `src/benchmark/correctness.ts`:

```ts
import { createHash } from "node:crypto";
import { openDatabase } from "../storage/index.js";
import { pruneExpiredBlocks } from "../pruner/index.js";
import { expandStub } from "../pruner/index.js";
import type { NormalizedTraceSession, TraceCorpusBlock } from "../agent-traces/types.js";
import type { CorrectnessScenarioRow } from "./types.js";

const WORKSPACE = "bench-correctness";

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function ratio(num: number, denom: number, emptyValue: number): number {
  return denom === 0 ? emptyValue : num / denom;
}

interface BlockState {
  id: string;
  firstTurn: number;
  originalHash: string;
}

export function computeCorrectnessForSession(
  session: NormalizedTraceSession,
  k: number,
): CorrectnessScenarioRow {
  const db = openDatabase(":memory:");
  try {
    const sessionId = session.session_id;
    const firstSeen = new Map<string, BlockState>();
    const referenceTurns = new Map<string, number[]>(); // block id -> turns referenced after first

    let stubbedBlocks = 0;
    let stubbedThenReferenced = 0;
    let restoredCorrectly = 0;
    let neededBlocks = 0;
    let neededButUnavailable = 0;

    const sortedTurns = [...session.turns].sort((a, b) => a.turn_number - b.turn_number);

    for (const turn of sortedTurns) {
      // Insert blocks first seen this turn; record reference for blocks seen before.
      for (const block of turn.blocks_in_prompt) {
        if (!firstSeen.has(block.id)) {
          firstSeen.set(block.id, {
            id: block.id,
            firstTurn: turn.turn_number,
            originalHash: hash(block.content),
          });
          insertTraceBlock(db, sessionId, block, turn.turn_number);
        } else {
          // Block re-appears at a later turn => referenced.
          const list = referenceTurns.get(block.id) ?? [];
          list.push(turn.turn_number);
          referenceTurns.set(block.id, list);
        }
      }

      // Replay pruning at this turn using the REAL production path.
      const pruneResult = pruneExpiredBlocks(db, {
        workspace_id: WORKSPACE,
        session_id: sessionId,
        k,
        current_turn: turn.turn_number,
        enabled: true,
      });
      stubbedBlocks += pruneResult.pruned_blocks_count;
    }

    // For each block that was stubbed AND later referenced, test rehydration.
    for (const [id, state] of firstSeen.entries()) {
      const refs = referenceTurns.get(id) ?? [];
      if (refs.length === 0) continue;

      const row = db.getBlock(id);
      if (!row || row.is_stub !== 1) continue; // only count blocks actually stubbed
      stubbedThenReferenced += 1;
      neededBlocks += 1;

      const refetchTurn = refs[0]!;
      const result = expandStub(db, {
        workspace_id: WORKSPACE,
        session_id: sessionId,
        block_id: id,
        turn_number: refetchTurn,
        updated_at: refetchTurn,
      });

      if (!result.ok) {
        neededButUnavailable += 1;
        continue;
      }

      // Compare trace content at the refetch turn against the original hash.
      const refetchBlock = blockContentAtTurn(session, id, refetchTurn);
      const currentHash = refetchBlock === null ? null : hash(refetchBlock.content);
      if (currentHash !== null && currentHash === state.originalHash) {
        restoredCorrectly += 1;
      } else {
        neededButUnavailable += 1; // content drifted under the stub => stale
      }
    }

    return {
      scenario_id: session.scenario_id,
      session_id: sessionId,
      k,
      stubbed_blocks: stubbedBlocks,
      stubbed_then_referenced: stubbedThenReferenced,
      restored_correctly: restoredCorrectly,
      needed_blocks: neededBlocks,
      needed_but_unavailable: neededButUnavailable,
      rehydration_recall: ratio(restoredCorrectly, stubbedThenReferenced, 1),
      stale_answer_rate: ratio(neededButUnavailable, neededBlocks, 0),
    };
  } finally {
    db.close();
  }
}

function blockContentAtTurn(
  session: NormalizedTraceSession,
  blockId: string,
  turnNumber: number,
): TraceCorpusBlock | null {
  const turn = session.turns.find((t) => t.turn_number === turnNumber);
  if (!turn) return null;
  return turn.blocks_in_prompt.find((b) => b.id === blockId) ?? null;
}

function insertTraceBlock(
  db: ReturnType<typeof openDatabase>,
  sessionId: string,
  block: TraceCorpusBlock,
  addedAtTurn: number,
): void {
  db.insertBlock({
    id: block.id,
    workspace_id: WORKSPACE,
    session_id: sessionId,
    content_hash: hash(block.content),
    kind: block.kind,
    volatility: "VOLATILE",
    is_pinned: false,
    token_count: Math.ceil(block.content.length / 4),
    added_at_turn: addedAtTurn,
    last_referenced_at_turn: addedAtTurn,
    unused_turns: 0,
    is_stub: false,
    stub_summary: null,
    refetch_handle: JSON.stringify({ type: "tool_use", id: block.id }),
    restored_at_turn: null,
    created_at: addedAtTurn,
    updated_at: addedAtTurn,
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/benchmark/__tests__/correctness.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/benchmark/correctness.ts src/benchmark/__tests__/correctness.test.ts
git commit -m "feat(benchmark): deterministic rehydration-recall metric"
```

---

## Task 4: Report aggregation across sessions

**Files:**
- Modify: `src/benchmark/correctness.ts`
- Test: `src/benchmark/__tests__/correctness.test.ts`

- [ ] **Step 1: Write the failing test for `generateCorrectnessReport`**

Append to `src/benchmark/__tests__/correctness.test.ts`:

```ts
import { generateCorrectnessReport } from "../correctness.js";

describe("generateCorrectnessReport", () => {
  it("aggregates totals across sessions and asserts content-free", () => {
    const sessions = ["clean-rehydration", "stub-never-referenced", "lossy-missing-handle"].map(load);
    const report = generateCorrectnessReport({
      run_id: "test",
      generated_at: "2026-06-16T00:00:00Z",
      sessions,
      k: 3,
      normalized_dir: null,
    });
    expect(report.scenarios).toHaveLength(3);
    expect(report.totals.stubbed_then_referenced).toBeGreaterThanOrEqual(2);
    expect(report.totals.needed_but_unavailable).toBeGreaterThanOrEqual(1);
    expect(report.privacy.content_persisted).toBe(false);
    // content-free guard: serialized report must not contain fixture content strings
    const json = JSON.stringify(report);
    expect(json).not.toContain("export const TTL");
    expect(json).not.toContain("VERSION = ");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/benchmark/__tests__/correctness.test.ts`
Expected: FAIL — `generateCorrectnessReport` not defined.

- [ ] **Step 3: Implement the aggregator**

Append to `src/benchmark/correctness.ts`:

```ts
import type { CorrectnessReport } from "./types.js";

export interface GenerateCorrectnessOptions {
  run_id: string;
  generated_at: string;
  sessions: NormalizedTraceSession[];
  k: number;
  normalized_dir?: string | null;
}

export function generateCorrectnessReport(
  options: GenerateCorrectnessOptions,
): CorrectnessReport {
  const scenarios = options.sessions.map((s) => computeCorrectnessForSession(s, options.k));
  const totals = scenarios.reduce(
    (acc, row) => ({
      stubbed_blocks: acc.stubbed_blocks + row.stubbed_blocks,
      stubbed_then_referenced: acc.stubbed_then_referenced + row.stubbed_then_referenced,
      restored_correctly: acc.restored_correctly + row.restored_correctly,
      needed_blocks: acc.needed_blocks + row.needed_blocks,
      needed_but_unavailable: acc.needed_but_unavailable + row.needed_but_unavailable,
    }),
    {
      stubbed_blocks: 0,
      stubbed_then_referenced: 0,
      restored_correctly: 0,
      needed_blocks: 0,
      needed_but_unavailable: 0,
    },
  );

  return {
    run_id: options.run_id,
    generated_at: options.generated_at,
    k: options.k,
    source: {
      kind: "normalized_trace",
      provider: options.sessions[0]?.provider ?? null,
      normalized_dir: options.normalized_dir ?? null,
    },
    totals: {
      ...totals,
      rehydration_recall: ratio(totals.restored_correctly, totals.stubbed_then_referenced, 1),
      stale_answer_rate: ratio(totals.needed_but_unavailable, totals.needed_blocks, 0),
    },
    scenarios,
    privacy: { content_persisted: false },
  };
}

export function formatCorrectnessMarkdown(report: CorrectnessReport): string {
  return [
    `# CacheLane Cache-Correctness ${report.run_id}`,
    "",
    `Generated: ${report.generated_at}`,
    `K: ${report.k}`,
    "",
    "## Totals",
    "",
    `- Rehydration recall: ${(report.totals.rehydration_recall * 100).toFixed(1)}%`,
    `- Stale answer rate: ${(report.totals.stale_answer_rate * 100).toFixed(1)}%`,
    `- Stubbed blocks: ${report.totals.stubbed_blocks}`,
    `- Stubbed then referenced: ${report.totals.stubbed_then_referenced}`,
    `- Restored correctly: ${report.totals.restored_correctly}`,
    "",
    "## Scenarios",
    "",
    "| Scenario | K | Stubbed | Needed | Recall | Stale |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.scenarios.map(
      (r) =>
        `| ${r.scenario_id} | ${r.k} | ${r.stubbed_blocks} | ${r.needed_blocks} | ${(r.rehydration_recall * 100).toFixed(1)}% | ${(r.stale_answer_rate * 100).toFixed(1)}% |`,
    ),
    "",
    "No prompt text, file contents, or tool output are persisted in this report.",
    "",
  ].join("\n");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/benchmark/__tests__/correctness.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/benchmark/correctness.ts src/benchmark/__tests__/correctness.test.ts
git commit -m "feat(benchmark): aggregate cache-correctness report + markdown"
```

---

## Task 5: Re-export from benchmark index

**Files:**
- Modify: `src/benchmark/index.ts`

- [ ] **Step 1: Add the export**

Add to `src/benchmark/index.ts` (alongside existing exports):

```ts
export {
  computeCorrectnessForSession,
  generateCorrectnessReport,
  formatCorrectnessMarkdown,
} from "./correctness.js";
export type { GenerateCorrectnessOptions } from "./correctness.js";
export type { CorrectnessReport, CorrectnessScenarioRow } from "./types.js";
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/benchmark/index.ts
git commit -m "feat(benchmark): export cache-correctness API"
```

---

## Task 6: CLI subcommand `benchmark correctness <trace>`

**Files:**
- Modify: `src/cli/index.ts` (the `benchmarkCmd` block, after the `compare` subcommand near line 555)

- [ ] **Step 1: Add the subcommand**

Insert into `createCachelaneCli`, after the `benchmarkCmd.command("compare")` block:

```ts
  benchmarkCmd
    .command("correctness")
    .description("Measure rehydration recall + stale-answer rate on a recorded trace")
    .argument("<trace>", "Path to normalized trace directory")
    .option("--k <number>", "Pruner K", (v) => parseInt(v, 10), 3)
    .option("--json", "Print stable JSON")
    .action(async (trace: string, cmd: { k: number; json?: boolean }) => {
      const { loadNormalizedTraceSessions } = await import("../benchmark/recorded.js");
      const { generateCorrectnessReport, formatCorrectnessMarkdown } = await import(
        "../benchmark/index.js"
      );
      const sessions = loadNormalizedTraceSessions(trace);
      const report = generateCorrectnessReport({
        run_id: "cli",
        generated_at: new Date().toISOString(),
        sessions,
        k: cmd.k,
        normalized_dir: trace,
      });
      io.stdout(cmd.json ? jsonLine(report) : `${formatCorrectnessMarkdown(report)}\n`);
    });
```

- [ ] **Step 2: Write a CLI smoke test**

Add to `src/cli/__tests__/cli.test.ts` (follow the existing test's harness for building the CLI and capturing stdout):

```ts
it("benchmark correctness emits JSON with recall/stale totals", async () => {
  const out: string[] = [];
  const program = createCachelaneCli({
    env: process.env,
    io: { stdout: (t) => out.push(t), stderr: () => {} },
  });
  await program.parseAsync([
    "node", "cachelane", "benchmark", "correctness",
    "src/benchmark/__tests__/fixtures/correctness", "--json",
  ]);
  const report = JSON.parse(out.join(""));
  expect(report.privacy.content_persisted).toBe(false);
  expect(typeof report.totals.rehydration_recall).toBe("number");
});
```

(If the existing cli.test.ts imports `createCachelaneCli` differently, match that import.)

- [ ] **Step 3: Run to verify it passes**

Run: `npx vitest run src/cli/__tests__/cli.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts src/cli/__tests__/cli.test.ts
git commit -m "feat(cli): add benchmark correctness subcommand"
```

---

## Task 7: CI script + npm script + gate

**Files:**
- Create: `scripts/benchmark/run-correctness.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the CI entrypoint**

Create `scripts/benchmark/run-correctness.ts` (model on `scripts/benchmark/run-recorded.ts`):

```ts
import { resolve } from "node:path";
import { loadNormalizedTraceSessions } from "../../src/benchmark/recorded.js";
import { generateCorrectnessReport } from "../../src/benchmark/index.js";

const dir = process.argv[2] ?? "benchmark/runs/committed/fake-smoke-3/normalized";
const sessions = loadNormalizedTraceSessions(resolve(process.cwd(), dir));
const report = generateCorrectnessReport({
  run_id: "ci-correctness",
  generated_at: new Date().toISOString(),
  sessions,
  k: 3,
  normalized_dir: dir,
});

// CI gate: pruning must be non-lossy on committed traces.
const failed =
  report.totals.rehydration_recall < 1 || report.totals.stale_answer_rate > 0;
process.stdout.write(JSON.stringify(report.totals, null, 2) + "\n");
if (failed) {
  process.stderr.write(
    `[correctness] GATE FAILED: recall=${report.totals.rehydration_recall} stale=${report.totals.stale_answer_rate}\n`,
  );
  process.exitCode = 1;
}
```

- [ ] **Step 2: Add the npm script**

Modify `package.json` scripts block — add:

```json
    "benchmark:correctness": "tsx scripts/benchmark/run-correctness.ts",
```

- [ ] **Step 3: Run the gate against committed traces**

Run: `npm run benchmark:correctness`
Expected: prints totals JSON; exit 0 (committed fake-smoke traces should be non-lossy). If they contain no stub-then-reference lifecycle, recall denom is 0 → recall 1.0 → still passes.

- [ ] **Step 4: Commit**

```bash
git add scripts/benchmark/run-correctness.ts package.json
git commit -m "ci(benchmark): cache-correctness gate (recall=1.0, stale=0.0)"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: PASS (all existing + new tests).

- [ ] **Step 2: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 3: Paste output, then mark done**

Per verification-before-completion: paste the test/lint/tsc output before claiming complete.

---

## Self-review notes

- **Spec coverage:** rehydration_recall (Task 3), stale_answer_rate (Task 3, lossy fixture), report aggregation (Task 4), CLI (Task 6), CI gate (Task 7), content-free assertion (Task 4 test). ✅
- **Type consistency:** `CorrectnessScenarioRow`/`CorrectnessReport` defined in Task 1 and used unchanged in Tasks 3–7. `computeCorrectnessForSession(session, k)` and `generateCorrectnessReport(options)` signatures stable across tasks. ✅
- **Reuse:** real `openDatabase(":memory:")`, `pruneExpiredBlocks`, `expandStub`, `loadNormalizedTraceSessions` — no reimplementation. ✅
- **Open item for executor:** the committed fake-smoke traces may not include a stub→reference lifecycle; if so the gate trivially passes (recall denom 0). The 3 dedicated fixtures are the real test of the metric. If a stronger CI signal is wanted, point `run-correctness.ts` at the fixtures dir.
