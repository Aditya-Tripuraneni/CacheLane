#!/usr/bin/env tsx
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runAgentScenarios, type AgentTraceProviderName } from "../../src/agent-traces/index.js";
import {
  formatBenchmarkMarkdown,
  generateRecordedBenchmarkReport,
  loadNormalizedTraceSessions,
} from "../../src/benchmark/index.js";
import { renderRecordedBenchmarkHtml } from "../../src/benchmark/render-html.js";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    provider: { type: "string", default: "fake" },
    count: { type: "string" },
    "scenario-dir": { type: "string" },
    "output-root": { type: "string", default: "benchmark/runs" },
    "run-id": { type: "string" },
    model: { type: "string", default: "claude-opus-4-7" },
    markdown: { type: "boolean", default: false },
    html: { type: "string" },
  },
});

function providerName(value: string | undefined): AgentTraceProviderName {
  if (value === "fake" || value === "glm" || value === "claude-code") return value;
  throw new Error(`Unsupported provider: ${value ?? "(missing)"}`);
}

function parseCount(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("--count must be a positive integer");
  }
  return count;
}

function defaultRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const outputRoot = resolve(values["output-root"] ?? "benchmark/runs");
const runId = values["run-id"] ?? defaultRunId();
let runDir = resolve(outputRoot, runId);
let normalizedDir = values.input ? resolve(values.input) : "";

if (values.input === undefined) {
  const trace = await runAgentScenarios({
    provider: providerName(values.provider),
    count: parseCount(values.count),
    scenarioDir: values["scenario-dir"],
    outputRoot,
    runId,
  });
  runDir = trace.run_dir;
  normalizedDir = trace.normalized_dir;
}

await mkdir(runDir, { recursive: true });
const sessions = loadNormalizedTraceSessions(normalizedDir);
const report = generateRecordedBenchmarkReport({
  run_id: runId,
  generated_at: new Date().toISOString(),
  normalized_dir: normalizedDir,
  model: values.model,
  sessions,
});
const reportPath = resolve(runDir, "benchmark-report.json");
await writeJson(reportPath, report);

let markdownPath: string | null = null;
if (values.markdown) {
  markdownPath = resolve(runDir, "BENCHMARK-REPORT.md");
  await writeFile(markdownPath, formatBenchmarkMarkdown(report), "utf8");
}

let htmlPath: string | null = null;
if (values.html) {
  try {
    htmlPath = resolve(values.html);
    await writeFile(htmlPath, renderRecordedBenchmarkHtml(report), "utf8");
  } catch (err) {
    // fail-open: never let report rendering break the benchmark run
    console.error(`[benchmark] HTML report write failed: ${err instanceof Error ? err.message : String(err)}`);
    htmlPath = null;
  }
}

console.log(
  JSON.stringify(
    {
      run_id: runId,
      run_dir: runDir,
      normalized_dir: normalizedDir,
      report_path: reportPath,
      markdown_path: markdownPath,
      html_path: htmlPath,
      totals: report.totals,
    },
    null,
    2,
  ),
);
