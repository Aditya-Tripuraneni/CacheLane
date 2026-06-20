#!/usr/bin/env tsx
import { parseArgs } from "node:util";
import { runLatencyAbCli, formatLatencyReport } from "../../src/benchmark/index.js";

const { values } = parseArgs({
  options: {
    repeats: { type: "string" },
    "scenario-dir": { type: "string" },
    count: { type: "string" },
    "proxy-url": { type: "string" },
    "control-url": { type: "string" },
    model: { type: "string" },
    out: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

function parsePositiveInt(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${label} must be a positive integer`);
  return n;
}

const report = await runLatencyAbCli({
  repeats: parsePositiveInt(values.repeats, "--repeats"),
  scenarioDir: values["scenario-dir"],
  count: parsePositiveInt(values.count, "--count"),
  proxyUrl: values["proxy-url"],
  controlUrl: values["control-url"],
  model: values.model,
  out: values.out,
});

console.log(values.json ? JSON.stringify(report, null, 2) : formatLatencyReport(report));
