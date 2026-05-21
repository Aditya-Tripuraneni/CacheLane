import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCachelaneCli } from "../index.js";
import { openDatabase } from "../../storage/index.js";

let tmpDir: string;
let env: NodeJS.ProcessEnv;

async function run(args: string[]): Promise<string> {
  let stdout = "";
  let stderr = "";
  const program = createCachelaneCli({
    env,
    io: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
  });
  program.exitOverride();
  await program.parseAsync(["node", "cachelane", ...args]);
  expect(stderr).toBe("");
  return stdout;
}

async function runFailure(args: string[]): Promise<string> {
  let stdout = "";
  let stderr = "";
  const program = createCachelaneCli({
    env,
    io: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
  });
  program.exitOverride();

  try {
    await program.parseAsync(["node", "cachelane", ...args]);
  } catch (err) {
    return `${stdout}${stderr}${err instanceof Error ? err.message : String(err)}`;
  }
  throw new Error("Expected command to fail");
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-cli-"));
  env = {
    ...process.env,
    CACHELANE_HOME: path.join(tmpDir, "cachelane"),
    CLAUDE_HOME: path.join(tmpDir, "claude"),
    CACHELANE_WORKSPACE_ID: "ws-1",
    CACHELANE_SESSION_ID: "sess-1",
  };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("cachelane CLI", () => {
  it("config mutation commands update only intended fields", async () => {
    const configPath = path.join(env.CACHELANE_HOME!, "config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          version: 1,
          pruner: {
            enabled: true,
            k: 3,
            mode: "default",
            unrelated: "preserved",
          },
          keepalive: {
            policy: "auto",
            interval_seconds: 150,
            idle_threshold_seconds: 240,
            large_prefix_threshold_tokens: 50000,
          },
          classification: {
            pin: [],
            exclude: [],
            sliding_window_turns: 4,
            custom: "preserved",
          },
          telemetry: { opt_in: false, endpoint: "" },
          log_level: "info",
          top_level_custom: true,
        },
        null,
        2,
      ),
    );

    await run(["pin", "src/**/*.ts"]);
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      classification: { pin: string[]; custom: string };
      pruner: { unrelated: string };
      top_level_custom: boolean;
    };

    expect(raw.classification.pin).toEqual(["src/**/*.ts"]);
    expect(raw.classification.custom).toBe("preserved");
    expect(raw.pruner.unrelated).toBe("preserved");
    expect(raw.top_level_custom).toBe(true);
  });

  it("stats --json returns stable scoped output", async () => {
    const db = openDatabase(path.join(env.CACHELANE_HOME!, "cachelane.db"));
    db.insertTurn({
      id: "turn-cli-stats",
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 1,
      model: "claude-opus-4-7",
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_5m_tokens: 0,
      cache_creation_1h_tokens: 0,
      cache_read_tokens: 900,
      effective_cost_units: 190,
      prefix_breakpoint_hash: null,
      middle_breakpoint_hash: null,
      pruned_blocks_count: 2,
      keepalive_pings_since_last_turn: 1,
      created_at: 1_715_000_000_000,
    });
    db.close();

    const output = await run(["stats", "--json"]);
    expect(JSON.parse(output)).toMatchObject({
      turns: 1,
      cache_hit_ratio: 0.9,
      pruner_counts: { pruned_blocks: 2 },
      keepalive_counts: { pings: 1 },
    });
  });

  it("stats --json returns zero totals for an empty DB", async () => {
    const output = await run(["stats", "--json"]);
    expect(JSON.parse(output)).toMatchObject({
      turns: 0,
      cache_hit_ratio: 0,
      effective_cost_units: 0,
      baseline_cost_units: 0,
      savings_ratio: 0,
    });
  });

  it("stats rejects invalid scope and invalid since values", async () => {
    await expect(runFailure(["stats", "--scope", "project"])).resolves.toContain(
      "Invalid stats scope",
    );
    await expect(runFailure(["stats", "--since", "last-week"])).resolves.toContain(
      "Invalid since value",
    );
  });

  it("explain --json returns metadata-only explanations", async () => {
    const db = openDatabase(path.join(env.CACHELANE_HOME!, "cachelane.db"));
    db.insertTurnExplanation({
      turn_id: "turn-cli-explain",
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 1,
      model: "claude-opus-4-7",
      prefix_breakpoint_hash: null,
      middle_breakpoint_hash: null,
      mutated: true,
      pruned_blocks_count: 0,
      prune_decisions: [],
      block_metadata: [],
      region_metadata: {
        message_count: 1,
        stable_count: 0,
        semi_count: 0,
        volatile_count: 1,
      },
      signals: ["prefix_cached"],
      created_at: 1_715_000_000_000,
      updated_at: 1_715_000_000_000,
    });
    db.close();

    const output = await run(["explain", "--json"]);
    expect(JSON.stringify(JSON.parse(output))).not.toContain("fixture prompt");
    expect(JSON.parse(output)).toMatchObject({
      found: true,
      explanation: { turn_number: 1, mutated: true },
    });
  });

  it("explain --json returns found=false for an empty DB", async () => {
    const output = await run(["explain", "--json"]);
    expect(JSON.parse(output)).toEqual({ found: false });
  });

  it("explain rejects invalid turn numbers", async () => {
    await expect(runFailure(["explain", "--turn", "nan"])).resolves.toContain(
      "Invalid turn number",
    );
  });

  it("doctor --json has stable check shape", async () => {
    const output = await run(["doctor", "--json"]);
    const report = JSON.parse(output) as { checks: { name: string; ok: boolean }[] };
    expect(report.checks.map((check) => check.name)).toEqual([
      "node",
      "config",
      "database",
      "mcp",
      "hooks",
      "data",
    ]);
  });

  it("install is idempotent against temp-home Claude fixtures", async () => {
    fs.mkdirSync(env.CLAUDE_HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(env.CLAUDE_HOME!, "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other" } } }, null, 2),
    );

    const first = JSON.parse(await run(["install"])) as { changed: boolean };
    const second = JSON.parse(await run(["install"])) as { changed: boolean };
    const mcp = JSON.parse(
      fs.readFileSync(path.join(env.CLAUDE_HOME!, "mcp.json"), "utf-8"),
    ) as { mcpServers: Record<string, unknown> };

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["cachelane", "other"]);
  });

  it("install reports malformed Claude MCP config without overwriting it", async () => {
    fs.mkdirSync(env.CLAUDE_HOME!, { recursive: true });
    const mcpPath = path.join(env.CLAUDE_HOME!, "mcp.json");
    fs.writeFileSync(mcpPath, "{not json");

    await expect(runFailure(["install"])).resolves.toContain("Invalid JSON");
    expect(fs.readFileSync(mcpPath, "utf-8")).toBe("{not json");
  });

  it("install replaces an existing CacheLane hook descriptor", async () => {
    const hookPath = path.join(env.CLAUDE_HOME!, "hooks", "cachelane.json");
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, JSON.stringify({ name: "cachelane", old: true }, null, 2));

    await run(["install"]);
    const hook = JSON.parse(fs.readFileSync(hookPath, "utf-8")) as {
      hooks: { PreRequest: unknown[]; PostResponse: unknown[] };
    };

    expect(hook.hooks.PreRequest).toHaveLength(1);
    expect(hook.hooks.PostResponse).toHaveLength(1);
  });

  it("keepalive rejects invalid policies", async () => {
    await expect(runFailure(["keepalive", "forever"])).resolves.toContain(
      "Invalid keepalive policy",
    );
  });

  it("config mutation commands report malformed CacheLane config", async () => {
    const configPath = path.join(env.CACHELANE_HOME!, "config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "{bad json");

    await expect(runFailure(["pin", "src/**/*.ts"])).resolves.toContain(
      "Invalid JSON",
    );
  });

  it("uninstall preserves data unless --purge is passed", async () => {
    await run(["install"]);
    const dbPath = path.join(env.CACHELANE_HOME!, "cachelane.db");
    openDatabase(dbPath).close();

    await run(["uninstall"]);
    expect(fs.existsSync(path.join(env.CACHELANE_HOME!, "config.json"))).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true);

    await run(["install"]);
    await run(["uninstall", "--purge"]);
    expect(fs.existsSync(env.CACHELANE_HOME!)).toBe(false);
  });
});
