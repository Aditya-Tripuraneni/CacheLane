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

function tierMultiplier(tier: string): number {
  switch (tier) {
    case "cache_read": return 0.1;
    case "cache_creation_5m": return 1.25;
    case "cache_creation_1h": return 2.0;
    case "cache_creation": return 1.25;
    default: return 1.0;
  }
}

export function formatTopBlocks(
  result: { found: false } | { found: true; explanation: TurnExplanationRecord },
  limit: number
): string {
  if (!result.found) return "No turn explanation found.";

  const explanation = result.explanation;
  const blocks = [...explanation.block_metadata].sort((a, b) => b.token_count - a.token_count);
  
  const lines = [
    `Turn ${explanation.turn_number} — Top blocks by token weight`,
    ``,
    `  ${"Block ID".padEnd(38)}  ${"Kind".padEnd(14)}  ${"Region".padEnd(8)}  ${"Tokens".padStart(8)}  ${"Tier".padEnd(16)}  ${"Est. Cost"}`,
    `  ${"─".repeat(98)}`
  ];

  let shownCount = 0;
  for (const block of blocks) {
    if (shownCount >= limit) break;
    
    let tier = "unknown";
    let estCost = 0;
    if (explanation.region_cost) {
      const region = block.volatility.toLowerCase() as "stable" | "semi" | "volatile";
      const regionCost = explanation.region_cost[region];
      if (regionCost) {
        tier = regionCost.tier;
        const mult = tierMultiplier(tier);
        estCost = block.token_count * mult;
      }
    }
    
    let displayTier = tier;
    if (tier === "input") displayTier = "input (1x)";
    else if (tier === "cache_read") displayTier = "cache_read";
    
    lines.push(`  ${block.block_id.padEnd(38)}  ${block.kind.padEnd(14)}  ${block.volatility.padEnd(8)}  ${String(block.token_count).padStart(8)}  ${displayTier.padEnd(16)}  ${estCost.toFixed(1)} cu`);
    shownCount++;
  }

  if (blocks.length > limit) {
    lines.push(`  (${blocks.length - limit} more blocks below threshold)`);
  }

  lines.push(``);
  lines.push(`  Region totals:`);
  
  if (explanation.region_cost) {
    for (const region of ["stable", "semi", "volatile"] as const) {
      const rc = explanation.region_cost[region];
      const multText = rc.tier === "input" ? "(1x)" : rc.tier === "cache_read" ? "(0.1x)" : rc.tier.startsWith("cache_creation") ? "(1.25x/2x)" : "";
      lines.push(`    ${region.toUpperCase().padEnd(8)}: ${String(rc.tokens).padStart(8)} tokens → ${rc.tier.padEnd(18)} ${multText.padEnd(10)} → ${rc.cost_units.toFixed(1).padStart(7)} cu`);
    }
    const baseline = explanation.usage.input_tokens + explanation.usage.cache_read_tokens + explanation.usage.cache_creation_5m_tokens + explanation.usage.cache_creation_1h_tokens;
    const savings = baseline > 0 ? ((baseline - explanation.usage.effective_cost_units) / baseline * 100).toFixed(1) : "0.0";
    lines.push(`    Total effective: ${explanation.usage.effective_cost_units.toFixed(1)} cu  (vs. ${baseline.toFixed(1)} baseline — ${savings}% savings)`);
  } else {
    lines.push(`    (No region cost breakdown available for this turn)`);
  }

  return lines.join("\n");
}
