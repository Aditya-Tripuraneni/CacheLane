import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCachelaneCli } from "../../cli/index.js";
import { openDatabase, type CachelaneDb } from "../../storage/index.js";
import { handleExpandTool } from "../../server/tools.js";

const fixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/m7-session.json", import.meta.url), "utf-8"),
) as {
  workspace_id: string;
  session_id: string;
  turn: Omit<
    Parameters<CachelaneDb["insertTurn"]>[0],
    "workspace_id" | "session_id"
  >;
  block: Omit<
    Parameters<CachelaneDb["insertBlock"]>[0],
    "workspace_id" | "session_id"
  >;
};

let tmpDir: string;
let env: NodeJS.ProcessEnv;

async function runCli(args: string[]): Promise<string> {
  let stdout = "";
  const program = createCachelaneCli({
    env,
    io: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        throw new Error(text);
      },
    },
  });
  program.exitOverride();
  await program.parseAsync(["node", "cachelane", ...args]);
  return stdout;
}

function seedFixture(db: CachelaneDb): void {
  db.insertBlock({
    ...fixture.block,
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
  });
  db.insertTurn({
    ...fixture.turn,
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
  });
  db.insertTurnExplanation({
    turn_id: fixture.turn.id,
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
    turn_number: fixture.turn.turn_number,
    model: fixture.turn.model,
    prefix_breakpoint_hash: fixture.turn.prefix_breakpoint_hash,
    middle_breakpoint_hash: fixture.turn.middle_breakpoint_hash,
    mutated: true,
    pruned_blocks_count: fixture.turn.pruned_blocks_count,
    prune_decisions: [
      {
        block_id: fixture.block.id,
        action: "stubbed",
        reason: "unused_turns >= 3",
        kind: "tool_output",
        stub_summary: fixture.block.stub_summary,
        has_refetch_handle: true,
      },
    ],
    block_metadata: [
      {
        block_id: fixture.block.id,
        message_index: 0,
        content_index: 0,
        kind: "tool_output",
        volatility: "VOLATILE",
        is_pinned: false,
        has_refetch_handle: true,
        token_count: 250,
      },
    ],
    region_metadata: {
      message_count: 2,
      stable_count: 0,
      semi_count: 1,
      volatile_count: 1,
    },
    signals: ["prefix_cached"],
    usage: {
      input_tokens: fixture.turn.input_tokens,
      output_tokens: fixture.turn.output_tokens,
      cache_creation_5m_tokens: fixture.turn.cache_creation_5m_tokens,
      cache_creation_1h_tokens: fixture.turn.cache_creation_1h_tokens,
      cache_read_tokens: fixture.turn.cache_read_tokens,
      effective_cost_units: fixture.turn.effective_cost_units,
    },
    created_at: fixture.turn.created_at,
    updated_at: fixture.turn.created_at,
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-m7-e2e-"));
  env = {
    ...process.env,
    CACHELANE_HOME: path.join(tmpDir, "cachelane"),
    CACHELANE_WORKSPACE_ID: fixture.workspace_id,
    CACHELANE_SESSION_ID: fixture.session_id,
  };
  const db = openDatabase(path.join(env.CACHELANE_HOME!, "cachelane.db"));
  seedFixture(db);
  db.close();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("M7 E2E fixture", () => {
  it("drives stats, explain, and expand from a metadata-only session fixture", async () => {
    const stats = JSON.parse(await runCli(["stats", "--json"])) as {
      turns: number;
      cache_hit_ratio: number;
      pruner_counts: { pruned_blocks: number };
    };
    const explain = JSON.parse(await runCli(["explain", "--json"])) as {
      found: boolean;
      explanation: { turn_id: string; prune_decisions: unknown[] };
    };
    const db = openDatabase(path.join(env.CACHELANE_HOME!, "cachelane.db"));
    const expanded = handleExpandTool(
      {
        db,
        workspace_id: fixture.workspace_id,
        session_id: fixture.session_id,
      },
      { block_id: fixture.block.id.slice(0, 8) },
    );
    db.close();

    expect(stats).toMatchObject({
      turns: 1,
      cache_hit_ratio: 0.88,
      pruner_counts: { pruned_blocks: 1 },
    });
    expect(explain).toMatchObject({
      found: true,
      explanation: {
        turn_id: fixture.turn.id,
        prune_decisions: [{ block_id: fixture.block.id }],
      },
    });
    expect(JSON.stringify(explain)).not.toContain("raw prompt");
    expect(expanded).toMatchObject({
      ok: true,
      refetch_request: {
        type: "trusted_refetch",
        refetch_handle: fixture.block.refetch_handle,
      },
    });
  });
});
