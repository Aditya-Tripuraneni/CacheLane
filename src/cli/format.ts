import type {
  CachelaneStats,
  SessionSummaryRow,
  TurnExplanationRecord,
} from "../storage/index.js";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatStats(stats: CachelaneStats): string {
  return [
    `Scope: ${stats.scope}`,
    `Turns: ${stats.turns}`,
    `Cache hit ratio: ${percent(stats.cache_hit_ratio)}`,
    `Pipeline fallback turns: ${stats.pipeline_fallback_turns}`,
    `Effective cost units: ${stats.effective_cost_units.toFixed(2)}`,
    `Baseline cost units: ${stats.baseline_cost_units.toFixed(2)}`,
    `Savings ratio: ${percent(stats.savings_ratio)}`,
    `Pruned blocks: ${stats.pruner_counts.pruned_blocks}`,
    `Keepalive pings: ${stats.keepalive_counts.pings}`,
    `Estimated compression tokens saved: ${stats.compression_counts.tokens_saved}`,
  ].join("\n");
}

export function formatExplanation(
  result: { found: false } | { found: true; explanation: TurnExplanationRecord },
): string {
  if (!result.found) return "No turn explanation found.";

  const explanation = result.explanation;
  return [
    `Turn: ${explanation.turn_number}`,
    `Model: ${explanation.model}`,
    `Mutated: ${explanation.mutated ? "yes" : "no"}`,
    `Prefix hash: ${explanation.prefix_breakpoint_hash ?? "none"}`,
    `Middle hash: ${explanation.middle_breakpoint_hash ?? "none"}`,
    `Pruned blocks: ${explanation.pruned_blocks_count}`,
    `Messages: ${explanation.region_metadata.message_count}`,
    `Signals: ${explanation.signals.join(", ") || "none"}`,
  ].join("\n");
}

export function formatSessions(rows: SessionSummaryRow[]): string {
  if (rows.length === 0) return "No sessions recorded.";
  const lines = [
    `${"SESSION ID".padEnd(38)}  ${"TURNS".padStart(5)}  ${"HIT".padStart(6)}  ${"SAVINGS".padStart(7)}  LAST ACTIVE`,
    "-".repeat(80),
  ];
  for (const r of rows) {
    const date = new Date(r.last_active_ms).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    lines.push(
      `${r.session_id.padEnd(38)}  ${String(r.turns).padStart(5)}  ${(r.cache_hit_ratio * 100).toFixed(1).padStart(5)}%  ${(r.savings_ratio * 100).toFixed(1).padStart(6)}%  ${date}`,
    );
  }
  return lines.join("\n");
}

export function jsonLine(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
