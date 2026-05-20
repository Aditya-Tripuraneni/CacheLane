import type { PrefixState } from "../types/index.js";

export class CacheStateTracker {
  private readonly states: Map<string, PrefixState> = new Map();

  private key(workspace_id: string, session_id: string): string {
    return `${workspace_id}:${session_id}`;
  }

  get(workspace_id: string, session_id: string): PrefixState | undefined {
    return this.states.get(this.key(workspace_id, session_id));
  }

  update(workspace_id: string, session_id: string, state: PrefixState): void {
    this.states.set(this.key(workspace_id, session_id), state);
  }

  reset(workspace_id: string, session_id: string): void {
    this.states.delete(this.key(workspace_id, session_id));
  }
}
