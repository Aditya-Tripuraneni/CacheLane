import type { CachelaneDb } from "../storage/index.js";
import {
  detectDetailedReferences,
  type ReferenceTurn,
} from "../references/index.js";

export interface PostResponseInput {
  db: CachelaneDb;
  workspace_id: string;
  session_id: string;
  turn_id: string;
  turn_number: number;
  turn: ReferenceTurn;
  now_ms?: number;
}

export interface PostResponseResult {
  referenced_ids: Set<string>;
  signals: string[];
}

export function handlePostResponse(input: PostResponseInput): PostResponseResult {
  const now = input.now_ms ?? Date.now();
  try {
    const references = detectDetailedReferences(input.turn);
    const referenced_ids = new Set(references.map((ref) => ref.block_id));

    input.db.insertBlockReferences(
      references.map((ref) => ({
        block_id: ref.block_id,
        turn_id: input.turn_id,
        reference_type: ref.reference_type,
        evidence: ref.evidence,
        created_at: now,
      })),
    );
    input.db.updateBlockCounters({
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      turn_number: input.turn_number,
      referenced_ids,
      updated_at: now,
    });

    return { referenced_ids, signals: ["ok"] };
  } catch (err) {
    console.error(
      "[cachelane] post-response: reference detection error — failing open",
      err instanceof Error ? err.message : String(err),
    );
    return { referenced_ids: new Set(), signals: ["error:fallback"] };
  }
}
