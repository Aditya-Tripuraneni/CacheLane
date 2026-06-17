import { describe, it, expect } from "vitest";
import { renderRecordedBenchmarkHtml, benchmarkTabs } from "../render-html.js";
import type { RecordedBenchmarkReport } from "../types.js";

const report: RecordedBenchmarkReport = {
  run_id: "demo-run",
  generated_at: "2026-06-16T00:00:00Z",
  source: { kind: "normalized_trace", provider: "fake", normalized_dir: null, model: "claude-opus-4-7" },
  counts: { sessions: 2, turns: 5, blocks: 9, tool_calls: 4 },
  totals: {
    input_tokens: 1000, cache_read_tokens: 4000,
    baseline_cost_units: 5000, effective_cost_units: 1400,
    savings_ratio: 0.72, cache_hit_ratio: 0.8, pruned_blocks: 3, keepalive_pings: 0,
  },
  scenarios: [
    { scenario_id: "read-summarize-file", session_id: "s1", turns: 2, blocks: 4, tool_calls: 2,
      input_tokens: 400, cache_read_tokens: 1600, baseline_cost_units: 2000, effective_cost_units: 560,
      savings_ratio: 0.72, cache_hit_ratio: 0.8, pruned_blocks: 1, keepalive_pings: 0 },
    { scenario_id: "debug-failing-test", session_id: "s2", turns: 3, blocks: 5, tool_calls: 2,
      input_tokens: 600, cache_read_tokens: 2400, baseline_cost_units: 3000, effective_cost_units: 840,
      savings_ratio: 0.72, cache_hit_ratio: 0.8, pruned_blocks: 2, keepalive_pings: 0 },
  ],
  privacy: { content_persisted: false },
};

describe("renderRecordedBenchmarkHtml", () => {
  it("is a self-contained, content-free document", () => {
    const html = renderRecordedBenchmarkHtml(report);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('name="cachelane:content_persisted" content="false"');
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("uses the shared warm theme", () => {
    const html = renderRecordedBenchmarkHtml(report);
    expect(html).toContain("--color-accent");
    expect(html).not.toContain("#0b0d12");
  });

  it("renders totals and scenarios as separate tab panels", () => {
    const html = renderRecordedBenchmarkHtml(report);
    expect(html).toContain('id="p-totals"');
    expect(html).toContain('id="p-scenarios"');
    expect(html).toContain('class="tab-label">Totals</label>');
    expect(html).toContain('class="tab-label">Scenarios</label>');
  });

  it("exposes totals and scenarios as reusable PageTabs", () => {
    const tabs = benchmarkTabs(report);
    expect(tabs.map((t) => t.id)).toEqual(["totals", "scenarios"]);
    expect(tabs.map((t) => t.label)).toEqual(["Totals", "Scenarios"]);
    expect(tabs[0]?.html).toContain("Savings");
    expect(tabs[1]?.html).toContain("read-summarize-file");
  });

  it("shows headline cards and a per-scenario row for every scenario", () => {
    const html = renderRecordedBenchmarkHtml(report);
    expect(html).toContain("Savings");
    expect(html).toContain("Cache hit ratio");
    expect(html).toContain("read-summarize-file");
    expect(html).toContain("debug-failing-test");
  });

  it("includes a content-free footer", () => {
    const html = renderRecordedBenchmarkHtml(report);
    expect(html).toContain("No prompt text");
  });
});
