# Benchmark Duel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `cachelane benchmark duel` — a hands-free command that runs the same scripted multi-turn scenarios through real Claude Code twice (CacheLane mutation ON vs OFF), interleaved with cooldowns, and emits one comparison report with a deterministic-estimate headline plus a real-billed-dollars tier.

**Architecture:** A new `src/benchmark/duel.ts` orchestrator loops scenarios, flips `features.mutation_enabled` in the CacheLane config per run, drives the existing `claude-code` trace provider (extended for multi-turn session pinning), then computes two tiers per run — the deterministic estimate via the existing `generateRecordedBenchmarkReport`, and real billed tokens via a new transcript `usage` extractor. A new `duel-report.ts` renders `duel-report.json` + `DUEL-REPORT.md`. The orchestrator takes an injectable run function so it is unit-testable without spawning Claude Code.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Node 20, vitest, commander, better-sqlite3 (already present). No new npm deps.

---

## Conventions (read before starting)

- ESM imports use `.js` suffix even for `.ts` files (e.g. `import { x } from "./foo.js"`).
- Storage/API-contract types use `snake_case`; in-process working types may use `camelCase`.
- Volatility vocabulary is always `STABLE | SEMI | VOLATILE` (not relevant to this plan but do not introduce synonyms).
- Reports must persist **no** prompt text, assistant text, tool output, or file contents — counts/tokens/ratios/IDs only.
- Run tests with `npx vitest run <path>`; lint with `npm run lint`; typecheck with `npx tsc --noEmit`.
- Node 20 required (`nvm use 20`) — `better-sqlite3` native binding fails on Node 24.

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `src/agent-traces/types.ts` | Add optional `turns?: string[]` to `ScenarioSpec` | Modify |
| `src/agent-traces/scenarios.ts` | Validate `turns`; default `turns` from `prompt` | Modify |
| `src/cli/config.ts` | `setMutationEnabled` — true cachelane on/off lever | Modify |
| `src/benchmark/pricing.ts` | Centralized per-token price constants + `priceUsd()` | New |
| `src/benchmark/usage-extract.ts` | Sum real billed `usage` tokens from a transcript JSONL | New |
| `src/agent-traces/providers/claude-code.ts` | Drive a multi-turn session (`--session-id` + `--resume`) | Modify |
| `src/benchmark/duel-report.ts` | Build `DuelReport` object + render markdown | New |
| `src/benchmark/duel.ts` | Orchestrator: toggle, run twice, cooldown, both tiers | New |
| `src/benchmark/index.ts` | Re-export duel entry points | Modify |
| `src/cli/index.ts` | `benchmark duel` subcommand | Modify |
| `benchmark/scenarios/09-multi-turn-refactor.json` | A multi-turn scenario fixture | New |

---

## Task 1: Multi-turn scenario format

**Files:**
- Modify: `src/agent-traces/types.ts:21-29` (the `ScenarioSpec` interface)
- Modify: `src/agent-traces/scenarios.ts:42-63` (`validateScenarioSpec`)
- Test: `src/agent-traces/__tests__/scenarios.test.ts`

Back-compat rule: a scenario with only `prompt` yields `turns: [prompt]`. A scenario with `turns` keeps them and sets `prompt` to `turns[0]` (so existing single-prompt consumers still work). At least one of `prompt`/`turns` must be present.

- [ ] **Step 1: Write the failing test**

Add to `src/agent-traces/__tests__/scenarios.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateScenarioSpec } from "../scenarios.js";

describe("validateScenarioSpec turns", () => {
  const base = {
    id: "multi-turn-demo",
    title: "Demo",
    description: "d",
    workspace_files: [],
  };

  it("defaults turns from a single prompt", () => {
    const spec = validateScenarioSpec({ ...base, prompt: "do the thing" });
    expect(spec.turns).toEqual(["do the thing"]);
    expect(spec.prompt).toBe("do the thing");
  });

  it("accepts an explicit turns array and sets prompt to turns[0]", () => {
    const spec = validateScenarioSpec({ ...base, turns: ["first", "second"] });
    expect(spec.turns).toEqual(["first", "second"]);
    expect(spec.prompt).toBe("first");
  });

  it("rejects a scenario with neither prompt nor turns", () => {
    expect(() => validateScenarioSpec({ ...base })).toThrow(/prompt or turns/);
  });

  it("rejects an empty turns array", () => {
    expect(() => validateScenarioSpec({ ...base, turns: [] })).toThrow(/turns/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agent-traces/__tests__/scenarios.test.ts`
Expected: FAIL — `spec.turns` is undefined / no "prompt or turns" error thrown.

- [ ] **Step 3: Add `turns` to the type**

In `src/agent-traces/types.ts`, change the `ScenarioSpec` interface to add `turns`:

```ts
export interface ScenarioSpec {
  id: string;
  title: string;
  description: string;
  prompt: string;
  turns: string[];
  workspace_files: ScenarioWorkspaceFile[];
  expected_references: string[];
  tags: string[];
}
```

- [ ] **Step 4: Implement validation**

In `src/agent-traces/scenarios.ts`, replace the `return { ... }` block of `validateScenarioSpec` (lines 52-62) with logic that resolves `turns` and `prompt` together:

```ts
  const hasPrompt = typeof input.prompt === "string" && input.prompt.trim().length > 0;
  const hasTurns = Array.isArray(input.turns);
  if (!hasPrompt && !hasTurns) {
    throw new Error(`${source}: scenario must define prompt or turns`);
  }

  const turns = hasTurns
    ? readStringArray(input.turns, "turns", source)
    : [readString(input.prompt, "prompt", source)];
  if (turns.length === 0) {
    throw new Error(`${source}: turns must contain at least one prompt`);
  }

  return {
    id,
    title: readString(input.title, "title", source),
    description: readString(input.description, "description", source),
    prompt: turns[0],
    turns,
    workspace_files: readWorkspaceFiles(input.workspace_files, source),
    expected_references: input.expected_references
      ? readStringArray(input.expected_references, "expected_references", source)
      : [],
    tags: input.tags ? readStringArray(input.tags, "tags", source) : [],
  };
```

Note: `description` stays required to match existing scenarios; the test `base` includes it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/agent-traces/__tests__/scenarios.test.ts`
Expected: PASS (all new tests plus existing ones).

- [ ] **Step 6: Verify existing scenarios still load**

Run: `npx vitest run src/agent-traces/`
Expected: PASS — existing single-prompt scenarios now carry `turns: [prompt]`.

- [ ] **Step 7: Commit**

```bash
git add src/agent-traces/types.ts src/agent-traces/scenarios.ts src/agent-traces/__tests__/scenarios.test.ts
git commit -m "feat(traces): support multi-turn scenarios with prompt back-compat"
```

---

## Task 2: `setMutationEnabled` config lever

**Files:**
- Modify: `src/cli/config.ts` (add setter near `setPrunerEnabled` at line 68)
- Test: `src/cli/__tests__/config.test.ts` (create if absent)

This is the **true** CacheLane on/off switch the duel toggles. `features.mutation_enabled` is read by the proxy at `src/proxy/server.ts:415`; setting it `false` returns the unmutated request (full passthrough), which is the "CacheLane OFF" baseline. The existing `enable`/`disable` commands only toggle the pruner, not the reorderer, so they are NOT sufficient.

- [ ] **Step 1: Write the failing test**

Create `src/cli/__tests__/config.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setMutationEnabled } from "../config.js";

describe("setMutationEnabled", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cachelane-cfg-"));
    configPath = join(dir, "config.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes features.mutation_enabled = false", () => {
    const config = setMutationEnabled(configPath, false);
    expect(config.features.mutation_enabled).toBe(false);
    const onDisk = JSON.parse(readFileSync(configPath, "utf8"));
    expect(onDisk.features.mutation_enabled).toBe(false);
  });

  it("writes features.mutation_enabled = true", () => {
    setMutationEnabled(configPath, false);
    const config = setMutationEnabled(configPath, true);
    expect(config.features.mutation_enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/__tests__/config.test.ts`
Expected: FAIL — `setMutationEnabled` is not exported.

- [ ] **Step 3: Implement the setter**

In `src/cli/config.ts`, add after `setPrunerEnabled` (after line 72):

```ts
export function setMutationEnabled(configPath: string, enabled: boolean): CachelaneConfig {
  return updateConfig(configPath, (raw) => {
    ensureSection(raw, "features").mutation_enabled = enabled;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/__tests__/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/config.ts src/cli/__tests__/config.test.ts
git commit -m "feat(cli): add setMutationEnabled config lever for benchmark duel"
```

---

## Task 3: Centralized pricing module

**Files:**
- Create: `src/benchmark/pricing.ts`
- Test: `src/benchmark/__tests__/pricing.test.ts`

The constants `$3 / $0.30 / $3.75` per Mtok are currently duplicated in `scripts/benchmark/live-ab-test.ts` and `src/benchmark/live-ab-test.ts`. Centralize so the duel and existing code share one source.

- [ ] **Step 1: Write the failing test**

Create `src/benchmark/__tests__/pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { priceUsd, SONNET_PRICING } from "../pricing.js";

describe("priceUsd", () => {
  it("prices plain input tokens at $3 / Mtok", () => {
    expect(priceUsd({ input_tokens: 1_000_000, cache_read_tokens: 0, cache_creation_tokens: 0 }))
      .toBeCloseTo(3.0, 6);
  });

  it("prices cache reads at $0.30 / Mtok", () => {
    expect(priceUsd({ input_tokens: 0, cache_read_tokens: 1_000_000, cache_creation_tokens: 0 }))
      .toBeCloseTo(0.3, 6);
  });

  it("prices cache writes at $3.75 / Mtok", () => {
    expect(priceUsd({ input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 1_000_000 }))
      .toBeCloseTo(3.75, 6);
  });

  it("exposes raw per-token constants", () => {
    expect(SONNET_PRICING.input).toBeCloseTo(3 / 1_000_000, 12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/benchmark/__tests__/pricing.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `src/benchmark/pricing.ts`:

```ts
export interface BilledTokens {
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

// Anthropic Sonnet pricing, dollars per token.
export const SONNET_PRICING = {
  input: 3.0 / 1_000_000,
  cache_read: 0.3 / 1_000_000,
  cache_write: 3.75 / 1_000_000,
} as const;

export function priceUsd(tokens: BilledTokens): number {
  return (
    tokens.input_tokens * SONNET_PRICING.input +
    tokens.cache_read_tokens * SONNET_PRICING.cache_read +
    tokens.cache_creation_tokens * SONNET_PRICING.cache_write
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/benchmark/__tests__/pricing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/benchmark/pricing.ts src/benchmark/__tests__/pricing.test.ts
git commit -m "feat(benchmark): add centralized Sonnet pricing module"
```

---

## Task 4: Real billed usage extractor

**Files:**
- Create: `src/benchmark/usage-extract.ts`
- Test: `src/benchmark/__tests__/usage-extract.test.ts`

Claude Code transcripts are JSONL; assistant lines carry `message.usage` with `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. The existing `normalizer.ts` discards these, so we add a dedicated reader. Sum across all assistant messages in the transcript. Verified real shape:
`{"input_tokens":2,"cache_creation_input_tokens":16116,"cache_read_input_tokens":19778,"output_tokens":189}`.

- [ ] **Step 1: Write the failing test with a fixture**

Create `src/benchmark/__tests__/usage-extract.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractBilledUsage } from "../usage-extract.js";

const ASSISTANT_A = JSON.stringify({
  type: "assistant",
  message: { role: "assistant", usage: {
    input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 5,
  } },
});
const ASSISTANT_B = JSON.stringify({
  type: "assistant",
  message: { role: "assistant", usage: {
    input_tokens: 4, cache_read_input_tokens: 200, cache_creation_input_tokens: 0, output_tokens: 7,
  } },
});
const USER_LINE = JSON.stringify({ type: "user", message: { role: "user", content: "hi" } });

describe("extractBilledUsage", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cachelane-usage-"));
    path = join(dir, "transcript.jsonl");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("sums usage across assistant messages and ignores user lines", () => {
    writeFileSync(path, [USER_LINE, ASSISTANT_A, ASSISTANT_B, ""].join("\n"));
    const usage = extractBilledUsage(path);
    expect(usage).toEqual({
      input_tokens: 14,
      cache_read_tokens: 300,
      cache_creation_tokens: 50,
    });
  });

  it("returns zeros for a transcript with no usage", () => {
    writeFileSync(path, [USER_LINE, ""].join("\n"));
    expect(extractBilledUsage(path)).toEqual({
      input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0,
    });
  });

  it("skips malformed lines without throwing", () => {
    writeFileSync(path, ["not json", ASSISTANT_A, "{bad", ""].join("\n"));
    expect(extractBilledUsage(path).cache_read_tokens).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/benchmark/__tests__/usage-extract.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the extractor**

Create `src/benchmark/usage-extract.ts`:

```ts
import { readFileSync } from "node:fs";
import type { BilledTokens } from "./pricing.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function extractBilledUsage(transcriptPath: string): BilledTokens {
  const totals: BilledTokens = {
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };

  const lines = readFileSync(transcriptPath, "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || parsed.type !== "assistant") continue;
    const message = isRecord(parsed.message) ? parsed.message : undefined;
    const usage = message && isRecord(message.usage) ? message.usage : undefined;
    if (!usage) continue;
    totals.input_tokens += num(usage.input_tokens);
    totals.cache_read_tokens += num(usage.cache_read_input_tokens);
    totals.cache_creation_tokens += num(usage.cache_creation_input_tokens);
  }

  return totals;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/benchmark/__tests__/usage-extract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/benchmark/usage-extract.ts src/benchmark/__tests__/usage-extract.test.ts
git commit -m "feat(benchmark): extract real billed usage from Claude Code transcripts"
```

---

## Task 5: Multi-turn Claude Code provider

**Files:**
- Modify: `src/agent-traces/providers/claude-code.ts`
- Test: `src/agent-traces/__tests__/providers.test.ts` (extend)

Drive all of a scenario's `turns` inside ONE Claude Code session so cache/pruning state accumulates. Use `--session-id <uuid>` on the first turn and `--resume <uuid> -p "<turn>"` for follow-ups. The session id is derived deterministically from `run_id` + `scenario.id` (NO `Math.random`/`Date.now` — those are banned in this codebase's deterministic paths and break reproducibility). After all turns, find the newest transcript touched after the run started (existing `newestTranscriptAfter` helper).

Add a `sessionId` option and a `--session-id`-aware arg builder. Keep the existing `dry_run` behavior but reflect all turns.

- [ ] **Step 1: Write the failing test**

Extend `src/agent-traces/__tests__/providers.test.ts` with a dry-run multi-turn assertion:

```ts
import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../providers/claude-code.js";

describe("claude-code adapter multi-turn dry run", () => {
  it("plans one command per turn under a single pinned session id", async () => {
    const adapter = createClaudeCodeAdapter();
    const scenario = {
      id: "demo",
      title: "Demo",
      description: "d",
      prompt: "first",
      turns: ["first", "second", "third"],
      workspace_files: [],
      expected_references: [],
      tags: [],
    };
    const raw = await adapter.runScenario(scenario, {
      dry_run: true,
      run_id: "run-1",
      run_dir: "/tmp/run-1",
      now: () => new Date("2026-06-14T00:00:00.000Z"),
    });
    expect(raw.turns).toHaveLength(3);
    const summary = raw.command_summary as { session_id?: string; turn_count?: number };
    expect(summary.turn_count).toBe(3);
    expect(typeof summary.session_id).toBe("string");
    expect(summary.session_id).toContain("run-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agent-traces/__tests__/providers.test.ts`
Expected: FAIL — dry run returns a single turn and no `turn_count`/`session_id`.

- [ ] **Step 3: Implement multi-turn driving**

Replace the body of `runScenario` in `src/agent-traces/providers/claude-code.ts` (the function returned from `createClaudeCodeAdapter`, lines 45-95) with:

```ts
    async runScenario(scenario, runOptions): Promise<RawTraceSession> {
      const startedDate = runOptions.now();
      const startedAt = startedDate.toISOString();
      const turns = scenario.turns.length > 0 ? scenario.turns : [scenario.prompt];
      const sessionId = `${runOptions.run_id}-${scenario.id}`;

      if (runOptions.dry_run) {
        return {
          session_id: sessionId,
          provider: "claude-code",
          scenario_id: scenario.id,
          started_at: startedAt,
          ended_at: runOptions.now().toISOString(),
          command_summary: {
            command,
            args: [...baseArgs, "<scenario-turn>"],
            transcript_root: transcriptRoot,
            session_id: sessionId,
            turn_count: turns.length,
          },
          turns: turns.map((_, i) => ({
            assistant_text: `Dry run only. Planned Claude Code turn ${i + 1}/${turns.length} for ${scenario.id}.`,
          })),
        };
      }

      for (let i = 0; i < turns.length; i++) {
        const turnArgs =
          i === 0
            ? ["--session-id", sessionId, ...baseArgs, turns[i]]
            : ["--resume", sessionId, ...baseArgs, turns[i]];
        await execFileAsync(command, turnArgs, {
          cwd: process.cwd(),
          timeout: 120_000,
          maxBuffer: 1024 * 1024 * 10,
        });
      }

      const transcriptPath = newestTranscriptAfter(transcriptRoot, startedDate.getTime());
      if (!transcriptPath) {
        throw new Error(`Claude Code completed but no JSONL transcript was found under ${transcriptRoot}`);
      }

      return {
        session_id: sessionId,
        provider: "claude-code",
        scenario_id: scenario.id,
        started_at: startedAt,
        ended_at: runOptions.now().toISOString(),
        transcript_path: transcriptPath,
        command_summary: {
          command,
          args: [...baseArgs, "<scenario-turn>"],
          transcript_root: transcriptRoot,
          session_id: sessionId,
          turn_count: turns.length,
        },
        turns: [],
      };
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agent-traces/__tests__/providers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent-traces/providers/claude-code.ts src/agent-traces/__tests__/providers.test.ts
git commit -m "feat(traces): drive multi-turn Claude Code sessions with pinned session id"
```

---

## Task 6: Duel report builder

**Files:**
- Create: `src/benchmark/duel-report.ts`
- Test: `src/benchmark/__tests__/duel-report.test.ts`

Pure functions: given per-scenario ON/OFF results (estimate cost units + billed tokens), build a `DuelReport` object and render markdown. No I/O, no Claude Code — fully unit-testable. Privacy: object contains only ids/counts/tokens/ratios/dollars.

- [ ] **Step 1: Write the failing test**

Create `src/benchmark/__tests__/duel-report.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDuelReport, renderDuelMarkdown, type DuelScenarioInput } from "../duel-report.js";

const SCENARIOS: DuelScenarioInput[] = [
  {
    scenario_id: "multi-turn-refactor",
    turns: 4,
    on: {
      estimate_baseline_units: 1000, estimate_effective_units: 300,
      billed: { input_tokens: 200, cache_read_tokens: 800, cache_creation_tokens: 100 },
    },
    off: {
      estimate_baseline_units: 1000, estimate_effective_units: 1000,
      billed: { input_tokens: 1000, cache_read_tokens: 0, cache_creation_tokens: 0 },
    },
  },
];

describe("buildDuelReport", () => {
  it("computes estimate savings ratio from on vs off effective units", () => {
    const report = buildDuelReport({
      run_id: "duel-1",
      generated_at: "2026-06-14T00:00:00.000Z",
      cooldown_seconds: 360,
      model: "claude-sonnet",
      scenarios: SCENARIOS,
    });
    // OFF effective 1000 -> ON effective 300 => 70% saved
    expect(report.totals.estimate_savings_ratio).toBeCloseTo(0.7, 6);
  });

  it("computes live dollar savings from billed tokens", () => {
    const report = buildDuelReport({
      run_id: "duel-1", generated_at: "t", cooldown_seconds: 360,
      model: "claude-sonnet", scenarios: SCENARIOS,
    });
    expect(report.totals.live_usd_off).toBeGreaterThan(report.totals.live_usd_on);
    expect(report.totals.live_usd_savings_ratio).toBeGreaterThan(0);
  });

  it("persists no prompt or assistant content", () => {
    const report = buildDuelReport({
      run_id: "duel-1", generated_at: "t", cooldown_seconds: 360,
      model: "claude-sonnet", scenarios: SCENARIOS,
    });
    expect(JSON.stringify(report)).not.toMatch(/refactor the|summarize|read src/i);
    expect(report.privacy.content_persisted).toBe(false);
  });

  it("renders a markdown report with both tiers", () => {
    const report = buildDuelReport({
      run_id: "duel-1", generated_at: "t", cooldown_seconds: 360,
      model: "claude-sonnet", scenarios: SCENARIOS,
    });
    const md = renderDuelMarkdown(report);
    expect(md).toContain("HEADLINE");
    expect(md).toContain("LIVE BILLED");
    expect(md).toContain("multi-turn-refactor");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/benchmark/__tests__/duel-report.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the report builder**

Create `src/benchmark/duel-report.ts`:

```ts
import { priceUsd, type BilledTokens } from "./pricing.js";

export interface DuelSideInput {
  estimate_baseline_units: number;
  estimate_effective_units: number;
  billed: BilledTokens;
}

export interface DuelScenarioInput {
  scenario_id: string;
  turns: number;
  on: DuelSideInput;
  off: DuelSideInput;
}

export interface BuildDuelReportOptions {
  run_id: string;
  generated_at: string;
  cooldown_seconds: number;
  model: string;
  scenarios: DuelScenarioInput[];
}

export interface DuelScenarioRow {
  scenario_id: string;
  turns: number;
  estimate_effective_on: number;
  estimate_effective_off: number;
  estimate_savings_ratio: number;
  live_usd_on: number;
  live_usd_off: number;
  live_usd_savings_ratio: number;
}

export interface DuelReport {
  run_id: string;
  generated_at: string;
  cooldown_seconds: number;
  model: string;
  totals: {
    estimate_effective_on: number;
    estimate_effective_off: number;
    estimate_savings_ratio: number;
    live_usd_on: number;
    live_usd_off: number;
    live_usd_savings_ratio: number;
  };
  scenarios: DuelScenarioRow[];
  privacy: { content_persisted: false };
}

function savings(off: number, on: number): number {
  return off === 0 ? 0 : (off - on) / off;
}

function rowFor(input: DuelScenarioInput): DuelScenarioRow {
  const live_usd_on = priceUsd(input.on.billed);
  const live_usd_off = priceUsd(input.off.billed);
  return {
    scenario_id: input.scenario_id,
    turns: input.turns,
    estimate_effective_on: input.on.estimate_effective_units,
    estimate_effective_off: input.off.estimate_effective_units,
    estimate_savings_ratio: savings(
      input.off.estimate_effective_units,
      input.on.estimate_effective_units,
    ),
    live_usd_on,
    live_usd_off,
    live_usd_savings_ratio: savings(live_usd_off, live_usd_on),
  };
}

export function buildDuelReport(options: BuildDuelReportOptions): DuelReport {
  const scenarios = options.scenarios.map(rowFor);
  const sum = (pick: (r: DuelScenarioRow) => number): number =>
    scenarios.reduce((acc, r) => acc + pick(r), 0);

  const estimate_effective_on = sum((r) => r.estimate_effective_on);
  const estimate_effective_off = sum((r) => r.estimate_effective_off);
  const live_usd_on = sum((r) => r.live_usd_on);
  const live_usd_off = sum((r) => r.live_usd_off);

  return {
    run_id: options.run_id,
    generated_at: options.generated_at,
    cooldown_seconds: options.cooldown_seconds,
    model: options.model,
    totals: {
      estimate_effective_on,
      estimate_effective_off,
      estimate_savings_ratio: savings(estimate_effective_off, estimate_effective_on),
      live_usd_on,
      live_usd_off,
      live_usd_savings_ratio: savings(live_usd_off, live_usd_on),
    },
    scenarios,
    privacy: { content_persisted: false },
  };
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function usd(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function renderDuelMarkdown(report: DuelReport): string {
  const t = report.totals;
  const lines = [
    `# CacheLane Duel ${report.run_id}`,
    "",
    `Generated: ${report.generated_at}`,
    `Model: ${report.model} · Cooldown: ${report.cooldown_seconds}s · Scenarios: ${report.scenarios.length}`,
    "",
    "## HEADLINE (deterministic estimate — apples-to-apples)",
    "",
    `- Effective cost units OFF: ${t.estimate_effective_off.toFixed(2)}`,
    `- Effective cost units ON:  ${t.estimate_effective_on.toFixed(2)}`,
    `- Savings: ${pct(t.estimate_savings_ratio)}`,
    "",
    "## LIVE BILLED (real transcript usage — directional, warm-cache noise)",
    "",
    `- Est. dollars OFF: ${usd(t.live_usd_off)}`,
    `- Est. dollars ON:  ${usd(t.live_usd_on)}`,
    `- Savings: ${pct(t.live_usd_savings_ratio)}`,
    "",
    "> Live numbers carry model nondeterminism + cache-window noise.",
    "> Trust the deterministic estimate for the headline %.",
    "",
    "## Per-scenario",
    "",
    "| Scenario | Turns | Est. savings | Live savings |",
    "|---|---:|---:|---:|",
    ...report.scenarios.map(
      (r) =>
        `| ${r.scenario_id} | ${r.turns} | ${pct(r.estimate_savings_ratio)} | ${pct(r.live_usd_savings_ratio)} |`,
    ),
    "",
    "No prompt text, assistant text, tool output, or file contents are persisted in this report.",
    "",
  ];
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/benchmark/__tests__/duel-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/benchmark/duel-report.ts src/benchmark/__tests__/duel-report.test.ts
git commit -m "feat(benchmark): add duel report builder and markdown renderer"
```

---

## Task 7: Duel orchestrator

**Files:**
- Create: `src/benchmark/duel.ts`
- Modify: `src/benchmark/index.ts` (re-export)
- Test: `src/benchmark/__tests__/duel.test.ts`

Orchestrates: for each scenario, run ON then cooldown then OFF (alternating order by scenario index so neither side systematically pre-warms), capturing the deterministic estimate (via `generateRecordedBenchmarkReport` on the normalized session) and the billed usage (via `extractBilledUsage` on the transcript). Side effects (toggling config, sleeping, running Claude Code) are injected so the orchestrator is unit-testable.

`--estimate-only` mode: skip the live run entirely; the billed tier is all-zeros and only the estimate headline is meaningful. This is the free, CI-safe path.

- [ ] **Step 1: Write the failing test**

Create `src/benchmark/__tests__/duel.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runDuel, type DuelDeps } from "../duel.js";
import type { NormalizedTraceSession } from "../../agent-traces/types.js";

function session(scenarioId: string, repeatedContent: boolean): NormalizedTraceSession {
  // Two turns; when repeatedContent is true the same block appears twice -> cache hit.
  const block = (salt: string) => ({
    id: `b-${salt}`, id_token: `t-${salt}`, kind: "file_read" as const, content: "AAA",
  });
  return {
    session_id: `s-${scenarioId}`,
    provider: "claude-code",
    scenario_id: scenarioId,
    source: {},
    turns: [
      { turn_number: 0, assistant_text: "", tool_calls: [], blocks_in_prompt: [block("1")] },
      {
        turn_number: 1, assistant_text: "", tool_calls: [],
        blocks_in_prompt: repeatedContent ? [block("1")] : [block("2")],
      },
    ],
  };
}

function makeDeps(): DuelDeps {
  return {
    setMutationEnabled: vi.fn(),
    sleep: vi.fn(async () => {}),
    now: () => new Date("2026-06-14T00:00:00.000Z"),
    runScenarioSession: vi.fn(async (scenarioId: string, mutationEnabled: boolean) => ({
      normalized: session(scenarioId, mutationEnabled), // ON => repeated content => cache hit
      transcriptPath: undefined,
      billed: mutationEnabled
        ? { input_tokens: 100, cache_read_tokens: 900, cache_creation_tokens: 50 }
        : { input_tokens: 1000, cache_read_tokens: 0, cache_creation_tokens: 0 },
    })),
  };
}

describe("runDuel", () => {
  const scenarios = [
    { id: "alpha", title: "A", description: "d", prompt: "p", turns: ["p", "p2"],
      workspace_files: [], expected_references: [], tags: [] },
  ];

  it("runs each scenario ON and OFF and reports estimate savings", async () => {
    const deps = makeDeps();
    const report = await runDuel(
      { run_id: "duel-1", cooldown_seconds: 0, model: "claude-sonnet", estimate_only: false },
      scenarios,
      deps,
    );
    expect(deps.runScenarioSession).toHaveBeenCalledTimes(2); // ON + OFF
    expect(report.totals.estimate_savings_ratio).toBeGreaterThan(0);
    expect(report.totals.live_usd_savings_ratio).toBeGreaterThan(0);
  });

  it("toggles mutation on and off around the runs", async () => {
    const deps = makeDeps();
    await runDuel(
      { run_id: "duel-1", cooldown_seconds: 0, model: "claude-sonnet", estimate_only: false },
      scenarios, deps,
    );
    const calls = (deps.setMutationEnabled as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(calls).toContain(true);
    expect(calls).toContain(false);
  });

  it("estimate_only mode skips the live OFF/ON billed run for dollars", async () => {
    const deps = makeDeps();
    const report = await runDuel(
      { run_id: "duel-1", cooldown_seconds: 0, model: "claude-sonnet", estimate_only: true },
      scenarios, deps,
    );
    expect(report.totals.live_usd_on).toBe(0);
    expect(report.totals.live_usd_off).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/benchmark/__tests__/duel.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the orchestrator**

Create `src/benchmark/duel.ts`:

```ts
import type { NormalizedTraceSession, ScenarioSpec } from "../agent-traces/types.js";
import { generateRecordedBenchmarkReport } from "./recorded.js";
import { buildDuelReport, type DuelReport, type DuelScenarioInput } from "./duel-report.js";
import type { BilledTokens } from "./pricing.js";

export interface ScenarioRunResult {
  normalized: NormalizedTraceSession;
  transcriptPath?: string;
  billed: BilledTokens;
}

export interface DuelDeps {
  setMutationEnabled: (enabled: boolean) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  runScenarioSession: (scenarioId: string, mutationEnabled: boolean) => Promise<ScenarioRunResult>;
}

export interface RunDuelOptions {
  run_id: string;
  cooldown_seconds: number;
  model: string;
  estimate_only: boolean;
}

const ZERO_BILLED: BilledTokens = {
  input_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
};

function estimateUnits(
  session: NormalizedTraceSession,
  model: string,
  run_id: string,
  generated_at: string,
): { baseline: number; effective: number } {
  const report = generateRecordedBenchmarkReport({
    run_id,
    generated_at,
    sessions: [session],
    model,
  });
  return {
    baseline: report.totals.baseline_cost_units,
    effective: report.totals.effective_cost_units,
  };
}

export async function runDuel(
  options: RunDuelOptions,
  scenarios: ScenarioSpec[],
  deps: DuelDeps,
): Promise<DuelReport> {
  const generated_at = deps.now().toISOString();
  const cooldownMs = options.cooldown_seconds * 1000;
  const inputs: DuelScenarioInput[] = [];

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    // Alternate which side runs first so neither side systematically pre-warms the cache.
    const onFirst = i % 2 === 0;
    const order: boolean[] = onFirst ? [true, false] : [false, true];

    const results = new Map<boolean, ScenarioRunResult>();
    for (let j = 0; j < order.length; j++) {
      const mutationEnabled = order[j];
      deps.setMutationEnabled(mutationEnabled);
      results.set(mutationEnabled, await deps.runScenarioSession(scenario.id, mutationEnabled));
      if (cooldownMs > 0 && j < order.length - 1) await deps.sleep(cooldownMs);
    }

    const onResult = results.get(true)!;
    const offResult = results.get(false)!;
    const onEst = estimateUnits(onResult.normalized, options.model, options.run_id, generated_at);
    const offEst = estimateUnits(offResult.normalized, options.model, options.run_id, generated_at);

    inputs.push({
      scenario_id: scenario.id,
      turns: scenario.turns.length,
      on: {
        estimate_baseline_units: onEst.baseline,
        estimate_effective_units: onEst.effective,
        billed: options.estimate_only ? ZERO_BILLED : onResult.billed,
      },
      off: {
        estimate_baseline_units: offEst.baseline,
        estimate_effective_units: offEst.effective,
        billed: options.estimate_only ? ZERO_BILLED : offResult.billed,
      },
    });
  }

  return buildDuelReport({
    run_id: options.run_id,
    generated_at,
    cooldown_seconds: options.cooldown_seconds,
    model: options.model,
    scenarios: inputs,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/benchmark/__tests__/duel.test.ts`
Expected: PASS.

- [ ] **Step 5: Re-export from index**

In `src/benchmark/index.ts`, add (alongside existing exports):

```ts
export { runDuel, type DuelDeps, type RunDuelOptions } from "./duel.js";
export { buildDuelReport, renderDuelMarkdown, type DuelReport } from "./duel-report.js";
```

- [ ] **Step 6: Run the full benchmark suite**

Run: `npx vitest run src/benchmark/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/benchmark/duel.ts src/benchmark/index.ts src/benchmark/__tests__/duel.test.ts
git commit -m "feat(benchmark): add duel orchestrator with injectable side effects"
```

---

## Task 8: CLI `benchmark duel` subcommand

**Files:**
- Modify: `src/cli/index.ts` (add subcommand after `dashboard`, around line 603)
- Test: manual smoke (the live path needs Claude Code; estimate-only path is the testable surface)

Wires real dependencies into `runDuel`: `setMutationEnabled` from `../cli/config.js`, `sleep` via `setTimeout`, and a `runScenarioSession` that writes the scenario workspace files, invokes the `claude-code` adapter for the turn sequence, normalizes the transcript, and extracts billed usage. Writes `duel-report.json` + `DUEL-REPORT.md` under `benchmark/runs/<run-id>/`.

- [ ] **Step 1: Add the subcommand**

In `src/cli/index.ts`, after the `dashboard` subcommand block (ends ~line 603), add:

```ts
  benchmarkCmd
    .command("duel")
    .description("Run CacheLane ON vs OFF on the same scenarios and emit one comparison report")
    .option("--run-id <id>", "Run identifier (default: timestamp)")
    .option("--cooldown <seconds>", "Cooldown between ON/OFF runs", (v) => parseInt(v, 10), 360)
    .option("--model <model>", "Model id for the estimate tier", "claude-sonnet-4-6")
    .option("--scenario-dir <dir>", "Scenario directory")
    .option("--estimate-only", "Skip live Claude Code runs (free, CI-safe)", false)
    .action(async (cmd: {
      runId?: string; cooldown: number; model: string; scenarioDir?: string; estimateOnly: boolean;
    }) => {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const { loadScenarioSpecs } = await import("../agent-traces/scenarios.js");
      const { createClaudeCodeAdapter } = await import("../agent-traces/providers/claude-code.js");
      const { normalizeTrace } = await import("../agent-traces/normalizer.js");
      const { extractBilledUsage } = await import("../benchmark/usage-extract.js");
      const { runDuel, renderDuelMarkdown } = await import("../benchmark/index.js");
      const { setMutationEnabled } = await import("./config.js");

      const runId = cmd.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
      const configPath = cachelaneConfigPath(env);
      const scenarios = loadScenarioSpecs(cmd.scenarioDir);
      const adapter = createClaudeCodeAdapter();
      const runDir = resolve(process.cwd(), "benchmark", "runs", runId);
      mkdirSync(runDir, { recursive: true });

      const report = await runDuel(
        { run_id: runId, cooldown_seconds: cmd.cooldown, model: cmd.model, estimate_only: cmd.estimateOnly },
        scenarios,
        {
          setMutationEnabled: (enabled: boolean) => { setMutationEnabled(configPath, enabled); },
          sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
          now: () => new Date(),
          runScenarioSession: async (scenarioId: string) => {
            const scenario = scenarios.find((s) => s.id === scenarioId)!;
            const raw = await adapter.runScenario(scenario, {
              dry_run: cmd.estimateOnly,
              run_id: runId,
              run_dir: runDir,
              now: () => new Date(),
            });
            const normalized = normalizeTrace(raw);
            const billed = raw.transcript_path
              ? extractBilledUsage(raw.transcript_path)
              : { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
            return { normalized, transcriptPath: raw.transcript_path, billed };
          },
        },
      );

      // Always restore mutation to ON after the duel (fail-open default).
      setMutationEnabled(configPath, true);

      const jsonPath = resolve(runDir, "duel-report.json");
      const mdPath = resolve(runDir, "DUEL-REPORT.md");
      writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      writeFileSync(mdPath, renderDuelMarkdown(report), "utf8");

      io.stdout(`${JSON.stringify({ run_id: runId, json_path: jsonPath, markdown_path: mdPath, totals: report.totals }, null, 2)}\n`);
    });
```

- [ ] **Step 2: Build and typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 3: Estimate-only smoke (no Claude Code needed)**

Run: `npm run build && node dist/cli/index.js benchmark duel --estimate-only --cooldown 0 --run-id duel-smoke`
Expected: prints JSON with `run_id: "duel-smoke"` and a `totals` object; writes `benchmark/runs/duel-smoke/duel-report.json` and `DUEL-REPORT.md`. Live dollars are `0` (estimate-only); estimate units are populated from the dry-run normalized sessions.

Note: in `--estimate-only`, the dry-run adapter produces no prompt blocks, so estimate savings may be `0`. That is expected — estimate-only validates wiring, not savings. Real savings require the live run (Step 5) or the recorded benchmark.

- [ ] **Step 4: Verify CLI tests still pass**

Run: `npx vitest run src/cli/`
Expected: PASS.

- [ ] **Step 5 (optional, live): Real duel**

Prerequisites: `cachelane install` done, the local proxy/server running, `claude` on PATH, valid credentials. Then:

Run: `node dist/cli/index.js benchmark duel --cooldown 360 --run-id duel-live-1`
Expected: drives Claude Code twice per scenario (~real minutes + cooldowns), writes a report whose HEADLINE estimate and LIVE BILLED dollars both show ON < OFF. Confirm `features.mutation_enabled` is restored to `true` in the config afterward.

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): add benchmark duel subcommand"
```

---

## Task 9: Multi-turn scenario fixture

**Files:**
- Create: `benchmark/scenarios/09-multi-turn-refactor.json`
- Test: `npx vitest run src/agent-traces/__tests__/scenarios.test.ts` (loader already validates all scenarios)

A 4-turn scenario so the duel exercises cache reuse + K-pruning across turns. Tagged `multi-turn`.

- [ ] **Step 1: Create the fixture**

Create `benchmark/scenarios/09-multi-turn-refactor.json`:

```json
{
  "id": "multi-turn-refactor",
  "title": "Multi-turn refactor",
  "description": "Read a file, find an edge case, write a test, then refactor across four turns in one session so cache reuse and pruning engage.",
  "turns": [
    "Read src/cache-policy.ts and summarize the TTL behavior in two sentences.",
    "Find any edge case where the one hour prefix never refreshes.",
    "Write a test that reproduces that edge case.",
    "Refactor ttlForPrefix to fix the edge case while keeping the test green."
  ],
  "workspace_files": [
    {
      "path": "src/cache-policy.ts",
      "content": "export function ttlForPrefix(kind: 'ephemeral_5m' | 'ephemeral_1h'): number { return kind === 'ephemeral_1h' ? 3600 : 300; } The keepalive worker should avoid refreshing one hour prefixes unless the policy explicitly enables it."
    }
  ],
  "expected_references": ["src/cache-policy.ts"],
  "tags": ["multi-turn", "refactor"]
}
```

- [ ] **Step 2: Verify it loads and validates**

Run: `npx vitest run src/agent-traces/__tests__/scenarios.test.ts`
Expected: PASS — loader accepts the 4-turn scenario; `turns.length === 4`, `prompt === turns[0]`.

- [ ] **Step 3: Confirm estimate-only duel picks it up**

Run: `node dist/cli/index.js benchmark duel --estimate-only --cooldown 0 --run-id duel-smoke-2`
Expected: the report's `scenarios` array includes a row with `scenario_id: "multi-turn-refactor"` and `turns: 4`.

- [ ] **Step 4: Commit**

```bash
git add benchmark/scenarios/09-multi-turn-refactor.json
git commit -m "feat(benchmark): add multi-turn refactor scenario fixture"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS (paste output before claiming done — per CLAUDE.md verification discipline).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Docs touch-up (optional)**

If updating `BENCHMARK.md`, add a short "Duel" section pointing at `benchmark duel` and noting estimate-only is free/CI-safe while live mode is credential-gated. Keep it brief.

---

## Notes & runtime assumptions

- **The on/off lever is `features.mutation_enabled`**, gated at `src/proxy/server.ts:415`. The duel assumes the running proxy re-reads config per request (so a mid-run toggle takes effect on the next turn). Verify this during the live run (Task 8 Step 5); if the proxy caches config at startup, the orchestrator will need to signal a reload or the proxy must be restarted between phases — flag this as a follow-up if observed.
- **Cache hygiene** uses interleave + cooldown with alternating ON/OFF order per scenario. Default cooldown 360s clears the 5m prompt-cache window; raise it if you observe cross-run warm-cache bleed in the live numbers.
- **Determinism**: prompts are byte-identical across ON/OFF, but real model responses vary. The report leans on the estimate tier for the headline and labels live dollars as directional.
- **Session pinning**: `--session-id <uuid>` then `--resume <uuid>`. Verify these flags against the installed `claude` version during the live run; adjust the arg builder in `claude-code.ts` if the flag names differ.
- **No new npm deps** were introduced. If a future change needs one, write an ADR first (per CLAUDE.md).
