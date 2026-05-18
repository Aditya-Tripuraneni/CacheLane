# ADR-002: Pair M1 (Cache Orchestration) with M2 (Trajectory Pruning) in v1

**Status:** Accepted  
**Date:** May 2026  
**Source:** Token Reduction Research §2.5

## Context

M1 (cache orchestration) is the highest-leverage mechanism (score 100/100) but does not address
long-session context bloat. M2 (trajectory pruning) is strongly differentiated (score 75/100)
but is not as concentrated a lever as M1. They address complementary surfaces.

## Decision

Ship both M1 and M2 in v1. M1 is the core product; M2 is a closely-coupled second feature.

## Alternatives Considered

| Alternative | Rejection reason |
|-------------|-----------------|
| Ship M1 alone | Leaves long-session context bloat unaddressed |
| Ship M2 alone | Doesn't exploit the cache lever (the largest reduction surface) |
| Ship M1 + M3 | M3's differentiation (3/5) weaker than M2's (5/5) |

## Consequences

**Positive:**
- Targets two distinct surfaces: cache mechanics and context bloat
- Both measurable against API usage fields (`cache_read_input_tokens`, effective cost units)

**Negative:**
- Increases v1 implementation scope vs. M1-only
- K-pruner adds quality-regression risk that M1 alone would not
