import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../index.js";
import type { CachelaneDb } from "../index.js";

let tmpDir: string;
let db: CachelaneDb;

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-compression-originals-"));
  db = openDatabase(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("compression_originals", () => {
  it("creates compression_originals table and indexes", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all() as { name: string }[];

    expect(tables.map((table) => table.name)).toContain("compression_originals");
    expect(indexes.map((index) => index.name)).toContain("idx_compression_originals_scope");
  });

  it("stores and retrieves byte-identical original content", () => {
    const original = '{"a":null,"b":[1,2,3],"text":"hello"}';
    const handle = db.recordCompressionOriginal({
      turn_id: "turn-1",
      session_id: "sess-1",
      workspace_id: "ws-1",
      tool_use_id: "tool-1",
      content_sha256: sha256(original),
      original_text: original,
      original_tokens: 12,
      created_at: 1_000,
      expires_at: 10_000,
    });

    const row = db.getCompressionOriginal({
      handle,
      workspace_id: "ws-1",
      session_id: "sess-1",
      now_ms: 2_000,
    });

    expect(row).toMatchObject({
      handle,
      workspace_id: "ws-1",
      session_id: "sess-1",
      tool_use_id: "tool-1",
      original_text: original,
      original_tokens: 12,
    });
  });

  it("does not retrieve originals from another workspace or session", () => {
    const handle = db.recordCompressionOriginal({
      turn_id: "turn-1",
      session_id: "sess-1",
      workspace_id: "ws-1",
      tool_use_id: "tool-1",
      content_sha256: sha256("secret"),
      original_text: "secret",
      original_tokens: 2,
      created_at: 1_000,
      expires_at: null,
    });

    expect(db.getCompressionOriginal({ handle, workspace_id: "ws-2", session_id: "sess-1" })).toBeNull();
    expect(db.getCompressionOriginal({ handle, workspace_id: "ws-1", session_id: "sess-2" })).toBeNull();
  });

  it("does not retrieve expired originals", () => {
    const handle = db.recordCompressionOriginal({
      turn_id: "turn-1",
      session_id: "sess-1",
      workspace_id: "ws-1",
      tool_use_id: "tool-1",
      content_sha256: sha256("old"),
      original_text: "old",
      original_tokens: 1,
      created_at: 1_000,
      expires_at: 2_000,
    });

    expect(db.getCompressionOriginal({
      handle,
      workspace_id: "ws-1",
      session_id: "sess-1",
      now_ms: 2_001,
    })).toBeNull();
  });

  it("deletes unused retained originals by handle", () => {
    const handle = db.recordCompressionOriginal({
      turn_id: "turn-1",
      session_id: "sess-1",
      workspace_id: "ws-1",
      tool_use_id: "tool-1",
      content_sha256: sha256("temporary"),
      original_text: "temporary",
      original_tokens: 3,
      created_at: 1_000,
      expires_at: null,
    });

    db.deleteCompressionOriginal(handle);

    expect(db.getCompressionOriginal({
      handle,
      workspace_id: "ws-1",
      session_id: "sess-1",
    })).toBeNull();
  });

  it("cleans up expired originals opportunistically before storing a new original", () => {
    const oldHandle = db.recordCompressionOriginal({
      turn_id: "turn-1",
      session_id: "sess-1",
      workspace_id: "ws-1",
      tool_use_id: "tool-old",
      content_sha256: sha256("old"),
      original_text: "old",
      original_tokens: 1,
      created_at: 1_000,
      expires_at: 2_000,
    });

    db.recordCompressionOriginal({
      turn_id: "turn-2",
      session_id: "sess-1",
      workspace_id: "ws-1",
      tool_use_id: "tool-new",
      content_sha256: sha256("new"),
      original_text: "new",
      original_tokens: 1,
      created_at: 3_000,
      expires_at: null,
    });

    expect(db.getCompressionOriginal({
      handle: oldHandle,
      workspace_id: "ws-1",
      session_id: "sess-1",
      now_ms: 1_500,
    })).toBeNull();
  });

  it("deletes expired originals explicitly", () => {
    db.recordCompressionOriginal({
      turn_id: "turn-1",
      session_id: "sess-1",
      workspace_id: "ws-1",
      tool_use_id: "tool-expired",
      content_sha256: sha256("expired"),
      original_text: "expired",
      original_tokens: 1,
      created_at: 1_000,
      expires_at: 2_000,
    });
    const liveHandle = db.recordCompressionOriginal({
      turn_id: "turn-2",
      session_id: "sess-1",
      workspace_id: "ws-1",
      tool_use_id: "tool-live",
      content_sha256: sha256("live"),
      original_text: "live",
      original_tokens: 1,
      created_at: 1_500,
      expires_at: 5_000,
    });

    expect(db.deleteExpiredCompressionOriginals(3_000)).toBe(1);
    expect(db.getCompressionOriginal({
      handle: liveHandle,
      workspace_id: "ws-1",
      session_id: "sess-1",
      now_ms: 3_000,
    })?.original_text).toBe("live");
  });
});
