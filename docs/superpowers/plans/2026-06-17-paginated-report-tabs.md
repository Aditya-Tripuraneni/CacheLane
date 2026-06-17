# Merged Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cachelane report` emit a single self-contained HTML page that shows the live-DB tabs (Usage / Curve / Decisions) and, when `--benchmark <file>` is given, also the recorded-benchmark tabs (Totals / Scenarios) — up to five tabs in one file.

**Architecture:** Extract `benchmarkTabs(report): PageTab[]` from the benchmark renderer and accept an optional `RecordedBenchmarkReport` in `renderReportHtml(data, benchmark?)`, composing both tab sets through the existing `pageShell`. Thread the optional benchmark through `generateReport`. Add a `--benchmark <path>` flag to the `report` CLI command that fail-open loads + validates a `benchmark-report.json`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, Node 20 (`nvm use 20` — required for better-sqlite3 + vitest). Lint: `eslint src`. Types: `npx tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-06-17-paginated-report-tabs-design.md`

**Vocabulary reminder:** `STABLE | SEMI | VOLATILE` only. snake_case for storage/API-contract types; camelCase for in-process helpers (`PageTab`, `benchmarkTabs`, function params).

**Run all test commands with Node 20.** Prefix with `nvm use 20 &&` if the shell is not already on Node 20.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/benchmark/render-html.ts` | Render `RecordedBenchmarkReport` → HTML | Extract `benchmarkTabs(report): PageTab[]`; wrapper calls it |
| `src/report/render-html.ts` | Render `ReportData` → HTML | `renderReportHtml(data, benchmark?)`; append `benchmarkTabs` when present |
| `src/report/index.ts` | Report write path | `generateReport(db, opts, outPath, benchmark?)` passes benchmark through |
| `src/cli/index.ts` | CLI `report` command | Add `--benchmark <path>`; fail-open load + validate; pass to `generateReport` |
| `src/benchmark/__tests__/render-html.test.ts` | Benchmark renderer tests | Add `benchmarkTabs` unit test |
| `src/report/__tests__/render-html.test.ts` | Report renderer tests | Add merged-page (with/without benchmark) tests |
| `src/cli/__tests__/cli.test.ts` | CLI tests | Add report `--benchmark` valid + fail-open tests |

`src/report/theme.ts` (already tab-based), charts, ANSI dashboard, markdown report, `scripts/benchmark/run-recorded.ts`, and `web/` are **untouched**.

---

## Task 1: Extract `benchmarkTabs` from the benchmark renderer

**Files:**
- Modify: `src/benchmark/render-html.ts`
- Test: `src/benchmark/__tests__/render-html.test.ts`

- [ ] **Step 1: Add a `benchmarkTabs` unit test**

In `src/benchmark/__tests__/render-html.test.ts`, add this import line at the top alongside the existing import:

```ts
import { renderRecordedBenchmarkHtml, benchmarkTabs } from "../render-html.js";
```

(Replace the existing `import { renderRecordedBenchmarkHtml } from "../render-html.js";` line.)

Then add this test inside the `describe("renderRecordedBenchmarkHtml", ...)` block, after the existing `"renders totals and scenarios as separate tab panels"` test:

```ts
  it("exposes totals and scenarios as reusable PageTabs", () => {
    const tabs = benchmarkTabs(report);
    expect(tabs.map((t) => t.id)).toEqual(["totals", "scenarios"]);
    expect(tabs.map((t) => t.label)).toEqual(["Totals", "Scenarios"]);
    expect(tabs[0].html).toContain("Savings");
    expect(tabs[1].html).toContain("read-summarize-file");
  });
```

- [ ] **Step 2: Run the benchmark renderer test to verify it fails**

Run: `nvm use 20 && npx vitest run src/benchmark/__tests__/render-html.test.ts`
Expected: FAIL — `benchmarkTabs` is not exported (import error / undefined).

- [ ] **Step 3: Extract `benchmarkTabs` and rewrite the wrapper**

In `src/benchmark/render-html.ts`, replace the whole `renderRecordedBenchmarkHtml` function (the `export function renderRecordedBenchmarkHtml(report: RecordedBenchmarkReport): string { ... }` block) with:

```ts
export function benchmarkTabs(report: RecordedBenchmarkReport): PageTab[] {
  const t = report.totals;
  const totalsHtml = `
<div class="cards">
  ${card("Savings", pct(t.savings_ratio))}
  ${card("Cache hit ratio", pct(t.cache_hit_ratio))}
  ${card("Sessions", String(report.counts.sessions))}
  ${card("Turns", String(report.counts.turns))}
  ${card("Baseline units", t.baseline_cost_units.toFixed(0))}
  ${card("Effective units", t.effective_cost_units.toFixed(0))}
  ${card("Pruned blocks", String(t.pruned_blocks))}
</div>`;

  const scenariosHtml = `
<table>
<thead><tr><th>Scenario</th><th>Turns</th><th>Blocks</th><th>Cache hit</th><th>Savings</th><th>Savings bar</th></tr></thead>
<tbody>${scenarioRows(report)}</tbody>
</table>`;

  return [
    { id: "totals", label: "Totals", html: totalsHtml },
    { id: "scenarios", label: "Scenarios", html: scenariosHtml },
  ];
}

export function renderRecordedBenchmarkHtml(report: RecordedBenchmarkReport): string {
  return pageShell({
    title: "CacheLane Benchmark",
    subtitle: `Run ${esc(report.run_id)} · Generated ${esc(report.generated_at)}`,
    tabs: benchmarkTabs(report),
    footerHtml: `<footer>Generated from a recorded benchmark run (provider: ${esc(report.source.provider ?? "unknown")}, model: ${esc(report.source.model)}). No prompt text, assistant text, tool output, or file contents are persisted in this report — content_persisted: false.</footer>`,
  });
}
```

Then update the import on line 1 to also bring in the `PageTab` type:

```ts
import { pageShell, type PageTab } from "../report/theme.js";
```

The helpers (`esc`, `pct`, `card`, `scenarioRows`) above this function are unchanged.

- [ ] **Step 4: Run the benchmark renderer test to verify it passes**

Run: `nvm use 20 && npx vitest run src/benchmark/__tests__/render-html.test.ts`
Expected: PASS (all six tests).

- [ ] **Step 5: Commit**

```bash
git add src/benchmark/render-html.ts src/benchmark/__tests__/render-html.test.ts
git commit -m "refactor: extract reusable benchmarkTabs from benchmark renderer"
```

---

## Task 2: Accept an optional benchmark in the report renderer

**Files:**
- Modify: `src/report/render-html.ts`
- Test: `src/report/__tests__/render-html.test.ts`

- [ ] **Step 1: Add merged-page tests**

In `src/report/__tests__/render-html.test.ts`, add this import at the top, after the existing `ReportData` import:

```ts
import type { RecordedBenchmarkReport } from "../../benchmark/types.js";
```

Add this fixture constant after the existing `data` constant (before the `describe` block):

```ts
const benchmark: RecordedBenchmarkReport = {
  run_id: "demo-run",
  generated_at: "2026-06-16T00:00:00Z",
  source: { kind: "normalized_trace", provider: "fake", normalized_dir: null, model: "m" },
  counts: { sessions: 1, turns: 2, blocks: 3, tool_calls: 1 },
  totals: {
    input_tokens: 100, cache_read_tokens: 400, baseline_cost_units: 500, effective_cost_units: 140,
    savings_ratio: 0.72, cache_hit_ratio: 0.8, pruned_blocks: 1, keepalive_pings: 0,
  },
  scenarios: [
    { scenario_id: "read-summarize-file", session_id: "s1", turns: 2, blocks: 3, tool_calls: 1,
      input_tokens: 100, cache_read_tokens: 400, baseline_cost_units: 500, effective_cost_units: 140,
      savings_ratio: 0.72, cache_hit_ratio: 0.8, pruned_blocks: 1, keepalive_pings: 0 },
  ],
  privacy: { content_persisted: false },
};
```

Then add these two tests inside the `describe("renderReportHtml", ...)` block, after the existing `"declares content_persisted false and includes all three panels"` test:

```ts
  it("omits benchmark panels when no benchmark is supplied", () => {
    const html = renderReportHtml(data);
    expect(html).not.toContain('id="p-totals"');
    expect(html).not.toContain('id="p-scenarios"');
  });

  it("appends benchmark totals and scenarios panels when a benchmark is supplied", () => {
    const html = renderReportHtml(data, benchmark);
    expect(html).toContain('id="p-usage"');
    expect(html).toContain('id="p-totals"');
    expect(html).toContain('id="p-scenarios"');
    expect(html).toContain("read-summarize-file");
  });
```

- [ ] **Step 2: Run the report renderer test to verify it fails**

Run: `nvm use 20 && npx vitest run src/report/__tests__/render-html.test.ts`
Expected: FAIL — `renderReportHtml(data, benchmark)` does not yet accept a second argument, so the benchmark panels are absent.

- [ ] **Step 3: Add the optional benchmark parameter to `renderReportHtml`**

In `src/report/render-html.ts`, change the imports on lines 1–3 to also import the benchmark tab-builder and the report type:

```ts
import type { ReportData, ReportTurn } from "./types.js";
import type { RecordedBenchmarkReport } from "../benchmark/types.js";
import { renderCurveSvg, renderStackedBarSvg } from "./charts.js";
import { pageShell } from "./theme.js";
import { benchmarkTabs } from "../benchmark/render-html.js";
```

Then change the `renderReportHtml` signature and its `pageShell` call. Replace the function signature line:

```ts
export function renderReportHtml(data: ReportData): string {
```

with:

```ts
export function renderReportHtml(data: ReportData, benchmark?: RecordedBenchmarkReport): string {
```

And replace the `tabs: [ ... ]` array inside the `pageShell({ ... })` return with:

```ts
    tabs: [
      { id: "usage", label: "Usage", html: usageHtml },
      { id: "curve", label: "Curve", html: curveHtml },
      { id: "decisions", label: "Decisions", html: decisionsHtml },
      ...(benchmark ? benchmarkTabs(benchmark) : []),
    ],
```

The helper functions (`esc`, `pct`, `cumulative`, `card`, `decisionRows`) and all data-computation consts are unchanged.

- [ ] **Step 4: Run the report renderer test to verify it passes**

Run: `nvm use 20 && npx vitest run src/report/__tests__/render-html.test.ts`
Expected: PASS (all six tests).

- [ ] **Step 5: Commit**

```bash
git add src/report/render-html.ts src/report/__tests__/render-html.test.ts
git commit -m "feat: merge optional benchmark tabs into the report page"
```

---

## Task 3: Thread the optional benchmark through `generateReport`

**Files:**
- Modify: `src/report/index.ts`
- Test: none (covered by the CLI test in Task 4; this is a one-line signature passthrough)

- [ ] **Step 1: Add the optional benchmark parameter**

In `src/report/index.ts`, change the imports to also export/import the benchmark type, and update `generateReport`.

Add this type import near the top (after the `ReportOptions` import on line 7):

```ts
import type { RecordedBenchmarkReport } from "../benchmark/types.js";
```

Replace the `generateReport` function (lines 19–27) with:

```ts
export function generateReport(
  db: CachelaneDb,
  opts: ReportOptions,
  outPath: string,
  benchmark?: RecordedBenchmarkReport,
): GenerateReportResult {
  const data = buildReportData(db, opts);
  writeFileSync(outPath, renderReportHtml(data, benchmark), "utf8");
  return { out_path: outPath, turns: data.turns.length, sessions: data.sessions.length };
}
```

- [ ] **Step 2: Typecheck**

Run: `nvm use 20 && npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/report/index.ts
git commit -m "feat: pass optional benchmark through generateReport"
```

---

## Task 4: Add the `--benchmark` flag to the report command (fail-open)

**Files:**
- Modify: `src/cli/index.ts`
- Test: `src/cli/__tests__/cli.test.ts`

- [ ] **Step 1: Add CLI tests for the merged report**

In `src/cli/__tests__/cli.test.ts`, add these tests inside the `describe("cachelane CLI", ...)` block (after an existing `it(...)`). They use the same `run`/`env`/`fs`/`path`/`os` helpers already in the file. A valid benchmark file is the serialized `RecordedBenchmarkReport`; a garbage file is invalid JSON.

```ts
  it("report --benchmark embeds the benchmark panels in the HTML", async () => {
    const benchmarkPath = path.join(tmpDir, "benchmark-report.json");
    fs.writeFileSync(
      benchmarkPath,
      JSON.stringify({
        run_id: "r1",
        generated_at: "2026-06-16T00:00:00Z",
        source: { kind: "normalized_trace", provider: "fake", normalized_dir: null, model: "m" },
        counts: { sessions: 1, turns: 2, blocks: 3, tool_calls: 1 },
        totals: {
          input_tokens: 100, cache_read_tokens: 400, baseline_cost_units: 500,
          effective_cost_units: 140, savings_ratio: 0.72, cache_hit_ratio: 0.8,
          pruned_blocks: 1, keepalive_pings: 0,
        },
        scenarios: [
          { scenario_id: "read-summarize-file", session_id: "s1", turns: 2, blocks: 3, tool_calls: 1,
            input_tokens: 100, cache_read_tokens: 400, baseline_cost_units: 500, effective_cost_units: 140,
            savings_ratio: 0.72, cache_hit_ratio: 0.8, pruned_blocks: 1, keepalive_pings: 0 },
        ],
        privacy: { content_persisted: false },
      }),
    );
    const outPath = path.join(tmpDir, "report.html");
    await run(["report", "--out", outPath, "--no-open", "--benchmark", benchmarkPath]);
    const html = fs.readFileSync(outPath, "utf-8");
    expect(html).toContain('id="p-usage"');
    expect(html).toContain('id="p-totals"');
    expect(html).toContain('id="p-scenarios"');
    expect(html).toContain("read-summarize-file");
  });

  it("report --benchmark fails open on an unreadable benchmark file", async () => {
    const badPath = path.join(tmpDir, "garbage.json");
    fs.writeFileSync(badPath, "{not valid json");
    const outPath = path.join(tmpDir, "report.html");
    // run() asserts stderr is empty, so use a tolerant inline runner that captures stderr.
    let stderr = "";
    const program = createCachelaneCli({
      env,
      io: { stdout: () => {}, stderr: (t) => { stderr += t; } },
    });
    program.exitOverride();
    await program.parseAsync(["node", "cachelane", "report", "--out", outPath, "--no-open", "--benchmark", badPath]);
    const html = fs.readFileSync(outPath, "utf-8");
    expect(html).toContain('id="p-usage"');
    expect(html).not.toContain('id="p-totals"');
    expect(stderr).toMatch(/benchmark/i);
  });
```

Confirm `createCachelaneCli` is already imported at the top of the test file (it is used by the `run` helper). If not, add it to the existing import from `../index.js`.

- [ ] **Step 2: Run the CLI test to verify it fails**

Run: `nvm use 20 && npx vitest run src/cli/__tests__/cli.test.ts`
Expected: FAIL — there is no `--benchmark` flag, so the embed test finds no `p-totals`; the unknown-option may also error.

- [ ] **Step 3: Add the `--benchmark` flag and fail-open loader**

In `src/cli/index.ts`, in the `report` command definition (around lines 387–424):

Add this option after the `--out` option line (`.option("--out <path>", "Output HTML path")`):

```ts
    .option("--benchmark <path>", "Embed a recorded benchmark-report.json as extra tabs")
```

Add `benchmark?: string` to the action's destructured option type. Change:

```ts
      sessionId?: string; workspaceId?: string; db?: string; out?: string; open?: boolean;
```

to:

```ts
      sessionId?: string; workspaceId?: string; db?: string; out?: string; open?: boolean; benchmark?: string;
```

Inside the `try` block, after the `--json` early-return and before `const outPath = ...`, add the fail-open loader:

```ts
        let benchmark: RecordedBenchmarkReport | undefined;
        if (cmd.benchmark) {
          try {
            const raw = JSON.parse(readFileSync(cmd.benchmark, "utf8")) as RecordedBenchmarkReport;
            if (raw && typeof raw === "object" && raw.privacy?.content_persisted === false && Array.isArray(raw.scenarios)) {
              benchmark = raw;
            } else {
              io.stderr(`cachelane: ignoring --benchmark ${cmd.benchmark}: not a content-free benchmark report\n`);
            }
          } catch (err) {
            io.stderr(`cachelane: ignoring --benchmark ${cmd.benchmark}: ${err instanceof Error ? err.message : String(err)}\n`);
          }
        }
```

Change the `generateReport` call to pass the benchmark:

```ts
        const result = generateReport(context.db, opts, outPath, benchmark);
```

Ensure the needed imports exist at the top of `src/cli/index.ts`:
- `readFileSync` from `node:fs` (add `readFileSync` to the existing `node:fs` import; if there is no `node:fs` import yet, add `import { readFileSync } from "node:fs";`).
- `import type { RecordedBenchmarkReport } from "../benchmark/types.js";`

(Check the top of the file first; only add an import that is not already present.)

- [ ] **Step 4: Run the CLI test to verify it passes**

Run: `nvm use 20 && npx vitest run src/cli/__tests__/cli.test.ts`
Expected: PASS — embed test finds the benchmark panels; fail-open test still writes the 3-tab page and emits a `benchmark` warning to stderr.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/__tests__/cli.test.ts
git commit -m "feat: cachelane report --benchmark embeds recorded benchmark tabs (fail-open)"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `nvm use 20 && npm test`
Expected: PASS — full suite green. No failures.

- [ ] **Step 2: Lint**

Run: `nvm use 20 && npm run lint`
Expected: clean, no errors.

- [ ] **Step 3: Typecheck**

Run: `nvm use 20 && npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 4: Smoke-test the merged report**

Run a recorded benchmark to produce a `benchmark-report.json`, then generate a merged report:
```bash
mkdir -p /tmp/cachelane-ui
nvm use 20 && npx tsx scripts/benchmark/run-recorded.ts --provider fake --run-id merged-preview
# find the produced benchmark-report.json path from the JSON output's report_path, then:
# npx tsx <cli entry> report --out /tmp/cachelane-ui/report.html --no-open --benchmark <report_path>
```
If a CLI entry for `report` is not conveniently runnable via tsx, rely on the Task 4 CLI test as the smoke test instead and note that here.

Then verify the tab markup is present in a merged file (or assert via the CLI test):
```bash
grep -c 'class="tab-radio"' /tmp/cachelane-ui/report.html
grep -c 'id="p-totals"' /tmp/cachelane-ui/report.html
```
Expected: first grep = 5 (one radio per tab), second grep = 1.

- [ ] **Step 5: Paste the verification output**

Per CLAUDE.md `verification-before-completion`: paste the `npm test`, `npm run lint`, and `npx tsc --noEmit` output before claiming done. Do not claim completion without it.

---

## Self-Review Notes

- **Spec coverage:** Task 1 extracts `benchmarkTabs` (spec "benchmark/render-html.ts" section); Task 2 adds the optional benchmark to `renderReportHtml` (spec "report/render-html.ts"); Task 3 threads it through `generateReport` (spec "report/index.ts"); Task 4 adds the `--benchmark` flag + fail-open loader (spec "cli/index.ts" + Fail-open invariant); Task 5 covers verification + invariants.
- **Type consistency:** `PageTab` (`{id,label,html}`) and `RecordedBenchmarkReport` are used identically across tasks. Panel ids `usage/curve/decisions/totals/scenarios` are unique across the merged set. `benchmark?` is optional everywhere it appears (`renderReportHtml`, `generateReport`, CLI option).
- **Invariants:** no `<script>` / external URLs (asserted); no `Date.now()`/`Math.random()` added; `content_persisted` meta preserved by `pageShell`; `--benchmark` validates `privacy.content_persisted === false` and fails open on any error.
- **Standalone benchmark page unchanged:** `renderRecordedBenchmarkHtml(report)` keeps its signature, so `scripts/benchmark/run-recorded.ts` is untouched.
- **No placeholders:** every code step shows full replacement code; every run step has an exact command + expected result.
