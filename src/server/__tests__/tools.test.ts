import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type CachelaneDb } from "../../storage/index.js";
import {
  expandInputSchema,
  explainInputSchema,
  handleExpandTool,
  handleExplainTool,
  handleRetrieveToolOutputTool,
  handleStatsTool,
  jsonTextPayload,
  retrieveToolOutputInputSchema,
  statsInputSchema,
  type CachelaneMcpContext,
} from "../tools.js";

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

function insertTurn(id: string, turnNumber: number, overrides: Partial<Parameters<typeof db.insertTurn>[0]> = {}) {
  db.insertTurn({
    id,
    workspace_id: "ws-1",
    session_id: "sess-1",
    turn_number: turnNumber,
    model: "claude-opus-4-7",
    input_tokens: 100,
    output_tokens: 20,
    cache_creation_5m_tokens: 0,
    cache_creation_1h_tokens: 0,
    cache_read_tokens: 900,
    effective_cost_units: 190,
    prefix_breakpoint_hash: null,
    middle_breakpoint_hash: null,
    pruned_blocks_count: 0,
    keepalive_pings_since_last_turn: 0,
    created_at: 1_715_000_000_000 + turnNumber,
    ...overrides,
  });
}

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
    unused_turns: 3,
    is_stub: true,
    stub_summary: "tool output summary",
    refetch_handle: "tool:read:src/auth.ts",
    created_at: now,
    updated_at: now,
    restored_at_turn: null,
    ...overrides,
  });
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function insertExplanation(
  id: string,
  turnNumber: number,
  overrides: Partial<Parameters<typeof db.insertTurnExplanation>[0]> = {},
) {
  const now = 1_715_000_000_000 + turnNumber;
  db.insertTurnExplanation({
    turn_id: id,
    workspace_id: "ws-1",
    session_id: "sess-1",
    turn_number: turnNumber,
    model: "claude-opus-4-7",
    prefix_breakpoint_hash: null,
    middle_breakpoint_hash: null,
    mutated: false,
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
    ...overrides,
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-server-"));
  db = openDatabase(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("MCP tool schemas", () => {
  it("rejects invalid stats scope", () => {
    expect(statsInputSchema.safeParse({ scope: "project" }).success).toBe(false);
  });

  it("rejects invalid explain turn", () => {
    expect(explainInputSchema.safeParse({ turn: -1 }).success).toBe(false);
  });

  it("rejects missing expand block_id", () => {
    expect(expandInputSchema.safeParse({}).success).toBe(false);
  });

  it("rejects missing retrieve handle", () => {
    expect(retrieveToolOutputInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("MCP tool handlers", () => {
  it("stats returns scoped aggregates", () => {
    insertTurn("turn-1", 1, {
      pruned_blocks_count: 2,
      keepalive_pings_since_last_turn: 1,
    });
    insertTurn("turn-2", 1, {
      workspace_id: "ws-2",
      session_id: "sess-2",
      input_tokens: 500,
      cache_read_tokens: 0,
      effective_cost_units: 500,
    });

    const stats = handleStatsTool(context(), { scope: "session" });
    expect(stats).toMatchObject({
      turns: 1,
      cache_hit_ratio: 0.9,
      pruner_counts: { pruned_blocks: 2 },
      keepalive_counts: { pings: 1 },
    });
  });

  it("explain returns latest by default and requested turn when provided", () => {
    insertExplanation("turn-explain-1", 1);
    insertExplanation("turn-explain-2", 2);

    expect(handleExplainTool(context(), {})).toMatchObject({
      found: true,
      explanation: { turn_number: 2 },
    });
    expect(handleExplainTool(context(), { turn: 1 })).toMatchObject({
      found: true,
      explanation: { turn_number: 1 },
    });
  });

  it("explain uses the same default session resolution as session stats", () => {
    insertTurn("turn-sess-1", 1, {
      session_id: "sess-1",
      created_at: 1_715_000_000_000,
    });
    insertTurn("turn-sess-2", 1, {
      session_id: "sess-2",
      created_at: 1_715_000_000_100,
    });
    insertExplanation("turn-explain-sess-1", 1, {
      session_id: "sess-1",
      signals: ["sess-1"],
    });
    insertExplanation("turn-explain-sess-2", 1, {
      session_id: "sess-2",
      signals: ["sess-2"],
      created_at: 1_715_000_000_100,
      updated_at: 1_715_000_000_100,
    });

    expect(handleExplainTool({ ...context(), session_id: "default" }, {})).toMatchObject({
      found: true,
      explanation: { session_id: "sess-2", signals: ["sess-2"] },
    });
    expect(handleExplainTool(context(), {})).toMatchObject({
      found: true,
      explanation: { session_id: "sess-1", signals: ["sess-1"] },
    });
  });

  it("expand covers success and pruner failure cases", () => {
    insertTurn("turn-1", 5);
    insertBlock("01EXPAND00000000000001");
    insertBlock("01MISSAA00000000000001", { is_stub: false });
    insertBlock("01AMBIG100000000000001");
    insertBlock("01AMBIG100000000000002");

    expect(handleExpandTool(context(), { block_id: "01EXPAND" })).toMatchObject({
      ok: true,
      block_id: "01EXPAND00000000000001",
    });
    expect(handleExpandTool(context(), { block_id: "short" })).toMatchObject({
      ok: false,
      error: { code: "invalid_block_id" },
    });
    expect(handleExpandTool(context(), { block_id: "01ABSENT" })).toMatchObject({
      ok: false,
      error: { code: "missing_block" },
    });
    expect(handleExpandTool(context(), { block_id: "01AMBIG1" })).toMatchObject({
      ok: false,
      error: { code: "ambiguous_prefix" },
    });
    expect(handleExpandTool(context(), { block_id: "01MISSAA" })).toMatchObject({
      ok: false,
      error: { code: "not_stub" },
    });
  });

  it("retrieves retained compression original by handle", () => {
    const original = '{"a":null,"b":[1,2,3]}';
    const handle = db.recordCompressionOriginal({
      turn_id: "turn-1",
      workspace_id: "ws-1",
      session_id: "sess-1",
      tool_use_id: "tool-1",
      content_sha256: sha256(original),
      original_text: original,
      original_tokens: 10,
      created_at: 1_715_000_000_000,
      expires_at: null,
    });

    expect(handleRetrieveToolOutputTool(context(), { handle })).toEqual({
      found: true,
      tool_use_id: "tool-1",
      original_text: original,
      original_tokens: 10,
    });
  });

  it("retrieve returns not found for wrong session or expired handle", () => {
    const handle = db.recordCompressionOriginal({
      turn_id: "turn-1",
      workspace_id: "ws-1",
      session_id: "sess-other",
      tool_use_id: "tool-1",
      content_sha256: sha256("secret"),
      original_text: "secret",
      original_tokens: 2,
      created_at: 1_715_000_000_000,
      expires_at: 1_715_000_000_001,
    });

    expect(handleRetrieveToolOutputTool(context(), { handle })).toEqual({ found: false });
  });

  it("json payloads never include known prompt or tool fixture content", () => {
    const payload = jsonTextPayload({
      explanation: {
        block_metadata: [{ block_id: "01SAFE", has_refetch_handle: true }],
      },
    });
    expect(JSON.stringify(payload)).not.toContain("secret prompt fixture");
  });
});
