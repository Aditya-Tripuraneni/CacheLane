import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type CachelaneDb } from "../storage/index.js";
import type { AnthropicMessagesRequest } from "../orchestrator/index.js";
import type { NormalizedTraceSession, AgentTraceTurn } from "../agent-traces/types.js";
import { countTokens } from "../tokenizer/index.js";
import { CacheStateTracker } from "../orchestrator/index.js";
import {
  classifyAllMessages,
  computeBlockPlacements,
} from "../proxy/server.js";
import { loadConfig } from "../config/index.js";
import { handlePreRequest, type StageCollector } from "../hooks/pre-request.js";
import { summarizeStage } from "./stats.js";
import type { LatencyReport, StageLatencyStats, LatencyScenarioRow } from "./types.js";

const TOOL_KINDS = new Set([
  "tool_output",
  "tool_use_result_pair",
  "tool_result",
]);

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function tokensOf(content: string, model: string): number {
  try {
    return countTokens(content, model);
  } catch {
    return Math.ceil(content.length / 4);
  }
}

/** Build an AnthropicMessagesRequest from a trace turn.
 *  Tool-ish blocks become tool_result content keyed by block id so
 *  computeBlockPlacements resolves them. */
export function buildReplayRequest(
  turn: AgentTraceTurn,
  model: string,
): AnthropicMessagesRequest {
  const toolResults = turn.blocks_in_prompt
    .filter((b) => TOOL_KINDS.has(b.kind))
    .map((b) => ({
      type: "tool_result" as const,
      tool_use_id: b.id,
      content: b.content,
    }));

  const textBlocks = turn.blocks_in_prompt
    .filter((b) => !TOOL_KINDS.has(b.kind))
    .map((b) => ({ type: "text" as const, text: b.content }));

  const messages: AnthropicMessagesRequest["messages"] = [
    { role: "user", content: [...textBlocks, ...toolResults] },
  ];

  return { model, messages, max_tokens: 1024 };
}

/** Insert this turn's blocks so the DB grows as it would in production. */
export function seedBlocksForTurn(
  db: CachelaneDb,
  workspaceId: string,
  sessionId: string,
  turn: AgentTraceTurn,
  turnNumber: number,
): void {
  const now = Date.now();
  const model = "claude-opus-4-7";
  for (const b of turn.blocks_in_prompt) {
    if (db.getBlock(b.id) !== null) continue;
    db.insertBlock({
      id: b.id,
      workspace_id: workspaceId,
      session_id: sessionId,
      content_hash: hash(b.content),
      kind: b.kind,
      volatility: "VOLATILE",
      is_pinned: false,
      token_count: tokensOf(b.content, model),
      added_at_turn: turnNumber,
      last_referenced_at_turn: turnNumber,
      unused_turns: 0,
      is_stub: false,
      stub_summary: null,
      refetch_handle: null,
      restored_at_turn: null,
      created_at: now,
      updated_at: now,
    });
  }
}

export interface LatencyBenchmarkOptions {
  run_id: string;
  generated_at: string;
  sessions: NormalizedTraceSession[];
  model: string;
  warmup: number;
  iterations: number;
  normalized_dir?: string | null;
  config_path?: string;
}

const STAGE_ORDER = [
  "config_load",
  "classify",
  "block_placements",
  "prune",
  "materialize",
  "orchestrate",
  "db_record",
  "serialize",
  "total",
] as const;

const WORKSPACE = "benchmark-ws";

function timeSync<T>(fn: () => T): { value: T; ns: bigint } {
  const start = process.hrtime.bigint();
  const value = fn();
  return { value, ns: process.hrtime.bigint() - start };
}

export function measurePipelineLatency(opts: LatencyBenchmarkOptions): LatencyReport {
  const samples: Record<string, bigint[]> = {};
  for (const s of STAGE_ORDER) samples[s] = [];
  const scenarioRows: LatencyScenarioRow[] = [];
  let totalTurns = 0;

  for (const session of opts.sessions) {
    const scenarioTotals: bigint[] = [];

    const runPass = (record: boolean): void => {
      const db = openDatabase(":memory:");
      const tracker = new CacheStateTracker();
      let turnNumber = 0;

      for (const turn of session.turns) {
        const request = buildReplayRequest(turn, opts.model);

        const cfg = timeSync(() =>
          loadConfig(opts.config_path ?? join(tmpdir(), "cachelane-bench-config.json")),
        );
        const classes = timeSync(() =>
          classifyAllMessages(request.messages, turnNumber, cfg.value),
        );
        const placements = timeSync(() =>
          computeBlockPlacements(
            request.messages,
            db.getBlocksBySession(WORKSPACE, session.session_id),
          ),
        );

        const innerNs: Record<string, bigint> = {};
        const collector: StageCollector = {
          mark: (stage, ns) => {
            innerNs[stage] = ns;
          },
        };

        const preResult = timeSync(() =>
          handlePreRequest({
            db,
            tracker,
            workspace_id: WORKSPACE,
            session_id: session.session_id,
            current_turn: turnNumber,
            original_request: request,
            message_classifications: classes.value,
            block_placements: placements.value,
            pruner: cfg.value.pruner,
            timings: collector,
          }),
        );

        const serialize = timeSync(() => JSON.stringify(preResult.value.request));

        // Seed AFTER timing so the next turn sees accumulated DB state.
        seedBlocksForTurn(db, WORKSPACE, session.session_id, turn, turnNumber);

        if (record) {
          const total =
            cfg.ns +
            classes.ns +
            placements.ns +
            serialize.ns +
            (innerNs["prune"] ?? 0n) +
            (innerNs["materialize"] ?? 0n) +
            (innerNs["orchestrate"] ?? 0n) +
            (innerNs["db_record"] ?? 0n);

          samples["config_load"]!.push(cfg.ns);
          samples["classify"]!.push(classes.ns);
          samples["block_placements"]!.push(placements.ns);
          samples["prune"]!.push(innerNs["prune"] ?? 0n);
          samples["materialize"]!.push(innerNs["materialize"] ?? 0n);
          samples["orchestrate"]!.push(innerNs["orchestrate"] ?? 0n);
          samples["db_record"]!.push(innerNs["db_record"] ?? 0n);
          samples["serialize"]!.push(serialize.ns);
          samples["total"]!.push(total);
          scenarioTotals.push(total);
        }
        turnNumber++;
      }
      db.close();
    };

    for (let w = 0; w < opts.warmup; w++) runPass(false);
    for (let i = 0; i < opts.iterations; i++) runPass(true);

    totalTurns += session.turns.length;
    scenarioRows.push({
      scenario_id: session.scenario_id,
      session_id: session.session_id,
      turns: session.turns.length,
      total_p95_ms: summarizeStage("total", scenarioTotals).p95_ms,
    });
  }

  const stages: StageLatencyStats[] = STAGE_ORDER.map((s) =>
    summarizeStage(s, samples[s]!),
  );

  return {
    run_id: opts.run_id,
    generated_at: opts.generated_at,
    source: {
      kind: "normalized_trace",
      provider: opts.sessions[0]?.provider ?? null,
      normalized_dir: opts.normalized_dir ?? null,
      model: opts.model,
    },
    config: { warmup: opts.warmup, iterations: opts.iterations },
    counts: { sessions: opts.sessions.length, turns: totalTurns },
    stages,
    scenarios: scenarioRows,
    privacy: { content_persisted: false },
  };
}

export function formatLatencyMarkdown(report: LatencyReport): string {
  const f = (n: number) => n.toFixed(3);
  const lines = [
    `# CacheLane Proxy Latency Benchmark ${report.run_id}`,
    "",
    `Generated: ${report.generated_at}`,
    `Provider: ${report.source.provider ?? "unknown"}   Model: ${report.source.model}`,
    `Config: warmup=${report.config.warmup}, iterations=${report.config.iterations}`,
    `Sessions: ${report.counts.sessions}   Turns: ${report.counts.turns}`,
    "",
    "## Per-stage overhead (ms)",
    "",
    "| Stage | p50 | p95 | p99 | mean | max | samples |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...report.stages.map(
      (s) =>
        `| ${s.stage} | ${f(s.p50_ms)} | ${f(s.p95_ms)} | ${f(s.p99_ms)} | ${f(s.mean_ms)} | ${f(s.max_ms)} | ${s.samples} |`,
    ),
    "",
    "## Scenarios",
    "",
    "| Scenario | Turns | total p95 (ms) |",
    "|---|---:|---:|",
    ...report.scenarios.map(
      (r) => `| ${r.scenario_id} | ${r.turns} | ${f(r.total_p95_ms)} |`,
    ),
    "",
    "Timings only. No prompt text, assistant text, tool output, or file contents are persisted.",
    "",
  ];
  return lines.join("\n");
}
