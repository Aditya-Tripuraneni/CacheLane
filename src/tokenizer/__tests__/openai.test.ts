import { describe, it, expect } from "vitest";
import { openaiTokenizer } from "../openai.js";

describe("openaiTokenizer", () => {
  it("counts tokens for a gpt-4o model with o200k_base", () => {
    const n = openaiTokenizer.count("hello world", "gpt-4o");
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(10);
  });

  it("counts tokens for a non-4o model via the cl100k_base branch", () => {
    const n = openaiTokenizer.count("hello world", "gpt-3.5-turbo");
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(10);
  });
});
