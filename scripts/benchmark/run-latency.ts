#!/usr/bin/env tsx
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadNormalizedTraceSessions } from "../../src/benchmark/index.js";
import { measurePipelineLatency, formatLatencyMarkdown } from "../../src/benchmark/latency.js";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    provider: { type: "string", default: "fake" },
    "run-id": { type: "string" },
    model: { type: "string", default: "claude-opus-4-7" },
    warmup: { type: "string", default: "5" },
    iterations: { type: "string", default: "20" },
    "output-root": { type: "string", default: "benchmark/runs" },
    "config-path": { type: "string" },
    markdown: { type: "boolean", default: false },
  },
});

function defaultRunId(): string {
  return `latency-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function parsePositiveInt(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const runId = values["run-id"] ?? defaultRunId();
const outputRoot = resolve(values["output-root"] ?? "benchmark/runs");
const runDir = resolve(outputRoot, runId);
const warmup = parsePositiveInt(values.warmup, "warmup", 5);
const iterations = parsePositiveInt(values.iterations, "iterations", 20);

let normalizedDir: string | null = null;
let sessions;

if (values.input) {
  normalizedDir = resolve(values.input);
  sessions = loadNormalizedTraceSessions(normalizedDir);
} else {
  // No recorded trace input: run a minimal synthetic session so the script
  // still produces output without requiring a recorded-trace run first.
  sessions = [
    {
      scenario_id: "synthetic-baseline",
      session_id: "synthetic-sess-1",
      provider: values.provider ?? "fake",
      source: {},
      turns: [0, 1, 2, 3, 4].map((n) => ({
        turn_number: n,
        assistant_text: "",
        tool_calls: [],
        blocks_in_prompt: [
          { id: `blk-${n}-sys`, id_token: `blk-${n}-sys`, kind: "system_prompt" as const, content: `You are a helpful assistant. Turn ${n}.` },
          { id: `blk-${n}-tool`, id_token: `blk-${n}-tool`, kind: "tool_output" as const, content: `Tool output for turn ${n}: file contents here.` },
          { id: `blk-${n}-user`, id_token: `blk-${n}-user`, kind: "user_text" as const, content: `User message for turn ${n}.` },
        ],
      })),
    },
  ];
}

await mkdir(runDir, { recursive: true });

const report = measurePipelineLatency({
  run_id: runId,
  generated_at: new Date().toISOString(),
  sessions,
  model: values.model ?? "claude-opus-4-7",
  warmup,
  iterations,
  normalized_dir: normalizedDir,
  config_path: values["config-path"],
});

const reportPath = resolve(runDir, "latency-report.json");
await writeJson(reportPath, report);

let markdownPath: string | null = null;
if (values.markdown) {
  markdownPath = resolve(runDir, "LATENCY-REPORT.md");
  await writeFile(markdownPath, formatLatencyMarkdown(report), "utf8");
}

console.log(
  JSON.stringify(
    {
      run_id: runId,
      run_dir: runDir,
      report_path: reportPath,
      markdown_path: markdownPath,
      counts: report.counts,
      total_p95_ms: report.stages.find((s) => s.stage === "total")?.p95_ms ?? null,
    },
    null,
    2,
  ),
);
