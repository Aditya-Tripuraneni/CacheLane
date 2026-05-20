import { describe, expect, it } from "vitest";
import { CacheStateTracker } from "../cache-state-tracker.js";
import type { PrefixState } from "../types.js";

function makeState(workspace_id: string, suffix: string): PrefixState {
  return {
    workspace_id,
    prefix_hash: `prefix-${suffix}`,
    middle_hash: `middle-${suffix}`,
    prefix_token_count: 100,
    ttl_class: "5m",
    cached_at_ms: 1700000000000,
    last_read_at_ms: 1700000000000,
    expected_expiry_ms: 1700000300000,
  };
}

describe("CacheStateTracker", () => {
  it("get returns undefined for unknown workspace", () => {
    const t = new CacheStateTracker();
    expect(t.get("unknown")).toBeUndefined();
  });

  it("update creates a new entry visible to get", () => {
    const t = new CacheStateTracker();
    const state = makeState("ws-1", "a");
    t.update("ws-1", state);
    expect(t.get("ws-1")).toEqual(state);
  });

  it("update overwrites an existing entry", () => {
    const t = new CacheStateTracker();
    t.update("ws-1", makeState("ws-1", "a"));
    t.update("ws-1", makeState("ws-1", "b"));
    expect(t.get("ws-1")?.prefix_hash).toBe("prefix-b");
  });

  it("isolates entries per workspace", () => {
    const t = new CacheStateTracker();
    t.update("ws-1", makeState("ws-1", "a"));
    t.update("ws-2", makeState("ws-2", "z"));
    expect(t.get("ws-1")?.prefix_hash).toBe("prefix-a");
    expect(t.get("ws-2")?.prefix_hash).toBe("prefix-z");
  });
});
