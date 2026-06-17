import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NormalizedTraceSession } from "../../agent-traces/types.js";
import { computeCorrectnessForSession, generateCorrectnessReport } from "../correctness.js";

function load(name: string): NormalizedTraceSession {
  const p = resolve(__dirname, "fixtures", "correctness", `${name}.json`);
  return JSON.parse(readFileSync(p, "utf8")) as NormalizedTraceSession;
}

describe("computeCorrectnessForSession", () => {
  it("clean rehydration: recall 1.0, stale 0.0", () => {
    const row = computeCorrectnessForSession(load("clean-rehydration"), 3);
    expect(row.stubbed_blocks).toBeGreaterThanOrEqual(1);
    expect(row.stubbed_then_referenced).toBe(1);
    expect(row.restored_correctly).toBe(1);
    expect(row.rehydration_recall).toBe(1);
    expect(row.stale_answer_rate).toBe(0);
  });

  it("stub never referenced: recall 1.0 (empty denom), needed 0", () => {
    const row = computeCorrectnessForSession(load("stub-never-referenced"), 3);
    expect(row.stubbed_then_referenced).toBe(0);
    expect(row.rehydration_recall).toBe(1);
    expect(row.needed_blocks).toBe(0);
    expect(row.stale_answer_rate).toBe(0);
  });

  it("content drift under stub: stale_answer_rate > 0", () => {
    const row = computeCorrectnessForSession(load("lossy-missing-handle"), 3);
    expect(row.needed_but_unavailable).toBeGreaterThanOrEqual(1);
    expect(row.stale_answer_rate).toBeGreaterThan(0);
  });
});

describe("generateCorrectnessReport", () => {
  it("aggregates totals across sessions and asserts content-free", () => {
    const sessions = ["clean-rehydration", "stub-never-referenced", "lossy-missing-handle"].map(load);
    const report = generateCorrectnessReport({
      run_id: "test",
      generated_at: "2026-06-16T00:00:00Z",
      sessions,
      k: 3,
      normalized_dir: null,
    });
    expect(report.scenarios).toHaveLength(3);
    expect(report.totals.stubbed_then_referenced).toBeGreaterThanOrEqual(2);
    expect(report.totals.needed_but_unavailable).toBeGreaterThanOrEqual(1);
    expect(report.privacy.content_persisted).toBe(false);
    // content-free guard: serialized report must not contain fixture content strings
    const json = JSON.stringify(report);
    expect(json).not.toContain("export const TTL");
    expect(json).not.toContain("VERSION = ");
  });
});
