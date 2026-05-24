import type { PrefixState } from "../types/index.js";
import type { CachelaneDb } from "../storage/index.js";

export interface CacheStateEntry {
  workspace_id: string;
  session_id: string;
  state: PrefixState;
}

export class CacheStateTracker {
  private readonly states: Map<string, CacheStateEntry> = new Map();

  private key(workspace_id: string, session_id: string): string {
    return `${workspace_id}:${session_id}`;
  }

  get(workspace_id: string, session_id: string): PrefixState | undefined {
    return this.states.get(this.key(workspace_id, session_id))?.state;
  }

  update(workspace_id: string, session_id: string, state: PrefixState): void {
    this.states.set(this.key(workspace_id, session_id), {
      workspace_id,
      session_id,
      state,
    });
  }

  reset(workspace_id: string, session_id: string): void {
    this.states.delete(this.key(workspace_id, session_id));
  }

  entries(): CacheStateEntry[] {
    return Array.from(this.states.values());
  }

  fromDb(db: CachelaneDb): void {
    const sessions = db.listSessions();
    for (const session of sessions) {
      const turn = db.getRecentTurn({ workspace_id: session.workspace_id, session_id: session.session_id });
      if (!turn || !turn.prefix_breakpoint_hash) continue;

      const ttlClass = turn.cache_creation_1h_tokens > 0 ? "1h" : "5m";
      const tokenCount = turn.cache_creation_5m_tokens + turn.cache_creation_1h_tokens + turn.cache_read_tokens;
      
      this.update(session.workspace_id, session.session_id, {
        workspace_id: session.workspace_id,
        prefix_hash: turn.prefix_breakpoint_hash,
        middle_hash: turn.middle_breakpoint_hash,
        prefix_token_count: tokenCount,
        ttl_class: ttlClass,
        cached_at_ms: turn.created_at,
        last_read_at_ms: turn.created_at,
        expected_expiry_ms: turn.created_at + (ttlClass === "1h" ? 60 * 60 * 1000 : 5 * 60 * 1000),
      });
    }
  }
}
