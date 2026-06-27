import { describe, it, expect } from "vitest";
import { openaiChatAdapter as o, openaiCachedDiscount } from "../openai-chat.js";

describe("openaiCachedDiscount", () => {
  // Sourced from OpenAI per-model pricing (developers.openai.com), 2026-06:
  // gpt-4o $2.50→$1.25 (0.5x), gpt-4.1 $2.00→$0.50 (0.25x), gpt-5+ →0.1x.
  it.each([
    ["gpt-4o", 0.5],
    ["gpt-4o-mini", 0.5],
    ["gpt-4.1", 0.25],
    ["gpt-4.1-mini", 0.25],
    ["gpt-5", 0.1],
    ["gpt-5.1", 0.1],
    ["gpt-5.5", 0.1],
  ])("maps %s → %dx cached-input discount", (model, factor) => {
    expect(openaiCachedDiscount(model)).toBe(factor);
  });

  it("defaults unknown/empty models to the weakest discount (0.5x) so savings are never overstated", () => {
    expect(openaiCachedDiscount("gpt-4-turbo")).toBe(0.5);
    expect(openaiCachedDiscount("")).toBe(0.5);
  });
});

describe("openaiChatAdapter", () => {
  // effectiveUnits = (input - cacheRead) + cacheRead * per-model-discount.
  // Same usage, different model → different cost because the discount is per-model.
  const usage = {
    input: 2000,
    output: 500,
    cacheRead: 1408,
    cacheWrite: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
  };
  it.each([
    ["gpt-4o", 2000 - 1408 + 1408 * 0.5],
    ["gpt-4.1", 2000 - 1408 + 1408 * 0.25],
    ["gpt-5", 2000 - 1408 + 1408 * 0.1],
  ])("costModel.effectiveUnits applies the %s per-model discount", (model, expected) => {
    expect(o.costModel.effectiveUnits(usage, model)).toBeCloseTo(expected, 6);
  });

  it("costModel.effectiveUnits falls back to the 0.5x default when model is omitted", () => {
    expect(o.costModel.effectiveUnits(usage)).toBe(2000 - 1408 + 1408 * 0.5);
  });

  it("matches POST /v1/chat/completions and rejects /v1/messages", () => {
    expect(o.matchRoute("POST", "/v1/chat/completions")).toBe(true);
    expect(o.matchRoute("POST", "/v1/chat/completions?foo=bar")).toBe(true);
    expect(o.matchRoute("GET", "/v1/chat/completions")).toBe(false);
    expect(o.matchRoute("POST", "/v1/messages")).toBe(false);
  });

  it("parses cached_tokens from non-streaming chat usage", () => {
    const body = Buffer.from(
      JSON.stringify({
        usage: {
          prompt_tokens: 2000,
          completion_tokens: 500,
          prompt_tokens_details: { cached_tokens: 1408 },
        },
      }),
    );
    const u = o.parseUsage(body, "application/json");
    expect(u).toEqual({
      input: 2000,
      output: 500,
      cacheRead: 1408,
      cacheWrite: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    });
  });

  it("parses usage from the final streaming chunk when include_usage is set", () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      'data: {"choices":[{"delta":{}}],"usage":null}',
      'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":64}}}',
      "data: [DONE]",
      "",
    ].join("\n");
    const u = o.parseUsage(Buffer.from(sse), "text/event-stream");
    expect(u).toEqual({
      input: 100,
      output: 20,
      cacheRead: 64,
      cacheWrite: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    });
  });

  it("applyCacheHints sets prompt_cache_key, NO retention, NO cache_control", () => {
    const n = {
      model: "gpt-4o",
      system: [],
      tools: [],
      messages: [{ role: "user" as const, content: "hi" }],
      raw: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    };
    const out = o.applyCacheHints(n, { prefix_hash: "abc123", middle_hash: null });
    const raw = out.raw as Record<string, unknown>;
    expect(raw.prompt_cache_key).toBe("cachelane-abc123");
    expect(raw.prompt_cache_retention).toBeUndefined();
    expect(JSON.stringify(raw)).not.toContain("cache_control");
  });

  it("truncates prompt_cache_key to 64 chars", () => {
    const n = {
      model: "gpt-4o",
      system: [],
      tools: [],
      messages: [{ role: "user" as const, content: "hi" }],
      raw: { model: "gpt-4o", messages: [] },
    };
    const longHash = "a".repeat(128);
    const out = o.applyCacheHints(n, { prefix_hash: longHash, middle_hash: null });
    const raw = out.raw as Record<string, unknown>;
    expect((raw.prompt_cache_key as string).length).toBe(64);
    expect(raw.prompt_cache_key).toBe(`cachelane-${longHash}`.slice(0, 64));
  });

  it("supportsKeepalive is false", () => {
    expect(o.cachePolicy.supportsKeepalive).toBe(false);
  });

  it("deterministically serializes tools[].function regardless of key order", () => {
    const toolsA = [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string", description: "city" },
              unit: { type: "string", enum: ["c", "f"] },
            },
            required: ["location"],
          },
        },
      },
    ];
    // Same logical tool, keys in different order at every level.
    const toolsB = [
      {
        function: {
          parameters: {
            required: ["location"],
            properties: {
              unit: { enum: ["c", "f"], type: "string" },
              location: { description: "city", type: "string" },
            },
            type: "object",
          },
          description: "Get weather",
          name: "get_weather",
        },
        type: "function",
      },
    ];
    const mk = (tools: unknown) => ({
      model: "gpt-4o",
      system: [],
      tools: [],
      messages: [{ role: "user" as const, content: "hi" }],
      raw: { model: "gpt-4o", tools, messages: [] },
    });
    const outA = o.applyCacheHints(mk(toolsA), { prefix_hash: "h", middle_hash: null });
    const outB = o.applyCacheHints(mk(toolsB), { prefix_hash: "h", middle_hash: null });
    const toolsOutA = (outA.raw as Record<string, unknown>).tools;
    const toolsOutB = (outB.raw as Record<string, unknown>).tools;
    expect(JSON.stringify(toolsOutA)).toBe(JSON.stringify(toolsOutB));
  });

  it("normalizeRequest splits system messages and maps tools", () => {
    const body = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "you are helpful" },
        { role: "user", content: "hi" },
      ],
      tools: [{ type: "function", function: { name: "f", parameters: { type: "object" } } }],
    };
    const n = o.normalizeRequest(body);
    expect(n.model).toBe("gpt-4o");
    expect(n.system).toEqual([{ text: "you are helpful" }]);
    expect(n.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(n.tools).toEqual([{ name: "f", schema: { type: "object" } }]);
  });
});
