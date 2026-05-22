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

export { pruneExpiredBlocks } from "./k-pruning.js";
export { materializePrunedBlocks } from "./materialization.js";
export { expandStub, markExpandedBlockRestored } from "./tools.js";
