import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Classification } from "../../classifier/index.js";
import { CacheStateTracker } from "../../orchestrator/index.js";
import type { AnthropicMessagesRequest } from "../../orchestrator/index.js";
import { openDatabase, type CachelaneDb } from "../../storage/index.js";
import type { Volatility } from "../../types/index.js";
import type { PromptBlockPlacement } from "../../pruner/index.js";
import { handlePreRequest } from "../pre-request.js";

let tmpDir: string;
let db: CachelaneDb;

function cl(volatility: Volatility): Classification {
  return {
    kind: "tool_output",
    volatility,
    isPinned: false,
    signals: ["tool_output"],
  };
}

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

function baseRequest(text = "raw block content"): AnthropicMessagesRequest {
  return {
    model: "claude-opus-4-7",
    system: [{ type: "text", text: "You are Claude." }],
    tools: [{ name: "Read", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: [{ type: "text", text }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ],
    max_tokens: 1024,
  };
}

function placement(block_id: string): PromptBlockPlacement {
  return {
    block_id,
    message_index: 0,
    content_index: 0,
    kind: "tool_output",
    volatility: "VOLATILE",
    is_pinned: false,
    refetch_handle: "tool:read:src/auth.ts",
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-pre-request-"));
  db = openDatabase(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handlePreRequest", () => {
  it("runs classification input through pruner materialization before orchestration", () => {
    const blockId = "01KPREQ1000000000000001";
    insertBlock(blockId, { unused_turns: 3 });
    const tracker = new CacheStateTracker();

    const result = handlePreRequest({
      db,
      tracker,
      workspace_id: "ws-1",
      session_id: "sess-1",
      current_turn: 4,
      original_request: baseRequest(),
      message_classifications: [cl("SEMI"), cl("VOLATILE")],
      block_placements: [placement(blockId)],
      pruner: { enabled: true, k: 3, mode: "default" },
      now_ms: 1_715_000_004_000,
    });

    expect(result.pruned_blocks_count).toBe(1);
    expect(result.request.messages[0]?.content[0]).toEqual({
      type: "text",
      text: "[stub:01KPREQ1] tool_output tool:read:src/auth.ts (250 tokens elided) | refetch via cachelane:expand(block_id=01KPREQ1)",
    });
    expect(result.request.tools?.at(-1)?.cache_control).toEqual({
      type: "ephemeral",
      ttl: "5m",
    });
  });

  it("starts pruning a K=3 turn-1 block on turn 4", () => {
    const blockId = "01KPREQ2000000000000001";
    insertBlock(blockId);

    for (const turnNumber of [1, 2, 3]) {
      db.updateBlockCounters({
        workspace_id: "ws-1",
        session_id: "sess-1",
        turn_number: turnNumber,
        referenced_ids: new Set(),
        updated_at: 1_715_000_000_000 + turnNumber,
      });
    }

    const result = handlePreRequest({
      db,
      tracker: new CacheStateTracker(),
      workspace_id: "ws-1",
      session_id: "sess-1",
      current_turn: 4,
      original_request: baseRequest(),
      message_classifications: [cl("SEMI"), cl("VOLATILE")],
      block_placements: [placement(blockId)],
      pruner: { enabled: true, k: 3, mode: "default" },
    });

    expect(result.pruned_blocks_count).toBe(1);
    expect(db.getBlock(blockId)?.is_stub).toBe(1);
  });

  it("keeps a restored block suffix-only for one warming turn", () => {
    const blockId = "01KPREQ3000000000000001";
    insertBlock(blockId, {
      volatility: "SEMI",
      restored_at_turn: 6,
      last_referenced_at_turn: 6,
    });

    const result = handlePreRequest({
      db,
      tracker: new CacheStateTracker(),
      workspace_id: "ws-1",
      session_id: "sess-1",
      current_turn: 7,
      original_request: baseRequest(),
      message_classifications: [cl("SEMI"), cl("SEMI")],
      block_placements: [placement(blockId)],
      pruner: { enabled: false, k: 3, mode: "default" },
    });

    expect(result.effective_message_classifications[0]?.volatility).toBe(
      "VOLATILE",
    );
    expect(result.middle_hash).toBeNull();
  });

  it("allows normal classification on the turn after suffix warming", () => {
    const blockId = "01KPREQ4000000000000001";
    insertBlock(blockId, {
      volatility: "SEMI",
      restored_at_turn: 6,
      last_referenced_at_turn: 6,
    });

    const result = handlePreRequest({
      db,
      tracker: new CacheStateTracker(),
      workspace_id: "ws-1",
      session_id: "sess-1",
      current_turn: 8,
      original_request: baseRequest(),
      message_classifications: [cl("SEMI"), cl("SEMI")],
      block_placements: [placement(blockId)],
      pruner: { enabled: false, k: 3, mode: "default" },
    });

    expect(result.effective_message_classifications[0]?.volatility).toBe("SEMI");
    expect(result.middle_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails open when message_classifications length mismatches messages", () => {
    const original = baseRequest();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = handlePreRequest({
      db,
      tracker: new CacheStateTracker(),
      workspace_id: "ws-1",
      session_id: "sess-1",
      current_turn: 1,
      original_request: original,
      // original has 2 messages; supply only 1 classification
      message_classifications: [cl("SEMI")],
      block_placements: [],
      pruner: { enabled: false, k: 3, mode: "default" },
    });

    expect(result.request).toBe(original);
    expect(result.mutated).toBe(false);
    expect(result.signals).toContain("error:fallback");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("mismatch"),
      expect.any(Object),
    );
  });

  it("fails open with the original request when storage fails", () => {
    const original = baseRequest("do not touch");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failingDb = {
      getPrunableBlocks: () => {
        throw new Error("storage unavailable");
      },
    } as unknown as CachelaneDb;

    const result = handlePreRequest({
      db: failingDb,
      tracker: new CacheStateTracker(),
      workspace_id: "ws-1",
      session_id: "sess-1",
      current_turn: 4,
      original_request: original,
      message_classifications: [cl("SEMI"), cl("VOLATILE")],
      block_placements: [],
      pruner: { enabled: true, k: 3, mode: "default" },
    });

    expect(result.request).toBe(original);
    expect(result.mutated).toBe(false);
    expect(result.signals).toContain("error:fallback");
    expect(spy).toHaveBeenCalled();
  });
});
