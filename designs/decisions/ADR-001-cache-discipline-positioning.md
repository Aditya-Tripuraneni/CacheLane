# ADR-001: Build a Cache-Discipline Layer, Not Another Retrieval/Filter Tool

**Status:** Accepted  
**Date:** May 2026  
**Source:** Token Reduction Research §Executive Summary, §1.3, §2.5, §3.1

## Context

The seven-tool ecosystem (RTK, Context Mode, code-review-graph, Token Savior, Caveman,
claude-context, memsearch) has converged on four reduction axes:
1. Upstream filtering
2. Structural pre-indexing
3. Progressive disclosure
4. Output-side compression

None of them addresses the Anthropic prompt cache — a fifth, untouched axis that offers a ~10×
discount (0.1× vs 1.0× base input cost) on cache reads. Real-world cache-hit ratios after
deliberate prefix design sit at 50–84%. Below 20% is a "prefix-design failure, not a model
limitation."

## Decision

Build Cachelane as a cache-aware orchestrator that reorders prompt content into `STABLE | SEMI | VOLATILE`
regions with two `cache_control` breakpoints, maximising cache hits on every turn.

## Alternatives Considered

| Alternative | Rejection reason |
|-------------|-----------------|
| Compete with Context Mode on upstream filtering | Mature incumbent; no meaningful differentiation |
| Compete with Code Graph on structural pre-indexing | Mature incumbent; 4.6×–49× reduction already |
| Build a memsearch-like decision distillation tool (M5) | "Differentiation against memsearch is thin"; score 30/100 |

## Consequences

**Positive:**
- Compounds multiplicatively with all existing tools rather than competing
- Directly verifiable on the user's own Anthropic invoice (`cache_read_input_tokens`)
- Low technical risk — uses a documented, stable cache primitive

**Negative:**
- Requires correct classification of stable vs. volatile content (Q002)
- Workspace-level cache isolation (Feb 2026) complicates multi-workspace setups (Q006 — resolved)
