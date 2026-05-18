import { describe, expect, it } from "vitest";
import type { Volatility } from "../../types/index.js";
import type { Classification } from "../../classifier/index.js";
import { reorder } from "../reorderer.js";

// Helper: build a Classification with only the field reorder() reads.
function cl(volatility: Volatility): Classification {
  return {
    kind: "user_message",
    volatility,
    isPinned: false,
    signals: ["user_message"],
  };
}

describe("reorder", () => {
  it("returns middle_end_in_messages = index after last SEMI block", () => {
    const result = reorder([cl("SEMI"), cl("SEMI"), cl("VOLATILE")]);
    expect(result.middle_end_in_messages).toBe(2);
  });

  it("returns middle_end_in_messages = null when no SEMI messages", () => {
    const result = reorder([cl("VOLATILE"), cl("VOLATILE")]);
    expect(result.middle_end_in_messages).toBeNull();
  });

  it("handles all-SEMI input", () => {
    const result = reorder([cl("SEMI"), cl("SEMI"), cl("SEMI")]);
    expect(result.middle_end_in_messages).toBe(3);
  });

  it("handles empty input", () => {
    const result = reorder([]);
    expect(result.middle_end_in_messages).toBeNull();
  });

  it("uses last contiguous SEMI position when VOLATILE precedes SEMI (no swap)", () => {
    const result = reorder([cl("SEMI"), cl("VOLATILE"), cl("SEMI")]);
    expect(result.middle_end_in_messages).toBe(1);
  });

  it("treats STABLE in messages as middle (since system already holds the true prefix)", () => {
    const result = reorder([cl("STABLE"), cl("SEMI"), cl("VOLATILE")]);
    expect(result.middle_end_in_messages).toBe(2);
  });
});
