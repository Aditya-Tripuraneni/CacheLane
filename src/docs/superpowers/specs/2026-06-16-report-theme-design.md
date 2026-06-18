# CacheLane Shared Report Theme — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorming) — pending implementation plan
**Author:** Claude/agent session
**Topic:** Make the benchmark HTML report and the `cachelane report` page share one warm visual theme consistent with the `web/` marketing site.

## Problem

CacheLane has three visual surfaces that currently disagree:

1. **`web/`** — a Next.js 15 + React 19 + Tailwind v4 site using a warm light palette
   (Pampas cream background `#F4F3EE`, Crail rust accent `#C15F3C`, sage green success,
   charcoal-espresso foreground). Tokens are defined as `oklch(...)` CSS variables in
   `web/app/globals.css`. Fonts are Geist via `next/font`. Chart reference component:
   `web/components/demo/cost-chart.tsx`.
2. **`cachelane report`** (m9, `src/report/render-html.ts`) — a self-contained, zero-dependency,
   offline HTML file using a **dark** theme (`#0b0d12`) with inline SVG charts.
3. **Benchmark output** (`src/benchmark/dashboard.ts` ANSI terminal, `src/benchmark/duel-report.ts`
   markdown) — **no HTML form at all**.

The user wants both the benchmark output and the report page restyled to the `web/` look, sharing a
single theme so they cannot drift.

## Constraints (project invariants — non-negotiable)

- **Self-contained / offline:** report HTML must contain no external URLs, no CDN links, no
  `<script src>`, no React runtime. It is a single file openable from disk with no network.
- **Local-only:** renders only from in-memory report objects / the local SQLite DB. No prompt text,
  file contents, or tool output is persisted or shown. Every page carries
  `<meta name="cachelane:content_persisted" content="false">`.
- **Byte-stable:** the theme CSS is a static string constant — no `Date.now()`, no randomness in the
  style layer — so the SHA-256 prefix-cache-stability gate is unaffected.
- **Fail-open:** writing an HTML artifact must never break a benchmark run; a write error is swallowed
  and the run continues.

Because of the self-contained constraint, we **cannot** import the `web/` React/Tailwind components
directly. We port the *visual language* (design tokens) into hand-written CSS + SVG.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Which outputs to restyle | Both, sharing one theme: new benchmark HTML report **and** the m9 `report` page. |
| Fidelity approach | Port the design tokens — inline the exact oklch palette, fonts, and card/chart/table styling into a shared CSS string. Pure HTML + SVG, offline, byte-stable. |
| Benchmark HTML entry point | Flag on the existing benchmark run: `--html <path>` on `scripts/benchmark/run-recorded.ts`, written alongside the existing JSON/markdown. |
| Fonts | System font stack (`-apple-system`/`system-ui` sans + `ui-monospace` mono), matching `web/` fallbacks. No embedded font binaries. |
| Shared theme location | `src/report/theme.ts` (the report module is the natural home; benchmark imports from there). |
| Branching | None — work in place on `main`. The three Phase-3 branches (m8/m9/m10) were merged into `main` first so report + benchmark code coexist in one tree. |

## Architecture

### New module: `src/report/theme.ts`

Pure, zero-dependency. Exports:

- `CACHELANE_REPORT_CSS: string` — design tokens ported verbatim from `web/app/globals.css`:
  the warm oklch palette (`--color-bg`, `--color-bg-elev`, `--color-fg`, `--color-fg-muted`,
  `--color-fg-faint`, `--color-border`, `--color-accent`, `--color-success`, `--color-warn`,
  `--color-danger`), a system font stack, and component rules for `.card`, `.table`, `.badge`,
  and `.cl-chart` matching the rounded-border / elevated-surface look of `cost-chart.tsx`.
  Light theme only (drops `color-scheme: light dark` and the dark `#0b0d12` background).
- `pageShell({ title, subtitle, bodyHtml }): string` — wraps content in the
  `<!DOCTYPE html>` + `<head>` (charset, viewport, `cachelane:content_persisted` meta, `<style>`)
  + `<body>` boilerplate shared by both pages.

Chart color tokens are sourced from the theme so the SVG helpers use accent-rust / sage / danger
instead of hardcoded hex.

### Modified: `src/report/render-html.ts` (m9 report page)

- Remove the inline dark `<style>` block.
- Render via `pageShell()` so the page inherits the warm palette and shared component styling.
- Preserve the three views (`view-usage`, `view-curve`, `view-decisions`), their exact data, and the
  CacheLane-curve narrative paragraph verbatim. Only visual chrome changes:
  - "mutated" badge → sage-on-cream; "fail-open" badge → danger rust-brown.

### Modified: `src/report/charts.ts`

- `renderCurveSvg` and `renderStackedBarSvg` swap hardcoded hex (red `#ef4444`, green, chart frame
  `#11141b`) for theme tokens (`--color-danger` baseline, `--color-success` effective,
  `--color-accent`, elevated cream chart frame). SVG geometry unchanged.

### New module: `src/benchmark/render-html.ts`

Exports `renderRecordedBenchmarkHtml(report: RecordedBenchmarkReport): string` (renders from the
existing in-memory `RecordedBenchmarkReport` built by `generateRecordedBenchmarkReport` in
`src/benchmark/recorded.ts` — this is the report object the `run-recorded.ts` script already produces.
No new computation; the report already carries `privacy: { content_persisted: false }`). Uses
`pageShell()` for identical chrome to the report page.

Content (mirrors the existing `formatBenchmarkMarkdown` so HTML and markdown stay in sync):
- **Headline cards** (shared `.card`): savings ratio, cache hit ratio, sessions, turns,
  baseline cost units, effective cost units, pruned blocks.
- **Savings bar chart** (shared SVG helper): one bar per scenario showing that scenario's
  `savings_ratio`, accent-rust styled, matching `cost-chart.tsx`.
- **Per-scenario table** (shared `.table`): scenario_id, turns, blocks, cache hit %, savings % —
  the same columns as the existing markdown report.
- **Content-free footer** reproducing the markdown's "No prompt text … is persisted" line.

### Modified: `scripts/benchmark/run-recorded.ts`

Add an optional `--html <path>` flag. When passed, after the report object is built, write the themed
HTML via `renderDuelReportHtml` alongside the existing JSON/markdown. The write is wrapped so a failure
never breaks the benchmark run (fail-open). Default behavior (no flag) is unchanged.

Usage: `npm run benchmark:recorded -- --html out.html`

## Data flow

```
RecordedBenchmarkReport (in-memory, content-free)
   │
   ├── formatBenchmarkMarkdown() ── existing
   ├── JSON.stringify()          ── existing
   └── renderRecordedBenchmarkHtml() ─ NEW ──┐
                                              ├──> pageShell({ CACHELANE_REPORT_CSS, ... }) ──> *.html
ReportData (from local SQLite)                │
   └── renderReportHtml() ── restyled ────────┘
```

Both HTML renderers funnel through the same `theme.ts`, guaranteeing visual consistency.

## Testing (TDD per CLAUDE.md: red → watch fail → minimal green)

| Test file | Asserts |
|---|---|
| `src/report/__tests__/theme.test.ts` (new) | `CACHELANE_REPORT_CSS` contains warm tokens (e.g. Pampas/rust oklch values), no dark `#0b0d12`; `pageShell` emits the `content_persisted` meta and no external `http(s)://` URL. |
| `src/report/__tests__/render-html.test.ts` (update) | View IDs intact; badges use new token classes; no dark-hex leftovers. |
| `src/report/__tests__/charts.test.ts` (update) | SVGs reference theme colors, not the old red/green hex. |
| `src/benchmark/__tests__/render-html.test.ts` (new) | `renderRecordedBenchmarkHtml` emits headline cards, per-scenario rows, content-free footer, and no external URLs. |

An offline-safety assertion (grep for `http://`/`https://`) guards the self-contained invariant in
both renderer tests.

## Files

- **New:** `src/report/theme.ts`, `src/benchmark/render-html.ts`,
  `src/report/__tests__/theme.test.ts`, `src/benchmark/__tests__/render-html.test.ts`
- **Modified:** `src/report/render-html.ts`, `src/report/charts.ts`,
  `scripts/benchmark/run-recorded.ts`, `src/report/__tests__/render-html.test.ts`,
  `src/report/__tests__/charts.test.ts`

## Out of scope (YAGNI)

- No embedded Geist font binaries (system stack chosen).
- No bundled Tailwind build (token-port chosen).
- No restyle of the ANSI terminal `dashboard.ts` (stays for live watching).
- No new `cachelane report --benchmark` CLI mode (flag-on-run chosen instead).
- No changes to the `web/` site itself.
