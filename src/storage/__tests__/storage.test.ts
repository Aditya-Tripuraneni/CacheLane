import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../index.js";
import type { CachelaneDb } from "../index.js";

let tmpDir: string;
let db: CachelaneDb;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-test-db-"));
});

afterEach(() => {
  try {
    db?.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("openDatabase", () => {
  it("opens in WAL journal mode", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const rows = db.pragma("journal_mode") as { journal_mode: string }[];
    expect(rows[0].journal_mode).toBe("wal");
  });

  it("applies schema — blocks, turns, block_references tables exist", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("blocks");
    expect(names).toContain("turns");
    expect(names).toContain("block_references");
  });

  it("applies restored_at_turn migration to blocks", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const columns = db.prepare("PRAGMA table_info(blocks)").all() as {
      name: string;
    }[];
    expect(columns.map((column) => column.name)).toContain("restored_at_turn");
  });

  it("applies all six spec indexes by exact name", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_blocks_session");
    expect(names).toContain("idx_blocks_hash");
    expect(names).toContain("idx_blocks_unused");
    expect(names).toContain("idx_turns_session_num");
    expect(names).toContain("idx_refs_block");
    expect(names).toContain("idx_refs_turn");
  });

  it("passes integrity_check on fresh DB", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const result = db.pragma("integrity_check") as { integrity_check: string }[];
    expect(result[0].integrity_check).toBe("ok");
  });

  it("renames corrupt file and creates fresh DB", () => {
    const dbPath = path.join(tmpDir, "corrupt.db");
    fs.writeFileSync(dbPath, "this is not a valid sqlite database");

    db = openDatabase(dbPath);

    const files = fs.readdirSync(tmpDir);
    const renamed = files.find((f) => f.startsWith("corrupt.db.corrupt-"));
    expect(renamed).toBeTruthy();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("blocks");
  });

  it("insertBlock + getBlock round-trip", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    db.insertBlock({
      id: "01HZXQ5K0000000000000001",
      workspace_id: "ws-1",
      session_id: "sess-1",
      content_hash: "a".repeat(64),
      kind: "file_read",
      volatility: "SEMI",
      is_pinned: false,
      token_count: 500,
      added_at_turn: 1,
      last_referenced_at_turn: 1,
      unused_turns: 0,
      is_stub: false,
      stub_summary: null,
      refetch_handle: null,
      created_at: now,
      updated_at: now,
    });

    const block = db.getBlock("01HZXQ5K0000000000000001");
    expect(block).not.toBeNull();
    expect(block!.kind).toBe("file_read");
    expect(block!.volatility).toBe("SEMI");
    expect(block!.token_count).toBe(500);
    expect(block!.is_pinned).toBe(0);
    expect(block!.is_stub).toBe(0);
    expect(block!.added_at_turn).toBe(1);
    expect(block!.stub_summary).toBeNull();
    expect(block!.restored_at_turn).toBeNull();
  });

  it("incrementUnusedTurns increments counter and updates updated_at", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    db.insertBlock({
      id: "01HZXQ5K0000000000000002",
      workspace_id: "ws-1",
      session_id: "sess-1",
      content_hash: "b".repeat(64),
      kind: "tool_output",
      volatility: "VOLATILE",
      is_pinned: false,
      token_count: 200,
      added_at_turn: 1,
      last_referenced_at_turn: 1,
      unused_turns: 0,
      is_stub: false,
      stub_summary: null,
      refetch_handle: null,
      created_at: now,
      updated_at: now,
    });

    db.incrementUnusedTurns("01HZXQ5K0000000000000002", now + 1000);

    const block = db.getBlock("01HZXQ5K0000000000000002");
    expect(block!.unused_turns).toBe(1);
    expect(block!.updated_at).toBe(now + 1000);
  });

  it("insertTurn + getTurn round-trip with effective_cost_units", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    // Formula: input_tokens + 1.25*cache_creation_5m + 2.0*cache_creation_1h + 0.1*cache_read
    // = 200 + 1.25*1000 + 2.0*0 + 0.1*500 = 1500
    db.insertTurn({
      id: "01HZXQ5K0000000000000010",
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 1,
      model: "claude-opus-4-7",
      input_tokens: 200,
      output_tokens: 80,
      cache_creation_5m_tokens: 1000,
      cache_creation_1h_tokens: 0,
      cache_read_tokens: 500,
      effective_cost_units: 1500,
      prefix_breakpoint_hash: "c".repeat(64),
      middle_breakpoint_hash: null,
      pruned_blocks_count: 0,
      keepalive_pings_since_last_turn: 0,
      created_at: now,
    });

    const turn = db.getTurn("01HZXQ5K0000000000000010");
    expect(turn).not.toBeNull();
    expect(turn!.turn_number).toBe(1);
    expect(turn!.model).toBe("claude-opus-4-7");
    expect(turn!.cache_creation_5m_tokens).toBe(1000);
    expect(turn!.cache_creation_1h_tokens).toBe(0);
    expect(turn!.cache_read_tokens).toBe(500);
    expect(turn!.output_tokens).toBe(80);
    expect(turn!.effective_cost_units).toBeCloseTo(1500, 5);
  });

  it("markStub sets is_stub=1, refetch_handle and stub_summary", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    db.insertBlock({
      id: "01HZXQ5K0000000000000003",
      workspace_id: "ws-1",
      session_id: "sess-1",
      content_hash: "d".repeat(64),
      kind: "file_read",
      volatility: "SEMI",
      is_pinned: false,
      token_count: 800,
      added_at_turn: 1,
      last_referenced_at_turn: 1,
      unused_turns: 3,
      is_stub: false,
      stub_summary: null,
      refetch_handle: null,
      created_at: now,
      updated_at: now,
    });

    db.markStub(
      "01HZXQ5K0000000000000003",
      "view:auth.py:1-50",
      "Read auth.py:1-50 (800 tokens elided)",
      now + 2000
    );

    const block = db.getBlock("01HZXQ5K0000000000000003");
    expect(block!.is_stub).toBe(1);
    expect(block!.refetch_handle).toBe("view:auth.py:1-50");
    expect(block!.stub_summary).toContain("auth.py");
    expect(block!.restored_at_turn).toBeNull();
    expect(block!.updated_at).toBe(now + 2000);
  });

  it("restoreStub resets counters and records the restore turn", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    db.insertBlock({
      id: "01RESTORE00000000000001",
      workspace_id: "ws-1",
      session_id: "sess-1",
      content_hash: "r".repeat(64),
      kind: "file_read",
      volatility: "SEMI",
      is_pinned: false,
      token_count: 800,
      added_at_turn: 1,
      last_referenced_at_turn: 1,
      unused_turns: 3,
      is_stub: true,
      stub_summary: "Read auth.py:1-50 (800 tokens elided)",
      refetch_handle: "view:auth.py:1-50",
      created_at: now,
      updated_at: now,
    });

    db.restoreStub({
      workspace_id: "ws-1",
      session_id: "sess-1",
      block_id: "01RESTORE00000000000001",
      turn_number: 7,
      updated_at: now + 3000,
    });

    const block = db.getBlock("01RESTORE00000000000001");
    expect(block!.is_stub).toBe(0);
    expect(block!.unused_turns).toBe(0);
    expect(block!.last_referenced_at_turn).toBe(7);
    expect(block!.restored_at_turn).toBe(7);
    expect(block!.updated_at).toBe(now + 3000);
  });

  it("insertBlockReference auto-assigns integer id and supports round-trip", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    db.insertBlock({
      id: "01BLOCK00000000000000001",
      workspace_id: "ws-1",
      session_id: "sess-1",
      content_hash: "e".repeat(64),
      kind: "tool_output",
      volatility: "VOLATILE",
      is_pinned: false,
      token_count: 100,
      added_at_turn: 1,
      last_referenced_at_turn: 1,
      unused_turns: 0,
      is_stub: false,
      stub_summary: null,
      refetch_handle: null,
      created_at: now,
      updated_at: now,
    });

    db.insertTurn({
      id: "01TURN000000000000000001",
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 1,
      model: "claude-opus-4-7",
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_5m_tokens: 0,
      cache_creation_1h_tokens: 0,
      cache_read_tokens: 0,
      effective_cost_units: 100,
      prefix_breakpoint_hash: null,
      middle_breakpoint_hash: null,
      pruned_blocks_count: 0,
      keepalive_pings_since_last_turn: 0,
      created_at: now,
    });

    const refId = db.insertBlockReference({
      block_id: "01BLOCK00000000000000001",
      turn_id: "01TURN000000000000000001",
      reference_type: "tool_call",
      evidence: "tool=Read,path=auth.py",
      created_at: now,
    });
    expect(typeof refId).toBe("number");
    expect(refId).toBeGreaterThan(0);

    const refs = db.getBlockReferencesForTurn("01TURN000000000000000001");
    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe(refId);
    expect(refs[0].block_id).toBe("01BLOCK00000000000000001");
    expect(refs[0].reference_type).toBe("tool_call");
    expect(refs[0].evidence).toBe("tool=Read,path=auth.py");
    expect(refs[0].created_at).toBe(now);
  });

  it("insertBlockReferences batch-inserts reference audit rows", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    db.insertBlock({
      id: "01BATCH0000000000000001",
      workspace_id: "ws-1",
      session_id: "sess-1",
      content_hash: "f".repeat(64),
      kind: "tool_output",
      volatility: "VOLATILE",
      is_pinned: false,
      token_count: 100,
      added_at_turn: 1,
      last_referenced_at_turn: 1,
      unused_turns: 0,
      is_stub: false,
      stub_summary: null,
      refetch_handle: null,
      created_at: now,
      updated_at: now,
    });
    db.insertTurn({
      id: "01BATCHTURN000000000001",
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 1,
      model: "claude-opus-4-7",
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_5m_tokens: 0,
      cache_creation_1h_tokens: 0,
      cache_read_tokens: 0,
      effective_cost_units: 100,
      prefix_breakpoint_hash: null,
      middle_breakpoint_hash: null,
      pruned_blocks_count: 0,
      keepalive_pings_since_last_turn: 0,
      created_at: now,
    });

    const ids = db.insertBlockReferences([
      {
        block_id: "01BATCH0000000000000001",
        turn_id: "01BATCHTURN000000000001",
        reference_type: "id_mention",
        evidence: "id_token=abcdef12",
        created_at: now,
      },
    ]);

    expect(ids).toHaveLength(1);
    expect(db.getBlockReferencesForTurn("01BATCHTURN000000000001")).toHaveLength(1);
  });

  it("updateBlockCounters resets referenced blocks and increments eligible idle blocks", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();
    const base = {
      workspace_id: "ws-1",
      session_id: "sess-1",
      content_hash: "a".repeat(64),
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
      created_at: now,
      updated_at: now,
    };

    db.insertBlock({ ...base, id: "01COUNTER0000000000001" });
    db.insertBlock({ ...base, id: "01COUNTER0000000000002" });
    db.insertBlock({
      ...base,
      id: "01COUNTER0000000000003",
      volatility: "STABLE",
    });

    db.updateBlockCounters({
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 4,
      referenced_ids: new Set(["01COUNTER0000000000001"]),
      updated_at: now + 1000,
    });

    expect(db.getBlock("01COUNTER0000000000001")?.unused_turns).toBe(0);
    expect(db.getBlock("01COUNTER0000000000001")?.last_referenced_at_turn).toBe(4);
    expect(db.getBlock("01COUNTER0000000000002")?.unused_turns).toBe(3);
    expect(db.getBlock("01COUNTER0000000000003")?.unused_turns).toBe(2);
  });

  it("getPrunableBlocks returns only eligible non-STABLE rows with refetch handles", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();
    const base = {
      workspace_id: "ws-1",
      session_id: "sess-1",
      content_hash: "a".repeat(64),
      kind: "tool_output",
      volatility: "VOLATILE",
      is_pinned: false,
      token_count: 100,
      added_at_turn: 1,
      last_referenced_at_turn: 1,
      unused_turns: 3,
      is_stub: false,
      stub_summary: null,
      refetch_handle: "tool:read:src/auth.ts",
      created_at: now,
      updated_at: now,
    };

    db.insertBlock({ ...base, id: "01PRUNABLE000000000001" });
    db.insertBlock({
      ...base,
      id: "01PRUNABLE000000000002",
      volatility: "STABLE",
    });
    db.insertBlock({
      ...base,
      id: "01PRUNABLE000000000003",
      refetch_handle: null,
    });
    db.insertBlock({
      ...base,
      id: "01PRUNABLE000000000004",
      is_pinned: true,
    });
    db.insertBlock({
      ...base,
      id: "01PRUNABLE000000000005",
      is_stub: true,
      stub_summary: "already stubbed",
    });

    const rows = db.getPrunableBlocks({
      workspace_id: "ws-1",
      session_id: "sess-1",
      k: 3,
    });

    expect(rows.map((row) => row.id)).toEqual(["01PRUNABLE000000000001"]);
  });

  it("getBlocksByIdPrefix scopes prefix lookup to workspace and session", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();
    db.insertBlock({
      id: "01PREFIX000000000000001",
      workspace_id: "ws-1",
      session_id: "sess-1",
      content_hash: "a".repeat(64),
      kind: "stub",
      volatility: "VOLATILE",
      is_pinned: false,
      token_count: 50,
      added_at_turn: 1,
      last_referenced_at_turn: 1,
      unused_turns: 3,
      is_stub: true,
      stub_summary: "stub",
      refetch_handle: "tool:read:src/auth.ts",
      created_at: now,
      updated_at: now,
    });

    const rows = db.getBlocksByIdPrefix({
      workspace_id: "ws-1",
      session_id: "sess-1",
      block_id_prefix: "01PREFIX",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("01PREFIX000000000000001");
  });

  it("getBlocksByIdPrefix treats SQL wildcard characters as literal prefix characters", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();
    db.insertBlock({
      id: "01PREFIX000000000000002",
      workspace_id: "ws-1",
      session_id: "sess-1",
      content_hash: "b".repeat(64),
      kind: "stub",
      volatility: "VOLATILE",
      is_pinned: false,
      token_count: 50,
      added_at_turn: 1,
      last_referenced_at_turn: 1,
      unused_turns: 3,
      is_stub: true,
      stub_summary: "stub",
      refetch_handle: "tool:read:src/auth.ts",
      created_at: now,
      updated_at: now,
    });

    const rows = db.getBlocksByIdPrefix({
      workspace_id: "ws-1",
      session_id: "sess-1",
      block_id_prefix: "01%",
    });

    expect(rows).toHaveLength(0);
  });
});
