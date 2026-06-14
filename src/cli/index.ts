#!/usr/bin/env node
import fs from "node:fs";
import { realpathSync } from "node:fs";
import path from "node:path";

import { Command } from "commander";
import { loadConfig, defaultWorkspaceId } from "../config/index.js";
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
import { getBannerText, printHelp } from "./banner.js";
import { installCachelane, uninstallCachelane } from "./install.js";
import {
  cachelaneHome,
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

function parsePositiveLimit(value: string): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid limit: ${value}`);
  }
  return limit;
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

function readPrunerDebugEntries(logPath: string, limit: number): unknown[] {
  let content: string;
  try {
    content = fs.readFileSync(logPath, "utf-8");
  } catch {
    return [];
  }

  const entries: unknown[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      if (row.event !== "pruner debug") continue;

      const message =
        typeof row.message === "string"
          ? (JSON.parse(row.message) as Record<string, unknown>)
          : {};

      entries.push({
        ts: row.ts,
        pid: row.pid,
        session_id: message.session_id ?? row.session_id,
        ...message,
      });
    } catch {
      // Skip malformed log lines; debug output should stay best-effort.
    }
  }

  return entries.slice(-limit);
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

    // In Hook mode (e.g. Bedrock), we bypass the HTTP proxy, so we must
    // record turn statistics directly from the Claude Code transcript.
    const db = openDatabase(cachelaneDbPath(env));
    try {
      const workspaceId = env.CACHELANE_WORKSPACE_ID ?? defaultWorkspaceId();
      const sessionId = typeof parsed.session_id === "string" ? parsed.session_id : "default";

      for (const call of calls) {
        if (!db.getTurn(call.id)) {
          const effective = calculateEffectiveCostUnits({
            input_tokens: call.input_tokens,
            cache_creation_5m_tokens: call.cache_creation_5m_tokens,
            cache_creation_1h_tokens: call.cache_creation_1h_tokens,
            cache_read_tokens: call.cache_read_tokens,
          });

          const currentTurn = db.allocateTurnNumber({
            workspace_id: workspaceId,
            session_id: sessionId,
            updated_at: call.created_at,
          });

          db.insertTurn({
            id: call.id,
            workspace_id: workspaceId,
            session_id: sessionId,
            turn_number: currentTurn,
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
            signals: JSON.stringify(["mode:hook"]),
            request_mutated: 1, // Indicate it was processed in hook mode
            created_at: call.created_at,
          });
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
    .addHelpText("beforeAll", getBannerText())
    .configureOutput({
      writeOut: io.stdout,
      writeErr: io.stderr,
    });

  program
    .command("help", { isDefault: false })
    .description("Show the full command reference")
    .action(() => {
      printHelp();
    });

  program
    .command("banner")
    .description("Print the CacheLane welcome banner")
    .action(() => {
      printHelp();
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

  const debugCmd = program
    .command("debug")
    .description("Read structured CacheLane debug logs");

  debugCmd
    .command("pruner")
    .description("Print recent pruner debug entries as a single JSON array")
    .option("--limit <number>", "number of entries to return", parsePositiveLimit, 5)
    .option("--log <path>", "CacheLane log path")
    .action((cmd: { limit: number; log?: string }) => {
      const logPath = cmd.log ?? path.join(cachelaneHome(env), "cachelane.log");
      io.stdout(jsonLine(readPrunerDebugEntries(logPath, cmd.limit)));
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
      if (process.stdin.isTTY) {
        io.stderr(`[cachelane] hook ${name} expects JSON payload on stdin. It is hanging because it is waiting for input.\n`);
        process.exitCode = 1;
        return;
      }
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
    .command("hook-mutate")
    .description("(DEPRECATED) Hook-based mutation engine for Claude Code. Use CacheLane proxy instead.")
    .action(async () => {
      io.stderr("[cachelane] WARNING: hook-mutate is deprecated and cannot perform pruning. Please use the CacheLane proxy instead.\n");
      if (process.stdin.isTTY) {
        io.stderr("[cachelane] hook-mutate expects JSON payload on stdin. It is hanging because it is waiting for input.\nUsage example: echo '{\"prompt\":\"test\"}' | cachelane hook-mutate\n");
        process.exitCode = 1;
        return;
      }
      const input = await readStdin();
      if (input.trim().length === 0) return;
      try {
        const { handleHookMutate } = await import("./hook-mutate.js");
        const parsed = JSON.parse(input) as Record<string, unknown>;
        const result = await handleHookMutate(env, parsed);
        if (result !== undefined) {
          io.stdout(result);
        }
      } catch (err) {
        // Fail open — log to stderr but don't break stdout
        io.stderr(`[cachelane] hook-mutate error: ${err instanceof Error ? err.message : String(err)}\n`);
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

  const benchmarkCmd = program.command("benchmark").description("Benchmark suite");
  
  benchmarkCmd
    .command("compare")
    .description("Compare CacheLane vs Baseline on a recorded agent trace")
    .argument("<trace>", "Path to normalized trace directory")
    .action(async (trace: string) => {
      const { loadNormalizedTraceSessions } = await import("../benchmark/recorded.js");
      const { runBaselineCompare } = await import("../benchmark/baseline-compare.js");
      const sessions = loadNormalizedTraceSessions(trace);
      const output = runBaselineCompare({
        run_id: "cli",
        generated_at: new Date().toISOString(),
        sessions,
        normalized_dir: trace,
      });
      io.stdout(output + "\n");
    });

  benchmarkCmd
    .command("live-report")
    .description("Analyze and report cache savings/costs from local SQLite database")
    .option("--db <path>", "SQLite database path")
    .option("--session <id>", "Report on a specific session")
    .option("--json", "Output as JSON")
    .action(async (cmd: { db?: string; session?: string; json?: boolean }) => {
      const { runLiveReport } = await import("../benchmark/index.js");
      runLiveReport(cmd);
    });

  benchmarkCmd
    .command("ab-test")
    .description("Run a live A/B toggle test of CacheLane savings")
    .option("--turns-per-phase <number>", "Number of turns per phase (default: 5)", (v) => parseInt(v, 10), 5)
    .option("--db <path>", "SQLite database path")
    .option("--scope <scope>", "Scope for turn detection (session, workspace, all) (default: session)")
    .action(async (cmd: { turnsPerPhase: number; db?: string; scope?: string }) => {
      const { runLiveAbTest } = await import("../benchmark/index.js");
      await runLiveAbTest(cmd);
    });

  benchmarkCmd
    .command("dashboard")
    .description("View the live benchmark dashboard terminal TUI")
    .option("--interval <seconds>", "Refresh interval in seconds (default: 3)", (v) => parseInt(v, 10), 3)
    .option("--db <path>", "SQLite database path")
    .option("--scope <scope>", "Scope for stats aggregation (session, workspace, all) (default: session)")
    .action(async (cmd: { interval: number; db?: string; scope?: string }) => {
      const { runDashboard } = await import("../benchmark/index.js");
      runDashboard(cmd);
    });

  benchmarkCmd
    .command("duel")
    .description("Run CacheLane ON vs OFF on the same scenarios and emit one comparison report")
    .option("--run-id <id>", "Run identifier (default: timestamp)")
    .option("--cooldown <seconds>", "Cooldown between ON/OFF runs", (v) => parseInt(v, 10), 360)
    .option("--model <model>", "Model id for the estimate tier", "claude-sonnet-4-6")
    .option("--scenario-dir <dir>", "Scenario directory")
    .option("--estimate-only", "Skip live Claude Code runs (free, CI-safe)", false)
    .action(async (cmd: {
      runId?: string; cooldown: number; model: string; scenarioDir?: string; estimateOnly: boolean;
    }) => {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const { loadScenarioSpecs } = await import("../agent-traces/scenarios.js");
      const { createClaudeCodeAdapter } = await import("../agent-traces/providers/claude-code.js");
      const { normalizeTrace } = await import("../agent-traces/normalizer.js");
      const { extractBilledUsage } = await import("../benchmark/usage-extract.js");
      const { runDuel, renderDuelMarkdown } = await import("../benchmark/index.js");
      const { setMutationEnabled } = await import("./config.js");

      const runId = cmd.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
      const configPath = cachelaneConfigPath(env);
      const scenarios = loadScenarioSpecs(cmd.scenarioDir);
      const adapter = createClaudeCodeAdapter();
      const runDir = resolve(process.cwd(), "benchmark", "runs", runId);
      mkdirSync(runDir, { recursive: true });

      const report = await runDuel(
        { run_id: runId, cooldown_seconds: cmd.cooldown, model: cmd.model, estimate_only: cmd.estimateOnly },
        scenarios,
        {
          setMutationEnabled: (enabled: boolean) => { setMutationEnabled(configPath, enabled); },
          sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
          now: () => new Date(),
          runScenarioSession: async (scenarioId: string) => {
            const scenario = scenarios.find((s) => s.id === scenarioId)!;
            const raw = await adapter.runScenario(scenario, {
              dry_run: cmd.estimateOnly,
              run_id: runId,
              run_dir: runDir,
              now: () => new Date(),
            });
            const normalized = normalizeTrace(raw);
            const billed = raw.transcript_path
              ? extractBilledUsage(raw.transcript_path)
              : { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
            return { normalized, transcriptPath: raw.transcript_path, billed };
          },
        },
      );

      // Always restore mutation to ON after the duel (fail-open default).
      setMutationEnabled(configPath, true);

      const jsonPath = resolve(runDir, "duel-report.json");
      const mdPath = resolve(runDir, "DUEL-REPORT.md");
      writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      writeFileSync(mdPath, renderDuelMarkdown(report), "utf8");

      io.stdout(`${JSON.stringify({ run_id: runId, json_path: jsonPath, markdown_path: mdPath, totals: report.totals }, null, 2)}\n`);
    });

  return program;
}

export async function runCli(argv = process.argv, options: CliOptions = {}): Promise<void> {
  await createCachelaneCli(options).parseAsync(argv);
}

const _argv1 = process.argv[1] ? (() => { try { return realpathSync(process.argv[1]).replace(/\\/g, "/"); } catch { return process.argv[1].replace(/\\/g, "/"); } })() : "";
if (_argv1 && (
  _argv1.endsWith("dist/cli/index.js") ||
  _argv1.endsWith("dist/cli/index.cjs") ||
  _argv1.endsWith("bin/cachelane") ||
  _argv1.endsWith("src/cli/index.ts")
)) {
  runCli().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
