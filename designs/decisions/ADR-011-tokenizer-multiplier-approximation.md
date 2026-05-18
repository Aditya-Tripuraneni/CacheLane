# ADR-011: Per-Model Tokenizer Multiplier as a Documented Approximation

**Status:** Accepted (M1; revisited in M3)
**Date:** 2026-05-18
**Source:** Phase 2 Spec §1.1 + Q8; Systems Design §11.1 M1 gate; REQ-F-003, REQ-NF-027

## Context

Anthropic ships a new tokenizer with Opus 4.7 that can produce up to **35%
more tokens** than Opus 4.6 for the same input. Cachelane's block-size
accounting must use the right tokenizer per request or its cost predictions
are systematically wrong. The Systems Design Document's M1 acceptance gate
is: *"Tokenizer model-lookup test passes for 4.6 and 4.7."*

The local `@anthropic-ai/tokenizer` (v0.0.4, tiktoken-based) does **not**
expose model-specific encodings — both 4.6 and 4.7 resolve to the same
underlying tokenizer, so they produce identical counts. With the previous
M1 code the gate was a paper gate: the test only checked that each call
returned a positive integer, never that 4.6 and 4.7 differ.

The canonical model-aware source is Anthropic's `/v1/messages/count_tokens`
API endpoint (it takes `model` as input). But that is a network call per
measurement — wrong shape for the orchestrator's hot path, which runs once
per turn before forwarding the real request.

## Decision

Introduce a per-model `tokenCountMultiplier` on `MODEL_TABLE` entries.
`countTokens(text, modelId)` multiplies the base tiktoken count by the
multiplier and rounds.

- `claude-opus-4-6`: multiplier `1.0` (baseline; tiktoken's count stands).
- `claude-opus-4-7`: multiplier `1.15` — a conservative midpoint of the
  documented "up to 35%" range. Under-estimates rather than over-prunes
  when the orchestrator lands in M3.

Future models (4.8, 4.9, ...) are added by appending one row to
`MODEL_TABLE`. The function signature does not change.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Wait for the SDK to expose 4.6 / 4.7 variants | Blocks M1 indefinitely; gate stays paper. |
| Call `/v1/messages/count_tokens` per request | Network call per measurement; defeats the local-only architecture and adds latency to the hot path. |
| Make the multiplier user-configurable in `CachelaneConfig` | Scope creep. Users do not know a meaningful number to set. |
| Drop the M1 gate, defer to M3 | Removes the load-bearing safety check. The whole product is built on per-model cost accuracy. |

## Consequences

**Positive**
- M1 gate is no longer a paper gate. The new tokenizer test asserts
  `count(4.7) > count(4.6)` and the multiplier ensures it.
- Hot path stays local — no network call per token measurement.
- New models land in one line of code.

**Negative**
- `1.15` is an approximation, not a measurement. Real-world variance is
  text-dependent; some inputs will exceed 35% and some will be near 0%.
- If Anthropic ships a 4.7.x tokenizer update, the multiplier may drift.
  M3 mitigates by reconciling against `usage.input_tokens` on every real
  API response.

## Verification

Required test in `src/tokenizer/__tests__/tokenizer.test.ts`:
```ts
it("M1 gate: 4.7 produces a higher count than 4.6 for the same input", () => {
  const sample = "The quick brown fox jumps over the lazy dog. ".repeat(20);
  expect(countTokens(sample, "claude-opus-4-7"))
    .toBeGreaterThan(countTokens(sample, "claude-opus-4-6"));
});
```

## Reconciliation plan (M3)

When the orchestrator lands and reads `usage.input_tokens` from every API
response, accumulate per-model `(predicted / actual)` ratios. If the
empirical ratio for a model drifts more than 10% from the multiplier over
N=100 turns, surface a warning via `cachelane doctor` and update the
multiplier with the empirical value. No silent auto-tuning.
