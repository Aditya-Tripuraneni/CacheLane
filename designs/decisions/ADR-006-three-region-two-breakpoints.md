# ADR-006: Three-Region Prompt Layout with Two cache_control Breakpoints

**Status:** Accepted  
**Date:** May 2026  
**Source:** Token Reduction Research §3.2 steps 2–3; Engineering Diagrams v2 D2

## Context

Anthropic's prompt cache requires byte-identical prefixes up to a `cache_control` breakpoint.
The design question is how many regions and breakpoints to use.

## Decision

Reorder into three regions with two `cache_control` breakpoints:

1. **Prefix (`STABLE`)** — system prompt, tool schemas, CLAUDE.md, pinned project rules
   → cached at 0.1× on every re-read
   → `cache_control` breakpoint #1 at end of prefix

2. **Middle (`SEMI`)** — recent-turn sliding window
   → conditionally cached when byte-stable (seen identical twice)
   → `cache_control` breakpoint #2 at end of middle (dynamic — only placed after middle seen identical twice)

3. **Suffix (`VOLATILE`)** — current-turn retrieval results, tool outputs, user message
   → always paid in full at 1.0×

## Alternatives Considered

| Alternative | Rejection reason |
|-------------|-----------------|
| Single breakpoint | Forces a binary stable/volatile choice; recent turns (SEMI) get no cache benefit |
| No breakpoints | Defeats the design entirely |
| More than two breakpoints | Complexity vs. diminishing returns; the Anthropic API may have breakpoint limits |

## Consequences

**Positive:**
- Mid-section (recent turns) gets partial cache benefit on consecutive turns
- Two-breakpoint design is the minimal structure needed to capture stable + semi-stable content

**Negative:**
- Classifier complexity increases (must distinguish STABLE vs. SEMI vs. VOLATILE)
- Middle breakpoint is dynamic (must be deferred until the middle is seen stable twice)
- After `/compact`, the middle breakpoint resets and first post-compact turn pays full write
