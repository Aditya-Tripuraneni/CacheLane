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
});
