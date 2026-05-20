import { describe, expect, it } from "vitest";
import type { Volatility } from "../../types/index.js";
import type { Classification } from "../../classifier/index.js";
import { findRegionBoundaries } from "../region-boundaries.js";

function cl(volatility: Volatility): Classification {
  return {
    kind: "user_message",
    volatility,
    isPinned: false,
    signals: ["user_message"],
  };
}

describe("findRegionBoundaries", () => {
  it("returns middle_end_in_messages = index after last SEMI block", () => {
    const result = findRegionBoundaries([cl("SEMI"), cl("SEMI"), cl("VOLATILE")]);
    expect(result.middle_end_in_messages).toBe(2);
  });

  it("returns middle_end_in_messages = null when no SEMI messages", () => {
    const result = findRegionBoundaries([cl("VOLATILE"), cl("VOLATILE")]);
    expect(result.middle_end_in_messages).toBeNull();
  });

  it("handles all-SEMI input", () => {
    const result = findRegionBoundaries([cl("SEMI"), cl("SEMI"), cl("SEMI")]);
    expect(result.middle_end_in_messages).toBe(3);
  });

  it("handles empty input", () => {
    const result = findRegionBoundaries([]);
    expect(result.middle_end_in_messages).toBeNull();
  });

  it("uses last contiguous SEMI position when VOLATILE interrupts (no swap)", () => {
    const result = findRegionBoundaries([cl("SEMI"), cl("VOLATILE"), cl("SEMI")]);
    expect(result.middle_end_in_messages).toBe(1);
  });

  it("treats STABLE in messages as middle (system already holds the true prefix)", () => {
    const result = findRegionBoundaries([cl("STABLE"), cl("SEMI"), cl("VOLATILE")]);
    expect(result.middle_end_in_messages).toBe(2);
  });
});
