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

## Optional Live Work

Future live experiments can consume the same normalized trace format, but they
must remain opt-in and credential-gated. M8 acceptance does not require live API
calls.
