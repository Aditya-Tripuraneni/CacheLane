import type {
  CachelaneStats,
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
    `Effective cost units: ${stats.effective_cost_units.toFixed(2)}`,
    `Baseline cost units: ${stats.baseline_cost_units.toFixed(2)}`,
    `Savings ratio: ${percent(stats.savings_ratio)}`,
    `Pruned blocks: ${stats.pruner_counts.pruned_blocks}`,
    `Keepalive pings: ${stats.keepalive_counts.pings}`,
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

export function jsonLine(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
