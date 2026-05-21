import type { CachelaneDb } from "../storage/index.js";
import {
  expandStub,
  type ExpandStubParams,
  type ExpandStubResult,
} from "../pruner/index.js";

export type { ExpandStubParams, ExpandStubResult } from "../pruner/index.js";

export function expandCachedStub(
  db: CachelaneDb,
  params: ExpandStubParams,
): ExpandStubResult {
  return expandStub(db, params);
}
