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
