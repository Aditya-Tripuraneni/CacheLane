import type { Classification, RegionBoundaries } from "./types.js";

// Messages keep their chronological order — Anthropic API requires it.
// The "middle" region is the contiguous run of SEMI/STABLE classified
// messages at the head of messages[]. The first VOLATILE message ends the
// middle; everything from that index onward is the suffix.
//
// We read `c.volatility` and ignore the rest of the Classification for now.
// M5's K-pruner will additionally consult `c.isPinned` and `c.kind` for the
// stub-materialisation decision; M3 keeps the contract narrow.
export function reorder(
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
