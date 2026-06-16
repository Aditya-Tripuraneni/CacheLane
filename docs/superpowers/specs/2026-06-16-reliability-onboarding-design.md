# CacheLane Reliability & Onboarding — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorming), pending implementation plan
**Topic:** Make CacheLane *verifiably* working — chain-aware doctor checks, a first-run
self-test, and prominent fail-open visibility — so users (esp. chained-proxy setups like the
GitHub #22 / Headroom case) can trust the tool isn't silently degrading.
**Roadmap:** [Phase 3 roadmap](2026-06-16-phase3-roadmap.md) — theme T3.

## Problem

CacheLane fails open by design: any error returns the unmutated request. That is correct for
safety but **invisible** — a misconfigured proxy, an unreachable upstream, or two token layers
fighting can leave CacheLane doing nothing while the user believes it's saving tokens.

Specifically:

1. **Proxy chaining (GH #22)** already works via config (`proxy.upstream_host/port/ssl/
   path_prefix`), but `cachelane doctor` does not know about it. A non-default upstream is
   neither probed nor surfaced; a chain that drops cache reads to ~0 ("two layers fighting" —
   already warned about in README prose) is not detected.
2. **No first-run confidence signal.** `doctor` checks install surfaces (node/config/db/mcp/
   hooks) but never confirms an actual round-trip mutated a request and earned a cache read.
3. **Fail-open is buried.** `pipeline_fallback_turns` exists in `getStats()` and the
   `cachelane:health` MCP tool flags >5% fallback, but the CLI doesn't make a degrading session
   loud.

## Goals

- **Chain-aware doctor:** detect a configured non-default upstream, probe its reachability, and
  warn if recent cache-read ratio collapsed after chaining.
- **Onboarding self-test:** a way to confirm, end-to-end, that the pipeline mutated a request
  and got a cache read — a green/red "CacheLane is actually working" signal.
- **Fail-open visibility:** make the fallback rate prominent in `doctor` (and the web report),
  flagging when it exceeds the configured threshold.
- Honor invariants: fail-open (these checks never block Claude Code), local-only (probes hit
  only the configured upstream / loopback), no content, snake_case at boundaries.

## Non-goals

- Not an interactive guided chain-setup command (`cachelane chain`) — roadmap R1.
- Not changing fail-open behavior itself — only making it observable.
- No new npm deps; reuse Node http/https already used by the proxy.

## Chosen approach

Extend the existing `src/cli/doctor.ts` + `src/cli/format.ts` rather than add a new surface,
and add one focused `cachelane verify` command for the live round-trip.

### Section 1 — Chain-aware doctor checks

Add checks to `runDoctor()` (each is a `DoctorCheck { name, ok, detail }`, fail-open — a failed
probe is a warning, not a crash):

- **`upstream` check:** read `config.proxy.upstream_*`. If upstream is the default
  (`api.anthropic.com:443` ssl) → `ok`, detail `"default (api.anthropic.com)"`. If non-default
  → detail names the chained target, e.g. `"chained → 127.0.0.1:8787 (http)"`, and triggers the
  reachability probe.
- **`upstream_reachable` check (only when non-default / on `--probe`):** open a TCP/HTTP
  connection to the configured upstream host:port with a short timeout (≤2s). `ok` on connect,
  `fail` with the error otherwise. Loopback-only by default unless upstream is remote.
- **`cache_reads` check:** read recent turns via `getStats(scope=session|workspace)`. If there
  are ≥ N recent turns and `cache_hit_ratio ≈ 0` while `mutation_enabled` is true, warn:
  `"cache reads ~0 over last N turns — chained proxy may be stripping cacheable content"`. This
  automates the README "verify with cachelane stats" caveat.
- **`fallback_rate` check:** compute fail-open % from recent `turn_explanations`
  (`!mutated` over the last `health.fallback_window_turns`, default 20). `fail`/warn when above
  `health.fallback_warning_threshold_pct` (default 5%). Reuses the exact logic in
  `server/health.ts` so doctor and the MCP `health` tool agree.

`doctor` stays exit-0-friendly for scripting; `--json` already supported. Add `--probe` to opt
into network probes (default off so plain `doctor` stays offline and instant).

### Section 2 — `cachelane verify` (first-run self-test)

A new command that gives a definitive "it works" signal. Two tiers, mirroring the benchmark
philosophy:

- **`cachelane verify` (default, offline):** runs the pipeline in-process against a synthetic
  multi-turn request (no network): asserts (a) the request was mutated (breakpoints placed), (b)
  a stub is produced when a block idles past K, (c) `expandStub` losslessly restores it. Prints
  a green checklist. This proves the *logic* end-to-end without credentials. CI-safe.
- **`cachelane verify --live` (opt-in, credential-gated):** sends two identical minimal real
  requests through the running proxy and confirms the second reports `cache_read_input_tokens >
  0`. Proves the *deployment* (proxy reachable, upstream reachable, cache firing). Won't run
  without the proxy up + upstream reachable; fails open with a clear message.

Output example (offline):
```
$ cachelane verify
  ok  pipeline mutates request (2 breakpoints placed)
  ok  K-pruning stubs idle block at K=3
  ok  stub rehydrates byte-identical via cachelane_expand
  ok  fail-open path returns unmutated request on injected error
  → CacheLane core is working. Run `cachelane verify --live` to confirm cache reads.
```

### Section 3 — Fail-open visibility

- `formatDoctor` / `formatStats` surface fail-open prominently: a `⚠ N% fallback (last M turns)`
  line when over threshold, near the top, not buried.
- The web report (T1) already plans a "fail-open turns" card; this spec is the source of the
  threshold logic it reuses.

## Section 4 — Testing (TDD)

- `doctor.test.ts` extensions, table-driven:
  - default upstream → `upstream` ok, no probe attempted.
  - non-default upstream + reachable fake → `upstream` chained detail + `upstream_reachable` ok.
  - non-default upstream + unreachable → `upstream_reachable` fail (warning), doctor still
    returns without throwing.
  - seeded turns with cache_hit_ratio 0 over N turns → `cache_reads` warn.
  - seeded explanations with >5% `!mutated` → `fallback_rate` warn; ≤5% → ok. Assert parity with
    `server/health.ts` on identical input.
- `verify.test.ts`: offline path asserts all four checks pass on a healthy synthetic request and
  that an injected pipeline error trips the fail-open check to "ok" (it *should* fail open).
  `--live` path is gated/mocked (no real network in CI).
- Reachability probe uses an ephemeral local server fixture (same pattern as
  `proxy/__tests__/helpers/cache-sim-upstream.ts`).

## Section 5 — Docs

- Fold the GH #22 chaining answer into `cachelane doctor --probe` guidance in the README
  chaining section: "after chaining, run `cachelane doctor --probe` to confirm the upstream is
  reachable and cache reads are still firing."

## Open questions for implementation plan

- Probe protocol: raw TCP connect vs. a HEAD/OPTIONS — recommend a cheap TCP connect to
  host:port (works for both HTTP and HTTPS upstreams without sending a request body).
- `verify --live` minimal-request shape: reuse the keepalive ping payload (`max_tokens=1`,
  one-token user message) so it's the cheapest possible real call.
- Whether `cache_reads`/`fallback_rate` checks belong in `doctor` always vs. only under a
  `doctor --health` flag (recommend: always, they're read-only and cheap).
- Threshold for the `cache_reads` warning (how many recent turns at ~0 before warning).
