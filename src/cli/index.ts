#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadConfig } from "../config/index.js";
import { openDatabase } from "../storage/index.js";
import { startCachelaneStdioServer } from "../server/index.js";
import {
  addExcludePattern,
  addPinPattern,
  setKeepalivePolicy,
  setPrunerEnabled,
  setPrunerMode,
  setTelemetryOptIn,
} from "./config.js";
import { formatDoctor, runDoctor } from "./doctor.js";
import { formatExplanation, formatStats, jsonLine } from "./format.js";
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
    .argument("<name>", "pre-request or post-response")
    .action(async () => {
      const input = await readStdin();
      if (input.trim().length === 0) return;
      JSON.parse(input);
      io.stdout(input.endsWith("\n") ? input : `${input}\n`);
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

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
