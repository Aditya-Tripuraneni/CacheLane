import { describe, it, expect } from "vitest";

import { aiderTarget } from "../install-targets/aider.js";
import { claudeCodeTarget } from "../install-targets/claude-code.js";

describe("aiderTarget", () => {
  it("redirects via OPENAI_API_BASE env var", () => {
    expect(aiderTarget.envVars).toContain("OPENAI_API_BASE");
  });

  it("uses the env redirect mechanism", () => {
    expect(aiderTarget.redirectMechanism).toBe("env");
  });

  it("targets the OpenAI upstream by default", () => {
    expect(aiderTarget.upstreamDefault).toBe("api.openai.com");
  });

  it("has no hook surface", () => {
    expect(aiderTarget.hookSurface).toBeUndefined();
  });

  it("has no mcp surface", () => {
    expect(aiderTarget.mcpSurface).toBeUndefined();
  });
});

describe("claudeCodeTarget", () => {
  it("redirects via ANTHROPIC_BASE_URL env var", () => {
    expect(claudeCodeTarget.envVars).toContain("ANTHROPIC_BASE_URL");
  });

  it("defines a hook surface", () => {
    expect(claudeCodeTarget.hookSurface).toBeTruthy();
  });

  it("defines an mcp surface", () => {
    expect(claudeCodeTarget.mcpSurface).toBeTruthy();
  });
});
