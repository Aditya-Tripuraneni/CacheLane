import type { StageLatencyStats } from "./types.js";

/** Nearest-rank percentile (p in 0..100). Returns 0 for empty input. */
export function percentile(sortedOrUnsorted: number[], p: number): number {
  if (sortedOrUnsorted.length === 0) return 0;
  const xs = [...sortedOrUnsorted].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * xs.length);
  const idx = Math.min(Math.max(rank, 1), xs.length) - 1;
  return xs[idx]!;
}

const NS_PER_MS = 1_000_000;

/** Summarize nanosecond duration samples into millisecond stats. */
export function summarizeStage(stage: string, samplesNs: bigint[]): StageLatencyStats {
  const ms = samplesNs.map((ns) => Number(ns) / NS_PER_MS);
  const sum = ms.reduce((a, b) => a + b, 0);
  return {
    stage,
    samples: ms.length,
    mean_ms: ms.length === 0 ? 0 : sum / ms.length,
    p50_ms: percentile(ms, 50),
    p95_ms: percentile(ms, 95),
    p99_ms: percentile(ms, 99),
    max_ms: ms.length === 0 ? 0 : Math.max(...ms),
  };
}
