# ADR-004: No Embeddings, Vector Stores, or ML Model Dependencies

**Status:** Accepted  
**Date:** May 2026  
**Source:** Phase 2 Spec §1.2.3, D6

## Context

Reference detection (determining which blocks the assistant referenced in a turn) could
theoretically use semantic similarity via embeddings or an ML model. This was evaluated and
rejected.

## Decision

Reference detection uses **only three deterministic signals**:
1. File paths quoted in tool-call arguments (exact match)
2. Block IDs (injected ULID prefix) cited in assistant text (substring match)
3. 40-character shingle exact substring overlap between block content and assistant output

No embeddings, no vector stores, no ML model dependencies.

## Rationale

- Embedding inference would add latency to every turn (network call or local model load)
- Embedding similarity introduces non-determinism; cache-stability guarantees depend on
  deterministic behaviour
- The 3-signal detector is auditable, testable (≥ 95% precision / ≥ 85% recall gate on corpus),
  and has no external dependencies
- "Deterministic and fast" is the correct trade-off here — the reference detector runs in the
  PostResponse path where latency must be < 20 ms

## Consequences

**Positive:**
- Zero additional dependencies
- Deterministic — no non-determinism in the hot path
- Testable with a static annotated corpus
- No added latency from model inference

**Negative:**
- May miss semantic references that aren't literal file-path or text quotes
- Recall target (≥ 85%) acknowledges ~15% miss rate is acceptable to avoid false-negative cost
  (unnecessary refetches from over-pruning)
