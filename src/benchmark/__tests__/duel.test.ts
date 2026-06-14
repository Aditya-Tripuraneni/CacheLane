import { describe, expect, it, vi } from "vitest";
import { runDuel, type DuelDeps } from "../duel.js";
import type { NormalizedTraceSession } from "../../agent-traces/types.js";

function session(scenarioId: string, repeatedContent: boolean): NormalizedTraceSession {
  // Two turns; when repeatedContent is true the same block appears twice -> cache hit.
  const block = (salt: string) => ({
    id: `b-${salt}`, id_token: `t-${salt}`, kind: "file_read" as const, content: `block-${salt}`,
  });
  return {
    session_id: `s-${scenarioId}`,
    provider: "claude-code",
    scenario_id: scenarioId,
    source: {},
    turns: [
      { turn_number: 0, assistant_text: "", tool_calls: [], blocks_in_prompt: [block("1")] },
      {
        turn_number: 1, assistant_text: "", tool_calls: [],
        blocks_in_prompt: repeatedContent ? [block("1")] : [block("2")],
      },
    ],
  };
}

function makeDeps(): DuelDeps {
  return {
    setMutationEnabled: vi.fn(),
    sleep: vi.fn(async () => {}),
    now: () => new Date("2026-06-14T00:00:00.000Z"),
    runScenarioSession: vi.fn(async (scenarioId: string, mutationEnabled: boolean) => ({
      normalized: session(scenarioId, mutationEnabled), // ON => repeated content => cache hit
      transcriptPath: undefined,
      billed: mutationEnabled
        ? { input_tokens: 100, cache_read_tokens: 900, cache_creation_tokens: 50 }
        : { input_tokens: 1000, cache_read_tokens: 0, cache_creation_tokens: 0 },
    })),
  };
}

describe("runDuel", () => {
  const scenarios = [
    { id: "alpha", title: "A", description: "d", prompt: "p", turns: ["p", "p2"],
      workspace_files: [], expected_references: [], tags: [] },
  ];

  it("runs each scenario ON and OFF and reports estimate savings", async () => {
    const deps = makeDeps();
    const report = await runDuel(
      { run_id: "duel-1", cooldown_seconds: 0, model: "claude-sonnet", estimate_only: false },
      scenarios,
      deps,
    );
    expect(deps.runScenarioSession).toHaveBeenCalledTimes(2); // ON + OFF
    expect(report.totals.estimate_savings_ratio).toBeGreaterThan(0);
    expect(report.totals.live_usd_savings_ratio).toBeGreaterThan(0);
  });

  it("toggles mutation on and off around the runs", async () => {
    const deps = makeDeps();
    await runDuel(
      { run_id: "duel-1", cooldown_seconds: 0, model: "claude-sonnet", estimate_only: false },
      scenarios, deps,
    );
    const calls = (deps.setMutationEnabled as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls).toContain(true);
    expect(calls).toContain(false);
  });

  it("estimate_only mode skips the live OFF/ON billed run for dollars", async () => {
    const deps = makeDeps();
    const report = await runDuel(
      { run_id: "duel-1", cooldown_seconds: 0, model: "claude-sonnet", estimate_only: true },
      scenarios, deps,
    );
    expect(report.totals.live_usd_on).toBe(0);
    expect(report.totals.live_usd_off).toBe(0);
  });
});
