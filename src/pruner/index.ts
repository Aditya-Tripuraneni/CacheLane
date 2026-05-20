import type { BlockRow, CachelaneDb } from "../storage/index.js";
import type {
  ExpandStubParams,
  ExpandStubErrorCode,
  ExpandStubResult,
  MaterializableRequest,
  MaterializePrunedBlocksParams,
  PromptBlockPlacement,
  PruneDecision,
  PruneExpiredBlocksParams,
  PruneResult,
  RestoreExpandedBlockParams,
} from "./types.js";

export type {
  ExpandStubParams,
  ExpandStubErrorCode,
  ExpandStubResult,
  MaterializableContentItem,
  MaterializableMessage,
  MaterializableRequest,
  MaterializePrunedBlocksParams,
  PromptBlockPlacement,
  PruneDecision,
  PruneExpiredBlocksParams,
  PruneResult,
  RestoreExpandedBlockParams,
  TrustedRefetchRequest,
} from "./types.js";

function makeStubSummary(row: BlockRow): string {
  const handle = row.refetch_handle ?? "unknown refetch handle";
  return `${row.kind} ${handle} (${row.token_count} tokens elided)`;
}

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

  const decisions: PruneDecision[] = rows.map((row) => {
    const refetchHandle = row.refetch_handle;
    if (refetchHandle === null) {
      throw new Error(`Prunable block ${row.id} is missing refetch_handle`);
    }

    const stubSummary = makeStubSummary(row);
    db.markStub(row.id, refetchHandle, stubSummary, nowMs);

    return {
      block_id: row.id,
      action: "stubbed",
      reason: `unused_turns >= ${params.k}`,
      stub_summary: stubSummary,
      refetch_handle: refetchHandle,
      kind: row.kind,
    };
  });

  return {
    pruned_blocks_count: decisions.length,
    decisions,
  };
}

export function formatStubText(decision: PruneDecision): string {
  const shortId = decision.block_id.slice(0, 8);
  return `[stub:${shortId}] ${decision.stub_summary} | refetch via cachelane:expand(block_id=${shortId})`;
}

function cloneMaterializableRequest<TRequest extends MaterializableRequest>(
  request: TRequest,
): MaterializableRequest {
  return {
    ...request,
    messages: request.messages.map((message) => ({
      ...message,
      content: message.content.map((content) => ({ ...content })),
    })),
  };
}

function placementKey(placement: PromptBlockPlacement): string {
  return `${placement.message_index}:${placement.content_index}`;
}

export function materializePrunedBlocks<
  TRequest extends MaterializableRequest,
>(params: MaterializePrunedBlocksParams<TRequest>): TRequest {
  const out = cloneMaterializableRequest(params.request);
  const placementsByBlockId = new Map<string, PromptBlockPlacement>();
  const seenLocations = new Set<string>();

  for (const placement of params.block_placements) {
    if (placementsByBlockId.has(placement.block_id)) {
      throw new Error(`Duplicate placement for block: ${placement.block_id}`);
    }
    const key = placementKey(placement);
    if (seenLocations.has(key)) {
      throw new Error(`Duplicate placement location: ${key}`);
    }
    placementsByBlockId.set(placement.block_id, placement);
    seenLocations.add(key);
  }

  for (const decision of params.decisions) {
    const placement = placementsByBlockId.get(decision.block_id);
    if (!placement) {
      throw new Error(
        `Pruned block has no placement metadata: ${decision.block_id}`,
      );
    }

    const message = out.messages[placement.message_index];
    if (!message) {
      throw new Error(
        `Invalid message_index for block ${decision.block_id}: ${placement.message_index}`,
      );
    }

    if (!message.content[placement.content_index]) {
      throw new Error(
        `Invalid content_index for block ${decision.block_id}: ${placement.content_index}`,
      );
    }

    message.content[placement.content_index] = {
      type: "text",
      text: formatStubText(decision),
    };
  }

  return out as TRequest;
}

function expandFailure(
  code: ExpandStubErrorCode,
  message: string,
): ExpandStubResult {
  return { ok: false, error: { code, message } };
}

export function expandStub(
  db: CachelaneDb,
  params: ExpandStubParams,
): ExpandStubResult {
  const rows = db.getBlocksByIdPrefix({
    workspace_id: params.workspace_id,
    session_id: params.session_id,
    block_id_prefix: params.block_id,
  });

  if (rows.length === 0) {
    return expandFailure(
      "missing_block",
      `No block found for id prefix: ${params.block_id}`,
    );
  }

  if (rows.length > 1) {
    return expandFailure(
      "ambiguous_prefix",
      `Ambiguous block id prefix: ${params.block_id}`,
    );
  }

  const row = rows[0];
  if (row.is_stub !== 1) {
    return expandFailure("not_stub", `Block is not a stub: ${row.id}`);
  }

  if (row.refetch_handle === null) {
    return expandFailure(
      "missing_refetch_handle",
      `Stub block is missing refetch_handle: ${row.id}`,
    );
  }

  db.restoreStub({
    workspace_id: params.workspace_id,
    session_id: params.session_id,
    block_id: row.id,
    turn_number: params.turn_number,
    updated_at: params.updated_at ?? Date.now(),
  });

  return {
    ok: true,
    block_id: row.id,
    refetch_request: {
      type: "trusted_refetch",
      refetch_handle: row.refetch_handle,
    },
    stub_summary: row.stub_summary,
  };
}

export function markExpandedBlockRestored(
  db: CachelaneDb,
  params: RestoreExpandedBlockParams,
): void {
  db.restoreStub({
    workspace_id: params.workspace_id,
    session_id: params.session_id,
    block_id: params.block_id,
    turn_number: params.turn_number,
    updated_at: params.updated_at ?? Date.now(),
  });
}
