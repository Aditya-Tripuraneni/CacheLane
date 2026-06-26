import { describe, it, expect } from "vitest";
import { anthropicMessagesAdapter as a } from "../anthropic-messages.js";

describe("anthropicMessagesAdapter", () => {
  it("matches /v1/messages and Bedrock /model/*", () => {
    expect(a.matchRoute("POST", "/v1/messages")).toBe(true);
    expect(a.matchRoute("POST", "/model/claude/invoke")).toBe(true);
    expect(a.matchRoute("GET", "/v1/messages")).toBe(false);
  });

  it("parses Anthropic SSE usage into NeutralUsage", () => {
    const sse = Buffer.from(
      'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":40,"cache_creation_input_tokens":10}}}\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":7}}\n'
    );
    const u = a.parseUsage(sse, "text/event-stream");
    expect(u).toEqual({ input: 100, output: 7, cacheRead: 40, cacheWrite: 10, cacheWrite5m: 10, cacheWrite1h: 0 });
  });

  it("preserves the 5m/1h cache-write tier split", () => {
    const sse = Buffer.from(
      'data: {"type":"message_start","message":{"usage":{"input_tokens":200,"cache_creation_5m_tokens":30,"cache_creation_1h_tokens":100}}}\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":5}}\n'
    );
    const u = a.parseUsage(sse, "text/event-stream");
    expect(u).toEqual({ input: 200, output: 5, cacheRead: 0, cacheWrite: 130, cacheWrite5m: 30, cacheWrite1h: 100 });
    // cost: 200*1.0 + 30*1.25 + 100*2.0 = 437.5
    expect(a.costModel.effectiveUnits(u!)).toBe(437.5);
  });
});
