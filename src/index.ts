// Public entry points
export { handlePreRequest } from "./hooks/pre-request.js";
export type { PreRequestInput, PreRequestResult } from "./hooks/pre-request.js";
export { handlePostResponse } from "./hooks/post-response.js";
export type { PostResponseInput, PostResponseResult } from "./hooks/post-response.js";

// Setup
export { openDatabase } from "./storage/index.js";
export type { CachelaneDb } from "./storage/index.js";
export { loadConfig } from "./config/index.js";

// Core domain types
export type {
  Block,
  BlockKind,
  Volatility,
  ReferenceType,
  PrefixState,
  CacheTier,
  CachelaneConfig,
} from "./types/index.js";

// Reference detection (used by hook callers to build ReferenceTurn)
export { detectReferences, detectDetailedReferences } from "./references/index.js";
export type {
  ReferenceTurn,
  ReferenceBlock,
  ReferenceToolCall,
  ReferenceResult,
  DetectedReference,
} from "./references/index.js";

// Pruner expand-stub (MCP tool entry point)
export { expandStub, markExpandedBlockRestored } from "./pruner/index.js";
export type {
  ExpandStubParams,
  ExpandStubResult,
  ExpandStubErrorCode,
} from "./pruner/index.js";

// Keepalive worker
export { KeepaliveWorker } from "./keepalive/index.js";
export type {
  KeepaliveWorkerOptions,
  KeepalivePingExecutor,
  KeepalivePingRequest,
  KeepalivePingResult,
  KeepaliveTickResult,
} from "./keepalive/index.js";
