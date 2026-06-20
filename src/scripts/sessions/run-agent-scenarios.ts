#!/usr/bin/env tsx
import { parseArgs } from "node:util";
import { runAgentScenarios, type AgentTraceProviderName } from "../../agent-traces/index.js";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "fake" },
    count: { type: "string" },
    "scenario-dir": { type: "string" },
    "output-root": { type: "string" },
    "run-id": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    model: { type: "string" },
    "base-url": { type: "string" },
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

const result = await runAgentScenarios({
  provider: providerName(values.provider),
  count: parseCount(values.count),
  scenarioDir: values["scenario-dir"],
  outputRoot: values["output-root"],
  runId: values["run-id"],
  dry_run: values["dry-run"],
  glm: {
    model: values.model,
    baseUrl: values["base-url"],
  },
});

console.log(
  JSON.stringify(
    {
      run_id: result.run_id,
      run_dir: result.run_dir,
      report_path: result.report_path,
      counts: result.report.counts,
    },
    null,
    2,
  ),
);
