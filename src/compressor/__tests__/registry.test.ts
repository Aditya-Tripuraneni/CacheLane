import { describe, expect, it } from "vitest";
import { createDefaultRegistry, routeCompression } from "../registry.js";
import type { ToolOutputCompressor } from "../types.js";

describe("compression registry", () => {
  it("returns default compressors in deterministic priority order", () => {
    const registry = createDefaultRegistry();
    expect(registry.map((compressor) => compressor.id)).toEqual([
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
