import { describe, expect, it } from "vitest";
import {
  formatBenchmarkMarkdown,
  generateRecordedBenchmarkReport,
} from "../recorded.js";
import type { NormalizedTraceSession } from "../../agent-traces/types.js";

const session: NormalizedTraceSession = {
  session_id: "session-benchmark",
  provider: "fake",
  scenario_id: "repeat-block",
  source: {},
  turns: [
    {
      turn_number: 1,
      assistant_text: "secret assistant text",
      tool_calls: [{ name: "read_file", input: { path: "src/secret.ts" } }],
      blocks_in_prompt: [
        {
          id: "block-1",
          id_token: "block-1",
          kind: "file_read",
          file_path: "src/secret.ts",
          content: "secret prompt fixture ".repeat(20),
        },
      ],
    },
    {
      turn_number: 2,
      assistant_text: "uses prior block",
      tool_calls: [],
      blocks_in_prompt: [
        {
          id: "block-1",
          id_token: "block-1",
          kind: "file_read",
          file_path: "src/secret.ts",
          content: "secret prompt fixture ".repeat(20),
        },
      ],
    },
  ],
};

describe("recorded benchmark report", () => {
  it("aggregates repeated prompt blocks as cache reads", () => {
    const report = generateRecordedBenchmarkReport({
      run_id: "test-run",
      generated_at: "2026-05-20T00:00:00.000Z",
      sessions: [session],
    });

    expect(report.counts).toMatchObject({
      sessions: 1,
      turns: 2,
      blocks: 2,
      tool_calls: 1,
    });

    // The fixture has one unique block seen in two turns:
    //   turn 1 → first occurrence  → inputTokens     = T
    //   turn 2 → duplicate hash    → cacheReadTokens  = T
    //
    // Formula (recorded.ts):
    //   baseline  = T + T          = 2T
    //   effective = T + 0.1 * T    = 1.1T
    //   savings   = (2T - 1.1T) / 2T = 0.9/2 = 0.45 (exact, independent of T)
    //   cache_hit = T / 2T         = 0.5    (exact)
    //
    // Using real @anthropic-ai/tokenizer + claude-opus-4-7 (1.15× multiplier):
    //   base tiktoken("secret prompt fixture ".repeat(20)) = 61
    //   T = round(61 * 1.15) = 70
    //   baseline = 140, effective = 77
    expect(report.totals.input_tokens).toBe(70);
    expect(report.totals.cache_read_tokens).toBe(70);
    expect(report.totals.baseline_cost_units).toBe(140);
    expect(report.totals.effective_cost_units).toBeCloseTo(77, 6);
    expect(report.totals.savings_ratio).toBeCloseTo(0.45, 2);
    expect(report.totals.cache_hit_ratio).toBeCloseTo(0.5, 2);
  });

  it("does not persist prompt, assistant, or tool content in report outputs", () => {
    const report = generateRecordedBenchmarkReport({
      run_id: "test-run",
      generated_at: "2026-05-20T00:00:00.000Z",
      sessions: [session],
    });
    const markdown = formatBenchmarkMarkdown(report);

    expect(JSON.stringify(report)).not.toContain("secret prompt fixture");
    expect(JSON.stringify(report)).not.toContain("secret assistant text");
    expect(markdown).not.toContain("secret prompt fixture");
  });

  it("handles empty normalized traces with zero totals", () => {
    const report = generateRecordedBenchmarkReport({
      run_id: "empty",
      generated_at: "2026-05-20T00:00:00.000Z",
      sessions: [],
    });

    expect(report).toMatchObject({
      counts: { sessions: 0, turns: 0, blocks: 0, tool_calls: 0 },
      totals: {
        baseline_cost_units: 0,
        effective_cost_units: 0,
        savings_ratio: 0,
        cache_hit_ratio: 0,
      },
    });
  });
});
