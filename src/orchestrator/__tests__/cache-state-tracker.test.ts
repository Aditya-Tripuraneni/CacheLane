import { describe, expect, it } from "vitest";
import { CacheStateTracker } from "../cache-state-tracker.js";
import type { PrefixState } from "../types.js";
import type { CachelaneDb } from "../../storage/index.js";

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
  it("get returns undefined for unknown workspace+session", () => {
    const t = new CacheStateTracker();
    expect(t.get("unknown", "s-1")).toBeUndefined();
  });

  it("update creates a new entry visible to get", () => {
    const t = new CacheStateTracker();
    const state = makeState("ws-1", "a");
    t.update("ws-1", "s-1", state);
    expect(t.get("ws-1", "s-1")).toEqual(state);
  });

  it("update overwrites an existing entry for the same session", () => {
    const t = new CacheStateTracker();
    t.update("ws-1", "s-1", makeState("ws-1", "a"));
    t.update("ws-1", "s-1", makeState("ws-1", "b"));
    expect(t.get("ws-1", "s-1")?.prefix_hash).toBe("prefix-b");
  });

  it("isolates entries per workspace", () => {
    const t = new CacheStateTracker();
    t.update("ws-1", "s-1", makeState("ws-1", "a"));
    t.update("ws-2", "s-1", makeState("ws-2", "z"));
    expect(t.get("ws-1", "s-1")?.prefix_hash).toBe("prefix-a");
    expect(t.get("ws-2", "s-1")?.prefix_hash).toBe("prefix-z");
  });

  it("isolates entries per session within the same workspace", () => {
    // Two concurrent sessions in ws-1 must never read each other's state.
    // If they shared a slot, session s-2 writing a different middle_hash
    // would cause s-1 to see a false match or miss on its next turn.
    const t = new CacheStateTracker();
    t.update("ws-1", "s-1", makeState("ws-1", "a"));
    t.update("ws-1", "s-2", makeState("ws-1", "z"));
    expect(t.get("ws-1", "s-1")?.prefix_hash).toBe("prefix-a");
    expect(t.get("ws-1", "s-2")?.prefix_hash).toBe("prefix-z");
    // s-2 write must not have clobbered s-1
    expect(t.get("ws-1", "s-1")?.middle_hash).toBe("middle-a");
  });

  it("returns active entries for keepalive iteration", () => {
    const t = new CacheStateTracker();
    t.update("ws-1", "s-1", makeState("ws-1", "a"));
    t.update("ws-2", "s-2", makeState("ws-2", "b"));

    expect(t.entries()).toEqual([
      { workspace_id: "ws-1", session_id: "s-1", state: makeState("ws-1", "a") },
      { workspace_id: "ws-2", session_id: "s-2", state: makeState("ws-2", "b") },
    ]);
  });

  it("loads state from DB recent turns", () => {
    const mockDb = {
      listSessions: () => [
        { workspace_id: "ws-1", session_id: "s-1" },
        { workspace_id: "ws-2", session_id: "s-2" },
      ],
      getRecentTurn: ({ session_id }: { session_id: string }) => {
        if (session_id === "s-1") {
          return {
            prefix_breakpoint_hash: "prefix-a",
            middle_breakpoint_hash: "middle-a",
            cache_creation_1h_tokens: 100,
            cache_creation_5m_tokens: 0,
            cache_read_tokens: 50,
            created_at: 1700000000000,
          };
        }
        return null;
      },
    };

    const t = new CacheStateTracker();
    t.fromDb(mockDb as unknown as CachelaneDb);

    expect(t.get("ws-1", "s-1")).toMatchObject({
      prefix_hash: "prefix-a",
      middle_hash: "middle-a",
      prefix_token_count: 150,
      ttl_class: "1h",
      expected_expiry_ms: 1700000000000 + 3600000,
    });
    expect(t.get("ws-2", "s-2")).toBeUndefined();
  });
});
