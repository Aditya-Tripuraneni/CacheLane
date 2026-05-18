# Cachelane Design Suite — Index

This folder is the single source of truth for implementing Cachelane. A new agent reading
only this folder should be able to begin implementation without consulting the raw source documents.

**Document set status:** Complete as of May 2026. Synthesized from 5 source documents (see CLAUDE.md).

---

## Reading Order

**For an agent starting implementation:**
1. [`01-system-overview.md`](01-system-overview.md) — understand the product and its terms (10 min)
2. [`02-architecture.md`](02-architecture.md) — understand what exists and how it connects (20 min)
3. [`04-turns-and-pruning.md`](04-turns-and-pruning.md) — understand the core algorithm (15 min)
4. [`06-systems-design.md`](06-systems-design.md) — understand the implementation plan (30 min)
5. [`03-engineering-specs.md`](03-engineering-specs.md) — check specific requirements as needed

**For a reviewer or architect:**
- Read all files. Start with `01` and `05` for context and rationale.

---

## File Map

| File | Contents | Primary Source |
|------|----------|----------------|
| [`01-system-overview.md`](01-system-overview.md) | Goals, non-goals, product summary, full glossary | All documents |
| [`02-architecture.md`](02-architecture.md) | All 7 diagrams interpreted as text, component catalog, interaction catalog, deployment topology | Engineering Diagrams v2 |
| [`03-engineering-specs.md`](03-engineering-specs.md) | REQ-F-001–037, REQ-NF-001–029, API contracts, data models, acceptance criteria | Phase 2 Spec v2 |
| [`04-turns-and-pruning.md`](04-turns-and-pruning.md) | Turn model, K-pruning algorithm with pseudocode, worked examples, edge cases, config knobs | Turns & Pruning Explainer |
| [`05-token-reduction.md`](05-token-reduction.md) | Research findings, 5 methodologies evaluated, 10 ADRs, performance targets, validation plan | Token Reduction Research |
| [`06-systems-design.md`](06-systems-design.md) | Tech stack, 8-module layout, SQLite schemas, per-turn overhead budgets, failure modes, milestones M1–M9 | Systems Design Document v2 |
| [`07-open-questions.md`](07-open-questions.md) | Remaining open questions with owners and resolution status | Phase 2 Spec v2 + synthesis |
| [`decisions/`](decisions/) | Individual ADR files (ADR-001 through ADR-010) | Token Reduction Research |

---

## Key Cross-References

- **Pipeline order decision**: [ADR-005](decisions/ADR-005-mcp-hooks-deployment.md) + [02-architecture.md §Per-Turn Flow](02-architecture.md#per-turn-api-flow-d4)
- **K value rationale**: [ADR-008](decisions/ADR-008-conservative-pruner-default.md) + [04-turns-and-pruning.md §Config Knobs](04-turns-and-pruning.md#configuration-knobs)
- **Cache breakpoint strategy**: [ADR-006](decisions/ADR-006-three-region-two-breakpoints.md) + [02-architecture.md §Block Model](02-architecture.md#block-model-and-cache-boundaries-d2)
- **Why not embeddings**: [ADR-004 + REQ-F-025](03-engineering-specs.md#functional-requirements) + [05-token-reduction.md](05-token-reduction.md)
- **100-session corpus gate**: [AC-5, AC-6](03-engineering-specs.md#acceptance-criteria) + [06-systems-design.md §M4](06-systems-design.md#milestones)

---

## Stable ID Prefixes

| Prefix | Namespace | File |
|--------|-----------|------|
| `REQ-F-###` | Functional requirements | `03-engineering-specs.md` |
| `REQ-NF-###` | Non-functional requirements | `03-engineering-specs.md` |
| `AC-###` | Acceptance criteria | `03-engineering-specs.md` |
| `ADR-###` | Architecture decision records | `decisions/ADR-###-*.md` |
| `Q###` | Open questions | `07-open-questions.md` |
