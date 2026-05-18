import { createHash } from "node:crypto";
import type {
  AnthropicMessagesRequest,
  Breakpoints,
  PrefixState,
  RegionBoundaries,
} from "./types.js";

function canonicalize(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]))
      .join(",") +
    "}"
  );
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function placeBreakpoints(
  request: AnthropicMessagesRequest,
  boundaries: RegionBoundaries,
  prevState: PrefixState | undefined,
): Breakpoints {
  const prefix_hash = sha256Hex(
    canonicalize({ system: request.system, tools: request.tools }),
  );

  let middle_hash: string | null = null;
  if (
    boundaries.middle_end_in_messages !== null &&
    boundaries.middle_end_in_messages > 0
  ) {
    middle_hash = sha256Hex(
      canonicalize(
        request.messages.slice(0, boundaries.middle_end_in_messages),
      ),
    );
  }

  const include_middle_breakpoint =
    middle_hash !== null &&
    prevState !== undefined &&
    prevState.middle_hash === middle_hash;

  return { prefix_hash, middle_hash, include_middle_breakpoint };
}
