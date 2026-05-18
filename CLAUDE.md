# Cachelane — Project Context for Claude/Agent Sessions

Cachelane is a local MCP server + Claude Code hooks (PreRequest/PostResponse) that intercepts
traffic between Claude Code and `api.anthropic.com` to reduce input-token costs on every turn.

**Two mechanisms:**
1. **Cache-aware orchestration** — reorders prompt blocks into three volatility regions and places
   two `cache_control` breakpoints so the Anthropic prompt cache fires at 0.1x instead of 1.0x.
2. **K-pruning** — replaces tool-call result blocks idle for ≥ K consecutive turns with refetchable
   stubs (non-lossy), flattening token growth in long sessions.

## Where to Start

All implementation-ready specs live in `/designs/`. Read them in order before touching code:

| File | What it answers |
|------|-----------------|
| [`designs/README.md`](designs/README.md) | Full index + reading order |
| [`designs/01-system-overview.md`](designs/01-system-overview.md) | Goals, non-goals, glossary |
| [`designs/02-architecture.md`](designs/02-architecture.md) | Components, data flows, all 7 diagrams |
| [`designs/03-engineering-specs.md`](designs/03-engineering-specs.md) | All requirements (REQ-F / REQ-NF), API contracts, data models |
| [`designs/04-turns-and-pruning.md`](designs/04-turns-and-pruning.md) | K-pruning algorithm, pseudocode, worked examples |
| [`designs/05-token-reduction.md`](designs/05-token-reduction.md) | Research rationale, ADRs, performance targets |
| [`designs/06-systems-design.md`](designs/06-systems-design.md) | Tech stack, modules, schemas, milestones, runbook |
| [`designs/07-open-questions.md`](designs/07-open-questions.md) | Remaining open questions with owners |
| [`designs/decisions/`](designs/decisions/) | Individual ADR files |

## Critical Invariants (do not violate without updating the spec)

- **Pipeline order**: Classifier → Pruner → Reorderer (this order is canonical; Pruner must run
  before Reorderer because pruning changes block token counts and volatility before breakpoints
  are computed).
- **Vocabulary**: `STABLE | SEMI | VOLATILE` — these are the only accepted names for volatility
  classes everywhere (spec, code, logs, tests, comments).
- **Naming**: storage and API-contract types use `snake_case` (e.g. the `Block` interface,
  `PrefixState`, `blocks/turns/block_references` rows, `CachelaneConfig` fields, SQLite columns).
  In-process working types (function parameters, local helpers) may use `camelCase`. Rule of
  thumb: if it crosses a process / storage / network boundary, snake_case.
- **Source of truth on drift**: when in-repo synthesized specs in `/designs/` conflict with the
  binding source docs (`Cachelane_Systems_Design_Document.docx`,
  `Cachelane_Phase2_Engineering_Specifications_v2.docx`; pre-extracted text under
  `/tmp/cachelane-extracts/`), the binding `.docx` wins. Fix the synthesis **upstream first**,
  then the code — otherwise drift recurs on the next milestone.
- **Fail-open**: any error in Cachelane must return the unmutated request to Claude Code. Never
  silently drop a turn or block the model.
- **Local-only**: no prompt content, API keys, or user data leave `api.anthropic.com`'s direct
  request path. No hosted backend.
- **Cache-stability gate**: SHA-256 of the prefix region must be byte-identical across 3
  consecutive identical-input runs. This gate **blocks merge** on failure — no exceptions.

## Source Documents

Original source materials at `/mnt/c/Users/jujum/Downloads/` (WSL path):
- `Cachelane_Token_Reduction_Research_and_Design.docx` — Phase 1 research (M1/M2 rationale, ADRs)
- `Cachelane_Phase2_Engineering_Specifications_v2_1.docx` — Phase 2 spec (tech stack, guardrails)
- `Cachelane_Engineering_Diagrams_v2.html` — 7 architecture diagrams (canonical visual reference)
- `Cachelane_Systems_Design_Document_1.docx` — Implementation-level design (modules, schemas)
- `Cachelane_Turns_and_Pruning_Explainer.html` — Algorithm intuition + worked examples

Pre-extracted plain text at `/tmp/cachelane-extracts/` (regenerate with pandoc if lost).
