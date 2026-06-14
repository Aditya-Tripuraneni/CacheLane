import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../providers/claude-code.js";
import { createGlmAdapter, buildGlmChatRequest, summarizeGlmRequest } from "../providers/glm.js";
import { validateScenarioSpec } from "../scenarios.js";

const scenario = validateScenarioSpec({
  id: "glm-redaction",
  title: "GLM Redaction",
  description: "Ensure request summaries do not carry secrets.",
  prompt: "Summarize src/a.ts.",
  workspace_files: [
    {
      path: "src/a.ts",
      content: "export const secretFree = true; The request summary must never include API keys.",
    },
  ],
  expected_references: ["src/a.ts"],
  tags: ["glm"],
});

describe("GLM provider", () => {
  it("redacts authorization material from request summaries", () => {
    const request = buildGlmChatRequest(scenario, {
      apiKey: "secret-token",
      model: "glm-test",
      baseUrl: "https://example.invalid/chat",
    });

    expect(request.headers.Authorization).toBe("Bearer secret-token");
    expect(JSON.stringify(summarizeGlmRequest(request))).not.toContain("secret-token");
  });

  it("does not require an API key for dry-run traces", async () => {
    const adapter = createGlmAdapter({
      apiKey: "secret-token",
      model: "glm-test",
      baseUrl: "https://example.invalid/chat",
    });

    const raw = await adapter.runScenario(scenario, {
      dry_run: true,
      run_id: "run",
      run_dir: "/tmp/run",
      now: () => new Date("2026-05-20T00:00:00.000Z"),
    });

    expect(JSON.stringify(raw)).not.toContain("secret-token");
    expect(raw.request_summary?.model).toBe("glm-test");
  });
});

describe("claude-code adapter multi-turn dry run", () => {
  it("plans one command per turn under a single pinned session id", async () => {
    const adapter = createClaudeCodeAdapter();
    const scenario = {
      id: "demo",
      title: "Demo",
      description: "d",
      prompt: "first",
      turns: ["first", "second", "third"],
      workspace_files: [],
      expected_references: [],
      tags: [],
    };
    const raw = await adapter.runScenario(scenario, {
      dry_run: true,
      run_id: "run-1",
      run_dir: "/tmp/run-1",
      now: () => new Date("2026-06-14T00:00:00.000Z"),
    });
    expect(raw.turns).toHaveLength(3);
    const summary = raw.command_summary as { session_id?: string; turn_count?: number };
    expect(summary.turn_count).toBe(3);
    expect(typeof summary.session_id).toBe("string");
    expect(summary.session_id).toContain("run-1");
  });
});
