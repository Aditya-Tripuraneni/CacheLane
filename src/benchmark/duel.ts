import type { NormalizedTraceSession, ScenarioSpec } from "../agent-traces/types.js";
import { generateRecordedBenchmarkReport } from "./recorded.js";
import { buildDuelReport, type DuelReport, type DuelScenarioInput } from "./duel-report.js";
import type { BilledTokens } from "./pricing.js";

export interface ScenarioRunResult {
  normalized: NormalizedTraceSession;
  transcriptPath?: string;
  billed: BilledTokens;
}

export interface DuelDeps {
  setMutationEnabled: (enabled: boolean) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  runScenarioSession: (scenarioId: string, mutationEnabled: boolean) => Promise<ScenarioRunResult>;
}

export interface RunDuelOptions {
  run_id: string;
  cooldown_seconds: number;
  model: string;
  estimate_only: boolean;
}

const ZERO_BILLED: BilledTokens = {
  input_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
};

function estimateUnits(
  session: NormalizedTraceSession,
  model: string,
  run_id: string,
  generated_at: string,
): { baseline: number; effective: number } {
  const report = generateRecordedBenchmarkReport({
    run_id,
    generated_at,
    sessions: [session],
    model,
  });
  return {
    baseline: report.totals.baseline_cost_units,
    effective: report.totals.effective_cost_units,
  };
}

export async function runDuel(
  options: RunDuelOptions,
  scenarios: ScenarioSpec[],
  deps: DuelDeps,
): Promise<DuelReport> {
  const generated_at = deps.now().toISOString();
  const cooldownMs = options.cooldown_seconds * 1000;
  const inputs: DuelScenarioInput[] = [];

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]!;
    // Alternate which side runs first so neither side systematically pre-warms the cache.
    const onFirst = i % 2 === 0;
    const order: boolean[] = onFirst ? [true, false] : [false, true];

    console.error(`[duel] Running scenario ${i + 1}/${scenarios.length}: ${scenario.id}`);
    const results = new Map<boolean, ScenarioRunResult>();
    for (let j = 0; j < order.length; j++) {
      const mutationEnabled = order[j]!;
      console.error(`[duel]   -> Phase ${j + 1}/2: CacheLane ${mutationEnabled ? "ON" : "OFF"}`);
      deps.setMutationEnabled(mutationEnabled);
      results.set(mutationEnabled, await deps.runScenarioSession(scenario.id, mutationEnabled));
      // The cooldown only exists to let the live Anthropic prompt cache expire
      // between ON/OFF runs. In estimate-only mode there are no live API calls,
      // so waiting is pure dead time — skip it.
      if (!options.estimate_only && cooldownMs > 0 && j < order.length - 1) {
        console.error(`[duel]   -> Waiting ${options.cooldown_seconds}s for Anthropic cache to expire...`);
        await deps.sleep(cooldownMs);
      }
    }

    const onResult = results.get(true)!;
    const offResult = results.get(false)!;
    const onEst = estimateUnits(onResult.normalized, options.model, options.run_id, generated_at);
    const offEst = estimateUnits(offResult.normalized, options.model, options.run_id, generated_at);

    inputs.push({
      scenario_id: scenario.id,
      turns: scenario.turns.length,
      on: {
        estimate_baseline_units: onEst.baseline,
        estimate_effective_units: onEst.effective,
        billed: options.estimate_only ? ZERO_BILLED : onResult.billed,
      },
      off: {
        estimate_baseline_units: offEst.baseline,
        estimate_effective_units: offEst.effective,
        billed: options.estimate_only ? ZERO_BILLED : offResult.billed,
      },
    });
  }

  return buildDuelReport({
    run_id: options.run_id,
    generated_at,
    cooldown_seconds: options.cooldown_seconds,
    model: options.model,
    scenarios: inputs,
  });
}
