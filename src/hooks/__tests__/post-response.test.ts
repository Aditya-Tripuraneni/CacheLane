import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handlePostResponse } from "../post-response.js";
import { openDatabase } from "../../storage/index.js";
import type { CachelaneDb } from "../../storage/index.js";
import type { ReferenceTurn } from "../../references/index.js";

let tmpDir: string;
let db: CachelaneDb;

function insertBlock(id: string, overrides: Partial<Parameters<typeof db.insertBlock>[0]> = {}) {
  const now = 1_715_000_000_000;
  db.insertBlock({
    id,
    workspace_id: "ws-1",
    session_id: "sess-1",
    content_hash: id.padEnd(64, "0").slice(0, 64),
    kind: "tool_output",
    volatility: "VOLATILE",
    is_pinned: false,
    token_count: 100,
    added_at_turn: 1,
    last_referenced_at_turn: 1,
    unused_turns: 2,
    is_stub: false,
    stub_summary: null,
    refetch_handle: null,
    restored_at_turn: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-post-response-"));
  db = openDatabase(path.join(tmpDir, "test.db"));
  db.insertTurn({
    id: "turn-1",
    workspace_id: "ws-1",
    session_id: "sess-1",
    turn_number: 2,
    model: "claude-opus-4-7",
    provider: "anthropic",
    input_tokens: 100,
    output_tokens: 20,
    cache_creation_5m_tokens: 0,
    cache_creation_1h_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    effective_cost_units: 100,
    prefix_breakpoint_hash: null,
    middle_breakpoint_hash: null,
    pruned_blocks_count: 0,
    keepalive_pings_since_last_turn: 0,
    created_at: 1_715_000_000_000,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handlePostResponse", () => {
  it("writes reference rows and updates counters for referenced and unreferenced blocks", () => {
    insertBlock("referenced-block");
    insertBlock("idle-block");

    const turn: ReferenceTurn = {
      turn_number: 2,
      assistant_text: "Using ref12345 here.",
      tool_calls: [],
      blocks_in_prompt: [
        {
          id: "referenced-block",
          id_token: "ref12345",
          kind: "tool_output",
          content: "referenced output",
        },
        {
          id: "idle-block",
          id_token: "idle0000",
          kind: "tool_output",
          content: "idle output",
        },
      ],
    };

    const result = handlePostResponse({
      db,
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_id: "turn-1",
      turn_number: 2,
      turn,
      now_ms: 1_715_000_001_000,
    });

    expect(result.referenced_ids).toEqual(new Set(["referenced-block"]));
    expect(db.getBlockReferencesForTurn("turn-1")).toHaveLength(1);
    expect(db.getBlock("referenced-block")?.unused_turns).toBe(0);
    expect(db.getBlock("referenced-block")?.last_referenced_at_turn).toBe(2);
    expect(db.getBlock("idle-block")?.unused_turns).toBe(3);
  });

  it("records Anthropic usage fields into the turn row", () => {
    const turn: ReferenceTurn = {
      turn_number: 2,
      assistant_text: "No references here.",
      tool_calls: [],
      blocks_in_prompt: [],
    };

    handlePostResponse({
      db,
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_id: "turn-1",
      turn_number: 2,
      turn,
      usage: {
        input_tokens: 100,
        output_tokens: 40,
        ephemeral_5m_input_tokens: 200,
        ephemeral_1h_input_tokens: 50,
        cache_read_input_tokens: 1000,
      },
      now_ms: 1_715_000_001_000,
    });

    const updated = db.getTurn("turn-1");
    expect(updated).toMatchObject({
      input_tokens: 100,
      output_tokens: 40,
      cache_creation_5m_tokens: 200,
      cache_creation_1h_tokens: 50,
      cache_read_tokens: 1000,
      effective_cost_units: 550,
    });
  });

  it("returns empty referenced_ids and ok signal when no references are detected", () => {
    insertBlock("silent-block");

    const turn: ReferenceTurn = {
      turn_number: 2,
      assistant_text: "Nothing here referencing any block.",
      tool_calls: [],
      blocks_in_prompt: [
        {
          id: "silent-block",
          id_token: "zzzzzzzz",
          kind: "tool_output",
          content: "some content",
        },
      ],
    };

    const result = handlePostResponse({
      db,
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_id: "turn-1",
      turn_number: 2,
      turn,
      now_ms: 1_715_000_001_000,
    });

    expect(result.referenced_ids.size).toBe(0);
    expect(result.signals).toContain("ok");
    expect(db.getBlockReferencesForTurn("turn-1")).toHaveLength(0);
    expect(db.getBlock("silent-block")?.unused_turns).toBe(3);
  });

  it("fails open when insertBlockReferences throws", () => {
    insertBlock("some-block");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failingDb = {
      ...db,
      insertBlockReferences: () => {
        throw new Error("storage unavailable");
      },
    } as unknown as CachelaneDb;

    const turn: ReferenceTurn = {
      turn_number: 2,
      assistant_text: "Nothing referencing anything.",
      tool_calls: [],
      blocks_in_prompt: [],
    };

    const result = handlePostResponse({
      db: failingDb,
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_id: "turn-1",
      turn_number: 2,
      turn,
      now_ms: 1_715_000_001_000,
    });

    expect(result.referenced_ids.size).toBe(0);
    expect(result.signals).toContain("error:fallback");
    expect(spy).toHaveBeenCalled();
  });

  it("detects tool_call file-path references alongside id_token references", () => {
    insertBlock("file-block", { refetch_handle: "tool:read:src/auth.ts" });
    insertBlock("id-block");

    const turn: ReferenceTurn = {
      turn_number: 2,
      assistant_text: "Here is the analysis.",
      tool_calls: [
        { name: "Read", input: { path: "src/auth.ts" } },
      ],
      blocks_in_prompt: [
        {
          id: "file-block",
          file_path: "src/auth.ts",
          id_token: "filebloc",
          kind: "file_read",
          content: "file content",
        },
        {
          id: "id-block",
          id_token: "idblockk",
          kind: "tool_output",
          content: "tool result",
        },
      ],
    };

    const result = handlePostResponse({
      db,
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_id: "turn-1",
      turn_number: 2,
      turn,
      now_ms: 1_715_000_001_000,
    });

    expect(result.referenced_ids).toContain("file-block");
    expect(result.signals).toContain("ok");
    expect(db.getBlockReferencesForTurn("turn-1").length).toBeGreaterThan(0);
  });

  it("fails open on detector errors without updating block counters", () => {
    insertBlock("idle-block");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const turn = null as unknown as ReferenceTurn;

    const result = handlePostResponse({
      db,
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_id: "turn-1",
      turn_number: 2,
      turn,
      now_ms: 1_715_000_001_000,
    });

    expect(result.referenced_ids.size).toBe(0);
    expect(result.signals).toContain("error:fallback");
    // Counters must NOT be mutated on detection error
    expect(db.getBlock("idle-block")?.unused_turns).toBe(2);
    expect(spy).toHaveBeenCalled();
  });
});
