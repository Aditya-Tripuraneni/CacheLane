import type { CachelaneDb } from "../storage/index.js";
import type { PruneDecision, PruneExpiredBlocksParams, PruneResult } from "./types.js";
import { makeStubSummary } from "./stubs.js";

export function pruneExpiredBlocks(
  db: CachelaneDb,
  params: PruneExpiredBlocksParams,
): PruneResult {
  if (params.enabled === false) {
    return { pruned_blocks_count: 0, decisions: [] };
  }

  if (!Number.isInteger(params.k) || params.k < 1) {
    throw new Error(`Invalid pruner K: ${params.k}`);
  }

  const nowMs = params.now_ms ?? Date.now();
  const rows = db.getPrunableBlocks({
    workspace_id: params.workspace_id,
    session_id: params.session_id,
    k: params.k,
  });

  // Build the full decision list first (no DB writes yet)
  const stubItems = rows.map((row) => {
    const refetchHandle = row.refetch_handle;
    if (refetchHandle === null) {
      throw new Error(`Prunable block ${row.id} is missing refetch_handle`);
    }
    return { row, refetchHandle, stubSummary: makeStubSummary(row) };
  });

  // Write all stubs atomically — either all succeed or none are written
  db.markStubs(
    stubItems.map(({ row, refetchHandle, stubSummary }) => ({
      id: row.id,
      workspace_id: params.workspace_id,
      session_id: params.session_id,
      refetchHandle,
      stubSummary,
      updatedAt: nowMs,
    })),
  );

  const decisions: PruneDecision[] = stubItems.map(({ row, refetchHandle, stubSummary }) => ({
    block_id: row.id,
    action: "stubbed" as const,
    reason: `unused_turns >= ${params.k}`,
    stub_summary: stubSummary,
    refetch_handle: refetchHandle,
    kind: row.kind,
  }));

  if (decisions.length > 0) {
    console.info("[cachelane] pruner: stubbed blocks", {
      count: decisions.length,
      kinds: decisions.map((d) => d.kind),
    });
  }

  return {
    pruned_blocks_count: decisions.length,
    decisions,
  };
}
