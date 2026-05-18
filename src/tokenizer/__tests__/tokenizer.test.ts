import { describe, it, expect } from "vitest";
import { countTokens, SUPPORTED_MODELS } from "../index.js";

const SAMPLE = "The quick brown fox jumps over the lazy dog.";

describe("countTokens", () => {
  it("returns a positive integer for claude-opus-4-6", () => {
    const n = countTokens(SAMPLE, "claude-opus-4-6");
    expect(n).toBeGreaterThan(0);
    expect(Number.isInteger(n)).toBe(true);
  });

  it("returns a positive integer for claude-opus-4-7", () => {
    const n = countTokens(SAMPLE, "claude-opus-4-7");
    expect(n).toBeGreaterThan(0);
    expect(Number.isInteger(n)).toBe(true);
  });

  it("throws for an unrecognised model string", () => {
    expect(() => countTokens(SAMPLE, "gpt-4-turbo")).toThrow(
      /unsupported model/i
    );
  });

  it("returns 0 for empty string", () => {
    expect(countTokens("", "claude-opus-4-7")).toBe(0);
  });

  it("SUPPORTED_MODELS includes both Opus 4.6 and 4.7", () => {
    expect(SUPPORTED_MODELS).toContain("claude-opus-4-6");
    expect(SUPPORTED_MODELS).toContain("claude-opus-4-7");
  });

  it("token count scales with input length", () => {
    const short = countTokens("Hello", "claude-opus-4-7");
    const long = countTokens("Hello ".repeat(100), "claude-opus-4-7");
    expect(long).toBeGreaterThan(short);
  });
});
