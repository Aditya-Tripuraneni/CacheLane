/**
 * Minimal, dependency-free decoder for the AWS event-stream framing
 * (`application/vnd.amazon.eventstream`) that AWS Bedrock's
 * `invoke-with-response-stream` returns.
 *
 * We deliberately do NOT pull in `@smithy/eventstream-codec` — a new runtime dep
 * requires an ADR per CLAUDE.md, and we only need to extract payloads (CRC
 * validation is unnecessary for read-only usage accounting).
 *
 * Frame layout (all integers big-endian):
 *   [0..4)   total length  (prelude + headers + payload + message CRC)
 *   [4..8)   headers length
 *   [8..12)  prelude CRC32
 *   [12..12+H)            headers
 *   [12+H..total-4)       payload
 *   [total-4..total)      message CRC32
 *
 * For Bedrock each payload is JSON of the form `{"bytes":"<base64>"}` where the
 * base64 decodes to the underlying Anthropic event JSON (e.g. `message_start`).
 * Some frames are control/exception frames without a `bytes` field; those are
 * skipped.
 */

const PRELUDE_LENGTH = 12;
const MESSAGE_CRC_LENGTH = 4;

/** Decode raw event-stream bytes into the list of inner Anthropic event objects. */
export function decodeEventStreamEvents(buffer: Buffer): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  let offset = 0;

  while (offset + PRELUDE_LENGTH <= buffer.length) {
    const totalLength = buffer.readUInt32BE(offset);
    const headersLength = buffer.readUInt32BE(offset + 4);

    // Guard against malformed/truncated frames — stop rather than throw so a
    // partial stream still yields whatever complete frames we parsed.
    if (totalLength < PRELUDE_LENGTH + MESSAGE_CRC_LENGTH) break;
    if (offset + totalLength > buffer.length) break;

    const payloadStart = offset + PRELUDE_LENGTH + headersLength;
    const payloadEnd = offset + totalLength - MESSAGE_CRC_LENGTH;
    if (payloadStart <= payloadEnd && payloadEnd <= buffer.length) {
      const payload = buffer.subarray(payloadStart, payloadEnd);
      const inner = extractInnerEvent(payload);
      if (inner !== null) events.push(inner);
    }

    offset += totalLength;
  }

  return events;
}

function extractInnerEvent(payload: Buffer): Record<string, unknown> | null {
  let outer: unknown;
  try {
    outer = JSON.parse(payload.toString("utf-8"));
  } catch {
    return null;
  }
  if (typeof outer !== "object" || outer === null) return null;

  // Bedrock wraps the real event in `{ "bytes": "<base64>" }`.
  const bytesField = (outer as { bytes?: unknown }).bytes;
  if (typeof bytesField === "string") {
    try {
      const decoded = Buffer.from(bytesField, "base64").toString("utf-8");
      const inner = JSON.parse(decoded);
      return typeof inner === "object" && inner !== null
        ? (inner as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  // Some deployments may emit the event JSON directly in the payload.
  return outer as Record<string, unknown>;
}

/**
 * Convert AWS event-stream bytes into Anthropic-style SSE text (`data: {json}\n`)
 * so it can be fed to the existing SSE usage parser unchanged.
 */
export function eventStreamToSSE(buffer: Buffer): string {
  return decodeEventStreamEvents(buffer)
    .map((evt) => `data: ${JSON.stringify(evt)}`)
    .join("\n");
}

/** Heuristic: does this look like AWS event-stream framing rather than text SSE? */
export function isEventStreamContentType(contentType: string | undefined): boolean {
  return typeof contentType === "string" &&
    contentType.toLowerCase().includes("application/vnd.amazon.eventstream");
}
