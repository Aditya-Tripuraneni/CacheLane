import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type CachelaneDb } from "../../storage/index.js";
import { buildReportData } from "../query.js";

let dir: string;
let db: CachelaneDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cl-report-"));
  db = openDatabase(join(dir, "t.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function seedTurn(turnNumber: number, input: number, cacheRead: number): void {
  const turnId = `t-${turnNumber}`;
  db.insertTurn({
    id: turnId, workspace_id: "ws", session_id: "s1", turn_number: turnNumber,
    model: "claude-opus-4-7", input_tokens: input, output_tokens: 10,
    cache_creation_5m_tokens: 0, cache_creation_1h_tokens: 0, cache_read_tokens: cacheRead,
    effective_cost_units: input + 0.1 * cacheRead,
    prefix_breakpoint_hash: "abc", middle_breakpoint_hash: null,
    pruned_blocks_count: 0, keepalive_pings_since_last_turn: 0,
    request_mutated: 1, signals: JSON.stringify(["prefix_cached"]), created_at: 1000 + turnNumber,
  });
  db.insertTurnExplanation({
    turn_id: turnId, workspace_id: "ws", session_id: "s1", turn_number: turnNumber,
    model: "claude-opus-4-7", prefix_breakpoint_hash: "abc", middle_breakpoint_hash: null,
    mutated: true, pruned_blocks_count: 0, prune_decisions: [],
    block_metadata: [], region_metadata: { message_count: 3, stable_count: 1, semi_count: 1, volatile_count: 1 },
    signals: ["prefix_cached"], created_at: 1000 + turnNumber, updated_at: 1000 + turnNumber,
    usage: {
      input_tokens: input, cache_read_tokens: cacheRead,
      cache_creation_5m_tokens: 0, cache_creation_1h_tokens: 0,
      output_tokens: 10, effective_cost_units: input + 0.1 * cacheRead,
    },
  });
}

describe("buildReportData", () => {
  it("aggregates turns with naive baseline per turn", () => {
    seedTurn(1, 100, 0);
    seedTurn(2, 20, 80);
    const data = buildReportData(db, {
      scope: "workspace", workspace_id: "ws", session_id: "s1",
      generated_at: "2026-06-16T00:00:00Z",
    });
    expect(data.turns).toHaveLength(2);
    // turn 2 naive baseline = input + cache_read at 1.0x = 20 + 80 = 100
    expect(data.turns[1]!.baseline_cost_units).toBe(100);
    expect(data.turns[1]!.effective_cost_units).toBeCloseTo(28, 5); // 20 + 0.1*80
    expect(data.privacy.content_persisted).toBe(false);
    expect(data.long_session_threshold_turns).toBe(15);
  });

  it("empty DB yields valid no-data report", () => {
    const data = buildReportData(db, {
      scope: "workspace", workspace_id: "ws", session_id: "s1",
      generated_at: "2026-06-16T00:00:00Z",
    });
    expect(data.turns).toEqual([]);
    expect(data.stats.turns).toBe(0);
  });
});
