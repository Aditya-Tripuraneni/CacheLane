import type { BlockRow } from "../storage/index.js";
import type { PruneDecision } from "./types.js";

export function makeStubSummary(row: BlockRow): string {
  const handle = row.refetch_handle ?? "unknown refetch handle";
  return `${row.kind} ${handle} (${row.token_count} tokens elided)`;
}

export function formatStubText(decision: PruneDecision): string {
  const id = decision.block_id;
  return `[stub:${id}] ${decision.stub_summary} | refetch via cachelane_expand(block_id=${id})`;
}
