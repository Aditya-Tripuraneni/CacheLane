import { describe, expect, it } from "vitest";
import { createDefaultRegistry, routeCompression } from "../registry.js";
import type { ToolOutputCompressor } from "../types.js";

describe("compression registry", () => {
  it("returns default compressors in deterministic priority order", () => {
    const registry = createDefaultRegistry();
    expect(registry.map((compressor) => compressor.id)).toEqual([
      "shell",
      "json",
      "log",
      "passthrough",
    ]);
  });

  it("dispatches to the first matching compressor", () => {
    const custom: ToolOutputCompressor = {
      id: "custom-json",
      supportedModes: ["lossless", "balanced", "aggressive"],
      detect: () => ({ matched: true, confidence: 100, content_type: "json" }),
      compress: (input) => ({
        content: `custom:${input.content}`,
        content_type: "json",
        compressor_id: "custom-json",
        lossiness: "lossless",
      }),
    };

    const result = routeCompression(
      {
        tool_use_id: "tool-1",
        content: '{"a":1}',
        mode: "lossless",
        json_max_array_items: 20,
      },
      [custom, ...createDefaultRegistry()],
    );

    expect(result.compressor_id).toBe("custom-json");
    expect(result.content).toBe('custom:{"a":1}');
  });

  it("fails open to passthrough when a matching compressor throws", () => {
    const throwing: ToolOutputCompressor = {
      id: "throwing",
      supportedModes: ["lossless", "balanced", "aggressive"],
      detect: () => ({ matched: true, confidence: 100, content_type: "json" }),
      compress: () => {
        throw new Error("boom");
      },
    };

    const result = routeCompression(
      {
        tool_use_id: "tool-1",
        content: '{"a":1}',
        mode: "lossless",
        json_max_array_items: 20,
      },
      [throwing],
    );

    expect(result.content).toBe('{"a":1}');
    expect(result.content_type).toBe("passthrough");
    expect(result.compressor_id).toBe("passthrough");
  });
});

describe("shell routing precedence", () => {
  it("routes a git-status output to the shell compressor when a command is present", () => {
    const out = routeCompression({
      tool_use_id: "t1",
      content: "On branch main\nUntracked files:\n\tsrc/c.ts",
      mode: "balanced",
      json_max_array_items: 20,
      command: "git status",
    });
    expect(out.compressor_id).toBe("shell");
    expect(out.content_type).toBe("shell");
  });

  it("falls through to log/passthrough when no command matches a profile", () => {
    const out = routeCompression({
      tool_use_id: "t1",
      content: "plain text output",
      mode: "balanced",
      json_max_array_items: 20,
      command: "cowsay",
    });
    expect(out.compressor_id).not.toBe("shell");
  });
});
