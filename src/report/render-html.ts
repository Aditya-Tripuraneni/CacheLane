import type { ReportData, ReportTurn } from "./types.js";
import type { RecordedBenchmarkReport } from "../benchmark/types.js";
import { renderCurveSvg, renderStackedBarSvg } from "./charts.js";
import { pageShell } from "./theme.js";
import { benchmarkTabs } from "../benchmark/render-html.js";

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

export function renderReportHtml(data: ReportData, benchmark?: RecordedBenchmarkReport): string {
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

  const usageHtml = `
<div class="cards">
  ${card("Savings", pct(data.stats.savings_ratio))}
  ${card("Cache hit ratio", pct(data.stats.cache_hit_ratio))}
  ${card("Turns", String(data.stats.turns))}
  ${card("Effective units", data.stats.effective_cost_units.toFixed(0))}
  ${card("Baseline units", data.stats.baseline_cost_units.toFixed(0))}
  ${card("Pruned blocks", String(data.stats.pruner_counts.pruned_blocks))}
  ${card("Fail-open turns", String(data.stats.pipeline_fallback_turns), data.stats.pipeline_fallback_turns > 0)}
</div>
<table><thead><tr><th>Session</th><th>Turns</th><th>Hit</th><th>Savings</th></tr></thead><tbody>${sessionRows}</tbody></table>`;

  const curveHtml = `
${curve}
<p class="note">Two lines: naive prefix caching (rust) pays input + reads near full price and never shrinks the prompt; CacheLane (sage) reads cached prefixes at 0.1× and prunes idle blocks to stubs. On short, stable sessions the lines nearly overlap — which is why CacheLane can look "the same as prefix caching." They diverge as the session grows: reordering rescues cache hits a volatile-first layout would lose, and K-pruning flattens token growth. A session is "long" once pruning and middle-region reuse compound — operationally ≥ ${data.long_session_threshold_turns} turns.</p>`;

  const decisionsHtml = `
<table><thead><tr><th>Turn</th><th>Model</th><th>Region (S/M/V)</th><th>Status</th><th>Pruned</th><th>Prune decisions</th><th>Signals</th></tr></thead>
<tbody>${decisionRows(data.turns) || `<tr><td colspan="7">No turns recorded yet — run Claude Code through the CacheLane proxy.</td></tr>`}</tbody></table>`;

  return pageShell({
    title: "CacheLane Report",
    subtitle: `Scope: ${esc(data.scope)} · Generated ${esc(data.generated_at)}`,
    tabs: [
      { id: "usage", label: "Usage", html: usageHtml },
      { id: "curve", label: "Curve", html: curveHtml },
      { id: "decisions", label: "Decisions", html: decisionsHtml },
      ...(benchmark ? benchmarkTabs(benchmark) : []),
    ],
    footerHtml: `<footer>Local report generated from ~/.cachelane/cachelane.db. No prompt text, file contents, or tool output are stored or shown — content_persisted: false.</footer>`,
  });
}
