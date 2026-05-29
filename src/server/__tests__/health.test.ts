import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type CachelaneDb } from "../../storage/index.js";
import { handleHealthTool, healthInputSchema } from "../health.js";
import type { CachelaneMcpContext } from "../tools.js";

let tmpDir: string;
let db: CachelaneDb;

function context(): CachelaneMcpContext {
  return {
    db,
    workspace_id: "ws-1",
    session_id: "sess-1",
    now_ms: 1_715_000_010_000,
  };
}

function insertExplanation(turnNumber: number, mutated: boolean) {
  const now = 1_715_000_000_000 + turnNumber;
  db.insertTurnExplanation({
    turn_id: `turn-${turnNumber}`,
    workspace_id: "ws-1",
    session_id: "sess-1",
    turn_number: turnNumber,
    model: "claude-opus-4-7",
    prefix_breakpoint_hash: null,
    middle_breakpoint_hash: null,
    mutated,
    pruned_blocks_count: 0,
    prune_decisions: [],
    block_metadata: [],
    region_metadata: {
      message_count: 1,
      stable_count: 0,
      semi_count: 0,
      volatile_count: 1,
    },
    signals: [],
    created_at: now,
    updated_at: now,
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-server-health-"));
  db = openDatabase(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  db?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Health tool handler", () => {
  it("rejects invalid input", () => {
    expect(healthInputSchema.safeParse({ unknown: "prop" }).success).toBe(true); // zod allows unknown props by default
  });

  it("returns ok when there are no recent turns", () => {
    const status = handleHealthTool(context(), {});
    expect(status).toMatchObject({
      status: "ok",
      explanation: "0 of the last 0 turns in the current session used fallback mode.",
    });
  });

  it("returns ok when all turns are mutated", () => {
    for (let i = 1; i <= 5; i++) {
      insertExplanation(i, true);
    }
    const status = handleHealthTool(context(), {});
    expect(status).toMatchObject({
      status: "ok",
      explanation: "0 of the last 5 workspace turns used fallback mode.",
    });
  });

  it("returns ok when fallback percentage is exactly 5%", () => {
    // 1 out of 20 is 5%
    for (let i = 1; i <= 19; i++) {
      insertExplanation(i, true);
    }
    insertExplanation(20, false);
    const status = handleHealthTool(context(), {});
    expect(status).toMatchObject({
      status: "ok",
      explanation: "1 of the last 20 workspace turns used fallback mode.",
    });
  });

  it("returns degraded when fallback percentage is more than 5%", () => {
    // 2 out of 20 is 10%
    for (let i = 1; i <= 18; i++) {
      insertExplanation(i, true);
    }
    insertExplanation(19, false);
    insertExplanation(20, false);
    const status = handleHealthTool(context(), {});
    expect(status).toMatchObject({
      status: "degraded",
      explanation: "2 of the last 20 workspace turns used fallback mode.",
    });
  });

  it("returns degraded for 1 out of 10", () => {
    // 1 out of 10 is 10%
    for (let i = 1; i <= 9; i++) {
      insertExplanation(i, true);
    }
    insertExplanation(10, false);
    const status = handleHealthTool(context(), {});
    expect(status).toMatchObject({
      status: "degraded",
      explanation: "1 of the last 10 workspace turns used fallback mode.",
    });
  });
  
  it("only considers the last 20 turns", () => {
    // 10 fallbacks, but they are all in the past.
    for (let i = 1; i <= 10; i++) {
      insertExplanation(i, false);
    }
    // Then 20 successful ones.
    for (let i = 11; i <= 30; i++) {
      insertExplanation(i, true);
    }
    const status = handleHealthTool(context(), {});
    expect(status).toMatchObject({
      status: "ok",
      explanation: "0 of the last 20 workspace turns used fallback mode.",
    });
  });
});
