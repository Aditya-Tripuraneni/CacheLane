import { describe, it, expect } from "vitest";
import { percentile, summarizeStage } from "../stats.js";
import { classifyAllMessages } from "../../proxy/server.js";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import { openDatabase } from "../../storage/index.js";
import {
  buildReplayRequest,
  seedBlocksForTurn,
  measurePipelineLatency,
  formatLatencyMarkdown,
} from "../latency.js";
import type { NormalizedTraceSession } from "../../agent-traces/types.js";
import type { LatencyReport } from "../types.js";

describe("percentile", () => {
  it("computes nearest-rank percentiles on a known set", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile(xs, 95)).toBe(10);
    expect(percentile(xs, 99)).toBe(10);
  });

  it("returns 0 for an empty array", () => {
    expect(percentile([], 95)).toBe(0);
  });
});

it("classifyAllMessages is importable and aligns with message count", () => {
  const messages = [{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }];
  const result = classifyAllMessages(messages, 0, DEFAULT_CONFIG);
  expect(result).toHaveLength(messages.length);
});

describe("summarizeStage", () => {
  it("summarizes nanosecond samples into millisecond stats", () => {
    const ns = [1_000_000n, 2_000_000n, 3_000_000n, 4_000_000n];
    const stat = summarizeStage("prune", ns);
    expect(stat.stage).toBe("prune");
    expect(stat.samples).toBe(4);
    expect(stat.max_ms).toBeCloseTo(4, 6);
    expect(stat.mean_ms).toBeCloseTo(2.5, 6);
    expect(stat.p50_ms).toBeCloseTo(2, 6);
  });
});

const FIXTURE: NormalizedTraceSession = {
  scenario_id: "fixture",
  session_id: "sess-1",
  provider: "fake",
  source: {},
  turns: [
    {
      turn_number: 0,
      assistant_text: "",
      tool_calls: [],
      blocks_in_prompt: [
        { id: "blk-sys", id_token: "blk-sys", kind: "system_prompt", content: "You are a helpful assistant." },
        { id: "blk-tool", id_token: "blk-tool", kind: "tool_output", content: "file contents here" },
      ],
    },
  ],
};

it("buildReplayRequest emits a tool_result referencing the block id", () => {
  const req = buildReplayRequest(FIXTURE.turns[0]!, "claude-opus-4-7");
  const flat = JSON.stringify(req.messages);
  expect(flat).toContain("blk-tool");
  expect(req.model).toBe("claude-opus-4-7");
});

it("seedBlocksForTurn inserts rows retrievable by session", () => {
  const db = openDatabase(":memory:");
  seedBlocksForTurn(db, "ws", "sess-1", FIXTURE.turns[0]!, 0);
  const rows = db.getBlocksBySession("ws", "sess-1");
  expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(["blk-sys", "blk-tool"]));
  db.close();
});

it("measures all stages and grows DB state across turns", () => {
  const session: NormalizedTraceSession = {
    scenario_id: "fixture",
    session_id: "sess-2",
    provider: "fake",
    source: {},
    turns: [0, 1, 2].map((n) => ({
      turn_number: n,
      assistant_text: "",
      tool_calls: [],
      blocks_in_prompt: [
        { id: `blk-${n}-a`, id_token: `blk-${n}-a`, kind: "system_prompt" as const, content: `sys ${n}` },
        { id: `blk-${n}-b`, id_token: `blk-${n}-b`, kind: "tool_output" as const, content: `out ${n}` },
      ],
    })),
  };

  const report = measurePipelineLatency({
    run_id: "t",
    generated_at: "2026-06-17T00:00:00Z",
    sessions: [session],
    model: "claude-opus-4-7",
    warmup: 1,
    iterations: 2,
  });

  const stageNames = report.stages.map((s) => s.stage);
  expect(stageNames).toEqual(
    expect.arrayContaining([
      "config_load", "classify", "block_placements",
      "prune", "materialize", "orchestrate", "db_record", "serialize", "total",
    ]),
  );
  const total = report.stages.find((s) => s.stage === "total")!;
  expect(total.samples).toBe(3 * 2);
  expect(report.counts.turns).toBe(3);
  expect(report.privacy.content_persisted).toBe(false);
});

it("formats a markdown report with a per-stage table and privacy footer", () => {
  const sampleReport: LatencyReport = {
    run_id: "r1",
    generated_at: "2026-06-17T00:00:00Z",
    source: { kind: "normalized_trace", provider: "fake", normalized_dir: null, model: "claude-opus-4-7" },
    config: { warmup: 5, iterations: 20 },
    counts: { sessions: 1, turns: 3 },
    stages: [
      { stage: "total", samples: 60, mean_ms: 1.2, p50_ms: 1.0, p95_ms: 2.0, p99_ms: 2.5, max_ms: 3.0 },
    ],
    scenarios: [{ scenario_id: "s", session_id: "sess", turns: 3, total_p95_ms: 2.0 }],
    privacy: { content_persisted: false },
  };
  const md = formatLatencyMarkdown(sampleReport);
  expect(md).toContain("# CacheLane Proxy Latency Benchmark r1");
  expect(md).toContain("| total |");
  expect(md).toContain("No prompt text");
});
