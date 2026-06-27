import { describe, it, expect } from "vitest";
import { renderReportHtml } from "../render-html.js";
import type { ReportData } from "../types.js";
import type { RecordedBenchmarkReport } from "../../benchmark/types.js";

const data: ReportData = {
  generated_at: "2026-06-16T00:00:00Z",
  scope: "workspace",
  workspace_id: "ws",
  session_id: null,
  long_session_threshold_turns: 15,
  stats: {
    scope: "workspace", workspace_id: "ws", session_id: null, since_ms: null,
    turns: 2, cache_hit_ratio: 0.4, effective_cost_units: 128, baseline_cost_units: 300,
    savings_ratio: 0.573, pipeline_fallback_turns: 0,
    pruner_counts: { pruned_blocks: 0, turns_with_pruning: 0 },
    keepalive_counts: { pings: 0, turns_with_keepalive: 0 },
    compression_counts: {
      compressed_blocks: 2,
      tokens_saved: 150,
      by_profile: [{ profile_id: "git-status", tokens_saved: 150, compressed_blocks: 2 }],
    },
  },
  turns: [
    { turn_number: 1, model: "m", input_tokens: 100, cache_read_tokens: 0, cache_creation_tokens: 0,
      effective_cost_units: 100, baseline_cost_units: 100, mutated: true,
      stable_count: 1, semi_count: 1, volatile_count: 1, pruned_blocks_count: 0, prune_decisions: [], signals: ["prefix_cached"] },
  ],
  sessions: [],
  privacy: { content_persisted: false },
};

const benchmark: RecordedBenchmarkReport = {
  run_id: "demo-run",
  generated_at: "2026-06-16T00:00:00Z",
  source: { kind: "normalized_trace", provider: "fake", normalized_dir: null, model: "m" },
  counts: { sessions: 1, turns: 2, blocks: 3, tool_calls: 1 },
  totals: {
    input_tokens: 100, cache_read_tokens: 400, baseline_cost_units: 500, effective_cost_units: 140,
    savings_ratio: 0.72, cache_hit_ratio: 0.8, pruned_blocks: 1, keepalive_pings: 0,
  },
  scenarios: [
    { scenario_id: "read-summarize-file", session_id: "s1", turns: 2, blocks: 3, tool_calls: 1,
      input_tokens: 100, cache_read_tokens: 400, baseline_cost_units: 500, effective_cost_units: 140,
      savings_ratio: 0.72, cache_hit_ratio: 0.8, pruned_blocks: 1, keepalive_pings: 0 },
  ],
  privacy: { content_persisted: false },
};

describe("renderReportHtml", () => {
  it("is self-contained (no external resource refs)", () => {
    const html = renderReportHtml(data);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("uses the warm theme, not the old dark theme", () => {
    const html = renderReportHtml(data);
    expect(html).toContain("--color-accent");
    expect(html).not.toContain("#0b0d12");
  });

  it("declares content_persisted false and includes all three panels", () => {
    const html = renderReportHtml(data);
    expect(html).toContain('name="cachelane:content_persisted" content="false"');
    expect(html).toContain('id="p-usage"');
    expect(html).toContain('id="p-curve"');
    expect(html).toContain('id="p-decisions"');
  });

  it("omits benchmark panels when no benchmark is supplied", () => {
    const html = renderReportHtml(data);
    expect(html).not.toContain('id="p-totals"');
    expect(html).not.toContain('id="p-scenarios"');
  });

  it("appends benchmark totals and scenarios panels when a benchmark is supplied", () => {
    const html = renderReportHtml(data, benchmark);
    expect(html).toContain('id="p-usage"');
    expect(html).toContain('id="p-totals"');
    expect(html).toContain('id="p-scenarios"');
    expect(html).toContain("read-summarize-file");
  });

  it("renders per-profile compression savings", () => {
    const html = renderReportHtml(data);
    expect(html).toContain("git-status");
    expect(html).toContain("150");
  });

  it("never leaks content (there is none to leak)", () => {
    const html = renderReportHtml(data);
    expect(html).not.toContain("export const");
  });
});
