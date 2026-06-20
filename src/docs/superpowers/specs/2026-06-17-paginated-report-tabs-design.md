# CacheLane Merged Report — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorming) — supersedes the earlier two-files-with-tabs design
**Author:** Claude/agent session
**Topic:** Consolidate CacheLane's report HTML and benchmark HTML into **one** self-contained,
CSS-only tabbed page emitted by `cachelane report`. The warm theme stays as-is.

## Problem

CacheLane produces two separate HTML outputs:

- `cachelane report` → a page built from the local SQLite `ReportData` (tabs: Usage / Curve /
  Decisions).
- The benchmark run script → a page built from an in-memory `RecordedBenchmarkReport` (tabs:
  Totals / Scenarios).

The user wants the benchmark and report **on the same output, not two separate outputs** — a single
file presenting all the views as tabs.

**Data-model constraint (the reason for the `--benchmark` flag):** the live report SQLite DB has
only sessions and turns. It has no notion of "scenarios" — `scenario_id` exists *only* inside a
recorded benchmark run (`RecordedBenchmarkReport.scenarios[]`). So the Totals/Scenarios tabs cannot
be derived from the live DB; they require an external benchmark run file. When that file is absent,
those two tabs are simply omitted.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| What "consolidate" means | **One merged file.** `cachelane report` emits a single HTML page with up to five tabs. NOT two files. |
| Tab mechanism | **CSS-only radio tabs** (already implemented in `pageShell`): hidden `<input type=radio>` + `<label>` + `:checked ~` sibling selectors. Zero JavaScript. |
| Entry point | `cachelane report` (the existing command). HTML is already its default output, so no new `--html` flag is added; the existing `--out <path>` controls the destination. |
| Where the benchmark data comes from | A new **`--benchmark <file>`** flag pointing at a recorded `benchmark-report.json`. Omit it → 3 report tabs only. Supply it → Totals + Scenarios tabs appended (5 tabs total). |

## Constraints (project invariants — non-negotiable)

- **Self-contained / offline:** no external URLs, no CDN, no `<script src>`, no React runtime. The
  page is pure HTML + CSS, openable from disk.
- **Local-only:** renders only from the local DB and a local benchmark file. Every page keeps
  `<meta name="cachelane:content_persisted" content="false">`. The CLI asserts the loaded benchmark
  file has `privacy.content_persisted === false` before embedding it.
- **Byte-stable:** no `Date.now()` / randomness in the renderers. The per-tab `:checked` rules are
  generated deterministically by `pageShell` from the tab ids. (`generated_at` comes in as input
  data from the CLI; that is unchanged.) The SHA-256 prefix-cache-stability gate is unaffected.
- **Fail-open:** if `--benchmark` is given but the file is missing, unparseable, or not a valid
  content-free benchmark report, the CLI logs a warning to **stderr** and renders the 3-tab page
  anyway. A bad `--benchmark` flag never breaks the report.

## Architecture

Two tab-builders, one shell, composed by the report renderer.

### `src/report/theme.ts` (unchanged — already tab-based)

`pageShell({ title, subtitle, tabs: PageTab[], footerHtml? })` already emits the radio/label/panel
markup and generated `:checked` rules. `PageTab = { id, label, html }`. No change this milestone.

### `src/report/render-html.ts`

- **Extract** `export function reportTabs(data: ReportData): PageTab[]` — returns the three existing
  tabs `[usage, curve, decisions]` (the html bodies built today inside `renderReportHtml`).
- **Change** `renderReportHtml(data, benchmark?)` to accept an optional `RecordedBenchmarkReport`.
  It composes `pageShell({ tabs: [...reportTabs(data), ...(benchmark ? benchmarkTabs(benchmark) : [])], ... })`.
  Imports `benchmarkTabs` from `../benchmark/render-html.js`.
- Tab id uniqueness: report ids are `usage/curve/decisions`, benchmark ids are `totals/scenarios` —
  no collisions across the merged set.

### `src/benchmark/render-html.ts`

- **Extract** `export function benchmarkTabs(report: RecordedBenchmarkReport): PageTab[]` — returns
  the two existing tabs `[totals, scenarios]`.
- `renderRecordedBenchmarkHtml(report)` stays a thin wrapper:
  `pageShell({ tabs: benchmarkTabs(report), ... })`. **The standalone benchmark `--html` output is
  unchanged** — still its own 2-tab page; the run script's call site is untouched.

### `src/report/index.ts`

- `generateReport(db, opts, outPath, benchmark?)` gains an optional `benchmark: RecordedBenchmarkReport`
  parameter, passed straight through to `renderReportHtml(data, benchmark)`.

### `src/cli/index.ts` — `report` subcommand

- Add `.option("--benchmark <path>", "Embed a recorded benchmark-report.json as extra tabs")`.
- In the action: if `cmd.benchmark` is set, read + `JSON.parse` the file inside a try/catch.
  Validate it is an object with `privacy.content_persisted === false` and an array `scenarios`.
  On success pass it to `generateReport`; on any failure write a one-line warning to `io.stderr`
  (or stdout if no stderr sink) and proceed with `benchmark = undefined`.

## Data flow

```
ReportData (local DB) ─────────────────►┐
                                         ├─► renderReportHtml(data, benchmark?) ─► pageShell([...reportTabs, ...benchmarkTabs?]) ─► report.html
RecordedBenchmarkReport (--benchmark) ──►┘   (benchmarkTabs only when the flag is supplied & valid)
```

## Testing (TDD: red → watch fail → minimal green)

| Test file | Asserts |
|---|---|
| `src/report/__tests__/render-html.test.ts` | (existing) 3 panels present; (new) with a benchmark arg the merged page also contains `id="p-totals"` and `id="p-scenarios"`; without it, those ids are absent; self-contained (no `<script src>`, no external URLs); `content_persisted` meta present. |
| `src/benchmark/__tests__/render-html.test.ts` | (existing) standalone benchmark page still has `id="p-totals"` / `id="p-scenarios"`; (new) `benchmarkTabs(report)` returns two `PageTab`s with ids `totals`/`scenarios`. |
| `src/cli/__tests__/*` (report command) | `--benchmark <valid file>` produces HTML containing the benchmark panels; `--benchmark <missing/garbage file>` writes a warning and still produces the 3-tab HTML (fail-open); no `--benchmark` → 3 tabs only. |

## Files

- **Modified:** `src/report/render-html.ts`, `src/benchmark/render-html.ts`, `src/report/index.ts`,
  `src/cli/index.ts`, and the corresponding test files.
- **Unchanged:** `src/report/theme.ts` (already tab-based), `src/report/charts.ts`, the ANSI
  dashboard, the markdown report, `scripts/benchmark/run-recorded.ts` (its
  `renderRecordedBenchmarkHtml(report)` call keeps the same signature), `web/`.

## Out of scope (YAGNI)

- Deriving Totals/Scenarios from the live DB (impossible — no scenario data there).
- Any JavaScript (CSS-only radio tabs already chosen).
- Deep-linking to a tab via URL hash.
- A new `--html` flag (HTML is already the report's default output; `--out` controls the path).
- Changes to `web/`, charts, the ANSI dashboard, or the markdown report.
