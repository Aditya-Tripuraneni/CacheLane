import type { Classification, RegionBoundaries } from "./types.js";

// Returns the index after the last contiguous SEMI/STABLE message at the head of messages[].
export function findRegionBoundaries(
  message_classifications: Classification[],
): RegionBoundaries {
  let middle_end: number | null = null;
  for (let i = 0; i < message_classifications.length; i++) {
    const v = message_classifications[i].volatility;
    if (v === "SEMI" || v === "STABLE") {
      middle_end = i + 1;
    } else {
      break;
    }
  }
  return { middle_end_in_messages: middle_end };
}
