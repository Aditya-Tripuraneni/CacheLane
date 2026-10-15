import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, copyFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSession } from "../parse.js";
import { buildReport, findTranscripts, renderText } from "../report.js";
import { fixture } from "./fixture.js";

describe("buildReport", () => {
  const r = buildReport([parseSession(fixture("idle"))], false);

  it("counts sessions and calls including sidechains", () => {
    expect(r).toMatchObject({ sessions: 1, projects: 1, calls: 4 });
  });

  it("ranks causes by write cost", () => {
    expect(r.causes[0]).toMatchObject({ cause: "idle_expired", count: 1, units: 204000 });
  });

  it("lists the largest rebuilds", () => {
    expect(r.worst[0]).toMatchObject({ tokens: 102000, gapMin: 120, cause: "idle_expired", sessionId: "sess-idl" });
  });

  it("recommends the guard for idle rebuilds", () => {
    expect(r.recommendation).toContain("guard");
  });

  it("hashes project names with hidePaths", () => {
    expect(buildReport([parseSession(fixture("idle"))], false, true).worst[0]!.project).toMatch(/^[0-9a-f]{8}$/);
  });

  it("handles no sessions", () => {
    expect(buildReport([], false)).toMatchObject({ hitRatio: 0, causes: [], recommendation: "No cache rebuilds found. Nothing to fix." });
  });
});

describe("renderText", () => {
  it("prints the summary, causes and next step", () => {
    const text = renderText(buildReport([parseSession(fixture("idle"))], false), 30);
    expect(text).toContain("Cache hit ratio");
    expect(text).toContain("idle_expired");
    expect(text).toContain("at API price");
    expect(text).not.toContain("—");
  });
});

describe("findTranscripts", () => {
  it("filters by mtime and project", () => {
    const root = mkdtempSync(join(tmpdir(), "cl-audit-"));
    mkdirSync(join(root, "-Users-me-app"));
    mkdirSync(join(root, "-Users-me-other"));
    copyFileSync(fixture("idle"), join(root, "-Users-me-app", "a.jsonl"));
    copyFileSync(fixture("prefix"), join(root, "-Users-me-other", "b.jsonl"));
    utimesSync(join(root, "-Users-me-other", "b.jsonl"), new Date(0), new Date(0));
    expect(findTranscripts(root, Date.now() - 86_400_000)).toEqual([join(root, "-Users-me-app", "a.jsonl")]);
    expect(findTranscripts(root, 0, "-Users-me-other")).toEqual([join(root, "-Users-me-other", "b.jsonl")]);
  });
});
