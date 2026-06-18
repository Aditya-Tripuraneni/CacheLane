import type { ScenarioSpec } from "../agent-traces/types.js";
import { loadConfig } from "../config/index.js";
import { loadScenarioSpecs, selectScenarios } from "../agent-traces/scenarios.js";
import { cachelaneConfigPath } from "../cli/paths.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Arm = "treatment" | "control";

export interface ArmSummary {
  ttft_p50_ms: number;
  ttft_p95_ms: number;
  samples: number;
}

export interface LatencySample {
  arm: Arm;
  scenario_id: string;
  turn_index: number;
  repeat: number;
  ttft_ms: number | null;
  error?: string;
}

export interface LatencyAbReport {
  run_id: string;
  generated_at: string;
  model: string;
  repeats: number;
  scenario_count: number;
  treatment: ArmSummary;
  control: ArmSummary;
  /** control p50 − treatment p50. Positive ⇒ treatment is faster. */
  delta_p50_ms: number;
  delta_p95_ms: number;
  samples: LatencySample[];
}

export interface MessagesBody {
  model: string;
  stream: boolean;
  max_tokens: number;
  system: Array<{ type: "text"; text: string }>;
  messages: Array<{ role: "user"; content: string }>;
}

/** A streaming response whose first yielded chunk marks time-to-first-byte. */
export interface StreamingResponse {
  chunks(): AsyncIterable<Uint8Array>;
}

/** Injectable transport so tests can simulate streaming without a network. */
export type TtftTransport = (
  url: string,
  headers: Record<string, string>,
  body: MessagesBody,
) => Promise<StreamingResponse>;

export interface RunLatencyAbOptions {
  scenarios: ScenarioSpec[];
  repeats: number;
  model: string;
  proxyUrl: string;
  controlUrl: string;
  apiKey: string;
}

export interface RunLatencyAbDeps {
  transport: TtftTransport;
  /** Monotonic clock in ms. Defaults to performance.now. */
  now?: () => number;
  runId?: string;
  generatedAt?: string;
}

// ── Pure helpers ────────────────────────────────────────────────────────────

export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  // nearest-rank: index = ceil(p/100 * n) - 1, clamped
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index]!;
}

export function summarizeArm(samples: number[]): ArmSummary {
  return {
    ttft_p50_ms: percentile(samples, 50),
    ttft_p95_ms: percentile(samples, 95),
    samples: samples.length,
  };
}

function systemPrompt(scenario: ScenarioSpec): Array<{ type: "text"; text: string }> {
  const files = scenario.workspace_files
    .map((f) => `// ${f.path}\n${f.content}`)
    .join("\n\n");
  const text = files.length > 0
    ? `You are assisting with a coding task. Workspace files:\n\n${files}`
    : "You are assisting with a coding task.";
  return [{ type: "text", text }];
}

export function buildMessagesBody(
  scenario: ScenarioSpec,
  turnIndex: number,
  model: string,
  opts: { stream: boolean },
): MessagesBody {
  const turns = scenario.turns.slice(0, turnIndex + 1);
  return {
    model,
    stream: opts.stream,
    max_tokens: 256,
    system: systemPrompt(scenario),
    messages: turns.map((content) => ({ role: "user", content })),
  };
}

// ── TTFT measurement ──────────────────────────────────────────────────────────

export async function measureTtft(
  url: string,
  headers: Record<string, string>,
  body: MessagesBody,
  transport: TtftTransport,
  now: () => number = () => performance.now(),
): Promise<number> {
  const start = now();
  const response = await transport(url, headers, body);
  for await (const _chunk of response.chunks()) {
    return now() - start;
  }
  // empty stream — treat first-byte time as end-of-response
  return now() - start;
}

// ── Orchestration ──────────────────────────────────────────────────────────────

function armHeaders(apiKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
}

export async function runLatencyAb(
  opts: RunLatencyAbOptions,
  deps: RunLatencyAbDeps,
): Promise<LatencyAbReport> {
  const now = deps.now ?? (() => performance.now());
  const headers = armHeaders(opts.apiKey);
  const samples: LatencySample[] = [];

  const arms: Array<{ arm: Arm; url: string }> = [
    { arm: "treatment", url: opts.proxyUrl },
    { arm: "control", url: opts.controlUrl },
  ];

  for (let repeat = 0; repeat < opts.repeats; repeat++) {
    for (const scenario of opts.scenarios) {
      for (let turnIndex = 0; turnIndex < scenario.turns.length; turnIndex++) {
        const body = buildMessagesBody(scenario, turnIndex, opts.model, { stream: true });
        // Interleave arms turn-by-turn so transient network state hits both.
        for (const { arm, url } of arms) {
          try {
            const ttft = await measureTtft(url, headers, body, deps.transport, now);
            samples.push({
              arm,
              scenario_id: scenario.id,
              turn_index: turnIndex,
              repeat,
              ttft_ms: ttft,
            });
          } catch (err) {
            samples.push({
              arm,
              scenario_id: scenario.id,
              turn_index: turnIndex,
              repeat,
              ttft_ms: null,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }
  }

  const treatmentMs = samples
    .filter((s) => s.arm === "treatment" && s.ttft_ms !== null)
    .map((s) => s.ttft_ms!);
  const controlMs = samples
    .filter((s) => s.arm === "control" && s.ttft_ms !== null)
    .map((s) => s.ttft_ms!);

  const treatment = summarizeArm(treatmentMs);
  const control = summarizeArm(controlMs);

  return {
    run_id: deps.runId ?? "latency-ab",
    generated_at: deps.generatedAt ?? "",
    model: opts.model,
    repeats: opts.repeats,
    scenario_count: opts.scenarios.length,
    treatment,
    control,
    delta_p50_ms: control.ttft_p50_ms - treatment.ttft_p50_ms,
    delta_p95_ms: control.ttft_p95_ms - treatment.ttft_p95_ms,
    samples,
  };
}

// ── Live runner (real network) ─────────────────────────────────────────────────

/** A fetch-backed transport that streams the response body. */
export const fetchTransport: TtftTransport = async (url, headers, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const reader = res.body?.getReader();
  return {
    async *chunks() {
      if (!reader) return;
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value && value.length > 0) yield value;
      }
    },
  };
};

export function formatLatencyReport(report: LatencyAbReport): string {
  const lines: string[] = [];
  lines.push(`CacheLane latency A/B — TTFT (ms)`);
  lines.push(`  model: ${report.model}  repeats: ${report.repeats}  scenarios: ${report.scenario_count}`);
  lines.push(`  treatment (proxy):  p50 ${report.treatment.ttft_p50_ms}  p95 ${report.treatment.ttft_p95_ms}  n=${report.treatment.samples}`);
  lines.push(`  control  (direct):  p50 ${report.control.ttft_p50_ms}  p95 ${report.control.ttft_p95_ms}  n=${report.control.samples}`);
  const sign = report.delta_p50_ms >= 0 ? "faster" : "slower";
  lines.push(`  delta p50: ${report.delta_p50_ms}ms (treatment ${sign})  delta p95: ${report.delta_p95_ms}ms`);
  const errors = report.samples.filter((s) => s.error).length;
  if (errors > 0) lines.push(`  ${errors} turn(s) errored and were skipped`);
  return lines.join("\n");
}

export interface RunLatencyAbCliOptions {
  repeats?: number;
  scenarioDir?: string;
  count?: number;
  proxyUrl?: string;
  controlUrl?: string;
  model?: string;
  json?: boolean;
  out?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * CLI entrypoint: resolves env/config, runs the live A/B, prints and optionally
 * writes the JSON report. Fails fast if ANTHROPIC_API_KEY is absent — this is a
 * live command with no offline fallback.
 */
export async function runLatencyAbCli(opts: RunLatencyAbCliOptions): Promise<LatencyAbReport> {
  const env = opts.env ?? process.env;
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for the live latency benchmark (no offline fallback).",
    );
  }

  const config = loadConfig(cachelaneConfigPath(env));
  const proxyUrl = opts.proxyUrl ?? `http://127.0.0.1:${config.proxy.port}/v1/messages`;
  const controlUrl =
    opts.controlUrl ??
    `${(env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, "")}/v1/messages`;

  const scenarios = selectScenarios(loadScenarioSpecs(opts.scenarioDir), opts.count);

  const report = await runLatencyAb(
    {
      scenarios,
      repeats: opts.repeats ?? 3,
      model: opts.model ?? "claude-sonnet-4-6",
      proxyUrl,
      controlUrl,
      apiKey,
    },
    {
      transport: fetchTransport,
      now: () => performance.now(),
      runId: "latency-ab",
      generatedAt: new Date().toISOString(),
    },
  );

  if (opts.out) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(opts.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  return report;
}
