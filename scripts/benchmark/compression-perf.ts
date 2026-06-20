#!/usr/bin/env tsx
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { countTokens } from "../../src/tokenizer/index.js";
import { compress } from "../../src/compressor/index.js";
import type { AnthropicMessagesRequest } from "../../src/orchestrator/types.js";

type SampleStats = {
  samples: number;
  mean_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
};

type CompressionBenchmarkReport = {
  run_id: string;
  generated_at: string;
  model: string;
  config: {
    warmup: number;
    iterations: number;
    json_array_limit: number;
  };
  json: {
    original_tokens: number;
    compressed_tokens: number;
    tokens_saved: number;
    reduction_ratio: number;
    original_length: number;
    compressed_length: number;
    compressed_preview: string;
    pipeline_event_type: string;
    latency: SampleStats;
  };
  json_lossless: {
    original_tokens: number;
    compressed_tokens: number;
    tokens_saved: number;
    original_length: number;
    compressed_length: number;
    semantic_equal: boolean;
    pipeline_event_type: string;
    latency: SampleStats;
  };
  json_balanced: {
    original_tokens: number;
    compressed_tokens: number;
    tokens_saved: number;
    reduction_ratio: number;
    original_length: number;
    compressed_length: number;
    pipeline_event_type: string;
    latency: SampleStats;
  };
  log: {
    original_tokens: number;
    compressed_tokens: number;
    tokens_saved: number;
    reduction_ratio: number;
    original_length: number;
    compressed_length: number;
    compressed_preview: string;
    pipeline_event_type: string;
    latency: SampleStats;
  };
  validation: {
    json_parse_ok: boolean;
    json_lossless_parse_ok: boolean;
    json_lossless_semantic_equal: boolean;
    json_balanced_parse_ok: boolean;
    json_reduced: boolean;
    json_balanced_reduced: boolean;
    log_reduced: boolean;
    json_pipeline_saved_tokens: boolean;
    json_balanced_pipeline_saved_tokens: boolean;
    log_pipeline_saved_tokens: boolean;
    json_p99_under_5ms: boolean;
    json_lossless_p99_under_5ms: boolean;
    json_balanced_p99_under_5ms: boolean;
    log_p99_under_5ms: boolean;
  };
};

const { values } = parseArgs({
  options: {
    "run-id": { type: "string" },
    "output-root": { type: "string", default: "benchmark/runs" },
    "docs-path": { type: "string" },
    warmup: { type: "string", default: "100" },
    iterations: { type: "string", default: "1000" },
    model: { type: "string", default: "claude-opus-4-7" },
    "json-array-limit": { type: "string", default: "20" },
    markdown: { type: "boolean", default: false },
  },
});

function defaultRunId(): string {
  return `compression-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function parsePositiveInt(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return n;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]!;
}

function summarize(values: number[]): SampleStats {
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    samples: values.length,
    mean_ms: values.length === 0 ? 0 : sum / values.length,
    p50_ms: percentile(values, 50),
    p95_ms: percentile(values, 95),
    p99_ms: percentile(values, 99),
    max_ms: values.length === 0 ? 0 : Math.max(...values),
  };
}

function buildLargeJson(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < 500; i++) {
    out[`field_${i}`] = i % 2 === 0 ? null : {
      id: i,
      label: `item-${i}`,
      nested: i % 5 === 0 ? [] : { keep: true, drop: null },
    };
  }
  out.metadata = {
    source: "synthetic",
    empty_array: [],
    empty_object: {},
    keep: "yes",
  };
  return out;
}

function buildLargeLog(): string {
  const lines: string[] = ["FIRST LINE"];
  for (let i = 0; i < 500; i++) {
    if (i % 2 === 0) {
      lines.push(`2026-06-20T12:${String(i % 60).padStart(2, "0")}:00Z ERROR task-${i} failed`);
    } else if (i % 5 === 0) {
      lines.push(`WARN retry ${i}`);
    } else {
      lines.push(`INFO verbose entry ${i} with noise and details`);
    }
  }
  lines.push("LAST LINE");
  return lines.join("\n");
}

function nsToMs(fn: () => void): number {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function firstToolResultContent(messages: AnthropicMessagesRequest["messages"]): string {
  const blocks = messages[0]?.content ?? [];
  const toolResult = blocks.find((block) => block.type === "tool_result");
  if (!toolResult || typeof toolResult.content !== "string") {
    return "";
  }
  return toolResult.content;
}

async function writeText(path: string, text: string): Promise<void> {
  await writeFile(path, text, "utf8");
}

const runId = values["run-id"] ?? defaultRunId();
const outputRoot = resolve(values["output-root"] ?? "benchmark/runs");
const runDir = resolve(outputRoot, runId);
const warmup = parsePositiveInt(values.warmup ?? "100", "warmup");
const iterations = parsePositiveInt(values.iterations ?? "1000", "iterations");
const jsonArrayLimit = parsePositiveInt(values["json-array-limit"] ?? "20", "json-array-limit");
const model = values.model ?? "claude-opus-4-7";

await mkdir(runDir, { recursive: true });

const largeJsonObject = buildLargeJson();
const largeJson = JSON.stringify(largeJsonObject);
const largeLog = buildLargeLog();
const compressionConfig = {
  enabled: true,
  exclude: [],
  json_max_array_items: jsonArrayLimit,
  mode: "aggressive" as const,
};
const losslessCompressionConfig = {
  ...compressionConfig,
  mode: "lossless" as const,
};
const balancedCompressionConfig = {
  ...compressionConfig,
  mode: "balanced" as const,
};

for (let i = 0; i < warmup; i++) {
  compress(
    [{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_json", content: largeJson }] }] as AnthropicMessagesRequest["messages"],
    compressionConfig,
  );
  compress(
    [{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_json_lossless", content: largeJson }] }] as AnthropicMessagesRequest["messages"],
    losslessCompressionConfig,
  );
  compress(
    [{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_json_balanced", content: largeJson }] }] as AnthropicMessagesRequest["messages"],
    balancedCompressionConfig,
  );
  compress(
    [{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_log", content: largeLog }] }] as AnthropicMessagesRequest["messages"],
    compressionConfig,
  );
}

const jsonSamplesMs: number[] = [];
const jsonLosslessSamplesMs: number[] = [];
const jsonBalancedSamplesMs: number[] = [];
const logSamplesMs: number[] = [];

let jsonCompressed = "";
let jsonLosslessCompressed = "";
let jsonBalancedCompressed = "";
let logCompressed = "";
let jsonPipelineEventType = "passthrough";
let jsonLosslessPipelineEventType = "passthrough";
let jsonBalancedPipelineEventType = "passthrough";
let logPipelineEventType = "passthrough";

for (let i = 0; i < iterations; i++) {
  jsonSamplesMs.push(nsToMs(() => {
    const pipeline = compress(
      [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_json", content: largeJson }],
        },
      ] as AnthropicMessagesRequest["messages"],
      compressionConfig,
    );
    jsonPipelineEventType = pipeline.events[0]?.content_type ?? "passthrough";
    jsonCompressed = firstToolResultContent(pipeline.messages);
  }));

  jsonLosslessSamplesMs.push(nsToMs(() => {
    const pipeline = compress(
      [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_json_lossless", content: largeJson }],
        },
      ] as AnthropicMessagesRequest["messages"],
      losslessCompressionConfig,
    );
    jsonLosslessPipelineEventType = pipeline.events[0]?.content_type ?? "passthrough";
    jsonLosslessCompressed = firstToolResultContent(pipeline.messages);
  }));

  jsonBalancedSamplesMs.push(nsToMs(() => {
    const pipeline = compress(
      [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_json_balanced", content: largeJson }],
        },
      ] as AnthropicMessagesRequest["messages"],
      balancedCompressionConfig,
    );
    jsonBalancedPipelineEventType = pipeline.events[0]?.content_type ?? "passthrough";
    jsonBalancedCompressed = firstToolResultContent(pipeline.messages);
  }));

  logSamplesMs.push(nsToMs(() => {
    const pipeline = compress(
      [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_log", content: largeLog }],
        },
      ] as AnthropicMessagesRequest["messages"],
      compressionConfig,
    );
    logPipelineEventType = pipeline.events[0]?.content_type ?? "passthrough";
    logCompressed = firstToolResultContent(pipeline.messages);
  }));
}

const jsonOriginalTokens = countTokens(largeJson, model);
const jsonCompressedTokens = countTokens(jsonCompressed, model);
const jsonLosslessCompressedTokens = countTokens(jsonLosslessCompressed, model);
const jsonBalancedCompressedTokens = countTokens(jsonBalancedCompressed, model);
const logOriginalTokens = countTokens(largeLog, model);
const logCompressedTokens = countTokens(logCompressed, model);
const jsonLosslessLatency = summarize(jsonLosslessSamplesMs);
const jsonBalancedLatency = summarize(jsonBalancedSamplesMs);
const jsonLosslessParseOk = (() => {
  try {
    JSON.parse(jsonLosslessCompressed);
    return true;
  } catch {
    return false;
  }
})();
const jsonLosslessSemanticEqual =
  jsonLosslessParseOk &&
  JSON.stringify(JSON.parse(jsonLosslessCompressed)) === JSON.stringify(largeJsonObject);
const jsonBalancedParseOk = (() => {
  try {
    JSON.parse(jsonBalancedCompressed);
    return true;
  } catch {
    return false;
  }
})();

const report: CompressionBenchmarkReport = {
  run_id: runId,
  generated_at: new Date().toISOString(),
  model,
  config: {
    warmup,
    iterations,
    json_array_limit: jsonArrayLimit,
  },
  json: {
    original_tokens: jsonOriginalTokens,
    compressed_tokens: jsonCompressedTokens,
    tokens_saved: jsonOriginalTokens - jsonCompressedTokens,
    reduction_ratio: jsonOriginalTokens === 0 ? 0 : (jsonOriginalTokens - jsonCompressedTokens) / jsonOriginalTokens,
    original_length: largeJson.length,
    compressed_length: jsonCompressed.length,
    compressed_preview: jsonCompressed,
    pipeline_event_type: jsonPipelineEventType,
    latency: summarize(jsonSamplesMs),
  },
  json_lossless: {
    original_tokens: jsonOriginalTokens,
    compressed_tokens: jsonLosslessCompressedTokens,
    tokens_saved: jsonOriginalTokens - jsonLosslessCompressedTokens,
    original_length: largeJson.length,
    compressed_length: jsonLosslessCompressed.length,
    semantic_equal: jsonLosslessSemanticEqual,
    pipeline_event_type: jsonLosslessPipelineEventType,
    latency: jsonLosslessLatency,
  },
  json_balanced: {
    original_tokens: jsonOriginalTokens,
    compressed_tokens: jsonBalancedCompressedTokens,
    tokens_saved: jsonOriginalTokens - jsonBalancedCompressedTokens,
    reduction_ratio: jsonOriginalTokens === 0 ? 0 : (jsonOriginalTokens - jsonBalancedCompressedTokens) / jsonOriginalTokens,
    original_length: largeJson.length,
    compressed_length: jsonBalancedCompressed.length,
    pipeline_event_type: jsonBalancedPipelineEventType,
    latency: jsonBalancedLatency,
  },
  log: {
    original_tokens: logOriginalTokens,
    compressed_tokens: logCompressedTokens,
    tokens_saved: logOriginalTokens - logCompressedTokens,
    reduction_ratio: logOriginalTokens === 0 ? 0 : (logOriginalTokens - logCompressedTokens) / logOriginalTokens,
    original_length: largeLog.length,
    compressed_length: logCompressed.length,
    compressed_preview: logCompressed,
    pipeline_event_type: logPipelineEventType,
    latency: summarize(logSamplesMs),
  },
  validation: {
    json_parse_ok: (() => {
      try {
        JSON.parse(jsonCompressed);
        return true;
      } catch {
        return false;
      }
    })(),
    json_lossless_parse_ok: jsonLosslessParseOk,
    json_lossless_semantic_equal: jsonLosslessSemanticEqual,
    json_balanced_parse_ok: jsonBalancedParseOk,
    json_reduced: jsonCompressed.length < largeJson.length,
    json_balanced_reduced: jsonBalancedCompressed.length < largeJson.length,
    log_reduced: logCompressed.length < largeLog.length,
    json_pipeline_saved_tokens: jsonPipelineEventType === "json" && jsonOriginalTokens > jsonCompressedTokens,
    json_balanced_pipeline_saved_tokens: jsonBalancedPipelineEventType === "json" && jsonOriginalTokens > jsonBalancedCompressedTokens,
    log_pipeline_saved_tokens: logPipelineEventType === "log" && logOriginalTokens > logCompressedTokens,
    json_p99_under_5ms: summarize(jsonSamplesMs).p99_ms < 5,
    json_lossless_p99_under_5ms: jsonLosslessLatency.p99_ms < 5,
    json_balanced_p99_under_5ms: jsonBalancedLatency.p99_ms < 5,
    log_p99_under_5ms: summarize(logSamplesMs).p99_ms < 5,
  },
};

const reportPath = resolve(runDir, "compression-report.json");
await writeText(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (values.markdown) {
    const markdown = [
      `# CacheLane Tool Output Compression Benchmark ${runId}`,
      "",
      `Generated: ${report.generated_at}`,
      `Model: ${model}`,
      `Config: warmup=${warmup}, iterations=${iterations}, json_array_limit=${jsonArrayLimit}`,
      "",
      "## Summary",
      "",
      `- Estimated JSON tokens before: ${report.json.original_tokens}`,
      `- Estimated JSON tokens after: ${report.json.compressed_tokens}`,
      `- Estimated JSON tokens saved: ${report.json.tokens_saved}`,
      `- Estimated JSON reduction ratio: ${(report.json.reduction_ratio * 100).toFixed(1)}%`,
      `- JSON latency p50/p95/p99: ${report.json.latency.p50_ms.toFixed(3)} / ${report.json.latency.p95_ms.toFixed(3)} / ${report.json.latency.p99_ms.toFixed(3)} ms`,
      `- Lossless JSON semantic equal: ${report.json_lossless.semantic_equal}`,
      `- Lossless JSON latency p50/p95/p99: ${report.json_lossless.latency.p50_ms.toFixed(3)} / ${report.json_lossless.latency.p95_ms.toFixed(3)} / ${report.json_lossless.latency.p99_ms.toFixed(3)} ms`,
      `- Estimated balanced JSON tokens before: ${report.json_balanced.original_tokens}`,
      `- Estimated balanced JSON tokens after: ${report.json_balanced.compressed_tokens}`,
      `- Estimated balanced JSON tokens saved: ${report.json_balanced.tokens_saved}`,
      `- Estimated balanced JSON reduction ratio: ${(report.json_balanced.reduction_ratio * 100).toFixed(1)}%`,
      `- Balanced JSON latency p50/p95/p99: ${report.json_balanced.latency.p50_ms.toFixed(3)} / ${report.json_balanced.latency.p95_ms.toFixed(3)} / ${report.json_balanced.latency.p99_ms.toFixed(3)} ms`,
      `- Estimated log tokens before: ${report.log.original_tokens}`,
      `- Estimated log tokens after: ${report.log.compressed_tokens}`,
      `- Estimated log tokens saved: ${report.log.tokens_saved}`,
      `- Estimated log reduction ratio: ${(report.log.reduction_ratio * 100).toFixed(1)}%`,
      `- Log latency p50/p95/p99: ${report.log.latency.p50_ms.toFixed(3)} / ${report.log.latency.p95_ms.toFixed(3)} / ${report.log.latency.p99_ms.toFixed(3)} ms`,
      "",
      "## Validation",
      "",
      `- JSON parse valid: ${report.validation.json_parse_ok}`,
      `- Lossless JSON parse valid: ${report.validation.json_lossless_parse_ok}`,
      `- Lossless JSON semantic equal: ${report.validation.json_lossless_semantic_equal}`,
      `- Balanced JSON parse valid: ${report.validation.json_balanced_parse_ok}`,
      `- JSON reduced: ${report.validation.json_reduced}`,
      `- Balanced JSON reduced: ${report.validation.json_balanced_reduced}`,
      `- Log reduced: ${report.validation.log_reduced}`,
      `- JSON pipeline saved tokens: ${report.validation.json_pipeline_saved_tokens}`,
      `- Balanced JSON pipeline saved tokens: ${report.validation.json_balanced_pipeline_saved_tokens}`,
      `- Log pipeline saved tokens: ${report.validation.log_pipeline_saved_tokens}`,
      `- JSON p99 under 5ms: ${report.validation.json_p99_under_5ms}`,
      `- Lossless JSON p99 under 5ms: ${report.validation.json_lossless_p99_under_5ms}`,
      `- Balanced JSON p99 under 5ms: ${report.validation.json_balanced_p99_under_5ms}`,
      `- Log p99 under 5ms: ${report.validation.log_p99_under_5ms}`,
      "",
      "## JSON Compression (Aggressive)",
      "",
      `Original tokens: ${report.json.original_tokens} (estimated)`,
      `Compressed tokens: ${report.json.compressed_tokens} (estimated)`,
      `Tokens saved: ${report.json.tokens_saved} (estimated)`,
      `Reduction ratio: ${(report.json.reduction_ratio * 100).toFixed(1)}%`,
      `Latency p50/p95/p99: ${report.json.latency.p50_ms.toFixed(3)} / ${report.json.latency.p95_ms.toFixed(3)} / ${report.json.latency.p99_ms.toFixed(3)} ms`,
      "",
      "Compressed JSON preview:",
      "```json",
      report.json.compressed_preview,
      "```",
      "",
      "## JSON Compression (Lossless)",
      "",
      `Original tokens: ${report.json_lossless.original_tokens} (estimated)`,
      `Compressed tokens: ${report.json_lossless.compressed_tokens} (estimated)`,
      `Tokens saved: ${report.json_lossless.tokens_saved} (estimated)`,
      `Semantic equal: ${report.json_lossless.semantic_equal}`,
      `Latency p50/p95/p99: ${report.json_lossless.latency.p50_ms.toFixed(3)} / ${report.json_lossless.latency.p95_ms.toFixed(3)} / ${report.json_lossless.latency.p99_ms.toFixed(3)} ms`,
      "",
      "## JSON Compression (Balanced)",
      "",
      `Original tokens: ${report.json_balanced.original_tokens} (estimated)`,
      `Compressed tokens: ${report.json_balanced.compressed_tokens} (estimated)`,
      `Tokens saved: ${report.json_balanced.tokens_saved} (estimated)`,
      `Reduction ratio: ${(report.json_balanced.reduction_ratio * 100).toFixed(1)}%`,
      `Latency p50/p95/p99: ${report.json_balanced.latency.p50_ms.toFixed(3)} / ${report.json_balanced.latency.p95_ms.toFixed(3)} / ${report.json_balanced.latency.p99_ms.toFixed(3)} ms`,
      "",
      "## Log Compression",
      "",
      `Original tokens: ${report.log.original_tokens} (estimated)`,
      `Compressed tokens: ${report.log.compressed_tokens} (estimated)`,
      `Tokens saved: ${report.log.tokens_saved} (estimated)`,
      `Reduction ratio: ${(report.log.reduction_ratio * 100).toFixed(1)}%`,
      `Latency p50/p95/p99: ${report.log.latency.p50_ms.toFixed(3)} / ${report.log.latency.p95_ms.toFixed(3)} / ${report.log.latency.p99_ms.toFixed(3)} ms`,
      "",
      "Compressed log preview:",
      "```text",
    report.log.compressed_preview,
    "```",
    "",
  ].join("\n");
  const markdownPath = resolve(runDir, "COMPRESSION-REPORT.md");
  await writeText(markdownPath, markdown);
  if (values["docs-path"]) {
    await writeText(resolve(values["docs-path"]), markdown);
  }
}

console.log([
  `Run ID: ${runId}`,
  `Run directory: ${runDir}`,
  `Report JSON: ${reportPath}`,
  "",
  "JSON Compression (Aggressive)",
  `Original tokens: ${report.json.original_tokens}`,
  `Compressed tokens: ${report.json.compressed_tokens}`,
  `Tokens saved: ${report.json.tokens_saved}`,
  `Reduction ratio: ${(report.json.reduction_ratio * 100).toFixed(1)}%`,
  `Latency p50/p95/p99: ${report.json.latency.p50_ms.toFixed(3)} / ${report.json.latency.p95_ms.toFixed(3)} / ${report.json.latency.p99_ms.toFixed(3)} ms`,
  "",
  "JSON Compression (Lossless)",
  `Original tokens: ${report.json_lossless.original_tokens}`,
  `Compressed tokens: ${report.json_lossless.compressed_tokens}`,
  `Tokens saved: ${report.json_lossless.tokens_saved}`,
  `Semantic equal: ${report.json_lossless.semantic_equal}`,
  `Latency p50/p95/p99: ${report.json_lossless.latency.p50_ms.toFixed(3)} / ${report.json_lossless.latency.p95_ms.toFixed(3)} / ${report.json_lossless.latency.p99_ms.toFixed(3)} ms`,
  "",
  "JSON Compression (Balanced)",
  `Original tokens: ${report.json_balanced.original_tokens}`,
  `Compressed tokens: ${report.json_balanced.compressed_tokens}`,
  `Tokens saved: ${report.json_balanced.tokens_saved}`,
  `Reduction ratio: ${(report.json_balanced.reduction_ratio * 100).toFixed(1)}%`,
  `Latency p50/p95/p99: ${report.json_balanced.latency.p50_ms.toFixed(3)} / ${report.json_balanced.latency.p95_ms.toFixed(3)} / ${report.json_balanced.latency.p99_ms.toFixed(3)} ms`,
  "",
  "Log Compression",
  `Original tokens: ${report.log.original_tokens}`,
  `Compressed tokens: ${report.log.compressed_tokens}`,
  `Tokens saved: ${report.log.tokens_saved}`,
  `Reduction ratio: ${(report.log.reduction_ratio * 100).toFixed(1)}%`,
  `Latency p50/p95/p99: ${report.log.latency.p50_ms.toFixed(3)} / ${report.log.latency.p95_ms.toFixed(3)} / ${report.log.latency.p99_ms.toFixed(3)} ms`,
  "",
  "Validation",
  ...Object.entries(report.validation).map(([name, ok]) => `${name}: ${ok}`),
].join("\n"));

const validationFailures = Object.entries(report.validation)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);

if (validationFailures.length > 0) {
  throw new Error(
    `compression benchmark validation failed: ${validationFailures.join(", ")}`
  );
}
