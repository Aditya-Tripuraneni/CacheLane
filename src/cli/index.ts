#!/usr/bin/env node
import fs from "node:fs";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadConfig } from "../config/index.js";
import { openDatabase, calculateEffectiveCostUnits } from "../storage/index.js";
import { startCachelaneStdioServer } from "../server/index.js";
import { startProxy } from "../proxy/server.js";
import {
  addExcludePattern,
  addPinPattern,
  setKeepalivePolicy,
  setPrunerEnabled,
  setPrunerMode,
  setTelemetryOptIn,
} from "./config.js";
import { formatDoctor, runDoctor } from "./doctor.js";
import { formatExplanation, formatSessions, formatStats, jsonLine } from "./format.js";
import { installCachelane, uninstallCachelane } from "./install.js";
import {
  cachelaneConfigPath,
  cachelaneDbPath,
} from "./paths.js";
import {
  handleExplainTool,
  handleStatsTool,
  type CachelaneMcpContext,
} from "../server/tools.js";
import type { CachelaneConfig } from "../types/index.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface CliOptions {
  env?: NodeJS.ProcessEnv;
  io?: CliIo;
}

type JsonCommandOptions = {
  json?: boolean;
};

function defaultIo(): CliIo {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  };
}

function contextFromOptions(
  env: NodeJS.ProcessEnv,
  options: {
    db?: string;
    workspaceId?: string;
    sessionId?: string;
  },
): { context: CachelaneMcpContext; close: () => void } {
  const db = openDatabase(options.db ?? cachelaneDbPath(env));
  return {
    context: {
      db,
      workspace_id: options.workspaceId ?? env.CACHELANE_WORKSPACE_ID ?? "default",
      session_id: options.sessionId ?? env.CACHELANE_SESSION_ID ?? "default",
    },
    close: () => db.close(),
  };
}

function printConfig(io: CliIo, config: CachelaneConfig): void {
  io.stdout(`${JSON.stringify(config, null, 2)}\n`);
}

function parseStatsScope(value: string): "session" | "workspace" | "all" {
  if (value === "session" || value === "workspace" || value === "all") {
    return value;
  }
  throw new Error(`Invalid stats scope: ${value}`);
}

function parsePositiveTurn(value: string): number {
  const turn = Number(value);
  if (!Number.isInteger(turn) || turn < 1) {
    throw new Error(`Invalid turn number: ${value}`);
  }
  return turn;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
}

interface TranscriptApiCall {
  id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  cache_read_tokens: number;
  created_at: number;
}

function parseTranscriptApiCalls(content: string): TranscriptApiCall[] {
  const calls: TranscriptApiCall[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as Record<string, unknown>;
      const msg = entry.message as Record<string, unknown> | undefined;
      if (!msg || msg.role !== "assistant" || !msg.id || !msg.usage) continue;

      const u = msg.usage as Record<string, number | Record<string, number> | undefined>;
      const num = (v: number | undefined) => (typeof v === "number" ? v : 0);

      calls.push({
        id: msg.id as string,
        model: (msg.model as string) ?? "",
        input_tokens: num(u.input_tokens as number | undefined),
        output_tokens: num(u.output_tokens as number | undefined),
        cache_creation_5m_tokens: num(
          (u.ephemeral_5m_input_tokens ??
            u.cache_creation_5m_tokens ??
            u.cache_creation_input_tokens) as number | undefined,
        ),
        cache_creation_1h_tokens: num(
          (u.ephemeral_1h_input_tokens ?? u.cache_creation_1h_tokens) as number | undefined,
        ),
        cache_read_tokens: num(
          (u.cache_read_input_tokens ?? u.cache_read_tokens) as number | undefined,
        ),
        created_at: typeof entry.timestamp === "number" ? (entry.timestamp as number) : Date.now(),
      });
    } catch {
      // Skip malformed lines
    }
  }
  return calls;
}

async function handleHookEvent(env: NodeJS.ProcessEnv, parsed: Record<string, unknown>): Promise<void> {
  try {
    const sessionId =
      (typeof parsed.session_id === "string" ? parsed.session_id : undefined) ??
      (typeof parsed.sessionId === "string" ? parsed.sessionId : undefined) ??
      env.CACHELANE_SESSION_ID ??
      "default";
    const workspaceId = env.CACHELANE_WORKSPACE_ID ?? "default";

    const transcriptPath =
      typeof parsed.transcript_path === "string" ? parsed.transcript_path : null;
    if (!transcriptPath) return;

    let content: string;
    try {
      content = fs.readFileSync(transcriptPath, "utf-8");
    } catch {
      return;
    }

    const calls = parseTranscriptApiCalls(content);
    if (calls.length === 0) return;

    const db = openDatabase(cachelaneDbPath(env));
    try {
      const stats = db.getStats({ scope: "session", workspace_id: workspaceId, session_id: sessionId });
      let nextTurn = stats.turns + 1;

      for (const call of calls) {
        const effective = calculateEffectiveCostUnits({
          input_tokens: call.input_tokens,
          cache_creation_5m_tokens: call.cache_creation_5m_tokens,
          cache_creation_1h_tokens: call.cache_creation_1h_tokens,
          cache_read_tokens: call.cache_read_tokens,
        });
        try {
          db.insertTurn({
            id: call.id,
            workspace_id: workspaceId,
            session_id: sessionId,
            turn_number: nextTurn,
            model: call.model,
            input_tokens: call.input_tokens,
            output_tokens: call.output_tokens,
            cache_creation_5m_tokens: call.cache_creation_5m_tokens,
            cache_creation_1h_tokens: call.cache_creation_1h_tokens,
            cache_read_tokens: call.cache_read_tokens,
            effective_cost_units: effective,
            prefix_breakpoint_hash: null,
            middle_breakpoint_hash: null,
            pruned_blocks_count: 0,
            keepalive_pings_since_last_turn: 0,
            created_at: call.created_at,
          });
          nextTurn++;
        } catch {
          // Already recorded (UNIQUE constraint on id)
        }
      }
    } finally {
      db.close();
    }
  } catch (err) {
    process.stderr.write(`[cachelane] hook error: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export function createCachelaneCli(options: CliOptions = {}): Command {
  const env = options.env ?? process.env;
  const io = options.io ?? defaultIo();
  const program = new Command();

  program
    .name("cachelane")
    .description("Cache-aware prompt orchestration for Claude Code")
    .version("0.0.1")
    .configureOutput({
      writeOut: io.stdout,
      writeErr: io.stderr,
    });

  program
    .command("mcp")
    .description("Start the CacheLane MCP server over stdio")
    .option("--db <path>", "SQLite database path")
    .option("--workspace-id <id>", "Workspace scope")
    .option("--session-id <id>", "Session scope")
    .action(async (cmd: { db?: string; workspaceId?: string; sessionId?: string }) => {
      await startCachelaneStdioServer({
        db_path: cmd.db,
        workspace_id: cmd.workspaceId,
        session_id: cmd.sessionId,
      });
    });

  program
    .command("stats")
    .description("Read cache and pruning stats from the local SQLite log")
    .option("--scope <scope>", "stats scope", parseStatsScope, "session")
    .option("--since <time>", "ISO timestamp or ISO-8601 duration")
    .option("--workspace-id <id>", "Workspace scope")
    .option("--session-id <id>", "Session scope")
    .option("--db <path>", "SQLite database path")
    .option("--json", "Print stable JSON")
    .option("--opt-in", "Enable anonymous telemetry opt-in")
    .option("--opt-out", "Disable anonymous telemetry opt-in")
    .action((cmd: JsonCommandOptions & {
      scope: "session" | "workspace" | "all";
      since?: string;
      workspaceId?: string;
      sessionId?: string;
      db?: string;
      optIn?: boolean;
      optOut?: boolean;
    }) => {
      if (cmd.optIn || cmd.optOut) {
        const config = setTelemetryOptIn(cachelaneConfigPath(env), Boolean(cmd.optIn));
        printConfig(io, config);
        return;
      }

      const { context, close } = contextFromOptions(env, cmd);
      try {
        const stats = handleStatsTool(context, {
          scope: cmd.scope,
          since: cmd.since,
        });
        io.stdout(cmd.json ? jsonLine(stats) : `${formatStats(stats)}\n`);
      } finally {
        close();
      }
    });

  program
    .command("explain")
    .description("Read metadata-only explanation for the latest or requested turn")
    .option("--turn <number>", "Turn number", parsePositiveTurn)
    .option("--workspace-id <id>", "Workspace scope")
    .option("--session-id <id>", "Session scope")
    .option("--db <path>", "SQLite database path")
    .option("--json", "Print stable JSON")
    .action((cmd: JsonCommandOptions & {
      turn?: number;
      workspaceId?: string;
      sessionId?: string;
      db?: string;
    }) => {
      const { context, close } = contextFromOptions(env, cmd);
      try {
        const result = handleExplainTool(context, { turn: cmd.turn });
        io.stdout(cmd.json ? jsonLine(result) : `${formatExplanation(result)}\n`);
      } finally {
        close();
      }
    });

  program
    .command("sessions")
    .description("List all recorded sessions with cache stats")
    .option("--workspace-id <id>", "Filter by workspace")
    .option("--db <path>", "SQLite database path")
    .option("--json", "Print stable JSON")
    .action((cmd: JsonCommandOptions & { workspaceId?: string; db?: string }) => {
      const db = openDatabase(cmd.db ?? cachelaneDbPath(env));
      try {
        const rows = db.listSessions(cmd.workspaceId);
        io.stdout(cmd.json ? jsonLine(rows) : `${formatSessions(rows)}\n`);
      } finally {
        db.close();
      }
    });

  program
    .command("prune")
    .description("Set K-pruner mode")
    .option("--aggressive", "K=2")
    .option("--conservative", "K=5")
    .option("--default", "K=3")
    .action((cmd: { aggressive?: boolean; conservative?: boolean; default?: boolean }) => {
      const mode = cmd.aggressive
        ? "aggressive"
        : cmd.conservative
          ? "conservative"
          : "default";
      printConfig(io, setPrunerMode(cachelaneConfigPath(env), mode));
    });

  program
    .command("keepalive")
    .description("Set keepalive policy")
    .argument("<policy>", "off, static, adaptive, or auto")
    .action((policy: CachelaneConfig["keepalive"]["policy"]) => {
      if (!["off", "static", "adaptive", "auto"].includes(policy)) {
        throw new Error(`Invalid keepalive policy: ${policy}`);
      }
      printConfig(io, setKeepalivePolicy(cachelaneConfigPath(env), policy));
    });

  program
    .command("pin")
    .description("Add a classification pin glob")
    .argument("<pattern>", "file path or glob")
    .action((pattern: string) => {
      printConfig(io, addPinPattern(cachelaneConfigPath(env), pattern));
    });

  program
    .command("exclude")
    .description("Add a classification exclude glob")
    .argument("<pattern>", "file path or glob")
    .action((pattern: string) => {
      printConfig(io, addExcludePattern(cachelaneConfigPath(env), pattern));
    });

  program
    .command("enable")
    .description("Enable CacheLane pruning")
    .action(() => {
      printConfig(io, setPrunerEnabled(cachelaneConfigPath(env), true));
    });

  program
    .command("disable")
    .description("Disable CacheLane pruning")
    .action(() => {
      printConfig(io, setPrunerEnabled(cachelaneConfigPath(env), false));
    });

  program
    .command("doctor")
    .description("Check local CacheLane installation health")
    .option("--json", "Print stable JSON")
    .action((cmd: JsonCommandOptions) => {
      const report = runDoctor(env);
      io.stdout(cmd.json ? jsonLine(report) : `${formatDoctor(report)}\n`);
    });

  program
    .command("install")
    .description("Register CacheLane MCP and hook integration")
    .action(() => {
      io.stdout(jsonLine(installCachelane(env)));
    });

  program
    .command("uninstall")
    .description("Remove CacheLane MCP and hook integration")
    .option("--purge", "Also remove CacheLane config and database")
    .action((cmd: { purge?: boolean }) => {
      io.stdout(jsonLine(uninstallCachelane(env, Boolean(cmd.purge))));
    });

  program
    .command("hook")
    .description("Claude Code hook entrypoints")
    .argument("<name>", "hook event name (user-prompt-submit or stop)")
    .action(async (name: string) => {
      const input = await readStdin();
      if (input.trim().length === 0) return;
      try {
        const parsed = JSON.parse(input) as Record<string, unknown>;
        if (name === "user-prompt-submit" || name === "stop") {
          await handleHookEvent(env, parsed);
        }
      } catch {
        // Fail open — don't crash Claude Code
      }
    });

  program
    .command("proxy")
    .description("Start HTTP proxy that intercepts Anthropic API calls and runs the CacheLane pipeline")
    .option("--port <number>", "Port to listen on (default: 7332)", (v) => parseInt(v, 10), 7332)
    .option("--db <path>", "SQLite database path")
    .option("--config <path>", "CacheLane config path")
    .option("--workspace-id <id>", "Workspace scope")
    .option("--session-id <id>", "Session scope (default: auto-generated UUID)")
    .action((cmd: { port: number; db?: string; config?: string; workspaceId?: string; sessionId?: string }) => {
      startProxy({
        port: cmd.port,
        db_path: cmd.db ?? cachelaneDbPath(env),
        config_path: cmd.config ?? cachelaneConfigPath(env),
        workspace_id: cmd.workspaceId,
        session_id: cmd.sessionId,
      });
    });

  program
    .command("config")
    .description("Print active CacheLane config")
    .action(() => {
      printConfig(io, loadConfig(cachelaneConfigPath(env)));
    });

  return program;
}

export async function runCli(argv = process.argv, options: CliOptions = {}): Promise<void> {
  await createCachelaneCli(options).parseAsync(argv);
}

const _argv1 = process.argv[1] ? (() => { try { return realpathSync(process.argv[1]); } catch { return process.argv[1]; } })() : "";
if (_argv1 && fileURLToPath(import.meta.url) === _argv1) {
  runCli().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
