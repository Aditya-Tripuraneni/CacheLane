# Shared Report Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `cachelane report` page and a new benchmark HTML report one shared warm theme consistent with the `web/` site, as self-contained offline HTML.

**Architecture:** A new zero-dependency `src/report/theme.ts` exports the ported `web/` design tokens (`CACHELANE_REPORT_CSS`) and a `pageShell()` wrapper. The existing report renderer and a new benchmark renderer both funnel through it, so they cannot drift. Charts swap hardcoded hex for theme colors. The benchmark HTML is emitted via an optional `--html` flag on the existing recorded-benchmark script.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, Node 20 (`nvm use 20`). No new npm deps. Pure string/SVG rendering — no React, no Tailwind at runtime.

**Working context:** Work in place on `main` (no branch). The three Phase-3 branches are already merged; report + benchmark code coexist. Baseline before starting: `npm test` green (363 passed | 2 skipped).

**Vocabulary:** `STABLE | SEMI | VOLATILE` only. snake_case for storage/API-contract types; camelCase for in-process helpers.

---

## File Structure

- **Create** `src/report/theme.ts` — `CACHELANE_REPORT_CSS` constant + `pageShell()`. Single responsibility: shared HTML chrome + design tokens.
- **Create** `src/report/__tests__/theme.test.ts` — tests for the theme module.
- **Create** `src/benchmark/render-html.ts` — `renderRecordedBenchmarkHtml(report)`. Single responsibility: render a `RecordedBenchmarkReport` to themed HTML.
- **Create** `src/benchmark/__tests__/render-html.test.ts` — tests for the benchmark renderer.
- **Modify** `src/report/charts.ts` — swap hardcoded hex for theme color constants (exported from `theme.ts`).
- **Modify** `src/report/__tests__/charts.test.ts` — assert theme colors, not old hex.
- **Modify** `src/report/render-html.ts` — render via `pageShell()`; drop the inline dark `<style>`.
- **Modify** `src/report/__tests__/render-html.test.ts` — assert warm theme, keep self-contained + view-id assertions.
- **Modify** `scripts/benchmark/run-recorded.ts` — add optional `--html <path>` flag (fail-open write).

---

## Task 1: Theme module (tokens + page shell)

**Files:**
- Create: `src/report/theme.ts`
- Test: `src/report/__tests__/theme.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/report/__tests__/theme.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CACHELANE_REPORT_CSS, THEME_COLORS, pageShell } from "../theme.js";

describe("CACHELANE_REPORT_CSS", () => {
  it("uses the warm web/ palette, not the old dark theme", () => {
    expect(CACHELANE_REPORT_CSS).toContain("--color-accent");
    expect(CACHELANE_REPORT_CSS).toContain("oklch(");
    expect(CACHELANE_REPORT_CSS).not.toContain("#0b0d12");
    expect(CACHELANE_REPORT_CSS).not.toContain("color-scheme: light dark");
  });

  it("references no external resources", () => {
    expect(CACHELANE_REPORT_CSS).not.toMatch(/https?:\/\//);
    expect(CACHELANE_REPORT_CSS).not.toContain("@import");
  });
});

describe("THEME_COLORS", () => {
  it("exposes chart colors as oklch tokens", () => {
    expect(THEME_COLORS.danger).toContain("oklch(");
    expect(THEME_COLORS.success).toContain("oklch(");
    expect(THEME_COLORS.accent).toContain("oklch(");
  });
});

describe("pageShell", () => {
  it("wraps body in a self-contained, content-free document", () => {
    const html = pageShell({ title: "T", subtitle: "S", bodyHtml: "<p>hi</p>" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('name="cachelane:content_persisted" content="false"');
    expect(html).toContain(CACHELANE_REPORT_CSS);
    expect(html).toContain("<p>hi</p>");
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 20 && npx vitest run src/report/__tests__/theme.test.ts`
Expected: FAIL — cannot resolve `../theme.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/report/theme.ts`. Colors are ported verbatim from `web/app/globals.css`:

```ts
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Chart-facing tokens (oklch, ported from web/app/globals.css).
export const THEME_COLORS = {
  accent: "oklch(0.55 0.17 40)", // Crail rust
  success: "oklch(0.48 0.045 145)", // sage green
  danger: "oklch(0.38 0.100 35)", // deep rust-brown
  warn: "oklch(0.48 0.070 50)",
  fgFaint: "oklch(0.55 0.01 75)",
  border: "oklch(0.90 0.005 75)",
  bgElev: "oklch(1 0 0)",
} as const;

// Design tokens + component styling, ported from web/app/globals.css.
export const CACHELANE_REPORT_CSS = `
:root {
  --color-bg: oklch(0.965 0.005 75);
  --color-bg-elev: oklch(1 0 0);
  --color-bg-inline: oklch(0.93 0.01 75);
  --color-fg: oklch(0.15 0.005 75);
  --color-fg-muted: oklch(0.40 0.01 75);
  --color-fg-faint: oklch(0.55 0.01 75);
  --color-border: oklch(0.90 0.005 75);
  --color-border-strong: oklch(0.75 0.01 75);
  --color-accent: oklch(0.55 0.17 40);
  --color-success: oklch(0.48 0.045 145);
  --color-success-bg: oklch(0.95 0.01 145);
  --color-warn: oklch(0.48 0.070 50);
  --color-danger: oklch(0.38 0.100 35);
  --color-danger-bg: oklch(0.95 0.020 35);
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 32px;
  background: var(--color-bg); color: var(--color-fg);
  font: 14px/1.6 -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-feature-settings: "ss01", "cv11";
  -webkit-font-smoothing: antialiased; letter-spacing: -0.005em;
}
h1 { font-size: 24px; letter-spacing: -0.02em; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 36px 0 8px; letter-spacing: -0.01em; }
.note { color: var(--color-fg-muted); max-width: 760px; }
.cards { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
.card {
  background: var(--color-bg-elev); border: 1px solid var(--color-border);
  border-radius: 12px; padding: 14px 18px; min-width: 130px;
}
.card.danger { border-color: var(--color-danger); }
.card-value { font-size: 22px; font-weight: 700; }
.card-label { color: var(--color-fg-faint); font-size: 12px; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td {
  text-align: left; padding: 7px 10px; font-size: 13px; vertical-align: top;
  border-bottom: 1px solid var(--color-border);
}
th { color: var(--color-fg-muted); font-weight: 600; }
.bar-cell { width: 160px; }
.prunes { color: var(--color-fg-faint); font-size: 12px; }
.badge { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.badge.ok { background: var(--color-success-bg); color: var(--color-success); }
.badge.fail { background: var(--color-danger-bg); color: var(--color-danger); }
.cl-chart {
  width: 100%; max-width: 760px; margin-top: 8px;
  background: var(--color-bg-elev); border: 1px solid var(--color-border); border-radius: 12px;
}
section { margin-top: 8px; }
footer { margin-top: 36px; color: var(--color-fg-faint); font-size: 12px; }
`.trim();

export interface PageShellOptions {
  title: string;
  subtitle: string;
  bodyHtml: string;
}

export function pageShell(opts: PageShellOptions): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="cachelane:content_persisted" content="false">
<title>${esc(opts.title)}</title>
<style>${CACHELANE_REPORT_CSS}</style>
</head><body>
<h1>${esc(opts.title)}</h1>
<div class="note">${esc(opts.subtitle)}</div>
${opts.bodyHtml}
</body></html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/report/__tests__/theme.test.ts`
Expected: PASS (3 describe blocks, 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/report/theme.ts src/report/__tests__/theme.test.ts
git commit -m "feat(report): add shared warm theme module (tokens + pageShell)"
```

---

## Task 2: Charts use theme colors

**Files:**
- Modify: `src/report/charts.ts`
- Test: `src/report/__tests__/charts.test.ts`

- [ ] **Step 1: Update the failing test**

Replace `src/report/__tests__/charts.test.ts` entirely with:

```ts
import { describe, it, expect } from "vitest";
import { renderCurveSvg, renderStackedBarSvg } from "../charts.js";
import { THEME_COLORS } from "../theme.js";

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

  it("uses theme colors, not the old red/green hex", () => {
    const svg = renderCurveSvg({
      baselineCumulative: [100, 200],
      effectiveCumulative: [100, 120],
      longSessionThreshold: 15,
      firstPruneTurn: null,
    });
    expect(svg).toContain(THEME_COLORS.danger);
    expect(svg).toContain(THEME_COLORS.success);
    expect(svg).not.toContain("#ef4444");
    expect(svg).not.toContain("#22c55e");
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

  it("uses theme colors for segments", () => {
    const svg = renderStackedBarSvg([{ label: "a", value: 1 }, { label: "b", value: 1 }]);
    expect(svg).toContain(THEME_COLORS.accent);
    expect(svg).not.toContain("#3b82f6");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/report/__tests__/charts.test.ts`
Expected: FAIL — SVG still contains `#ef4444` / `#3b82f6`; theme colors absent.

- [ ] **Step 3: Update the implementation**

In `src/report/charts.ts`, add the import at the top:

```ts
import { THEME_COLORS } from "./theme.js";
```

Replace the empty-state `fill="#888"` in `renderCurveSvg` (line ~26):

```ts
    return `<svg viewBox="0 0 ${W} ${H}" class="cl-chart"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="${THEME_COLORS.fgFaint}">No data yet</text></svg>`;
```

Replace the `pruneMarker` block to use the accent color:

```ts
  const pruneMarker =
    input.firstPruneTurn !== null && input.firstPruneTurn < n
      ? `<line x1="${xAt(input.firstPruneTurn).toFixed(1)}" y1="${PAD}" x2="${xAt(input.firstPruneTurn).toFixed(1)}" y2="${H - PAD}" stroke="${THEME_COLORS.accent}" stroke-dasharray="4" /><text x="${(xAt(input.firstPruneTurn) + 4).toFixed(1)}" y="${PAD + 12}" fill="${THEME_COLORS.accent}" font-size="11">pruning</text>`
      : "";
```

Replace the `longRegion` block to use the warn color:

```ts
  const longRegion =
    input.longSessionThreshold < n
      ? `<rect x="${xAt(input.longSessionThreshold).toFixed(1)}" y="${PAD}" width="${(W - PAD - xAt(input.longSessionThreshold)).toFixed(1)}" height="${H - 2 * PAD}" fill="${THEME_COLORS.warn}" opacity="0.08" /><text x="${(xAt(input.longSessionThreshold) + 4).toFixed(1)}" y="${(H - PAD - 4).toFixed(1)}" fill="${THEME_COLORS.warn}" font-size="11">long session (≥${input.longSessionThreshold} turns)</text>`
      : "";
```

Replace the returned SVG body (polylines + labels) of `renderCurveSvg`:

```ts
  return `<svg viewBox="0 0 ${W} ${H}" class="cl-chart">
  ${longRegion}
  <polyline points="${baseline}" fill="none" stroke="${THEME_COLORS.danger}" stroke-width="2" />
  <polyline points="${effective}" fill="none" stroke="${THEME_COLORS.success}" stroke-width="2" />
  ${pruneMarker}
  <text x="${PAD}" y="${H - 8}" fill="${THEME_COLORS.fgFaint}" font-size="11">turn →</text>
  <text x="${W - PAD}" y="${PAD - 8}" text-anchor="end" fill="${THEME_COLORS.danger}" font-size="11">naive prefix cache</text>
  <text x="${W - PAD}" y="${PAD + 8}" text-anchor="end" fill="${THEME_COLORS.success}" font-size="11">CacheLane</text>
</svg>`;
```

In `renderStackedBarSvg`, replace the `colors` array:

```ts
  const colors = [THEME_COLORS.warn, THEME_COLORS.success, THEME_COLORS.accent, THEME_COLORS.danger];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/report/__tests__/charts.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/report/charts.ts src/report/__tests__/charts.test.ts
git commit -m "refactor(report): drive chart SVG colors from shared theme tokens"
```

---

## Task 3: Report page renders via pageShell

**Files:**
- Modify: `src/report/render-html.ts`
- Test: `src/report/__tests__/render-html.test.ts`

- [ ] **Step 1: Update the failing test**

Replace `src/report/__tests__/render-html.test.ts` entirely with (keeps the existing `data` fixture, updates assertions for the warm theme):

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

  it("uses the warm theme, not the old dark theme", () => {
    const html = renderReportHtml(data);
    expect(html).toContain("--color-accent");
    expect(html).not.toContain("#0b0d12");
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
    expect(html).not.toContain("export const");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/report/__tests__/render-html.test.ts`
Expected: FAIL — `--color-accent` absent (still dark theme), `#0b0d12` present.

- [ ] **Step 3: Update the implementation**

In `src/report/render-html.ts`, add to the imports at the top:

```ts
import { pageShell } from "./theme.js";
```

Replace the final `return \`<!DOCTYPE html> ... </body></html>\`;` block of `renderReportHtml` with a `pageShell()` call. The body keeps the three sections verbatim — only the shell/`<style>` is removed:

```ts
  const body = `
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
<p class="note">Two lines: naive prefix caching (rust) pays input + reads near full price and never shrinks the prompt; CacheLane (sage) reads cached prefixes at 0.1× and prunes idle blocks to stubs. On short, stable sessions the lines nearly overlap — which is why CacheLane can look "the same as prefix caching." They diverge as the session grows: reordering rescues cache hits a volatile-first layout would lose, and K-pruning flattens token growth. A session is "long" once pruning and middle-region reuse compound — operationally ≥ ${data.long_session_threshold_turns} turns.</p>
</section>

<section id="view-decisions">
<h2>Per-turn decision record</h2>
<table><thead><tr><th>Turn</th><th>Model</th><th>Region (S/M/V)</th><th>Status</th><th>Pruned</th><th>Prune decisions</th><th>Signals</th></tr></thead>
<tbody>${decisionRows(data.turns) || `<tr><td colspan="7">No turns recorded yet — run Claude Code through the CacheLane proxy.</td></tr>`}</tbody></table>
</section>

<footer>Local report generated from ~/.cachelane/cachelane.db. No prompt text, file contents, or tool output are stored or shown — content_persisted: false.</footer>`;

  return pageShell({
    title: "CacheLane Report",
    subtitle: `Scope: ${esc(data.scope)} · Generated ${esc(data.generated_at)}`,
    bodyHtml: body,
  });
```

Note: the `esc`, `pct`, `card`, `decisionRows`, `cumulative`, `curve`, and `sessionRows` definitions already exist in the file and are unchanged. Only the trailing HTML-shell return is replaced. The dark `<style>` block is removed (it was part of the old return string).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/report/__tests__/render-html.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/report/render-html.ts src/report/__tests__/render-html.test.ts
git commit -m "feat(report): render report page through shared warm pageShell"
```

---

## Task 4: Benchmark HTML renderer

**Files:**
- Create: `src/benchmark/render-html.ts`
- Test: `src/benchmark/__tests__/render-html.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/benchmark/__tests__/render-html.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderRecordedBenchmarkHtml } from "../render-html.js";
import type { RecordedBenchmarkReport } from "../types.js";

const report: RecordedBenchmarkReport = {
  run_id: "demo-run",
  generated_at: "2026-06-16T00:00:00Z",
  source: { kind: "normalized_trace", provider: "fake", normalized_dir: null, model: "claude-opus-4-7" },
  counts: { sessions: 2, turns: 5, blocks: 9, tool_calls: 4 },
  totals: {
    input_tokens: 1000, cache_read_tokens: 4000,
    baseline_cost_units: 5000, effective_cost_units: 1400,
    savings_ratio: 0.72, cache_hit_ratio: 0.8, pruned_blocks: 3, keepalive_pings: 0,
  },
  scenarios: [
    { scenario_id: "read-summarize-file", session_id: "s1", turns: 2, blocks: 4, tool_calls: 2,
      input_tokens: 400, cache_read_tokens: 1600, baseline_cost_units: 2000, effective_cost_units: 560,
      savings_ratio: 0.72, cache_hit_ratio: 0.8, pruned_blocks: 1, keepalive_pings: 0 },
    { scenario_id: "debug-failing-test", session_id: "s2", turns: 3, blocks: 5, tool_calls: 2,
      input_tokens: 600, cache_read_tokens: 2400, baseline_cost_units: 3000, effective_cost_units: 840,
      savings_ratio: 0.72, cache_hit_ratio: 0.8, pruned_blocks: 2, keepalive_pings: 0 },
  ],
  privacy: { content_persisted: false },
};

describe("renderRecordedBenchmarkHtml", () => {
  it("is a self-contained, content-free document", () => {
    const html = renderRecordedBenchmarkHtml(report);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('name="cachelane:content_persisted" content="false"');
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("uses the shared warm theme", () => {
    const html = renderRecordedBenchmarkHtml(report);
    expect(html).toContain("--color-accent");
    expect(html).not.toContain("#0b0d12");
  });

  it("shows headline cards and a per-scenario row for every scenario", () => {
    const html = renderRecordedBenchmarkHtml(report);
    expect(html).toContain("Savings");
    expect(html).toContain("Cache hit ratio");
    expect(html).toContain("read-summarize-file");
    expect(html).toContain("debug-failing-test");
  });

  it("includes a content-free footer", () => {
    const html = renderRecordedBenchmarkHtml(report);
    expect(html).toContain("No prompt text");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/benchmark/__tests__/render-html.test.ts`
Expected: FAIL — cannot resolve `../render-html.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/benchmark/render-html.ts`:

```ts
import { pageShell } from "../report/theme.js";
import { renderStackedBarSvg } from "../report/charts.js";
import type { RecordedBenchmarkReport } from "./types.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function card(label: string, value: string): string {
  return `<div class="card"><div class="card-value">${esc(value)}</div><div class="card-label">${esc(label)}</div></div>`;
}

function scenarioRows(report: RecordedBenchmarkReport): string {
  if (report.scenarios.length === 0) {
    return `<tr><td colspan="6">No scenarios in this run.</td></tr>`;
  }
  return report.scenarios
    .map((row) => {
      const bar = renderStackedBarSvg([
        { label: "saved", value: row.savings_ratio },
        { label: "spent", value: Math.max(0, 1 - row.savings_ratio) },
      ]);
      return `<tr><td>${esc(row.scenario_id)}</td><td>${row.turns}</td><td>${row.blocks}</td><td>${pct(row.cache_hit_ratio)}</td><td>${pct(row.savings_ratio)}</td><td class="bar-cell">${bar}</td></tr>`;
    })
    .join("");
}

export function renderRecordedBenchmarkHtml(report: RecordedBenchmarkReport): string {
  const t = report.totals;
  const body = `
<section id="view-totals">
<h2>Totals</h2>
<div class="cards">
  ${card("Savings", pct(t.savings_ratio))}
  ${card("Cache hit ratio", pct(t.cache_hit_ratio))}
  ${card("Sessions", String(report.counts.sessions))}
  ${card("Turns", String(report.counts.turns))}
  ${card("Baseline units", t.baseline_cost_units.toFixed(0))}
  ${card("Effective units", t.effective_cost_units.toFixed(0))}
  ${card("Pruned blocks", String(t.pruned_blocks))}
</div>
</section>

<section id="view-scenarios">
<h2>Per-scenario savings</h2>
<table>
<thead><tr><th>Scenario</th><th>Turns</th><th>Blocks</th><th>Cache hit</th><th>Savings</th><th>Savings bar</th></tr></thead>
<tbody>${scenarioRows(report)}</tbody>
</table>
</section>

<footer>Generated from a recorded benchmark run (provider: ${esc(report.source.provider ?? "unknown")}, model: ${esc(report.source.model)}). No prompt text, assistant text, tool output, or file contents are persisted in this report — content_persisted: false.</footer>`;

  return pageShell({
    title: "CacheLane Benchmark",
    subtitle: `Run ${esc(report.run_id)} · Generated ${esc(report.generated_at)}`,
    bodyHtml: body,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/benchmark/__tests__/render-html.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/benchmark/render-html.ts src/benchmark/__tests__/render-html.test.ts
git commit -m "feat(benchmark): add themed HTML renderer for recorded reports"
```

---

## Task 5: Wire `--html` flag into the recorded benchmark script

**Files:**
- Modify: `scripts/benchmark/run-recorded.ts`

- [ ] **Step 1: Add the flag, import, and fail-open write**

In `scripts/benchmark/run-recorded.ts`:

Add to the imports (after the existing `../../src/benchmark/index.js` import):

```ts
import { renderRecordedBenchmarkHtml } from "../../src/benchmark/render-html.js";
```

Add `html` to the `parseArgs` options object (after `markdown`):

```ts
    markdown: { type: "boolean", default: false },
    html: { type: "string" },
```

After the existing markdown block (the `if (values.markdown) { ... }` block, ~line 80), add the fail-open HTML write:

```ts
let htmlPath: string | null = null;
if (values.html) {
  try {
    htmlPath = resolve(values.html);
    await writeFile(htmlPath, renderRecordedBenchmarkHtml(report), "utf8");
  } catch (err) {
    // fail-open: never let report rendering break the benchmark run
    console.error(`[benchmark] HTML report write failed: ${err instanceof Error ? err.message : String(err)}`);
    htmlPath = null;
  }
}
```

Add `html_path: htmlPath,` to the final `console.log(JSON.stringify({ ... }))` summary object (after `markdown_path`):

```ts
      markdown_path: markdownPath,
      html_path: htmlPath,
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke-test the flag end-to-end**

Run:
```bash
nvm use 20
npx tsx scripts/benchmark/run-recorded.ts --provider fake --run-id theme-smoke --html /tmp/cachelane-bench.html
grep -c "content_persisted" /tmp/cachelane-bench.html
grep -c "color-accent" /tmp/cachelane-bench.html
grep -c "https\?://" /tmp/cachelane-bench.html || echo "no external urls: ok"
```
Expected: the run prints a summary JSON including `"html_path"`; the first two greps print `1` (or more); the URL grep prints `0` then `no external urls: ok`.

- [ ] **Step 4: Clean up the smoke artifact**

```bash
rm -f /tmp/cachelane-bench.html
```

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark/run-recorded.ts
git commit -m "feat(benchmark): add --html flag to emit themed report alongside json/markdown"
```

---

## Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `nvm use 20 && npm test`
Expected: all pass (baseline was 363 passed | 2 skipped; this plan adds tests, so expect more passing and the same skip count). Paste the summary line.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean, no output errors.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Finish the branch**

Since work is in place on `main` (no feature branch), invoke `superpowers:finishing-a-development-branch` — for a normal repo on `main` with all commits already made, this reduces to confirming tests pass and reporting completion. Do NOT push or open a PR unless the user asks.

---

## Self-Review

**Spec coverage:**
- Shared theme module (tokens + pageShell) → Task 1. ✓
- Restyle m9 report page via pageShell → Task 3. ✓
- Charts use theme colors → Task 2. ✓
- New benchmark HTML renderer (RecordedBenchmarkReport) → Task 4. ✓
- `--html` flag on run-recorded.ts, fail-open → Task 5. ✓
- Offline / content-free / no-external-URL assertions → Tasks 1, 3, 4. ✓
- System font stack, warm palette, no dark `#0b0d12` → Task 1 CSS + Task 3 assertion. ✓

**Type consistency:** `renderRecordedBenchmarkHtml(report: RecordedBenchmarkReport)`, `pageShell({ title, subtitle, bodyHtml })`, `THEME_COLORS.{accent,success,danger,warn,fgFaint,border,bgElev}`, `CACHELANE_REPORT_CSS` — names used identically across Tasks 1–5. `renderStackedBarSvg` reused from charts.ts with its existing `{ label, value }[]` signature. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓
