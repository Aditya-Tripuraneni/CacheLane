import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type CachelaneDb } from "../../storage/index.js";
import { formatStubText } from "../stubs.js";
import {
  expandStub,
  markExpandedBlockRestored,
  materializePrunedBlocks,
  pruneExpiredBlocks,
} from "../index.js";
import type { MaterializableRequest, PruneDecision } from "../types.js";

let tmpDir: string;
let db: CachelaneDb;

function insertBlock(
  id: string,
  overrides: Partial<Parameters<typeof db.insertBlock>[0]> = {},
): void {
  const now = 1_715_000_000_000;
  db.insertBlock({
    id,
    workspace_id: "ws-1",
    session_id: "sess-1",
    content_hash: id.padEnd(64, "0").slice(0, 64),
    kind: "tool_output",
    volatility: "VOLATILE",
    is_pinned: false,
    token_count: 250,
    added_at_turn: 1,
    last_referenced_at_turn: 1,
    unused_turns: 0,
    is_stub: false,
    stub_summary: null,
    refetch_handle: "tool:read:src/auth.ts",
    restored_at_turn: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-pruner-"));
  db = openDatabase(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("pruneExpiredBlocks", () => {
  it("six-turn synthetic session: K=3 stubs the turn-1 block at turn 4", () => {
    const id = "01KPRUNE0000000000000001";
    insertBlock(id);

    db.updateBlockCounters({
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 2,
      referenced_ids: new Set(),
      updated_at: 1_715_000_001_000,
    });
    db.updateBlockCounters({
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 3,
      referenced_ids: new Set(),
      updated_at: 1_715_000_002_000,
    });
    db.updateBlockCounters({
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 4,
      referenced_ids: new Set(),
      updated_at: 1_715_000_003_000,
    });

    const result = pruneExpiredBlocks(db, {
      workspace_id: "ws-1",
      session_id: "sess-1",
      k: 3,
      now_ms: 1_715_000_004_000,
    });

    expect(result.pruned_blocks_count).toBe(1);
    expect(db.getBlock(id)?.is_stub).toBe(1);
    expect(db.getBlock(id)?.stub_summary).toContain("tool_output");
  });

  it("skips pinned, STABLE, already-stubbed, and non-refetchable blocks", () => {
    insertBlock("01KPRUNE0000000000000002", {
      unused_turns: 3,
      is_pinned: true,
    });
    insertBlock("01KPRUNE0000000000000003", {
      unused_turns: 3,
      volatility: "STABLE",
    });
    insertBlock("01KPRUNE0000000000000004", {
      unused_turns: 3,
      is_stub: true,
      stub_summary: "already stubbed",
    });
    insertBlock("01KPRUNE0000000000000005", {
      unused_turns: 3,
      refetch_handle: null,
    });

    const result = pruneExpiredBlocks(db, {
      workspace_id: "ws-1",
      session_id: "sess-1",
      k: 3,
      now_ms: 1_715_000_004_000,
    });

    expect(result.pruned_blocks_count).toBe(0);
    expect(result.decisions).toHaveLength(0);
  });

  it("does nothing when disabled", () => {
    insertBlock("01KPRUNE0000000000000006", { unused_turns: 3 });

    const result = pruneExpiredBlocks(db, {
      workspace_id: "ws-1",
      session_id: "sess-1",
      k: 3,
      enabled: false,
      now_ms: 1_715_000_004_000,
    });

    expect(result.pruned_blocks_count).toBe(0);
    expect(db.getBlock("01KPRUNE0000000000000006")?.is_stub).toBe(0);
  });

  it("emits deterministic stub text with only id, summary, and expansion instruction", () => {
    const decision: PruneDecision = {
      block_id: "01KPRUNE0000000000000007",
      action: "stubbed",
      reason: "unused_turns >= 3",
      stub_summary: "tool_output tool:read:src/auth.ts (250 tokens elided)",
      refetch_handle: "tool:read:src/auth.ts",
      kind: "tool_output",
    };

    expect(formatStubText(decision)).toBe(
      "[stub:01KPRUNE] tool_output tool:read:src/auth.ts (250 tokens elided) | refetch via cachelane:expand(block_id=01KPRUNE)",
    );
  });
});

describe("materializePrunedBlocks", () => {
  it("preserves sequence and replaces only the mapped content item", () => {
    const request: MaterializableRequest = {
      model: "claude-opus-4-7",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "keep-0" },
            { type: "text", text: "raw secret content" },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "keep-1" }],
        },
      ],
    };

    const out = materializePrunedBlocks({
      request,
      decisions: [
        {
          block_id: "01KMATRL000000000000001",
          action: "stubbed",
          reason: "unused_turns >= 3",
          stub_summary: "tool_output tool:read:src/auth.ts (250 tokens elided)",
          refetch_handle: "tool:read:src/auth.ts",
          kind: "tool_output",
        },
      ],
      block_placements: [
        {
          block_id: "01KMATRL000000000000001",
          message_index: 0,
          content_index: 1,
          kind: "tool_output",
          volatility: "VOLATILE",
          is_pinned: false,
          refetch_handle: "tool:read:src/auth.ts",
        },
      ],
    });

    expect(out.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(out.messages[0]?.content[0]).toEqual({ type: "text", text: "keep-0" });
    expect(out.messages[0]?.content[1]).toEqual({
      type: "text",
      text: "[stub:01KMATRL] tool_output tool:read:src/auth.ts (250 tokens elided) | refetch via cachelane:expand(block_id=01KMATRL)",
    });
    expect(out.messages[1]?.content[0]).toEqual({ type: "text", text: "keep-1" });
    expect(request.messages[0]?.content[1]).toEqual({
      type: "text",
      text: "raw secret content",
    });
  });

  it("requires explicit placement metadata for pruned decisions", () => {
    expect(() =>
      materializePrunedBlocks({
        request: {
          messages: [{ content: [{ type: "text", text: "raw" }] }],
        },
        decisions: [
          {
            block_id: "01KMISSING0000000000001",
            action: "stubbed",
            reason: "unused_turns >= 3",
            stub_summary: "summary",
            refetch_handle: "handle",
            kind: "tool_output",
          },
        ],
        block_placements: [],
      }),
    ).toThrow(/no placement metadata/);
  });
});

describe("expandStub", () => {
  it("accepts an 8-character block prefix and returns the trusted refetch request", () => {
    insertBlock("01KEXPAND000000000000001", {
      is_stub: true,
      unused_turns: 3,
      stub_summary: "Read src/auth.ts (250 tokens elided)",
      refetch_handle: "tool:read:src/auth.ts",
    });

    const result = expandStub(db, {
      workspace_id: "ws-1",
      session_id: "sess-1",
      block_id: "01KEXPAN",
      turn_number: 6,
      updated_at: 1_715_000_006_000,
    });

    expect(result).toEqual({
      ok: true,
      block_id: "01KEXPAND000000000000001",
      refetch_request: {
        type: "trusted_refetch",
        refetch_handle: "tool:read:src/auth.ts",
      },
      stub_summary: "Read src/auth.ts (250 tokens elided)",
    });
    expect(db.getBlock("01KEXPAND000000000000001")?.is_stub).toBe(0);
    expect(db.getBlock("01KEXPAND000000000000001")?.restored_at_turn).toBe(6);
  });

  it("fails deterministically for ambiguous prefixes", () => {
    insertBlock("01KAMBIG000000000000001", {
      is_stub: true,
      stub_summary: "one",
    });
    insertBlock("01KAMBIG000000000000002", {
      is_stub: true,
      stub_summary: "two",
    });

    const result = expandStub(db, {
      workspace_id: "ws-1",
      session_id: "sess-1",
      block_id: "01KAMBIG",
      turn_number: 6,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ambiguous_prefix");
    }
  });

  it("fails deterministically for missing blocks", () => {
    const result = expandStub(db, {
      workspace_id: "ws-1",
      session_id: "sess-1",
      block_id: "01KMISSI",
      turn_number: 6,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("missing_block");
    }
  });

  it("rejects wildcard-containing prefixes before querying storage", () => {
    insertBlock("01KWILD1000000000000001", {
      is_stub: true,
      unused_turns: 3,
      stub_summary: "Read src/auth.ts (250 tokens elided)",
    });

    const result = expandStub(db, {
      workspace_id: "ws-1",
      session_id: "sess-1",
      block_id: "01K%WILD",
      turn_number: 6,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_block_id");
    }
    expect(db.getBlock("01KWILD1000000000000001")?.is_stub).toBe(1);
  });

  it("fails deterministically for non-stub blocks", () => {
    insertBlock("01KNOSTB000000000000001", {
      is_stub: false,
    });

    const result = expandStub(db, {
      workspace_id: "ws-1",
      session_id: "sess-1",
      block_id: "01KNOSTB",
      turn_number: 6,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_stub");
    }
  });

  it("fails deterministically when a stub has no refetch handle", () => {
    insertBlock("01KNOHND000000000000001", {
      is_stub: true,
      refetch_handle: null,
      stub_summary: "missing handle",
    });

    const result = expandStub(db, {
      workspace_id: "ws-1",
      session_id: "sess-1",
      block_id: "01KNOHND",
      turn_number: 6,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("missing_refetch_handle");
    }
  });

  it("restores a refetched stub to active with unused_turns reset to 0", () => {
    insertBlock("01KEXPAND000000000000002", {
      is_stub: true,
      unused_turns: 3,
      stub_summary: "Read src/auth.ts (250 tokens elided)",
      refetch_handle: "tool:read:src/auth.ts",
    });

    markExpandedBlockRestored(db, {
      workspace_id: "ws-1",
      session_id: "sess-1",
      block_id: "01KEXPAND000000000000002",
      turn_number: 6,
      updated_at: 1_715_000_006_000,
    });

    const block = db.getBlock("01KEXPAND000000000000002");
    expect(block?.is_stub).toBe(0);
    expect(block?.unused_turns).toBe(0);
    expect(block?.last_referenced_at_turn).toBe(6);
    expect(block?.restored_at_turn).toBe(6);
  });
});
