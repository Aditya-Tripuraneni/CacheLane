import { describe, expect, it } from "vitest";
import { compress, detectContentType } from "../index.js";
import type { AnthropicMessage, CompressorConfig } from "../types.js";

const DEFAULT_CONFIG: CompressorConfig = {
  enabled: true,
  mode: "aggressive",
  exclude: [],
  json_max_array_items: 20,
};

function toolResultMsg(content: string, toolUseId = "tool-1"): AnthropicMessage {
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
  };
}

describe("detectContentType", () => {
  it("detects valid JSON as 'json'", () => {
    expect(detectContentType('{"a":1}')).toBe("json");
  });

  it("detects JSON array as 'json'", () => {
    expect(detectContentType("[1,2,3]")).toBe("json");
  });

  it("detects log-heavy text as 'log'", () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      i < 5 ? `[INFO] step ${i}` : `other line ${i}`
    );
    expect(detectContentType(lines.join("\n"))).toBe("log");
  });

  it("detects plain text as 'passthrough'", () => {
    expect(detectContentType("here is some plain prose text")).toBe("passthrough");
  });

  it("detects invalid JSON as non-json", () => {
    const type = detectContentType("not { valid json");
    expect(type).not.toBe("json");
  });
});

describe("compress", () => {
  it("returns original messages when disabled", () => {
    const msg = toolResultMsg('{"a":null}');
    const config: CompressorConfig = { ...DEFAULT_CONFIG, enabled: false };
    const result = compress([msg], config);
    expect(result.messages[0]).toBe(msg);
    expect(result.events).toHaveLength(0);
  });

  it("compresses JSON tool_result content", () => {
    const msg = toolResultMsg(JSON.stringify({ a: 1, b: null, c: [] }));
    const result = compress([msg], DEFAULT_CONFIG);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.content_type).toBe("json");
    expect(result.events[0]!.tokens_saved).toBeGreaterThanOrEqual(0);
    const compressed = getToolResultContent(result.messages[0]!);
    expect(JSON.parse(compressed)).toEqual({ a: 1 });
  });

  it("defaults missing compression.mode to lossless for old config objects", () => {
    const original = JSON.stringify({ a: 1, b: null, c: [], d: { e: null } }, null, 2);
    const msg = toolResultMsg(original);
    const result = compress(
      [msg],
      {
        enabled: true,
        exclude: [],
        json_max_array_items: 20,
      } as CompressorConfig,
    );

    expect(result.events[0]!.mode).toBe("lossless");
    const compressed = getToolResultContent(result.messages[0]!);
    expect(JSON.parse(compressed)).toEqual(JSON.parse(original));
  });

  it("compresses log tool_result content", () => {
    const logLines = [
      "[INFO] starting",
      "[ERROR] something failed",
      "[INFO] done",
    ].join("\n");
    const msg = toolResultMsg(logLines);
    const result = compress([msg], DEFAULT_CONFIG);
    expect(result.events[0]!.content_type).toBe("log");
    const compressed = getToolResultContent(result.messages[0]!);
    expect(compressed).toContain("ERROR");
  });

  it("passthroughs plain text unchanged", () => {
    const msg = toolResultMsg("some plain text response");
    const result = compress([msg], DEFAULT_CONFIG);
    expect(result.events[0]!.content_type).toBe("passthrough");
    expect(getToolResultContent(result.messages[0]!)).toBe("some plain text response");
  });

  it("skips non-tool_result messages (user/assistant)", () => {
    const msg: AnthropicMessage = { role: "user", content: [{ type: "text", text: "hello" }] };
    const result = compress([msg], DEFAULT_CONFIG);
    expect(result.messages[0]).toBe(msg);
    expect(result.events).toHaveLength(0);
  });

  it("skips excluded tool_use_ids", () => {
    const msg = toolResultMsg('{"a":null}', "excluded-tool");
    const config: CompressorConfig = { ...DEFAULT_CONFIG, exclude: ["excluded-*"] };
    const result = compress([msg], config);
    expect(result.messages[0]).toBe(msg);
    expect(result.events).toHaveLength(0);
  });

  it("passes through array-shaped tool_result content unchanged", () => {
    const msg: AnthropicMessage = {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool-array",
          content: [
            { type: "text", text: JSON.stringify({ a: 1, b: null }) },
            { type: "image", source: { type: "url", url: "https://example.com/image.png" } },
          ],
        },
      ],
    };

    const result = compress([msg], DEFAULT_CONFIG);
    expect(result.messages[0]).toBe(msg);
    expect(result.events).toHaveLength(0);
  });

  it("passes through if compressJson throws (fail-open)", () => {
    const badMsg = toolResultMsg("{bad json}");
    const result = compress([badMsg], DEFAULT_CONFIG);
    expect(result.messages[0]!.content).toBeDefined();
  });

  it("honors per-compressor JSON disable without disabling log compression", () => {
    const jsonMsg = toolResultMsg(JSON.stringify({ a: 1, b: null }), "json-tool");
    const logMsg = toolResultMsg("[INFO] starting\n[ERROR] failed\n[INFO] done", "log-tool");
    const config: CompressorConfig = {
      ...DEFAULT_CONFIG,
      compressors: { json: false, log: true, shell: true },
    };

    const result = compress([jsonMsg, logMsg], config);

    expect(result.messages[0]).toBe(jsonMsg);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.content_type).toBe("log");
  });

  it("honors per-compressor log disable without disabling JSON compression", () => {
    const jsonMsg = toolResultMsg(JSON.stringify({ a: 1, b: null }), "json-tool");
    const logMsg = toolResultMsg("[INFO] starting\n[ERROR] failed\n[INFO] done", "log-tool");
    const config: CompressorConfig = {
      ...DEFAULT_CONFIG,
      compressors: { json: true, log: false, shell: true },
    };

    const result = compress([jsonMsg, logMsg], config);

    expect(result.messages[1]).toBe(logMsg);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.content_type).toBe("json");
  });

  it("records tokens_saved = original_tokens - compressed_tokens", () => {
    const original = JSON.stringify({ a: 1, b: null, c: null, d: null });
    const msg = toolResultMsg(original);
    const result = compress([msg], DEFAULT_CONFIG);
    const event = result.events[0]!;
    expect(event.tokens_saved).toBe(event.original_tokens - event.compressed_tokens);
  });

  it("requests retention for lossy compressed content above threshold", () => {
    const original = JSON.stringify({
      a: 1,
      b: null,
      items: Array.from({ length: 40 }, (_, i) => ({ id: i, empty: null })),
    });
    const msg = toolResultMsg(original);
    const retained: string[] = [];

    const result = compress(
      [msg],
      {
        ...DEFAULT_CONFIG,
        retention: {
          enabled: true,
          min_original_tokens: 1,
          ttl_days: 7,
        },
      },
      {
        retainOriginal: (record) => {
          retained.push(record.original_text);
          return "cto_test";
        },
      },
    );

    expect(retained).toEqual([original]);
    expect(result.events[0]!.retention_handle).toBe("cto_test");
    expect(result.events[0]!.outcome).toBe("retrieval_backed");
    expect(JSON.parse(getToolResultContent(result.messages[0]!))).toMatchObject({
      __cachelane_compressed: true,
      retrieval_handle: "cto_test",
    });
  });

  it("discards retained originals when retrieval marker overhead removes savings", () => {
    const original = JSON.stringify({ a: null, b: 1 });
    const msg = toolResultMsg(original);
    const discarded: string[] = [];

    const result = compress(
      [msg],
      {
        ...DEFAULT_CONFIG,
        retention: {
          enabled: true,
          min_original_tokens: 1,
          ttl_days: 7,
        },
      },
      {
        retainOriginal: () => "cto_large_marker",
        discardOriginal: (handle) => discarded.push(handle),
      },
    );

    expect(result.messages[0]).toBe(msg);
    expect(result.events[0]!.retention_handle).toBeUndefined();
    expect(discarded).toEqual(["cto_large_marker"]);
  });
});

function getToolResultContent(msg: AnthropicMessage): string {
  const content = msg.content as Array<{ type: string; content: string }>;
  return content[0]!.content;
}
