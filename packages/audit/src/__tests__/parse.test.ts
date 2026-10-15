import { describe, expect, it } from "vitest";
import { parseSession } from "../parse.js";
import { fixture } from "./fixture.js";

describe("parseSession", () => {
  const s = parseSession(fixture("idle"));

  it("de-duplicates streamed chunks by message id", () => {
    expect(s.calls.map((c) => c.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("separates sidechain calls and drops <synthetic> entries", () => {
    expect(s.sidechainCalls.map((c) => c.id)).toEqual(["s1"]);
  });

  it("reads the nested 5m/1h cache-write split", () => {
    expect(s.calls[0]).toMatchObject({ write1h: 100000, write5m: 0, read: 0, input: 5 });
  });

  it("falls back to the flat total as 5m when the split is absent", () => {
    const line = JSON.stringify({ type: "assistant", timestamp: "2026-10-01T10:00:00.000Z",
      message: { id: "x", model: "claude-opus-5-5", usage: { input_tokens: 1, cache_creation_input_tokens: 500 } } });
    expect(parseSession("/p/proj/s.jsonl", line).calls[0]).toMatchObject({ write5m: 500, write1h: 0 });
  });

  it("records compact_boundary timestamps", () => {
    expect(parseSession(fixture("compaction")).compactAt).toEqual([Date.parse("2026-10-01T10:01:30.000Z")]);
  });

  it("takes session id from entries and project from the directory name", () => {
    expect(s.sessionId).toBe("sess-idle");
    expect(s.project).toBe("fixtures");
  });
});
