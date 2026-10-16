import { describe, expect, it } from "vitest";
import { classifyRebuilds, hitRatio } from "../classify.js";
import { parseSession } from "../parse.js";
import { fixture } from "./fixture.js";

describe("classifyRebuilds", () => {
  it.each([
    ["idle", false, "idle_expired"],
    ["model-switch", false, "model_switch"],
    ["compaction", false, "compaction"],
    ["prefix", false, "prefix_changed"],
    ["prefix", true, "proxy_stripped"],
  ] as const)("%s (base url set: %s) -> %s", (name, baseUrlSet, cause) => {
    const rebuilds = classifyRebuilds(parseSession(fixture(name)), baseUrlSet);
    expect(rebuilds.map((r) => r.cause)).toEqual([cause]);
  });

  it("measures the idle gap", () => {
    const [r] = classifyRebuilds(parseSession(fixture("idle")), false);
    expect(r!.gapMs).toBe(2 * 3_600_000);
  });

  it("never counts a sidechain's first write as a rebuild", () => {
    const s = parseSession(fixture("idle"));
    expect(classifyRebuilds({ ...s, calls: s.calls.slice(0, 2) }, false)).toEqual([]);
  });
});

describe("hitRatio", () => {
  it("is reads over all input tokens", () => {
    expect(hitRatio(parseSession(fixture("prefix")).calls)).toBeCloseTo(100000 / 304012, 5);
  });

  it("is 0 with no calls", () => {
    expect(hitRatio([])).toBe(0);
  });
});
