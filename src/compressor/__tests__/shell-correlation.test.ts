import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { compress } from "../index.js";
import type { CompressorConfig } from "../types.js";
import type { AnthropicMessage } from "../../orchestrator/types.js";

const config: CompressorConfig = {
  enabled: true,
  exclude: [],
  json_max_array_items: 20,
  mode: "balanced",
  compressors: { json: true, log: true, shell: true },
};

const messages: AnthropicMessage[] = [
  {
    role: "assistant",
    content: [
      { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "git status" } },
    ],
  },
  {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: "On branch main\nUntracked files:\n\tsrc/c.ts\n\tsrc/d.ts",
      },
    ],
  },
];

describe("shell command correlation", () => {
  it("compresses a tool_result using the originating Bash command and tags profile_id", () => {
    const result = compress(messages, config, { model: "claude-sonnet-4-6" });
    const event = result.events.find((e) => e.tool_use_id === "toolu_1");
    expect(event?.content_type).toBe("shell");
    expect(event?.profile_id).toBe("git-status");
    expect(event?.tokens_saved).toBeGreaterThan(0);
  });

  it("retains the original on a failed command regardless of min_original_tokens", () => {
    const failMessages: AnthropicMessage[] = [
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "vitest run", exit_code: 1 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "✗ b.test.ts > fails\n  expected 1 received 2\nTests 1 failed | 0 passed" }] },
    ];
    const retained: string[] = [];
    const retentionConfig: CompressorConfig = {
      ...config,
      retention: { enabled: true, min_original_tokens: 1_000_000, ttl_days: 7 },
    };
    compress(failMessages, retentionConfig, {
      model: "claude-sonnet-4-6",
      retainOriginal: () => { retained.push("toolu_2"); return "handle_2"; },
    });
    expect(retained).toContain("toolu_2");
  });
});

describe("shell config gating", () => {
  it("does not shell-compress when compressors.shell is false", () => {
    const disabled: CompressorConfig = { ...config, compressors: { json: true, log: true, shell: false } };
    const result = compress(messages, disabled, { model: "claude-sonnet-4-6" });
    const event = result.events.find((e) => e.tool_use_id === "toolu_1");
    expect(event?.content_type).not.toBe("shell");
    expect(event?.profile_id).toBeUndefined();
  });

  it("does not shell-compress a profile disabled via shell_profiles", () => {
    const disabled: CompressorConfig = { ...config, shell_profiles: { "git-status": false } };
    const result = compress(messages, disabled, { model: "claude-sonnet-4-6" });
    const event = result.events.find((e) => e.tool_use_id === "toolu_1");
    expect(event?.content_type).not.toBe("shell");
  });

  it("still shell-compresses profiles that remain enabled", () => {
    const partial: CompressorConfig = { ...config, shell_profiles: { "git-diff": false } };
    // git status is NOT disabled here, so it should still be shell-compressed
    const result = compress(messages, partial, { model: "claude-sonnet-4-6" });
    const event = result.events.find((e) => e.tool_use_id === "toolu_1");
    expect(event?.content_type).toBe("shell");
    expect(event?.profile_id).toBe("git-status");
  });
});

describe("shell compression cache stability", () => {
  it("produces byte-identical output across 3 identical runs", () => {
    const run = () => {
      const r = compress(messages, config, { model: "claude-sonnet-4-6" });
      return JSON.stringify(r.messages);
    };
    const hashes = [run(), run(), run()].map((s) => createHash("sha256").update(s).digest("hex"));
    expect(new Set(hashes).size).toBe(1);
  });
});
