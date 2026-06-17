import type { CachelaneDb } from "../storage/index.js";
import type { ReportData, ReportOptions, ReportTurn } from "./types.js";

const LONG_SESSION_THRESHOLD_TURNS = 15;

export function buildReportData(db: CachelaneDb, opts: ReportOptions): ReportData {
  const stats = db.getStats({
    scope: opts.scope,
    workspace_id: opts.scope === "all" ? undefined : opts.workspace_id,
    session_id: opts.scope === "session" ? opts.session_id : undefined,
    since_ms: opts.since_ms,
  });

  const explanations = db.getRecentTurnExplanations({
    workspace_id: opts.workspace_id,
    session_id: opts.scope === "session" ? opts.session_id : undefined,
    limit: 500,
  });

  const turns: ReportTurn[] = explanations
    .slice()
    .sort((a, b) => a.turn_number - b.turn_number)
    .map((ex) => {
      const cacheCreation =
        ex.usage.cache_creation_5m_tokens + ex.usage.cache_creation_1h_tokens;
      return {
        turn_number: ex.turn_number,
        model: ex.model,
        input_tokens: ex.usage.input_tokens,
        cache_read_tokens: ex.usage.cache_read_tokens,
        cache_creation_tokens: cacheCreation,
        effective_cost_units: ex.usage.effective_cost_units,
        baseline_cost_units: ex.usage.input_tokens + ex.usage.cache_read_tokens,
        mutated: ex.mutated,
        stable_count: ex.region_metadata.stable_count,
        semi_count: ex.region_metadata.semi_count,
        volatile_count: ex.region_metadata.volatile_count,
        pruned_blocks_count: ex.pruned_blocks_count,
        prune_decisions: ex.prune_decisions.map((d) => ({
          block_id: d.block_id, action: d.action, reason: d.reason, kind: d.kind,
        })),
        signals: ex.signals,
      };
    });

  return {
    generated_at: opts.generated_at,
    scope: opts.scope,
    workspace_id: opts.scope === "all" ? null : opts.workspace_id,
    session_id: opts.scope === "session" ? opts.session_id : null,
    long_session_threshold_turns: LONG_SESSION_THRESHOLD_TURNS,
    stats,
    turns,
    sessions: db.listSessions(opts.scope === "all" ? undefined : opts.workspace_id),
    privacy: { content_persisted: false },
  };
}
