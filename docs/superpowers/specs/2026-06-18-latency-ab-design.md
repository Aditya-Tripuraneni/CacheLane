# Latency A/B Benchmark — Design

**Date:** 2026-06-18
**Status:** Approved for implementation
**Topic:** Live time-to-first-token (TTFT) comparison of CacheLane vs. raw passthrough

## Problem

CacheLane is built to reduce input-token *cost*. Its benchmarks measure cost
savings (`savings_ratio`, `cache_hit_ratio`) and proxy overhead budgets — never
end-to-end latency. We cannot currently answer "is it actually faster?" with a
real measurement.

Prompt-cache hits should lower TTFT (Anthropic skips recomputing cached prefix
tokens), and K-pruning shrinks the uploaded payload, but both are unverified
hypotheses. This feature adds a live A/B that measures TTFT directly.

## Goal

Prove (or disprove) a net latency win on the real Anthropic API by comparing two
arms over realistic, multi-turn workloads.

## Arms

For each scenario turn sequence, replay it through two arms with identical
message content and identical auth (`ANTHROPIC_API_KEY` from env):

- **Treatment** — `POST` to the running CacheLane proxy
  (`http://127.0.0.1:<config.proxy.port>/v1/messages`). Full reorder +
  `cache_control` + K-pruning.
- **Control** — `POST` directly to `api.anthropic.com` (or `ANTHROPIC_BASE_URL`),
  with no `cache_control` and no reordering.

Both arms set `stream: true`.

## Metric

**TTFT only** — wall-clock from request write to the first SSE data byte. The
response body is read just far enough to stamp the first byte, then discarded.
Total/decode time is intentionally excluded (dominated by output length, which
CacheLane does not change).

Report per arm: p50 and p95 across repeats, plus the delta (control − treatment).

## Workload

Replay the checked-in scenario specs in `benchmark/scenarios/*.json` via the
existing `loadScenarioSpecs` / `selectScenarios` loader. These include
multi-turn scenarios (refactor, code-review) so cache reuse and pruning engage
on later turns. Each scenario's turn sequence is replayed in both arms.

**Noise control:** arms are interleaved turn-by-turn, and the whole suite is
repeated N times (`--repeats`, default 3). Stats are computed across repeats.

## Packaging

A first-class CLI subcommand under the existing `benchmark` parent command:

```
cachelane benchmark latency [--repeats N] [--scenario-dir DIR] [--count N] \
                            [--proxy-url URL] [--control-url URL] \
                            [--model ID] [--json] [--out PATH]
```

Plus an npm script `npm run benchmark:latency` so it runs on any machine via
`tsx`. Logic lives in `src/benchmark/latency-ab.ts`, exported as `runLatencyAb`
from `src/benchmark/index.js` and lazy-imported by the CLI (matching the existing
`ab-test` / `duel` subcommands).

## Module structure (testable without network)

`src/benchmark/latency-ab.ts` separates pure logic from I/O so the bulk is unit
tested with no live calls:

- `percentile(samples, p)` and `summarizeArm(samples)` — pure stats.
- `buildMessagesBody(scenario, turnIndex, model, { stream })` — pure request-body
  construction (system + user turn from the scenario; cumulative turns for
  multi-turn cache growth).
- `armConfig(...)` — resolves URL + headers for each arm from env/config.
- `measureTtft(url, headers, body, transport)` — times first byte. `transport`
  is an injected `fetch`-like function returning a streaming body, so tests
  feed a fake stream and assert timing logic without a network.
- `runLatencyAb(opts, deps)` — orchestrates scenarios × arms × repeats, returns
  a `LatencyAbReport`. `deps` injects the transport and a `now()` clock for
  deterministic tests.

## Output shape

`LatencyAbReport`:
- `run_id`, `generated_at`, `model`, `repeats`, `scenario_count`
- per-arm summary: `{ ttft_p50_ms, ttft_p95_ms, samples }`
- `delta_p50_ms`, `delta_p95_ms` (control − treatment; positive = treatment faster)
- per-turn raw samples (arm, scenario_id, turn_index, repeat, ttft_ms)

Printed as JSON with `--json`, otherwise a short human-readable summary. Optional
`--out` writes the JSON report next to other benchmark artifacts.

## Privacy & fail-open

- The report stores TTFT timings, scenario IDs, turn indices, and model id only —
  no prompt text, response text, or token content.
- Missing `ANTHROPIC_API_KEY`: fail fast with a clear message (this is a live
  command; there is no offline fallback).
- A failed request for one turn records that sample as an error and continues;
  one bad turn never aborts the whole run.

## Non-goals

- Not added to the deterministic recorded gate (`BENCHMARK.md` keeps that offline).
- No passive in-proxy TTFT timing (possible follow-up).
- No total/decode-time metric.
- No cost measurement (the existing `ab-test` / `live-report` cover cost).
