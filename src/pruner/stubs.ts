import type { BlockRow } from "../storage/index.js";
import type { PruneDecision } from "./types.js";

export function makeStubSummary(row: BlockRow): string {
  const handle = row.refetch_handle ?? "unknown refetch handle";
  return `${row.kind} ${handle} (${row.token_count} tokens elided)`;
}

export function formatStubText(decision: PruneDecision): string {
  const shortId = decision.block_id.slice(0, 8);
  return `[stub:${shortId}] ${decision.stub_summary} | refetch via cachelane_expand(block_id=${shortId})`;
}
