import { describe, it, expect } from "vitest";
import { selectAdapter } from "../registry.js";

describe("selectAdapter", () => {
  it("returns the anthropic adapter for /v1/messages", () => {
    expect(selectAdapter("POST", "/v1/messages")?.name).toBe("anthropic");
  });
  it("returns the anthropic adapter for the Bedrock /model/* route (guards SigV4 path)", () => {
    expect(selectAdapter("POST", "/model/claude/invoke")?.name).toBe("anthropic");
  });
  it("returns null for unmatched routes", () => {
    expect(selectAdapter("GET", "/health")).toBeNull();
  });
});
