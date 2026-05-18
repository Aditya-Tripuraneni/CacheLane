import type { PrefixState } from "../types/index.js";

export class CacheStateTracker {
  private readonly states: Map<string, PrefixState> = new Map();

  get(workspace_id: string): PrefixState | undefined {
    return this.states.get(workspace_id);
  }

  update(workspace_id: string, state: PrefixState): void {
    this.states.set(workspace_id, state);
  }

  reset(workspace_id: string): void {
    this.states.delete(workspace_id);
  }
}
