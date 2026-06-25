import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../index.js";
import type { CachelaneDb } from "../index.js";

let tmpDir: string;
let db: CachelaneDb;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-compression-test-"));
  db = openDatabase(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  try {
    db?.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("compression_events migration", () => {
  it("creates compression_events table", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("compression_events");
  });

  it("creates idx_compression_session index", () => {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain("idx_compression_session");
  });

  it("has a profile_id column after migration 010", () => {
    const cols = (db.pragma("table_info(compression_events)") as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("profile_id");
  });
});

describe("recordCompressionEvents", () => {
  const WS = "ws-1";
  const SESS = "sess-1";
  const TURN = "turn-abc";

  it("inserts one row per event", () => {
    db.recordCompressionEvents(TURN, SESS, WS, [
      {
        tool_use_id: "t1",
        content_type: "json",
        original_tokens: 100,
        compressed_tokens: 60,
        tokens_saved: 40,
      },
      {
        tool_use_id: "t2",
        content_type: "log",
        original_tokens: 200,
        compressed_tokens: 80,
        tokens_saved: 120,
      },
    ]);

    const rows = db
      .prepare("SELECT * FROM compression_events ORDER BY tool_use_id")
      .all() as Array<{ tool_use_id: string; tokens_saved: number }>;

    expect(rows).toHaveLength(2);
    expect(rows[0]!.tool_use_id).toBe("t1");
    expect(rows[1]!.tool_use_id).toBe("t2");
  });

  it("is a no-op when events array is empty", () => {
    db.recordCompressionEvents(TURN, SESS, WS, []);
    const count = db
      .prepare("SELECT COUNT(*) as n FROM compression_events")
      .get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("stores all required fields", () => {
    db.recordCompressionEvents(TURN, SESS, WS, [
      {
        tool_use_id: "t-xyz",
        content_type: "passthrough",
        original_tokens: 50,
        compressed_tokens: 50,
        tokens_saved: 0,
        compressor_id: "json",
        mode: "aggressive",
        lossiness: "passthrough",
        outcome: "passthrough",
        latency_ms: 1.25,
        token_model: "claude-opus-4-7",
        retention_handle: "cto_123",
      },
    ]);

    const row = db
      .prepare("SELECT * FROM compression_events WHERE tool_use_id = 't-xyz'")
      .get() as {
      turn_id: string;
      session_id: string;
      workspace_id: string;
      content_type: string;
      original_tokens: number;
      compressed_tokens: number;
      tokens_saved: number;
      created_at: number;
      compressor_id: string | null;
      mode: string | null;
      lossiness: string | null;
      outcome: string | null;
      latency_ms: number | null;
      token_model: string | null;
      retention_handle: string | null;
    } | undefined;

    expect(row).toBeDefined();
    expect(row!.turn_id).toBe(TURN);
    expect(row!.session_id).toBe(SESS);
    expect(row!.workspace_id).toBe(WS);
    expect(row!.content_type).toBe("passthrough");
    expect(row!.original_tokens).toBe(50);
    expect(row!.compressed_tokens).toBe(50);
    expect(row!.tokens_saved).toBe(0);
    expect(row!.created_at).toBeGreaterThan(0);
    expect(row!.compressor_id).toBe("json");
    expect(row!.mode).toBe("aggressive");
    expect(row!.lossiness).toBe("passthrough");
    expect(row!.outcome).toBe("passthrough");
    expect(row!.latency_ms).toBe(1.25);
    expect(row!.token_model).toBe("claude-opus-4-7");
    expect(row!.retention_handle).toBe("cto_123");
  });

  it("persists profile_id when present", () => {
    db.recordCompressionEvents("turn-p", "sess-1", "ws-1", [
      { tool_use_id: "tp", content_type: "shell", original_tokens: 100, compressed_tokens: 20, tokens_saved: 80, compressor_id: "shell", profile_id: "git-status" },
    ]);
    const row = db.prepare("SELECT profile_id FROM compression_events WHERE tool_use_id = 'tp'").get() as { profile_id: string | null };
    expect(row.profile_id).toBe("git-status");
  });
});

describe("getStats compression_counts", () => {
  const WS = "ws-stats";
  const SESS = "sess-stats";

  it("returns zero counts when no compression events", () => {
    const stats = db.getStats({ scope: "workspace", workspace_id: WS, session_id: SESS });
    expect(stats.compression_counts).toEqual({ compressed_blocks: 0, tokens_saved: 0, by_profile: [] });
  });

  it("aggregates compressed_blocks and tokens_saved", () => {
    db.recordCompressionEvents("turn-1", SESS, WS, [
      { tool_use_id: "t1", content_type: "json", original_tokens: 100, compressed_tokens: 60, tokens_saved: 40 },
      { tool_use_id: "t2", content_type: "log", original_tokens: 200, compressed_tokens: 80, tokens_saved: 120 },
    ]);

    const stats = db.getStats({ scope: "workspace", workspace_id: WS, session_id: SESS });
    expect(stats.compression_counts.compressed_blocks).toBe(2);
    expect(stats.compression_counts.tokens_saved).toBe(160);
  });

  it("scopes counts to workspace/session", () => {
    db.recordCompressionEvents("turn-1", "other-sess", WS, [
      { tool_use_id: "t1", content_type: "json", original_tokens: 100, compressed_tokens: 60, tokens_saved: 40 },
    ]);
    db.recordCompressionEvents("turn-2", SESS, WS, [
      { tool_use_id: "t2", content_type: "json", original_tokens: 50, compressed_tokens: 30, tokens_saved: 20 },
    ]);

    const stats = db.getStats({ scope: "session", workspace_id: WS, session_id: SESS });
    expect(stats.compression_counts.compressed_blocks).toBe(1);
    expect(stats.compression_counts.tokens_saved).toBe(20);
  });

  it("does not count zero-savings passthrough events as compressed blocks", () => {
    db.recordCompressionEvents("turn-1", SESS, WS, [
      { tool_use_id: "t1", content_type: "passthrough", original_tokens: 100, compressed_tokens: 100, tokens_saved: 0 },
      { tool_use_id: "t2", content_type: "json", original_tokens: 120, compressed_tokens: 90, tokens_saved: 30 },
    ]);

    const stats = db.getStats({ scope: "workspace", workspace_id: WS, session_id: SESS });
    expect(stats.compression_counts.compressed_blocks).toBe(1);
    expect(stats.compression_counts.tokens_saved).toBe(30);
  });
});

describe("by_profile aggregation", () => {
  it("groups tokens_saved by profile_id", () => {
    db.recordCompressionEvents("turn-1", "sess-1", "ws-1", [
      { tool_use_id: "a", content_type: "shell", original_tokens: 100, compressed_tokens: 20, tokens_saved: 80, profile_id: "git-status" },
      { tool_use_id: "b", content_type: "shell", original_tokens: 100, compressed_tokens: 30, tokens_saved: 70, profile_id: "git-status" },
      { tool_use_id: "c", content_type: "shell", original_tokens: 100, compressed_tokens: 10, tokens_saved: 90, profile_id: "test-run" },
    ]);
    const stats = db.getStats({ scope: "all", workspace_id: "ws-1", session_id: "sess-1" });
    const byProfile = stats.compression_counts.by_profile;
    const gitStatus = byProfile.find((p) => p.profile_id === "git-status");
    expect(gitStatus?.tokens_saved).toBe(150);
    expect(gitStatus?.compressed_blocks).toBe(2);
  });

  it("scopes by_profile to workspace/session", () => {
    db.recordCompressionEvents("turn-1", "other-sess", "ws-1", [
      { tool_use_id: "x", content_type: "shell", original_tokens: 100, compressed_tokens: 20, tokens_saved: 80, profile_id: "git-status" },
    ]);
    db.recordCompressionEvents("turn-2", "sess-1", "ws-1", [
      { tool_use_id: "y", content_type: "shell", original_tokens: 100, compressed_tokens: 30, tokens_saved: 70, profile_id: "git-status" },
    ]);
    const stats = db.getStats({ scope: "session", workspace_id: "ws-1", session_id: "sess-1" });
    const gitStatus = stats.compression_counts.by_profile.find((p) => p.profile_id === "git-status");
    expect(gitStatus?.tokens_saved).toBe(70);
    expect(gitStatus?.compressed_blocks).toBe(1);
  });
});
