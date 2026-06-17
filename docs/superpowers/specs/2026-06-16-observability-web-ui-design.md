# CacheLane Observability Web UI (`cachelane report`) — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorming), pending implementation plan
**Topic:** A `cachelane report` CLI command that renders local SQLite data into a single
self-contained, shareable HTML report — including the long-session "CacheLane curve" (T4) and
the per-turn decision-record view (T5).
**Roadmap:** [Phase 3 roadmap](2026-06-16-phase3-roadmap.md) — themes T1 / T4 / T5.

## Problem

Observability is terminal-only today: `cachelane stats`, `cachelane explain`, `cachelane
sessions`, and a `benchmark dashboard` TUI. None is visual or shareable. Three concrete gaps:

1. Users can't *see* token usage / savings vs. baseline at a glance.
2. There is no artifact that shows CacheLane diverging from naive prefix caching on long
   sessions (the Reddit critique — see roadmap §T4).
3. `cachelane explain` exists but is a JSON/text dump; there is no visual per-turn decision
   record (T5).

All the data already exists in `~/.cachelane/cachelane.db` (`turns`, `turn_explanations`,
`blocks`). We are missing a *renderer*.

## Goals

- One command: `cachelane report` reads SQLite, writes a single self-contained `report.html`,
  opens it in the browser.
- **Self-contained**: inline CSS + JS + SVG charts. No server, no network, no new runtime npm
  dep. Works offline; the file is shareable as-is.
- Three views: (1) token usage & savings, (2) the CacheLane curve, (3) per-turn decision record.
- **Content-free**: only metadata already in the DB (hashes, counts, kinds, ratios). Report
  embeds `content_persisted: false`, matching the existing benchmark report invariant.
- Fail-open: an empty/missing/locked DB yields a valid "no data yet" report, never a crash.

## Non-goals

- No live server / auto-refresh (roadmap R3, `--serve`, deferred).
- Not reusing the Next.js `web/` app (heavy; couples observability to a framework).
- No new charting library — charts are SVG strings generated in Node.
- Not a billing report — uses effective-cost-units + the existing pricing constants only.

## Chosen approach

New module `src/report/`, mirroring the structure of `src/benchmark/`:

| File | Responsibility |
|------|----------------|
| `src/report/index.ts` | `generateReport(opts)` orchestration; public entry. |
| `src/report/query.ts` | Read-only aggregations over `turns` / `turn_explanations` / `blocks`. Returns a typed `ReportData` (snake_case). No content. |
| `src/report/charts.ts` | Pure functions returning SVG strings (`renderCurveSvg`, `renderBarSvg`, …). No deps. |
| `src/report/render-html.ts` | `renderReportHtml(data): string` — assembles the self-contained document. |
| `src/report/types.ts` | `ReportData`, `ReportOptions`, view-model types. |

CLI: a new `cachelane report` command in `src/cli/index.ts`:

```
cachelane report
  [--db <path>]              # default ~/.cachelane/cachelane.db
  [--scope session|workspace|all]   # default workspace
  [--session <id>]
  [--workspace-id <id>]
  [--out <path>]             # default ~/.cachelane/report.html
  [--no-open]                # write only, don't launch browser
  [--json]                   # emit the ReportData JSON instead of HTML (CI/debug)
```

Browser launch uses `execFile` from `node:child_process` (already a dependency-free import used
by `src/agent-traces/providers/claude-code.ts`) with the platform launcher (`open` on darwin,
`start` on win32, `xdg-open` on linux). `--no-open`, a non-zero launcher exit, or absent DISPLAY
all fall back to printing the file path. No new npm dep.

### Why static HTML over a server (recorded decision)

A static bundle keeps the local-only invariant trivially (no port, no process, no request
surface), adds zero hot-path deps, is shareable/attachable, and works offline. A server
(`--serve`) is roadmap R3 if interactive/live views are later demanded. Reusing Next.js was
rejected: it needs a build + node_modules and breaks the plain-CLI simplicity.

## Section 1 — Data model (`ReportData`, content-free)

`query.ts` produces one typed object the renderer consumes. All fields derive from existing
columns; **no block content, prompt text, or tool output**.

```ts
interface ReportData {
  generated_at: string;
  scope: "session" | "workspace" | "all";
  workspace_id: string | null;
  session_id: string | null;
  // Headline (reuses storage getStats()):
  stats: CachelaneStats;             // turns, cache_hit_ratio, effective/baseline cost units,
                                     // savings_ratio, pipeline_fallback_turns, pruner/keepalive counts
  // Per-turn series for the curve + decision table (from turns + turn_explanations):
  turns: ReportTurn[];
  sessions: SessionSummaryRow[];     // reuses listSessions()
  privacy: { content_persisted: false };
}

interface ReportTurn {
  turn_number: number;
  model: string;
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  effective_cost_units: number;
  // reconstructed naive baseline for the curve (no cache, no pruning):
  baseline_cost_units: number;       // input + cache_read at 1.0x (what you'd pay un-cached)
  mutated: boolean;                  // false => fail-open turn (flagged in the table)
  region: { stable_count: number; semi_count: number; volatile_count: number };
  pruned_blocks_count: number;
  prune_decisions: { block_id: string; action: string; reason: string; kind: string }[];
  signals: string[];
}
```

`query.ts` joins `turns` (billed usage) with `turn_explanations` (decision metadata) on
`turn_id`/`turn_number`. Where a turn has usage but no explanation (e.g. hook-mode turns), the
decision fields degrade to empty — never throw.

## Section 2 — View 1: Token usage & savings

Headline cards + a per-session table:

- **Cards:** total effective vs. baseline cost units, **savings %**, cache-hit ratio, turns,
  pruned blocks, keepalive pings, **fail-open turns** (from `pipeline_fallback_turns` —
  surfaces silent degradation, ties to reliability spec T3).
- **Per-session table:** reuses `listSessions()` (`SessionSummaryRow`): turns, cache_hit_ratio,
  savings_ratio, last_active.
- **Stacked token bar** per recent turn: input / cache_read / cache_creation, as inline SVG.

## Section 3 — View 2: The CacheLane curve (T4)

The artifact that answers "is this any different from prefix caching?"

- **X axis:** turn number. **Y axis:** cumulative cost units.
- **Two lines:** `baseline_cost_units` cumulative (naive: pay input+read at 1.0× every turn,
  no pruning) vs. `effective_cost_units` cumulative (CacheLane: 0.1× reads + pruning).
- **Annotations:** vertical marker at the first turn where `pruned_blocks_count > 0` ("pruning
  engages"); a shaded "long session" region starting at **turn 15** (definition from roadmap
  §T4 / `01-system-overview.md`); a callout of the divergence % at the last turn.
- **Copy block** under the chart states *why* the lines diverge (reordering rescues hits the
  naive layout loses; pruning flattens growth — prefix caching can't shrink the prompt) and
  defines "long session" explicitly. This is the written half of the T4 investigation, rendered
  next to the user's own data.

Charts are generated by `charts.ts` as SVG strings — line path from the cumulative series, no
JS charting lib. A tiny inline `<script>` adds hover tooltips only (progressive enhancement;
the SVG is meaningful without JS).

## Section 4 — View 3: Per-turn decision record (T5)

The visual form of `cachelane explain`, sourced from `turn_explanations`:

- **Turn timeline / table**, one row per turn: turn number, model, region split
  (stable/semi/volatile as a mini stacked bar), `mutated` badge (green) or **fail-open** badge
  (red), pruned count, signals.
- **Expandable per-turn detail:** prune decisions (block_id prefix, action, reason, kind —
  block_id only, never content), prefix/middle breakpoint hash prefixes, region counts, usage.
- This view + `cachelane explain` share the same underlying `TurnExplanationRecord`, so they
  cannot drift — the renderer formats exactly what `explain` returns.

## Section 5 — Privacy & fail-open

- The renderer only ever receives `ReportData`, which is constructed exclusively from existing
  metadata columns. A unit test asserts the serialized HTML contains no value from a content
  column (there are none to leak — blocks store only `content_hash`).
- `content_persisted: false` is embedded in the HTML as a machine-readable `<meta>` + visible
  footer line, mirroring `RecordedBenchmarkReport.privacy`.
- Missing DB, zero turns, or a locked DB → a valid "No data yet — run some Claude Code turns
  through the proxy" report. Never throws; CLI exits 0.

## Section 6 — Testing (TDD)

Per CLAUDE.md test discipline (fixtures as JSON, table-driven where enumerable):

- `query.test.ts`: seed an in-memory DB (Node 20) with known turns/explanations; assert
  `ReportData` aggregates (savings %, cache-hit ratio, cumulative baseline) match hand-computed
  values. Table-driven over scope = session/workspace/all.
- `charts.test.ts`: pure SVG functions — assert deterministic output for fixed series
  (snapshot the path `d` attribute), assert empty-series yields an empty-state SVG.
- `render-html.test.ts`: assert the document is self-contained (no `http(s)://` resource refs,
  no external `<script src>`/`<link href>`), contains `content_persisted` false, and includes
  all three view anchors. **Content-leak guard:** seed a block with a recognizable fake content
  string in a *non-persisted* path and assert it never appears (defensive; content isn't stored).
- `report.cli.test.ts`: `--json` emits stable `ReportData`; `--no-open` writes the file and
  prints its path; empty DB yields the no-data report with exit 0.

## Open questions for implementation plan

- Exact baseline reconstruction for the curve: confirm `baseline_cost_units = input_tokens +
  cache_read_tokens` (reads priced at 1.0× as if un-cached) is the right "what you'd pay
  without CacheLane" figure, vs. also re-adding pruned tokens. (Recommend: also add back pruned
  token estimate so the curve credits pruning; needs `blocks.token_count` join.)
- Whether `report` should accept `--since` like `stats` (likely yes; cheap to add).
- SVG sizing/responsiveness approach (viewBox + max-width) — settle in plan.
- Browser-open helper: shared util vs. inline; confirm no new dep.
