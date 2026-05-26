import { describe, expect, test } from "vitest";
import { formatStats } from "../format.js";
import type { CachelaneStats } from "../../storage/index.js";

describe("formatStats", () => {
  test("formats stats correctly including pipeline fallback turns", () => {
    const stats: CachelaneStats = {
      scope: "workspace",
      workspace_id: "wk-123",
      session_id: null,
      since_ms: null,
      turns: 10,
      cache_hit_ratio: 0.85,
      pipeline_fallback_turns: 2,
      effective_cost_units: 100.5,
      baseline_cost_units: 120.0,
      savings_ratio: 0.1625,
      pruner_counts: {
        pruned_blocks: 4,
        turns_with_pruning: 2,
      },
      keepalive_counts: {
        pings: 5,
        turns_with_keepalive: 3,
      }
    };

    const output = formatStats(stats);
    expect(output).toBe(
      [
        "Scope: workspace",
        "Turns: 10",
        "Cache hit ratio: 85.0%",
        "Pipeline fallback turns: 2",
        "Effective cost units: 100.50",
        "Baseline cost units: 120.00",
        "Savings ratio: 16.3%",
        "Pruned blocks: 4",
        "Keepalive pings: 5",
      ].join("\n")
    );
  });
});
