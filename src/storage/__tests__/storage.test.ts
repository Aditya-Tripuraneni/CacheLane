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
  try { db?.close(); } catch { /* ignore */ }
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
      workspaceId: "ws-1",
      sessionId: "sess-1",
      kind: "file_read",
      volatility: "SEMI",
      tokenCount: 500,
      contentHash: "a".repeat(64),
      unusedTurns: 0,
      isStub: false,
      refetchHandle: null,
      createdAt: now,
      updatedAt: now,
    });

    const block = db.getBlock("01HZXQ5K0000000000000001");
    expect(block).not.toBeNull();
    expect(block!.kind).toBe("file_read");
    expect(block!.volatility).toBe("SEMI");
    expect(block!.token_count).toBe(500);
    expect(block!.is_stub).toBe(0);
  });

  it("incrementUnusedTurns increments counter and updates updated_at", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    db.insertBlock({
      id: "01HZXQ5K0000000000000002",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      kind: "tool_output",
      volatility: "VOLATILE",
      tokenCount: 200,
      contentHash: "b".repeat(64),
      unusedTurns: 0,
      isStub: false,
      refetchHandle: null,
      createdAt: now,
      updatedAt: now,
    });

    db.incrementUnusedTurns("01HZXQ5K0000000000000002", now + 1000);

    const block = db.getBlock("01HZXQ5K0000000000000002");
    expect(block!.unused_turns).toBe(1);
    expect(block!.updated_at).toBe(now + 1000);
  });

  it("insertTurn + getTurn round-trip with effective_cost_units", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    db.insertTurn({
      id: "01HZXQ5K0000000000000010",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      turnNumber: 1,
      cacheWriteShortTokens: 1000,
      cacheWriteLongTokens: 0,
      cacheReadTokens: 500,
      inputTokens: 200,
      effectiveCostUnits: 1450,
      prefixBreakpointHash: "c".repeat(64),
      middleBreakpointHash: null,
      prunedBlocksCount: 0,
      keepalivePingsSinceLastTurn: 0,
      createdAt: now,
    });

    const turn = db.getTurn("01HZXQ5K0000000000000010");
    expect(turn).not.toBeNull();
    expect(turn!.turn_number).toBe(1);
    expect(turn!.cache_write_short_tokens).toBe(1000);
    expect(turn!.effective_cost_units).toBeCloseTo(1450, 5);
  });

  it("markStub sets is_stub=1 and refetch_handle", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    db.insertBlock({
      id: "01HZXQ5K0000000000000003",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      kind: "file_read",
      volatility: "SEMI",
      tokenCount: 800,
      contentHash: "d".repeat(64),
      unusedTurns: 3,
      isStub: false,
      refetchHandle: null,
      createdAt: now,
      updatedAt: now,
    });

    db.markStub("01HZXQ5K0000000000000003", "view:auth.py:1-50", now + 2000);

    const block = db.getBlock("01HZXQ5K0000000000000003");
    expect(block!.is_stub).toBe(1);
    expect(block!.refetch_handle).toBe("view:auth.py:1-50");
    expect(block!.updated_at).toBe(now + 2000);
  });

  it("insertBlockReference + getBlockReferencesForTurn round-trip", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    // Insert a block and turn first (FK constraints)
    db.insertBlock({
      id: "01BLOCK00000000000000001",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      kind: "tool_output",
      volatility: "VOLATILE",
      tokenCount: 100,
      contentHash: "e".repeat(64),
      unusedTurns: 0,
      isStub: false,
      refetchHandle: null,
      createdAt: now,
      updatedAt: now,
    });

    db.insertTurn({
      id: "01TURN000000000000000001",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      turnNumber: 1,
      cacheWriteShortTokens: 0,
      cacheWriteLongTokens: 0,
      cacheReadTokens: 0,
      inputTokens: 100,
      effectiveCostUnits: 100,
      prefixBreakpointHash: null,
      middleBreakpointHash: null,
      prunedBlocksCount: 0,
      keepalivePingsSinceLastTurn: 0,
      createdAt: now,
    });

    db.insertBlockReference({
      id: "01REF0000000000000000001",
      blockId: "01BLOCK00000000000000001",
      turnId: "01TURN000000000000000001",
      referenceType: "tool_call",
    });

    const refs = db.getBlockReferencesForTurn("01TURN000000000000000001");
    expect(refs).toHaveLength(1);
    expect(refs[0].block_id).toBe("01BLOCK00000000000000001");
    expect(refs[0].reference_type).toBe("tool_call");
  });
});
