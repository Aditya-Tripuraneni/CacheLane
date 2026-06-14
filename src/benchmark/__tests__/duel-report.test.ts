import { describe, expect, it } from "vitest";
import { buildDuelReport, renderDuelMarkdown, type DuelScenarioInput } from "../duel-report.js";

const SCENARIOS: DuelScenarioInput[] = [
  {
    scenario_id: "multi-turn-refactor",
    turns: 4,
    on: {
      estimate_baseline_units: 1000, estimate_effective_units: 300,
      billed: { input_tokens: 200, cache_read_tokens: 800, cache_creation_tokens: 100 },
    },
    off: {
      estimate_baseline_units: 1000, estimate_effective_units: 1000,
      billed: { input_tokens: 1000, cache_read_tokens: 0, cache_creation_tokens: 0 },
    },
  },
];

describe("buildDuelReport", () => {
  it("computes estimate savings ratio from on vs off effective units", () => {
    const report = buildDuelReport({
      run_id: "duel-1",
      generated_at: "2026-06-14T00:00:00.000Z",
      cooldown_seconds: 360,
      model: "claude-sonnet",
      scenarios: SCENARIOS,
    });
    // OFF effective 1000 -> ON effective 300 => 70% saved
    expect(report.totals.estimate_savings_ratio).toBeCloseTo(0.7, 6);
  });

  it("computes live dollar savings from billed tokens", () => {
    const report = buildDuelReport({
      run_id: "duel-1", generated_at: "t", cooldown_seconds: 360,
      model: "claude-sonnet", scenarios: SCENARIOS,
    });
    expect(report.totals.live_usd_off).toBeGreaterThan(report.totals.live_usd_on);
    expect(report.totals.live_usd_savings_ratio).toBeGreaterThan(0);
  });

  it("persists no prompt or assistant content", () => {
    const report = buildDuelReport({
      run_id: "duel-1", generated_at: "t", cooldown_seconds: 360,
      model: "claude-sonnet", scenarios: SCENARIOS,
    });
    expect(JSON.stringify(report)).not.toMatch(/refactor the|summarize|read src/i);
    expect(report.privacy.content_persisted).toBe(false);
  });

  it("renders a markdown report with both tiers", () => {
    const report = buildDuelReport({
      run_id: "duel-1", generated_at: "t", cooldown_seconds: 360,
      model: "claude-sonnet", scenarios: SCENARIOS,
    });
    const md = renderDuelMarkdown(report);
    expect(md).toContain("HEADLINE");
    expect(md).toContain("LIVE BILLED");
    expect(md).toContain("multi-turn-refactor");
  });
});
