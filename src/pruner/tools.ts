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

const EXPAND_BLOCK_ID_PREFIX_RE = /^[A-Za-z0-9]{8}$/;

export function expandStub(
  db: CachelaneDb,
  params: ExpandStubParams,
): ExpandStubResult {
  if (!EXPAND_BLOCK_ID_PREFIX_RE.test(params.block_id)) {
    return expandFailure(
      "invalid_block_id",
      "Block id must be an 8-character alphanumeric prefix",
    );
  }

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
  if (!row) {
    return expandFailure("missing_block", `No block found for id prefix: ${params.block_id}`);
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
