# CacheLane Proxy Latency Benchmark — Baseline 2026-06-18

Generated: 2026-06-18T15:37:03.971Z
Model: claude-opus-4-7 (tokenization only — no API calls made)
Config: warmup=5, iterations=20
Sessions: 1   Turns: 5 (synthetic)

> **Note:** These numbers are from one developer machine. Absolute milliseconds vary by CPU.
> The relative stage breakdown (orchestrate dominates) is consistent across hardware.
> Re-run `npm run bench:latency` on your machine to get local numbers.

## Per-stage overhead (ms)

| Stage | p50 | p95 | p99 | mean | max | samples |
|---|---:|---:|---:|---:|---:|---:|
| config_load | 0.167 | 0.258 | 0.275 | 0.185 | 1.022 | 100 |
| classify | 0.013 | 0.021 | 0.026 | 0.013 | 0.026 | 100 |
| block_placements | 0.058 | 0.099 | 0.151 | 0.057 | 0.152 | 100 |
| prune | 0.019 | 0.036 | 0.046 | 0.021 | 0.060 | 100 |
| materialize | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 100 |
| orchestrate | 29.755 | 32.425 | 33.428 | 29.925 | 34.404 | 100 |
| db_record | 0.070 | 0.109 | 0.133 | 0.073 | 0.167 | 100 |
| serialize | 0.004 | 0.007 | 0.016 | 0.005 | 0.037 | 100 |
| total | 30.053 | 32.889 | 33.884 | 30.278 | 34.772 | 100 |

## Scenarios

| Scenario | Turns | total p95 (ms) |
|---|---:|---:|
| synthetic-baseline | 5 | 32.889 |

## Key Observations

- **Total overhead p95: ~33 ms per turn** (measured end-to-end through the full pipeline).
- **Orchestrate dominates (~30 ms p50)**: The orchestrate stage — which serializes all messages
  to JSON and computes a SHA-256 prefix hash to detect cache-state changes — accounts for ~99%
  of the per-turn budget. All other pipeline stages combined are < 0.4 ms.
- **Config load: ~0.17 ms** — file read + parse on each turn; could be memoized if < 1 ms budget needed.
- **Prune: ~0.02 ms** — very fast SQLite query.
- **Materialize: < 0.001 ms** — essentially free (no expired blocks in this run).
- **DB record: ~0.07 ms** — fast WAL-mode SQLite write.
- **Serialize: < 0.01 ms** — JSON.stringify is negligible.

## How to Reproduce

```bash
npm run bench:latency
# Output written to benchmark/runs/latency-local/
```

To benchmark against real recorded traces:

```bash
npm run bench:latency -- --input path/to/normalized-trace-dir --provider fake --warmup 10 --iterations 50
```

Timings only. No prompt text, assistant text, tool output, or file contents are persisted.
