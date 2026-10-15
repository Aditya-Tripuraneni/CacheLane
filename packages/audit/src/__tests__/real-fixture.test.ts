import { describe, expect, it } from "vitest";
import { classifyRebuilds, hitRatio } from "../classify.js";
import { parseSession } from "../parse.js";
import { fixture } from "./fixture.js";

// A real Claude Code transcript scrubbed to usage metadata (no content, ids replaced,
// timestamps shifted). Checks the parser against the real field shape, not only
// hand-written fixtures.
describe("real scrubbed transcript", () => {
  const s = parseSession(fixture("real-scrubbed"));

  it("parses every API call and the compaction marker", () => {
    expect({ calls: s.calls.length, compact: s.compactAt.length }).toEqual({ calls: 196, compact: 1 });
  });

  it("finds the two idle rebuilds", () => {
    expect(classifyRebuilds(s, false).map((r) => r.cause)).toEqual(["idle_expired", "idle_expired"]);
  });

  it("matches the session's hit ratio", () => {
    expect(hitRatio(s.calls)).toBeCloseTo(0.987, 3);
  });
});
