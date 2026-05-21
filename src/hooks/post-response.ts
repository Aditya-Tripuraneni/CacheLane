import {
  calculateEffectiveCostUnits,
  type CachelaneDb,
} from "../storage/index.js";
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
  usage?: AnthropicUsageFields;
  now_ms?: number;
}

export interface PostResponseResult {
  referenced_ids: Set<string>;
  signals: string[];
}

export interface AnthropicUsageFields {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  ephemeral_5m_input_tokens?: number;
  ephemeral_1h_input_tokens?: number;
  cache_creation_5m_tokens?: number;
  cache_creation_1h_tokens?: number;
  cache_read_tokens?: number;
}

function usageNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function recordUsage(input: PostResponseInput, now: number): void {
  if (input.usage === undefined) return;

  const inputTokens = usageNumber(input.usage.input_tokens);
  const outputTokens = usageNumber(input.usage.output_tokens);
  const cacheCreation5m = usageNumber(
    input.usage.ephemeral_5m_input_tokens ??
      input.usage.cache_creation_5m_tokens ??
      input.usage.cache_creation_input_tokens,
  );
  const cacheCreation1h = usageNumber(
    input.usage.ephemeral_1h_input_tokens ??
      input.usage.cache_creation_1h_tokens,
  );
  const cacheRead = usageNumber(
    input.usage.cache_read_input_tokens ?? input.usage.cache_read_tokens,
  );
  const effectiveCostUnits = calculateEffectiveCostUnits({
    input_tokens: inputTokens,
    cache_creation_5m_tokens: cacheCreation5m,
    cache_creation_1h_tokens: cacheCreation1h,
    cache_read_tokens: cacheRead,
  });

  input.db.updateTurnUsage({
    turn_id: input.turn_id,
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    turn_number: input.turn_number,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_5m_tokens: cacheCreation5m,
    cache_creation_1h_tokens: cacheCreation1h,
    cache_read_tokens: cacheRead,
    effective_cost_units: effectiveCostUnits,
    updated_at: now,
  });
}

export function handlePostResponse(input: PostResponseInput): PostResponseResult {
  const now = input.now_ms ?? Date.now();
  try {
    recordUsage(input, now);
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
    console.error("[cachelane] post-response reference detection error", err);
    try {
      input.db.updateBlockCounters({
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        turn_number: input.turn_number,
        referenced_ids: new Set(),
        updated_at: now,
      });
    } catch (storageErr) {
      console.error("[cachelane] post-response counter update error", storageErr);
    }
    return { referenced_ids: new Set(), signals: ["error:fallback"] };
  }
}
