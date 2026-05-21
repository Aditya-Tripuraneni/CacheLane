import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NormalizedTraceSession } from "../agent-traces/types.js";
import { countTokens } from "../tokenizer/index.js";
import type { BenchmarkScenarioRow, RecordedBenchmarkReport } from "./types.js";

export type { BenchmarkScenarioRow, RecordedBenchmarkReport } from "./types.js";

export interface GenerateRecordedBenchmarkOptions {
  run_id: string;
  generated_at: string;
  sessions: NormalizedTraceSession[];
  normalized_dir?: string | null;
  model?: string;
}

const DEFAULT_BENCHMARK_MODEL = "claude-opus-4-7";

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function savingsRatio(baseline: number, effective: number): number {
  return baseline === 0 ? 0 : (baseline - effective) / baseline;
}

function countBlockTokens(content: string, model: string): number {
  try {
    return countTokens(content, model);
  } catch {
    return Math.ceil(content.length / 4);
  }
}

function scenarioRow(
  session: NormalizedTraceSession,
  model: string,
): BenchmarkScenarioRow {
  const seenContentHashes = new Set<string>();
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let prunedBlocks = 0;
  let blocks = 0;
  let toolCalls = 0;

  for (const turn of session.turns) {
    toolCalls += turn.tool_calls.length;

    for (const block of turn.blocks_in_prompt) {
      blocks++;
      if (block.kind === "stub") prunedBlocks++;

      const tokens = countBlockTokens(block.content, model);
      const hash = contentHash(block.content);
      if (seenContentHashes.has(hash)) {
        cacheReadTokens += tokens;
      } else {
        inputTokens += tokens;
        seenContentHashes.add(hash);
      }
    }
  }

  const baselineCostUnits = inputTokens + cacheReadTokens;
  const effectiveCostUnits = inputTokens + 0.1 * cacheReadTokens;

  return {
    scenario_id: session.scenario_id,
    session_id: session.session_id,
    turns: session.turns.length,
    blocks,
    tool_calls: toolCalls,
    input_tokens: inputTokens,
    cache_read_tokens: cacheReadTokens,
    baseline_cost_units: baselineCostUnits,
    effective_cost_units: effectiveCostUnits,
    savings_ratio: savingsRatio(baselineCostUnits, effectiveCostUnits),
    cache_hit_ratio: ratio(cacheReadTokens, baselineCostUnits),
    pruned_blocks: prunedBlocks,
    keepalive_pings: 0,
  };
}

export function loadNormalizedTraceSessions(dir: string): NormalizedTraceSession[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const path = resolve(dir, file);
      return JSON.parse(readFileSync(path, "utf8")) as NormalizedTraceSession;
    });
}

export function generateRecordedBenchmarkReport(
  options: GenerateRecordedBenchmarkOptions,
): RecordedBenchmarkReport {
  const model = options.model ?? DEFAULT_BENCHMARK_MODEL;
  const scenarios = options.sessions.map((session) => scenarioRow(session, model));
  const totals = scenarios.reduce(
    (acc, row) => ({
      input_tokens: acc.input_tokens + row.input_tokens,
      cache_read_tokens: acc.cache_read_tokens + row.cache_read_tokens,
      baseline_cost_units: acc.baseline_cost_units + row.baseline_cost_units,
      effective_cost_units: acc.effective_cost_units + row.effective_cost_units,
      pruned_blocks: acc.pruned_blocks + row.pruned_blocks,
      keepalive_pings: acc.keepalive_pings + row.keepalive_pings,
    }),
    {
      input_tokens: 0,
      cache_read_tokens: 0,
      baseline_cost_units: 0,
      effective_cost_units: 0,
      pruned_blocks: 0,
      keepalive_pings: 0,
    },
  );

  return {
    run_id: options.run_id,
    generated_at: options.generated_at,
    source: {
      kind: "normalized_trace",
      provider: options.sessions[0]?.provider ?? null,
      normalized_dir: options.normalized_dir ?? null,
      model,
    },
    counts: {
      sessions: options.sessions.length,
      turns: scenarios.reduce((sum, row) => sum + row.turns, 0),
      blocks: scenarios.reduce((sum, row) => sum + row.blocks, 0),
      tool_calls: scenarios.reduce((sum, row) => sum + row.tool_calls, 0),
    },
    totals: {
      ...totals,
      savings_ratio: savingsRatio(
        totals.baseline_cost_units,
        totals.effective_cost_units,
      ),
      cache_hit_ratio: ratio(
        totals.cache_read_tokens,
        totals.input_tokens + totals.cache_read_tokens,
      ),
    },
    scenarios,
    privacy: {
      content_persisted: false,
    },
  };
}

export function formatBenchmarkMarkdown(report: RecordedBenchmarkReport): string {
  const lines = [
    `# CacheLane Recorded Benchmark ${report.run_id}`,
    "",
    `Generated: ${report.generated_at}`,
    `Source provider: ${report.source.provider ?? "unknown"}`,
    `Model: ${report.source.model}`,
    "",
    "## Totals",
    "",
    `- Sessions: ${report.counts.sessions}`,
    `- Turns: ${report.counts.turns}`,
    `- Blocks: ${report.counts.blocks}`,
    `- Cache hit ratio: ${(report.totals.cache_hit_ratio * 100).toFixed(1)}%`,
    `- Savings ratio: ${(report.totals.savings_ratio * 100).toFixed(1)}%`,
    `- Baseline cost units: ${report.totals.baseline_cost_units.toFixed(2)}`,
    `- Effective cost units: ${report.totals.effective_cost_units.toFixed(2)}`,
    "",
    "## Scenarios",
    "",
    "| Scenario | Turns | Blocks | Cache hit | Savings |",
    "|---|---:|---:|---:|---:|",
    ...report.scenarios.map(
      (row) =>
        `| ${row.scenario_id} | ${row.turns} | ${row.blocks} | ${(row.cache_hit_ratio * 100).toFixed(1)}% | ${(row.savings_ratio * 100).toFixed(1)}% |`,
    ),
    "",
    "No prompt text, assistant text, tool output, or file contents are persisted in this report.",
    "",
  ];

  return lines.join("\n");
}
