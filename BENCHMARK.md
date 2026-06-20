# CacheLane Recorded Benchmark

CacheLane's default benchmark is recorded-only. It uses checked-in scenario
specs and the local fake trace provider, so it does not need Claude Code,
Anthropic credentials, GLM credentials, or network access.

## Run

```sh
npm run benchmark:recorded
```

The command writes generated material under `benchmark/runs/recorded-local/`:

- `raw/` and `normalized/` trace material from the scenario harness
- `report.json` from the trace generator
- `benchmark-report.json` with CacheLane cost-unit estimates
- `BENCHMARK-REPORT.md` with a short human-readable summary

Generated runs are gitignored by default. Curated sanitized artifacts may be
committed under `benchmark/runs/committed/`.

## Metrics

The recorded benchmark estimates savings from normalized trace metadata:

- `baseline_cost_units`: prompt block tokens if every turn paid full input cost
- `effective_cost_units`: first block occurrence at full input cost, repeated
  block content at 0.1x cache-read cost
- `cache_hit_ratio`: repeated block tokens divided by all prompt block tokens
- `savings_ratio`: `(baseline - effective) / baseline`

This is a deterministic replay estimate, not a live Anthropic billing report.
Live cache-write costs, latency, and provider variance are intentionally outside
the default gate.

## Privacy

`benchmark-report.json` and `BENCHMARK-REPORT.md` do not persist prompt text,
assistant text, tool output, or file contents. They contain scenario IDs, counts,
token estimates, and aggregate ratios only.

## Live Benchmarks & Analysis

CacheLane now supports a suite of live benchmark tools that run directly against Anthropic's API or analyze your live data:

- **Latency A/B (`npm run benchmark:latency`)**: Measures Time-To-First-Token (TTFT) by running scenarios directly to Anthropic versus through the CacheLane proxy. Requires `ANTHROPIC_API_KEY`.
- **Correctness (`npm run benchmark:correctness`)**: Tests rehydration recall and stale-answer rates to ensure the proxy's context pruning does not degrade the model's ability to answer correctly.
- **Compression (`npm run benchmark:compression`)**: Benchmarks the performance overhead of CacheLane's tool-output compressors.
- **HTML Dashboard (`cachelane report`)**: Generates a self-contained HTML visual dashboard of your real-world savings, cache hit ratios, and orchestration using your local SQLite database.

You can also run the terminal dashboard live while you work using `cachelane benchmark dashboard`.
