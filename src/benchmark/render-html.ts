import { pageShell, type PageTab } from "../report/theme.js";
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
