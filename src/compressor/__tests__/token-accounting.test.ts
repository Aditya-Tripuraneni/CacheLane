import { describe, expect, it } from "vitest";
import { countCompressionTokens } from "../token-accounting.js";
import { countTokens } from "../../tokenizer/index.js";

describe("compression token accounting", () => {
  it("uses the shared tokenizer path for supported models", () => {
    const text = JSON.stringify({ value: "x".repeat(500) });
    expect(countCompressionTokens(text, "claude-opus-4-7")).toBe(
      countTokens(text, "claude-opus-4-7"),
    );
  });

  it("falls back to a conservative estimate for unsupported non-Claude models", () => {
    expect(countCompressionTokens("abcd", "unknown-model")).toBe(1);
  });

  it("does not throw when modelId is undefined (Bedrock body has no model)", () => {
    // Regression: the record path called countTokens(str, opts.model) with an
    // undefined model on Bedrock turns, throwing before insertBlock ran — so no
    // blocks were ever recorded and nothing was ever prunable.
    expect(countCompressionTokens("abcd", undefined)).toBe(1);
  });
});
