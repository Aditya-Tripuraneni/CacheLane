import { describe, it, expect } from "vitest";
import type {
  Block,
  BlockKind,
  Volatility,
  PrefixState,
  TtlClass,
  ReferenceType,
} from "../index.js";

describe("types", () => {
  it("Volatility union contains exactly STABLE | SEMI | VOLATILE", () => {
    const values: Volatility[] = ["STABLE", "SEMI", "VOLATILE"];
    expect(values).toHaveLength(3);
  });

  it("TtlClass union contains exactly short | long", () => {
    const values: TtlClass[] = ["short", "long"];
    expect(values).toHaveLength(2);
  });

  it("BlockKind union covers all 9 kinds", () => {
    const values: BlockKind[] = [
      "system_prompt",
      "tool_schema",
      "project_rule",
      "prior_turn",
      "file_read",
      "tool_output",
      "retrieval",
      "user_message",
      "stub",
    ];
    expect(values).toHaveLength(9);
  });

  it("Block is constructable with required fields only", () => {
    const block: Block = {
      id: "01HZXQ5K0000000000000001",
      kind: "file_read",
      volatility: "SEMI",
      tokenCount: 1234,
      contentHash: "a".repeat(64),
      unusedTurns: 0,
      isStub: false,
    };
    expect(block.volatility).toBe("SEMI");
    expect(block.refetchHandle).toBeUndefined();
  });

  it("Block with optional refetchHandle is constructable", () => {
    const stub: Block = {
      id: "01HZXQ5K0000000000000002",
      kind: "stub",
      volatility: "VOLATILE",
      tokenCount: 50,
      contentHash: "b".repeat(64),
      unusedTurns: 3,
      isStub: true,
      refetchHandle: "view:auth.py:23-89",
    };
    expect(stub.refetchHandle).toBe("view:auth.py:23-89");
  });

  it("PrefixState is constructable", () => {
    const state: PrefixState = {
      workspaceId: "ws-abc",
      prefixHash: "c".repeat(64),
      middleHash: "d".repeat(64),
      prefixTokenCount: 8000,
      ttlClass: "short",
      cachedAtMs: 1715000000000,
      lastReadAtMs: 1715000010000,
      expectedExpiryMs: 1715000300000,
    };
    expect(state.ttlClass).toBe("short");
  });

  it("ReferenceType union covers all 3 reference kinds", () => {
    const values: ReferenceType[] = ["tool_call", "text_quote", "id_mention"];
    expect(values).toHaveLength(3);
  });
});
