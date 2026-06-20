# Observability Web UI (`cachelane report`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `cachelane report` command that reads the local SQLite DB and writes a single self-contained HTML file with three views — token usage & savings, the long-session CacheLane curve, and the per-turn decision record — then opens it.

**Architecture:** New `src/report/` module: `query.ts` aggregates existing DB rows into a content-free `ReportData`; `charts.ts` emits inline SVG strings (no charting dep); `render-html.ts` assembles a self-contained document (inline CSS/JS/SVG); `index.ts` orchestrates and writes the file. The CLI command launches the browser via `execFile` (no new dep).

**Tech Stack:** TypeScript, vitest, better-sqlite3, `node:child_process` execFile. Reuses `db.getStats`, `db.listSessions`, `db.getRecentTurnExplanations`. Node 20.

**Spec:** [docs/superpowers/specs/2026-06-16-observability-web-ui-design.md](../specs/2026-06-16-observability-web-ui-design.md)

---

## File Structure

- Create: `src/report/types.ts` — `ReportData`, `ReportTurn`, `ReportOptions`.
- Create: `src/report/query.ts` — `buildReportData(db, opts): ReportData`.
- Create: `src/report/charts.ts` — `renderCurveSvg`, `renderStackedBarSvg` (pure → SVG string).
- Create: `src/report/render-html.ts` — `renderReportHtml(data): string`.
- Create: `src/report/index.ts` — `generateReport(opts)`, `openInBrowser(path)`.
- Create: `src/report/__tests__/query.test.ts`, `charts.test.ts`, `render-html.test.ts`.
- Modify: `src/cli/index.ts` — add `cachelane report` command.
- Modify: `src/cli/__tests__/cli.test.ts` — report CLI smoke test.

### Ground-truth facts (verified in code)

- `db.getStats({scope, workspace_id, session_id, since_ms})` → `CachelaneStats` (`src/storage/types.ts:305`): has `turns, cache_hit_ratio, effective_cost_units, baseline_cost_units, savings_ratio, pipeline_fallback_turns, pruner_counts, keepalive_counts`.
- `db.listSessions(workspaceId?)` → `SessionSummaryRow[]` (`{workspace_id, session_id, turns, cache_hit_ratio, savings_ratio, last_active_ms}`).
- `db.getRecentTurnExplanations({workspace_id, session_id?, limit})` → `TurnExplanationRecord[]` (`src/storage/types.ts:276`): has `turn_number, model, mutated, pruned_blocks_count, prune_decisions[], region_metadata{message_count,stable_count,semi_count,volatile_count}, signals[], usage{input_tokens,cache_read_tokens,cache_creation_5m_tokens,cache_creation_1h_tokens,effective_cost_units}, prefix_breakpoint_hash, middle_breakpoint_hash`.
- `openDatabase(path)` (`data-access.ts:162`).
- `execFile` from `node:child_process` already imported in `src/agent-traces/providers/claude-code.ts:1` — no new dep.
- `cachelaneDbPath(env)`, `cachelaneConfigPath(env)`, `cachelaneHome(env)` in `src/cli/paths.ts`.

---

## Task 1: Report view-model types

**Files:**
- Create: `src/report/types.ts`

- [ ] **Step 1: Define types**

Create `src/report/types.ts`:

```ts
import type { CachelaneStats, SessionSummaryRow } from "../storage/index.js";

export interface ReportTurn {
  turn_number: number;
  model: string;
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  effective_cost_units: number;
  baseline_cost_units: number; // naive: input + cache_read priced at 1.0x (un-cached)
  mutated: boolean;
  stable_count: number;
  semi_count: number;
  volatile_count: number;
  pruned_blocks_count: number;
  prune_decisions: { block_id: string; action: string; reason: string; kind: string }[];
  signals: string[];
}

export interface ReportData {
  generated_at: string;
  scope: "session" | "workspace" | "all";
  workspace_id: string | null;
  session_id: string | null;
  long_session_threshold_turns: number; // 15 (roadmap §T4)
  stats: CachelaneStats;
  turns: ReportTurn[];
  sessions: SessionSummaryRow[];
  privacy: { content_persisted: false };
}

export interface ReportOptions {
  scope: "session" | "workspace" | "all";
  workspace_id: string;
  session_id: string;
  since_ms?: number;
  generated_at: string;
}
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/report/types.ts
git commit -m "feat(report): report view-model types"
```

---

## Task 2: Query — build ReportData from DB

**Files:**
- Create: `src/report/query.ts`
- Test: `src/report/__tests__/query.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/report/__tests__/query.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type CachelaneDb } from "../../storage/index.js";
import { buildReportData } from "../query.js";

let dir: string;
let db: CachelaneDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cl-report-"));
  db = openDatabase(join(dir, "t.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function seedTurn(turnNumber: number, input: number, cacheRead: number): void {
  const turnId = `t-${turnNumber}`;
  db.insertTurn({
    id: turnId, workspace_id: "ws", session_id: "s1", turn_number: turnNumber,
    model: "claude-opus-4-7", input_tokens: input, output_tokens: 10,
    cache_creation_5m_tokens: 0, cache_creation_1h_tokens: 0, cache_read_tokens: cacheRead,
    effective_cost_units: input + 0.1 * cacheRead,
    prefix_breakpoint_hash: "abc", middle_breakpoint_hash: null,
    pruned_blocks_count: 0, keepalive_pings_since_last_turn: 0,
    request_mutated: 1, signals: JSON.stringify(["prefix_cached"]), created_at: 1000 + turnNumber,
  });
  db.insertTurnExplanation({
    turn_id: turnId, workspace_id: "ws", session_id: "s1", turn_number: turnNumber,
    model: "claude-opus-4-7", prefix_breakpoint_hash: "abc", middle_breakpoint_hash: null,
    mutated: true, pruned_blocks_count: 0, prune_decisions: [],
    block_metadata: [], region_metadata: { message_count: 3, stable_count: 1, semi_count: 1, volatile_count: 1 },
    signals: ["prefix_cached"], created_at: 1000 + turnNumber, updated_at: 1000 + turnNumber,
  });
}

describe("buildReportData", () => {
  it("aggregates turns with naive baseline per turn", () => {
    seedTurn(1, 100, 0);
    seedTurn(2, 20, 80);
    const data = buildReportData(db, {
      scope: "workspace", workspace_id: "ws", session_id: "s1",
      generated_at: "2026-06-16T00:00:00Z",
    });
    expect(data.turns).toHaveLength(2);
    // turn 2 naive baseline = input + cache_read at 1.0x = 20 + 80 = 100
    expect(data.turns[1]!.baseline_cost_units).toBe(100);
    expect(data.turns[1]!.effective_cost_units).toBeCloseTo(28, 5); // 20 + 0.1*80
    expect(data.privacy.content_persisted).toBe(false);
    expect(data.long_session_threshold_turns).toBe(15);
  });

  it("empty DB yields valid no-data report", () => {
    const data = buildReportData(db, {
      scope: "workspace", workspace_id: "ws", session_id: "s1",
      generated_at: "2026-06-16T00:00:00Z",
    });
    expect(data.turns).toEqual([]);
    expect(data.stats.turns).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/report/__tests__/query.test.ts`
Expected: FAIL — `buildReportData` not defined.

- [ ] **Step 3: Implement query.ts**

Create `src/report/query.ts`:

```ts
import type { CachelaneDb } from "../storage/index.js";
import type { ReportData, ReportOptions, ReportTurn } from "./types.js";

const LONG_SESSION_THRESHOLD_TURNS = 15;

export function buildReportData(db: CachelaneDb, opts: ReportOptions): ReportData {
  const stats = db.getStats({
    scope: opts.scope,
    workspace_id: opts.scope === "all" ? undefined : opts.workspace_id,
    session_id: opts.scope === "session" ? opts.session_id : undefined,
    since_ms: opts.since_ms,
  });

  const explanations = db.getRecentTurnExplanations({
    workspace_id: opts.workspace_id,
    session_id: opts.scope === "session" ? opts.session_id : undefined,
    limit: 500,
  });

  const turns: ReportTurn[] = explanations
    .slice()
    .sort((a, b) => a.turn_number - b.turn_number)
    .map((ex) => {
      const cacheCreation =
        ex.usage.cache_creation_5m_tokens + ex.usage.cache_creation_1h_tokens;
      return {
        turn_number: ex.turn_number,
        model: ex.model,
        input_tokens: ex.usage.input_tokens,
        cache_read_tokens: ex.usage.cache_read_tokens,
        cache_creation_tokens: cacheCreation,
        effective_cost_units: ex.usage.effective_cost_units,
        baseline_cost_units: ex.usage.input_tokens + ex.usage.cache_read_tokens,
        mutated: ex.mutated,
        stable_count: ex.region_metadata.stable_count,
        semi_count: ex.region_metadata.semi_count,
        volatile_count: ex.region_metadata.volatile_count,
        pruned_blocks_count: ex.pruned_blocks_count,
        prune_decisions: ex.prune_decisions.map((d) => ({
          block_id: d.block_id, action: d.action, reason: d.reason, kind: d.kind,
        })),
        signals: ex.signals,
      };
    });

  return {
    generated_at: opts.generated_at,
    scope: opts.scope,
    workspace_id: opts.scope === "all" ? null : opts.workspace_id,
    session_id: opts.scope === "session" ? opts.session_id : null,
    long_session_threshold_turns: LONG_SESSION_THRESHOLD_TURNS,
    stats,
    turns,
    sessions: db.listSessions(opts.scope === "all" ? undefined : opts.workspace_id),
    privacy: { content_persisted: false },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/report/__tests__/query.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/query.ts src/report/__tests__/query.test.ts
git commit -m "feat(report): build content-free ReportData from SQLite"
```

---

## Task 3: Charts — inline SVG generators

**Files:**
- Create: `src/report/charts.ts`
- Test: `src/report/__tests__/charts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/report/__tests__/charts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderCurveSvg, renderStackedBarSvg } from "../charts.js";

describe("renderCurveSvg", () => {
  it("emits an svg with two polylines for baseline vs effective", () => {
    const svg = renderCurveSvg({
      baselineCumulative: [100, 200, 300],
      effectiveCumulative: [100, 128, 140],
      longSessionThreshold: 15,
      firstPruneTurn: null,
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect((svg.match(/<polyline/g) ?? []).length).toBe(2);
  });

  it("empty series yields an empty-state svg", () => {
    const svg = renderCurveSvg({
      baselineCumulative: [], effectiveCumulative: [], longSessionThreshold: 15, firstPruneTurn: null,
    });
    expect(svg).toContain("No data yet");
  });
});

describe("renderStackedBarSvg", () => {
  it("renders segments proportional to values", () => {
    const svg = renderStackedBarSvg([{ label: "input", value: 80 }, { label: "read", value: 20 }]);
    expect(svg).toContain("<svg");
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/report/__tests__/charts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement charts.ts**

Create `src/report/charts.ts`:

```ts
export interface CurveInput {
  baselineCumulative: number[];
  effectiveCumulative: number[];
  longSessionThreshold: number;
  firstPruneTurn: number | null;
}

const W = 720;
const H = 320;
const PAD = 40;

function points(series: number[], maxY: number): string {
  const n = series.length;
  if (n === 0) return "";
  return series
    .map((y, i) => {
      const x = PAD + (i / Math.max(1, n - 1)) * (W - 2 * PAD);
      const yy = H - PAD - (maxY === 0 ? 0 : (y / maxY) * (H - 2 * PAD));
      return `${x.toFixed(1)},${yy.toFixed(1)}`;
    })
    .join(" ");
}

export function renderCurveSvg(input: CurveInput): string {
  if (input.baselineCumulative.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" class="cl-chart"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#888">No data yet</text></svg>`;
  }
  const maxY = Math.max(...input.baselineCumulative, ...input.effectiveCumulative, 1);
  const baseline = points(input.baselineCumulative, maxY);
  const effective = points(input.effectiveCumulative, maxY);
  const n = input.baselineCumulative.length;
  const xAt = (turnIdx: number) =>
    PAD + (turnIdx / Math.max(1, n - 1)) * (W - 2 * PAD);

  const pruneMarker =
    input.firstPruneTurn !== null && input.firstPruneTurn < n
      ? `<line x1="${xAt(input.firstPruneTurn).toFixed(1)}" y1="${PAD}" x2="${xAt(input.firstPruneTurn).toFixed(1)}" y2="${H - PAD}" stroke="#e07b39" stroke-dasharray="4" /><text x="${(xAt(input.firstPruneTurn) + 4).toFixed(1)}" y="${PAD + 12}" fill="#e07b39" font-size="11">pruning</text>`
      : "";

  const longRegion =
    input.longSessionThreshold < n
      ? `<rect x="${xAt(input.longSessionThreshold).toFixed(1)}" y="${PAD}" width="${(W - PAD - xAt(input.longSessionThreshold)).toFixed(1)}" height="${H - 2 * PAD}" fill="#3b82f6" opacity="0.06" /><text x="${(xAt(input.longSessionThreshold) + 4).toFixed(1)}" y="${(H - PAD - 4).toFixed(1)}" fill="#3b82f6" font-size="11">long session (≥${input.longSessionThreshold} turns)</text>`
      : "";

  return `<svg viewBox="0 0 ${W} ${H}" class="cl-chart">
  ${longRegion}
  <polyline points="${baseline}" fill="none" stroke="#ef4444" stroke-width="2" />
  <polyline points="${effective}" fill="none" stroke="#22c55e" stroke-width="2" />
  ${pruneMarker}
  <text x="${PAD}" y="${H - 8}" fill="#888" font-size="11">turn →</text>
  <text x="${W - PAD}" y="${PAD - 8}" text-anchor="end" fill="#ef4444" font-size="11">naive prefix cache</text>
  <text x="${W - PAD}" y="${PAD + 8}" text-anchor="end" fill="#22c55e" font-size="11">CacheLane</text>
</svg>`;
}

export function renderStackedBarSvg(segments: { label: string; value: number }[]): string {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const colors = ["#3b82f6", "#22c55e", "#e07b39", "#a855f7"];
  let x = 0;
  const rects = segments
    .map((seg, i) => {
      const w = (seg.value / total) * 100;
      const rect = `<rect x="${x.toFixed(2)}%" y="0" width="${w.toFixed(2)}%" height="20" fill="${colors[i % colors.length]}"><title>${seg.label}: ${seg.value}</title></rect>`;
      x += w;
      return rect;
    })
    .join("");
  return `<svg viewBox="0 0 100 20" preserveAspectRatio="none" class="cl-bar" width="100%" height="20">${rects}</svg>`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/report/__tests__/charts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/charts.ts src/report/__tests__/charts.test.ts
git commit -m "feat(report): inline SVG chart generators (no charting dep)"
```

---

## Task 4: HTML renderer (self-contained)

**Files:**
- Create: `src/report/render-html.ts`
- Test: `src/report/__tests__/render-html.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/report/__tests__/render-html.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderReportHtml } from "../render-html.js";
import type { ReportData } from "../types.js";

const data: ReportData = {
  generated_at: "2026-06-16T00:00:00Z",
  scope: "workspace",
  workspace_id: "ws",
  session_id: null,
  long_session_threshold_turns: 15,
  stats: {
    scope: "workspace", workspace_id: "ws", session_id: null, since_ms: null,
    turns: 2, cache_hit_ratio: 0.4, effective_cost_units: 128, baseline_cost_units: 300,
    savings_ratio: 0.573, pipeline_fallback_turns: 0,
    pruner_counts: { pruned_blocks: 0, turns_with_pruning: 0 },
    keepalive_counts: { pings: 0, turns_with_keepalive: 0 },
  },
  turns: [
    { turn_number: 1, model: "m", input_tokens: 100, cache_read_tokens: 0, cache_creation_tokens: 0,
      effective_cost_units: 100, baseline_cost_units: 100, mutated: true,
      stable_count: 1, semi_count: 1, volatile_count: 1, pruned_blocks_count: 0, prune_decisions: [], signals: ["prefix_cached"] },
  ],
  sessions: [],
  privacy: { content_persisted: false },
};

describe("renderReportHtml", () => {
  it("is self-contained (no external resource refs)", () => {
    const html = renderReportHtml(data);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("declares content_persisted false and includes all three views", () => {
    const html = renderReportHtml(data);
    expect(html).toContain('name="cachelane:content_persisted" content="false"');
    expect(html).toContain('id="view-usage"');
    expect(html).toContain('id="view-curve"');
    expect(html).toContain('id="view-decisions"');
  });

  it("never leaks content (there is none to leak)", () => {
    const html = renderReportHtml(data);
    // prune_decisions carry block_id only; no content field exists in ReportData
    expect(html).not.toContain("export const");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/report/__tests__/render-html.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement render-html.ts**

Create `src/report/render-html.ts`:

```ts
import type { ReportData, ReportTurn } from "./types.js";
import { renderCurveSvg, renderStackedBarSvg } from "./charts.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function cumulative(values: number[]): number[] {
  let acc = 0;
  return values.map((v) => (acc += v));
}

function card(label: string, value: string, danger = false): string {
  return `<div class="card${danger ? " danger" : ""}"><div class="card-value">${esc(value)}</div><div class="card-label">${esc(label)}</div></div>`;
}

function decisionRows(turns: ReportTurn[]): string {
  return turns
    .map((t) => {
      const bar = renderStackedBarSvg([
        { label: "STABLE", value: t.stable_count },
        { label: "SEMI", value: t.semi_count },
        { label: "VOLATILE", value: t.volatile_count },
      ]);
      const badge = t.mutated
        ? `<span class="badge ok">mutated</span>`
        : `<span class="badge fail">fail-open</span>`;
      const prunes = t.prune_decisions
        .map((d) => `${esc(d.block_id)} (${esc(d.action)}: ${esc(d.reason)})`)
        .join("<br>") || "—";
      return `<tr><td>${t.turn_number}</td><td>${esc(t.model)}</td><td class="bar-cell">${bar}</td><td>${badge}</td><td>${t.pruned_blocks_count}</td><td class="prunes">${prunes}</td><td>${esc(t.signals.join(", ") || "—")}</td></tr>`;
    })
    .join("");
}

export function renderReportHtml(data: ReportData): string {
  const baselineCum = cumulative(data.turns.map((t) => t.baseline_cost_units));
  const effectiveCum = cumulative(data.turns.map((t) => t.effective_cost_units));
  const firstPruneIdx = data.turns.findIndex((t) => t.pruned_blocks_count > 0);
  const curve = renderCurveSvg({
    baselineCumulative: baselineCum,
    effectiveCumulative: effectiveCum,
    longSessionThreshold: data.long_session_threshold_turns,
    firstPruneTurn: firstPruneIdx >= 0 ? firstPruneIdx : null,
  });

  const sessionRows = data.sessions
    .map((s) => `<tr><td>${esc(s.session_id)}</td><td>${s.turns}</td><td>${pct(s.cache_hit_ratio)}</td><td>${pct(s.savings_ratio)}</td></tr>`)
    .join("") || `<tr><td colspan="4">No sessions yet</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="cachelane:content_persisted" content="false">
<title>CacheLane Report</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; background: #0b0d12; color: #e6e8ee; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 32px; }
  .cards { display: flex; flex-wrap: wrap; gap: 12px; }
  .card { background: #161a23; border-radius: 10px; padding: 14px 18px; min-width: 130px; }
  .card.danger { outline: 1px solid #ef4444; }
  .card-value { font-size: 22px; font-weight: 600; } .card-label { color: #97a0b3; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #232938; font-size: 13px; vertical-align: top; }
  .bar-cell { width: 160px; } .prunes { color: #97a0b3; font-size: 12px; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; } .badge.ok { background: #14361f; color: #22c55e; } .badge.fail { background: #3a1414; color: #ef4444; }
  .cl-chart { width: 100%; max-width: 760px; background: #11141b; border-radius: 10px; }
  footer { margin-top: 32px; color: #6b7280; font-size: 12px; }
  .note { color: #97a0b3; max-width: 760px; }
</style>
</head><body>
<h1>CacheLane Report</h1>
<div class="note">Scope: ${esc(data.scope)} · Generated ${esc(data.generated_at)}</div>

<section id="view-usage">
<h2>Token usage &amp; savings</h2>
<div class="cards">
  ${card("Savings", pct(data.stats.savings_ratio))}
  ${card("Cache hit ratio", pct(data.stats.cache_hit_ratio))}
  ${card("Turns", String(data.stats.turns))}
  ${card("Effective units", data.stats.effective_cost_units.toFixed(0))}
  ${card("Baseline units", data.stats.baseline_cost_units.toFixed(0))}
  ${card("Pruned blocks", String(data.stats.pruner_counts.pruned_blocks))}
  ${card("Fail-open turns", String(data.stats.pipeline_fallback_turns), data.stats.pipeline_fallback_turns > 0)}
</div>
<table><thead><tr><th>Session</th><th>Turns</th><th>Hit</th><th>Savings</th></tr></thead><tbody>${sessionRows}</tbody></table>
</section>

<section id="view-curve">
<h2>The CacheLane curve</h2>
${curve}
<p class="note">Two lines: naive prefix caching (red) pays input + reads near full price and never shrinks the prompt; CacheLane (green) reads cached prefixes at 0.1× and prunes idle blocks to stubs. On short, stable sessions the lines nearly overlap — which is why CacheLane can look "the same as prefix caching." They diverge as the session grows: reordering rescues cache hits a volatile-first layout would lose, and K-pruning flattens token growth. A session is "long" once pruning and middle-region reuse compound — operationally ≥ ${data.long_session_threshold_turns} turns.</p>
</section>

<section id="view-decisions">
<h2>Per-turn decision record</h2>
<table><thead><tr><th>Turn</th><th>Model</th><th>Region (S/M/V)</th><th>Status</th><th>Pruned</th><th>Prune decisions</th><th>Signals</th></tr></thead>
<tbody>${decisionRows(data.turns) || `<tr><td colspan="7">No turns recorded yet — run Claude Code through the CacheLane proxy.</td></tr>`}</tbody></table>
</section>

<footer>Local report generated from ~/.cachelane/cachelane.db. No prompt text, file contents, or tool output are stored or shown — content_persisted: false.</footer>
</body></html>`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/report/__tests__/render-html.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/render-html.ts src/report/__tests__/render-html.test.ts
git commit -m "feat(report): self-contained HTML renderer with 3 views"
```

---

## Task 5: Orchestrator + browser open

**Files:**
- Create: `src/report/index.ts`

- [ ] **Step 1: Implement generateReport + openInBrowser**

Create `src/report/index.ts`:

```ts
import { writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { platform } from "node:process";
import type { CachelaneDb } from "../storage/index.js";
import { buildReportData } from "./query.js";
import { renderReportHtml } from "./render-html.js";
import type { ReportOptions } from "./types.js";

export { buildReportData } from "./query.js";
export { renderReportHtml } from "./render-html.js";
export type { ReportData, ReportOptions, ReportTurn } from "./types.js";

export interface GenerateReportResult {
  out_path: string;
  turns: number;
  sessions: number;
}

export function generateReport(
  db: CachelaneDb,
  opts: ReportOptions,
  outPath: string,
): GenerateReportResult {
  const data = buildReportData(db, opts);
  writeFileSync(outPath, renderReportHtml(data), "utf8");
  return { out_path: outPath, turns: data.turns.length, sessions: data.sessions.length };
}

export function openInBrowser(filePath: string): void {
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const args = platform === "win32" ? ["", filePath] : [filePath];
  try {
    const child = execFile(cmd, args, () => { /* best-effort; ignore errors */ });
    child.unref?.();
  } catch {
    /* fail-open: never throw from opening a browser */
  }
}
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/report/index.ts
git commit -m "feat(report): generateReport orchestrator + browser open"
```

---

## Task 6: CLI `report` command

**Files:**
- Modify: `src/cli/index.ts`
- Test: `src/cli/__tests__/cli.test.ts`

- [ ] **Step 1: Add the command**

Insert into `createCachelaneCli` (after the `sessions` command, before `prune`):

```ts
  program
    .command("report")
    .description("Generate a self-contained HTML report from the local SQLite data")
    .option("--scope <scope>", "report scope", parseStatsScope, "workspace")
    .option("--session-id <id>", "Session scope")
    .option("--workspace-id <id>", "Workspace scope")
    .option("--db <path>", "SQLite database path")
    .option("--out <path>", "Output HTML path")
    .option("--no-open", "Write the file but do not open a browser")
    .option("--json", "Print ReportData JSON instead of writing HTML")
    .action(async (cmd: JsonCommandOptions & {
      scope: "session" | "workspace" | "all";
      sessionId?: string; workspaceId?: string; db?: string; out?: string; open?: boolean;
    }) => {
      const { generateReport, openInBrowser, buildReportData } = await import("../report/index.js");
      const { context, close } = contextFromOptions(env, cmd);
      try {
        const opts = {
          scope: cmd.scope,
          workspace_id: context.workspace_id,
          session_id: context.session_id,
          generated_at: new Date().toISOString(),
        };
        if (cmd.json) {
          io.stdout(jsonLine(buildReportData(context.db, opts)));
          return;
        }
        const outPath = cmd.out ?? path.join(cachelaneHome(env), "report.html");
        const result = generateReport(context.db, opts, outPath);
        io.stdout(`wrote ${result.out_path} (${result.turns} turns, ${result.sessions} sessions)\n`);
        if (cmd.open !== false) {
          openInBrowser(result.out_path);
          io.stdout("opening in browser...\n");
        }
      } finally {
        close();
      }
    });
```

Note: `cachelaneHome` is already imported (`src/cli/index.ts:24`); `path` is imported at the top.

- [ ] **Step 2: Write the CLI smoke test**

Add to `src/cli/__tests__/cli.test.ts`:

```ts
it("report --json emits content-free ReportData", async () => {
  const out: string[] = [];
  const program = createCachelaneCli({
    env: process.env,
    io: { stdout: (t) => out.push(t), stderr: () => {} },
  });
  await program.parseAsync(["node", "cachelane", "report", "--json", "--db", ":memory:"]);
  const data = JSON.parse(out.join(""));
  expect(data.privacy.content_persisted).toBe(false);
  expect(Array.isArray(data.turns)).toBe(true);
});
```

- [ ] **Step 3: Run to verify it passes**

Run: `npx vitest run src/cli/__tests__/cli.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts src/cli/__tests__/cli.test.ts
git commit -m "feat(cli): cachelane report command"
```

---

## Task 7: Full verification

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual smoke (optional, if a populated DB exists)**

Run: `npx tsx src/cli/index.ts report --no-open --db ~/.cachelane/cachelane.db --out /tmp/cl-report.html`
Expected: writes `/tmp/cl-report.html`; open it and confirm three views render and contain no prompt/file content.

- [ ] **Step 4: Paste output, then mark done.**

---

## Self-review notes

- **Spec coverage:** View 1 usage/savings (Task 4 §view-usage + cards incl. fail-open), View 2 curve incl. long-session region + prune marker + copy (Task 3 + Task 4 §view-curve), View 3 per-turn decisions (Task 4 §view-decisions), self-contained + content-free assertions (Task 4 tests), CLI incl. `--json`/`--no-open`/`--out` (Task 6), empty-DB no-data path (Task 2 + Task 4). ✅
- **Type consistency:** `ReportData`/`ReportTurn`/`ReportOptions` defined Task 1, used unchanged in Tasks 2–6. `renderCurveSvg(CurveInput)` / `renderStackedBarSvg(segments)` stable. `generateReport(db, opts, outPath)` stable. ✅
- **No new deps:** charts are SVG strings; browser-open uses `execFile`. ✅
- **Open item for executor:** baseline reconstruction uses `input + cache_read` at 1.0× (per spec). If crediting pruning is wanted later, join `blocks.token_count` for pruned tokens — deferred, noted in spec open questions.
