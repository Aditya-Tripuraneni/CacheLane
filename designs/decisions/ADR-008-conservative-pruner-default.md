# ADR-008: Conservative Pruner Default of K=3

**Status:** Accepted (empirical tuning planned for M8)  
**Date:** May 2026  
**Source:** Token Reduction Research §2.3 M2, §3.4, §3.6; Phase 2 Spec Q3

## Context

The K-pruning threshold determines how quickly blocks become stubs. Too aggressive (low K) means
blocks are stubbed before they become relevant again, causing refetch round-trips. Too conservative
(high K) means long-session savings are diminished.

## Decision

Default K=3. Provide two named modes:
- `--aggressive` → K=2 (stubs appear starting at turn 3)
- `--conservative` → K=5 (stubs appear starting at turn 6)

Config range: K ∈ {1, ..., 10}.

## Rationale

K=3 is a reasonable starting point based on the observation that:
- Blocks added in turn T and never referenced again become stubs at turn T+3 (idle turns 1, 2, 3)
- This matches the intuition from the worked example (38k → 19k by turn 6, ~50% savings)
- K=3 bounds the worst case: a false-negative costs one refetch round-trip (one extra turn)

K=2 is available for users who want maximum savings and accept higher refetch risk.  
K=5 is available for users who want minimal refetch risk and accept less savings.

## Consequences

**Positive:**
- Bounded downside: worst-case false negative = one refetch per stubbed block
- Default is conservative enough for most use cases

**Negative:**
- K=3 is empirically unvalidated; the M8 experiment will determine whether to adjust the default
- Sub-optimal until per-scenario tuning lands (Q003)

## Pending Experiment

The §2.4.5 keepalive + K experiment will test K ∈ {2, 3, 4, 5, 6} across the 5 benchmark
scenarios. Results may change the shipped default.
