# CacheLane Benchmark Duel — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorming), pending implementation plan
**Topic:** Hands-free CacheLane-on vs CacheLane-off benchmark with a single comparison report

## Problem

We want to answer "how many tokens / how much money does CacheLane save?" by running the
**same prompts** through Claude Code twice — once with CacheLane active and once without —
and producing **one comparison report**. Today the building blocks exist but are scattered:

- `npm run benchmark:recorded` — deterministic estimate via the fake provider (no network).
- `cachelane benchmark compare <trace>` — CacheLane vs baseline on one recorded trace (estimate).
- `cachelane benchmark ab-test` — interactive 3-phase ON/OFF/ON toggle; manual, session-based.
- `cachelane benchmark live-report` / `dashboard` — read real SQLite usage history.
- `claude-code` trace provider — can already spawn `claude -p "<prompt>"` and parse transcripts.

The gap: no single hands-free command that replays an identical prompt set under both
conditions and emits one side-by-side report. `ab-test` is closest but is manual and toggles
mid-session rather than replaying identical prompts.

## Goals

- One command, hands-free, produces one comparison report.
- Same prompts run on both the CacheLane-on and CacheLane-off sides.
- **Tiered fidelity:** a free deterministic estimate (the headline number) plus an opt-in,
  credential-gated live mode that reports real billed tokens/dollars from transcript usage.
- Exercise **multi-turn** sessions so cache reuse and K-pruning actually engage.
- Respect existing repo invariants: fail-open, local-only, no prompt/assistant/file content
  persisted in reports, `STABLE|SEMI|VOLATILE` vocabulary, snake_case at storage/API boundaries.

## Non-goals

- Not a live Anthropic billing report — live dollars are directional, not authoritative.
- No hosted backend; no new npm deps without an ADR.
- Not replacing `benchmark:recorded` — `duel --estimate-only` complements it.

## Chosen approach

A new `cachelane benchmark duel` orchestrator that **reuses existing pieces**:

- Loops scenarios; flips CacheLane on/off per run via the existing `enable`/`disable` config
  the hook reads (no second install).
- Drives the existing `claude-code` provider to run each scenario's turn sequence in **one
  Claude Code session** so cache/pruning state accumulates across turns.
- Feeds resulting transcripts through the existing `normalizer.ts` and
  `generateRecordedBenchmarkReport` for the deterministic estimate, and reads transcript
  `usage` fields for the live billed tier.

Rejected alternatives:

- **Extend `ab-test`** — it is session-based and interactive, fighting the hands-free +
  interleaved goals.
- **Pure transcript post-processing** — no control over cache hygiene or prompt identity.

## Section 1 — Scenario format (multi-turn)

Extend scenario JSON from a single `prompt` to a `turns` array:

```jsonc
{
  "id": "multi-turn-code-review",
  "title": "Multi-turn code review",
  "workspace_files": [ /* unchanged */ ],
  "turns": [
    "Read src/cache-policy.ts and summarize the TTL behavior.",
    "Now find any edge case where the 1h prefix never refreshes.",
    "Write a test that reproduces that edge case.",
    "Refactor ttlForPrefix to fix it, keeping the test green."
  ],
  "expected_references": ["src/cache-policy.ts"]
}
```

- Existing single-`prompt` scenarios remain valid: treated as a 1-element `turns` list.
- New multi-turn scenarios live alongside them and are tagged so the report groups
  single-turn vs multi-turn signal.

## Section 2 — How `duel` drives the runs

For each scenario, run the full turn sequence in one Claude Code session, twice:

```
for scenario in scenarios:
    runA = drive_claude_code(scenario.turns, cachelane=ON)    # hook mutates requests
    cooldown(wait_seconds)                                     # let Anthropic cache go cold
    runB = drive_claude_code(scenario.turns, cachelane=OFF)   # raw passthrough
    cooldown(wait_seconds)
```

- **Toggling:** flip via existing `cachelane enable` / `disable` config the hook reads.
- **One session per run:** pass a per-run session id so all N turns share a session and
  cache/pruning state accumulates — this is what surfaces multi-turn savings.
- **Cache hygiene (chosen: interleave + cooldown):** ON-first, cooldown, then OFF, with a
  configurable `--cooldown` (default ~360s to clear the 5m prompt-cache window). Alternate
  which side goes first across scenarios so neither side systematically benefits.
- **Determinism caveat:** prompts are byte-identical but real model responses vary
  (tool choices differ). The report flags this and leans on the deterministic estimate as
  the apples-to-apples figure.

## Section 3 — Data capture per run

Each run yields a JSONL transcript whose assistant messages carry a `usage` block. Capture
both tiers from the same source:

- **Tier 1 — real billed (ground truth):** from transcript `usage` —
  `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` — priced with the
  existing Sonnet constants (`$3 / $0.30 / $3.75` per Mtok) into dollars.
- **Tier 2 — deterministic estimate:** feed the same turn's blocks through
  `generateRecordedBenchmarkReport` for `baseline_cost_units`, `effective_cost_units`,
  `cache_hit_ratio`, `savings_ratio` — byte-stable, network-free.

Transcripts are normalized through the existing `normalizer.ts` so the block-level estimate
path matches `benchmark:recorded`. No new cost math.

## Section 4 — The comparison report

Produces `duel-report.json` (source of truth) + `DUEL-REPORT.md` (rendered view).

```
CacheLane Duel — 4 scenarios, 2 multi-turn / 2 single-turn
Cooldown 360s · Model claude-sonnet · 2026-06-14

═══ HEADLINE (deterministic estimate — apples-to-apples) ═══
                    CacheLane OFF    CacheLane ON     Savings
  Cost units          1,240,000        430,000        -65.3%
  Cache hit ratio          0.0%          71.2%        +71.2pp

═══ LIVE BILLED (real transcript usage — directional, warm-cache noise) ═══
                    CacheLane OFF    CacheLane ON     Savings
  input_tokens          980,400        310,200        -68.4%
  cache_read_tokens           0        540,100              —
  cache_creation              0         88,300              —
  est. dollars          $2.9412        $0.9714        -67.0%

  ⚠ Live numbers carry model nondeterminism + cache-window noise.
    Trust the deterministic estimate for the headline %.

═══ PER-SCENARIO ═══
  multi-turn-code-review   est -71%   live -69%   (4 turns)
  read-summarize-file      est -22%   live -18%   (1 turn)
```

Design points:

- Deterministic estimate is the headline; live dollars are clearly labeled directional.
- Per-scenario breakdown groups multi-turn vs single-turn.
- JSON is source of truth; markdown is rendered. JSON contains only counts/tokens/ratios/IDs
  — **no prompt text, assistant text, or file contents** (matches existing privacy invariant).
- `--estimate-only` skips live runs → free, CI-safe, byte-stable. Live mode is opt-in and
  credential-gated (won't run without `claude` reachable).

## Open questions for implementation plan

- Exact Claude Code flag for pinning a session id across turns in `-p` mode (verify against
  installed `claude` version).
- Where the report files land (`benchmark/runs/<run-id>/` consistent with existing layout).
- Whether `duel` lives as a new `src/benchmark/duel.ts` module + `benchmark duel` subcommand
  (recommended) vs folding into the recorded harness.
- Default scenario set: which existing scenarios get multi-turn variants.
