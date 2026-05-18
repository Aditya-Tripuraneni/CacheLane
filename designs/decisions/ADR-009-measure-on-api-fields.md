# ADR-009: Measure Success on Directly-Billed API Fields

**Status:** Accepted  
**Date:** May 2026  
**Source:** Token Reduction Research §3.5; Phase 2 Spec §2.4.4

## Context

Cachelane's value proposition is cost reduction. The measurement approach must be verifiable by
users on their own Anthropic invoices — not self-reported or estimated.

## Decision

Primary metrics come directly from the `usage` block returned in every Anthropic API response:
- `cache_read_input_tokens`
- `cache_creation_input_tokens` (5m and 1h variants)
- `input_tokens`

**Effective cost formula:**
```
effective_cost_units = input_tokens
                     + 1.25 × cache_creation_5m_tokens
                     + 2.0  × cache_creation_1h_tokens
                     + 0.1  × cache_read_tokens
```

**Cache-hit ratio:**
```
cache_hit_ratio = cache_read_input_tokens
                / (input_tokens + cache_creation_input_tokens + cache_read_input_tokens)
```

Secondary metrics: wall-clock time-to-first-token; LLM-judge quality regression score (tolerance
≤ 5% degradation).

## Alternatives Considered

| Alternative | Rejection reason |
|-------------|-----------------|
| Self-reported token reduction percentages | Not externally verifiable by the user |
| Character-count metrics | Opus 4.7 tokenizer divergence (up to 35% more tokens for same text) makes character counts misleading |
| Estimated savings vs. hypothetical baseline | Can't be confirmed on the user's invoice |

## Consequences

**Positive:**
- Externally auditable — users can verify savings on their own Anthropic invoices
- Reproducible — `BENCHMARK.md` scripts use the same formula

**Negative:**
- `cache_creation_5m` vs. `cache_creation_1h` fields must be tracked separately (both are
  returned in the API response under different keys)
