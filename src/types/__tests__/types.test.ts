import { describe, it, expect } from "vitest";
import type {
  Block,
  BlockKind,
  Volatility,
  PrefixState,
  CacheTier,
  ReferenceType,
} from "../index.js";

describe("types", () => {
  it("Volatility union contains exactly STABLE | SEMI | VOLATILE", () => {
    const values: Volatility[] = ["STABLE", "SEMI", "VOLATILE"];
    expect(values).toHaveLength(3);
  });

  it("CacheTier union contains exactly 5m | 1h", () => {
    const values: CacheTier[] = ["5m", "1h"];
    expect(values).toHaveLength(2);
  });

  it("BlockKind union covers all 11 kinds", () => {
    const values: BlockKind[] = [
      "system_prompt",
      "tool_schema",
      "claude_md",
      "project_rules",
      "prior_turn",
      "tool_use_result_pair",
      "file_read",
      "retrieval_result",
      "tool_output",
      "user_message",
      "stub",
    ];
    expect(values).toHaveLength(11);
  });

  it("Block is constructable with all required snake_case fields", () => {
    const block: Block = {
      id: "01HZXQ5K0000000000000001",
      workspace_id: "ws-abc",
      session_id: "sess-1",
      kind: "file_read",
      volatility: "SEMI",
      is_pinned: false,
      content_hash: "a".repeat(64),
      token_count: 1234,
      added_at_turn: 2,
      last_referenced_at_turn: 2,
      unused_turns: 0,
      is_stub: false,
      stub_summary: null,
      refetch_handle: null,
    };
    expect(block.volatility).toBe("SEMI");
    expect(block.refetch_handle).toBeNull();
  });

  it("Block representing a materialised stub", () => {
    const stub: Block = {
      id: "01HZXQ5K0000000000000002",
      workspace_id: "ws-abc",
      session_id: "sess-1",
      kind: "stub",
      volatility: "STABLE", // stubs inherit the replaced block's volatility (M2 passthrough)
      is_pinned: false,
      content_hash: "b".repeat(64),
      token_count: 50,
      added_at_turn: 1,
      last_referenced_at_turn: 1,
      unused_turns: 3,
      is_stub: true,
      stub_summary: "Read auth.py:23-89 (1.2 KB elided)",
      refetch_handle: "view:auth.py:23-89",
    };
    expect(stub.is_stub).toBe(true);
    expect(stub.refetch_handle).toBe("view:auth.py:23-89");
    expect(stub.stub_summary).toContain("auth.py");
  });

  it("PrefixState is constructable with 5m TTL", () => {
    const state: PrefixState = {
      workspace_id: "ws-abc",
      prefix_hash: "c".repeat(64),
      middle_hash: "d".repeat(64),
      prefix_token_count: 8000,
      ttl_class: "5m",
      cached_at_ms: 1715000000000,
      last_read_at_ms: 1715000010000,
      expected_expiry_ms: 1715000300000,
    };
    expect(state.ttl_class).toBe("5m");
  });

  it("PrefixState accepts null middle_hash before the second breakpoint lands", () => {
    const state: PrefixState = {
      workspace_id: "ws-abc",
      prefix_hash: "e".repeat(64),
      middle_hash: null,
      prefix_token_count: 8000,
      ttl_class: "1h",
      cached_at_ms: 1715000000000,
      last_read_at_ms: 1715000010000,
      expected_expiry_ms: 1715003600000,
    };
    expect(state.middle_hash).toBeNull();
    expect(state.ttl_class).toBe("1h");
  });

  it("ReferenceType union covers all 3 reference kinds", () => {
    const values: ReferenceType[] = ["tool_call", "text_quote", "id_mention"];
    expect(values).toHaveLength(3);
  });
});
