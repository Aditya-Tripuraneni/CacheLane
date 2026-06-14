import { describe, expect, it } from "vitest";
import {
  decodeEventStreamEvents,
  eventStreamToSSE,
  isEventStreamContentType,
} from "../eventstream.js";

/**
 * Build a single AWS event-stream frame wrapping `innerEvent` the way Bedrock
 * does: payload = JSON `{ "bytes": "<base64 of inner event JSON>" }`. CRC fields
 * are present but zeroed — the decoder does not validate them (read-only usage).
 */
function buildFrame(innerEvent: Record<string, unknown>, headers = Buffer.alloc(0)): Buffer {
  const innerJson = Buffer.from(JSON.stringify(innerEvent), "utf-8");
  const payload = Buffer.from(
    JSON.stringify({ bytes: innerJson.toString("base64") }),
    "utf-8",
  );
  const totalLength = 12 + headers.length + payload.length + 4;
  const frame = Buffer.alloc(totalLength);
  frame.writeUInt32BE(totalLength, 0);
  frame.writeUInt32BE(headers.length, 4);
  frame.writeUInt32BE(0, 8); // prelude CRC (not validated)
  headers.copy(frame, 12);
  payload.copy(frame, 12 + headers.length);
  frame.writeUInt32BE(0, totalLength - 4); // message CRC (not validated)
  return frame;
}

describe("eventstream decoder", () => {
  it("decodes a single Bedrock-wrapped frame into the inner event", () => {
    const evt = { type: "message_start", message: { usage: { input_tokens: 123 } } };
    const events = decodeEventStreamEvents(buildFrame(evt));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(evt);
  });

  it("decodes multiple concatenated frames in order", () => {
    const start = { type: "message_start", message: { usage: { input_tokens: 200, cache_read_input_tokens: 150 } } };
    const delta = { type: "message_delta", usage: { output_tokens: 42 } };
    const buf = Buffer.concat([buildFrame(start), buildFrame(delta)]);
    const events = decodeEventStreamEvents(buf);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "message_start" });
    expect(events[1]).toMatchObject({ type: "message_delta" });
  });

  it("reconstructs Anthropic-style SSE text the usage parser understands", () => {
    const start = { type: "message_start", message: { usage: { input_tokens: 10 } } };
    const sse = eventStreamToSSE(buildFrame(start));
    expect(sse).toContain("data: ");
    expect(JSON.parse(sse.slice("data: ".length))).toEqual(start);
  });

  it("stops gracefully on a truncated trailing frame (returns complete frames only)", () => {
    const evt = { type: "message_start", message: {} };
    const full = buildFrame(evt);
    const truncated = Buffer.concat([full, full.subarray(0, 6)]);
    const events = decodeEventStreamEvents(truncated);
    expect(events).toHaveLength(1);
  });

  it("skips frames whose payload is not the expected JSON shape", () => {
    // A frame whose payload is not {bytes:...} and not an object → skipped.
    const payload = Buffer.from("not json", "utf-8");
    const totalLength = 12 + payload.length + 4;
    const frame = Buffer.alloc(totalLength);
    frame.writeUInt32BE(totalLength, 0);
    frame.writeUInt32BE(0, 4);
    payload.copy(frame, 12);
    expect(decodeEventStreamEvents(frame)).toHaveLength(0);
  });

  it("detects the AWS event-stream content type", () => {
    expect(isEventStreamContentType("application/vnd.amazon.eventstream")).toBe(true);
    expect(isEventStreamContentType("text/event-stream")).toBe(false);
    expect(isEventStreamContentType(undefined)).toBe(false);
  });
});
