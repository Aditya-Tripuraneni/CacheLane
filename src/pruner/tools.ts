import type { CachelaneDb } from "../storage/index.js";
import type {
  ExpandStubErrorCode,
  ExpandStubParams,
  ExpandStubResult,
  RestoreExpandedBlockParams,
} from "./types.js";

function expandFailure(
  code: ExpandStubErrorCode,
  message: string,
): ExpandStubResult {
  return { ok: false, error: { code, message } };
}

// Full tool-use ids (e.g. toolu_bdrk_017xVeKjasBHLkuCgKUmCRZJ) are matched
// exactly. Bounded length guards against a malformed id reaching the query.
const EXPAND_BLOCK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

// True only if a block can round-trip through expandStub: its id validates and
// getBlock resolves it within the same workspace/session. The pruner uses this
// as a fail-open gate — a block that can't be expanded is never stubbed.
export function isExpandableBlockId(
  db: CachelaneDb,
  workspace_id: string,
  session_id: string,
  block_id: string,
): boolean {
  if (!EXPAND_BLOCK_ID_RE.test(block_id)) {
    return false;
  }
  const row = db.getBlock(block_id);
  return (
    !!row &&
    row.workspace_id === workspace_id &&
    row.session_id === session_id
  );
}

export function expandStub(
  db: CachelaneDb,
  params: ExpandStubParams,
): ExpandStubResult {
  if (!EXPAND_BLOCK_ID_RE.test(params.block_id)) {
    return expandFailure(
      "invalid_block_id",
      "Block id must be a non-empty alphanumeric id (may include _ or -)",
    );
  }

  const row = db.getBlock(params.block_id);

  if (
    !row ||
    row.workspace_id !== params.workspace_id ||
    row.session_id !== params.session_id
  ) {
    return expandFailure(
      "missing_block",
      `No block found for id: ${params.block_id}`,
    );
  }
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
