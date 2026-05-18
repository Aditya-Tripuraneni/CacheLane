# ADR-003: Defer Tokenizer-Aware Rewriting (M3) and Speculative Inclusion (M4); Reject Decision Distillation (M5)

**Status:** Accepted (M3 Deferred; M4 Deferred; M5 Rejected)  
**Date:** May 2026  
**Source:** Token Reduction Research §2.3, §2.4, §2.5

## Context

Three additional methodologies were evaluated beyond the chosen M1+M2:
- **M3** — tokenizer-aware content rewriting (10–25% savings on identifier-heavy content)
- **M4** — speculative/budgeted inclusion (20–40% savings)
- **M5** — cross-session decision distillation (variable savings)

## Decisions

### M3 — Deferred to v1.1 (fast-follow)

M3 yields meaningful savings (10–25%) especially under Opus 4.7's 35% tokenizer inflation, but
identifier aliasing risks degrading quality on code-edit tasks. Will ship as a per-block opt-in
transformation — **never enabled by default**.

### M4 — Deferred

Conceptually similar to Token Savior; depends on existing retrieval tools (claude-context, Code
Graph); not as concentrated a lever as M1/M2. Score 55/100.

### M5 — Rejected

"Differentiation against memsearch is thin." Existing tool occupies most of this space.
Score 30/100.

## Consequences

**Positive:**
- Keeps v1 scope tight; reduces quality-regression risk
- Clear product positioning (no overlap with existing tools)

**Negative:**
- M3 leaves 10–25% savings on the table until fast-follow
- M4 leaves 20–40% scenario savings foregone to maintain focus
