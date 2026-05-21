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
    expect(report.totals.cache_read_tokens).toBeGreaterThan(0);
    expect(report.totals.effective_cost_units).toBeLessThan(
      report.totals.baseline_cost_units,
    );
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
