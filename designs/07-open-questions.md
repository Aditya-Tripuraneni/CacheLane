# 07 — Open Questions

**Purpose:** All unresolved questions, their owners, targets, and current resolution status.  
**Scope:** Anything that was flagged as undecided in the source documents, plus gaps and
contradictions identified during synthesis.  
**Source:** Phase 2 Spec v2 §4 + synthesis review.

---

## Summary Table

| ID | Question | Status | Owner | Target |
|----|----------|--------|-------|--------|
| Q001 | Reference-detection precision/recall | **Unresolved — blocks M4** | Lead engineer | 2 weeks after Phase 2 approval |
| Q002 | Classifier accuracy on real-world content | Unresolved | Lead engineer | 2 weeks (parallel with Q001) |
| Q003 | Optimal K value(s) | Unresolved | Lead engineer | 3 weeks after approval |
| Q004 | Cache-control breakpoint placement for stable middle | Resolved in SDD | Lead engineer | Covered by M3 |
| Q005 | Interaction with `/compact` | **Resolved in SDD + D6** | — | — |
| Q006 | Multi-workspace operation | **Resolved in SDD** | — | — |
| Q007 | Telemetry opt-in mechanism | Partially resolved | Project lead | Before v1 release |
| Q008 | Tokenizer model-string table | Unresolved | Lead engineer | 2 days |
| Q009 | `tool_use`/`tool_result` pair atomicity | **Resolved in SDD** | — | — |
| Q_A | Keepalive experiment funding (Option A/B/C) | **Unresolved — decision needed** | Project lead | Before M8 |
| Q010 | Refetch interaction with reorderer on next turn | Unresolved | Lead engineer | With M5 |
| Q011 | Mid-turn error and turn-end semantics | Unresolved | Lead engineer | With orchestrator impl |
| Q012 | Reference-detection semantics beyond the 3-signal rule | Resolved (3-signal rule is binding) | — | — |

---

## Detail

### Q001 — Reference-Detection Precision & Recall

**Question:** Does the three-signal deterministic detector (file paths in tool calls + block IDs in
text + 40-char shingle overlap) achieve ≥ 95% precision and ≥ 85% recall against real Claude Code
sessions?

**Why it matters:** If precision is low, too many blocks are incorrectly marked "referenced" and
K-pruning saves fewer tokens. If recall is low, blocks are stubbed when they shouldn't be, causing
unnecessary refetch round-trips.

**Resolution path:**
1. Build a 100-session annotated corpus (6-hour human task — **must start during M2 or M3**)
2. Run the three-signal detector against the corpus
3. Measure precision and recall; CI gate asserts ≥ 95% / ≥ 85%
4. Only after this gate passes does M4 proceed

**Blocks:** M4 (Reference detection milestone). The corpus must exist in-repo before pruner code
is written (AC-6).

**Owner:** Lead engineer  
**Target:** 2 weeks after Phase 2 approval

---

### Q002 — Classifier Accuracy

**Question:** Does the fingerprint-based conservative classifier (defaults to `VOLATILE` unless
file paths + last-modified mtimes match a stable signature) correctly classify real-world prompt
blocks?

**Resolution path:** Validate against the same 100-session corpus as Q001 (parallel work).
Initial allowlist (CLAUDE.md, tool schemas, system prompt, pinned files) is a starting point.

**Owner:** Lead engineer  
**Target:** 2 weeks (parallel with Q001)

---

### Q003 — Optimal K Value

**Question:** Is K=3 the right default? What is the optimal K per scenario type?

**Resolution path:** Experiment K ∈ {2, 3, 4, 5, 6} across the 5 benchmark scenarios (§2.4.5 of
Phase 2 spec). Measure net effective cost = effective input cost + keepalive overhead. Paired
Wilcoxon signed-rank vs. A1 baseline.

**Current defaults pending experiment:** K=3 (default), K=2 (aggressive), K=5 (conservative).

**Owner:** Lead engineer  
**Target:** 3 weeks after Phase 2 approval

---

### Q004 — Cache-Control Breakpoint Placement for Stable Middle

**Status: Resolved in Systems Design Document.**

**Resolution:** The middle `cache_control` breakpoint is placed **only if** the same turn-window
has been seen byte-identical at least twice. This is the "stable-middle heuristic" implemented in
the Reorderer.

**Implication:** First turn after `/compact` never gets a middle breakpoint; second (identical)
turn gets the breakpoint.

---

### Q005 — Interaction with `/compact`

**Status: Resolved in Systems Design Document + D6 (diagram).**

**Resolution:**
1. Cachelane detects the compacted history by comparing middle-region hashes
2. Removes blocks no longer present from the reference log
3. Creates a new Block for the compacted summary, classifies it as `SEMI`
4. Defers the middle breakpoint until the compacted summary is seen byte-identical twice
5. First turn after `/compact` pays a full middle write; second turn hits the cache

**Implementation hook:** detect in the PreRequest handler by hashing the middle region and
comparing against `CacheStateTracker.middleHash`.

---

### Q006 — Multi-Workspace Operation

**Status: Resolved in Systems Design Document.**

**Resolution:**
- Reference log is keyed by `workspace_id`
- `CacheStateTracker` is also keyed by `workspace_id`
- Prefixes are never shared across workspaces (Anthropic workspace isolation since Feb 5, 2026)
- `workspace_id` comes from Claude Code's workspace identification API (Claude Code ≥ 0.6)

---

### Q007 — Telemetry Default & Activation Mechanism

**Status: Partially resolved.**

**Resolved part:** Telemetry is **OFF by default**. This is binding per Phase 2 spec D9 and
REQ-F-011.

**Unresolved part:** The exact `--opt-in` command shape and the README privacy-policy section
wording. Proposed: `cachelane stats --opt-in` activates it; `cachelane stats --opt-out` disables
it permanently.

**Owner:** Project lead  
**Target:** Before v1 release

---

### Q008 — Tokenizer Model-String Table

**Question:** What are the exact model-string identifiers for Opus 4.6 and Opus 4.7 that the
`@anthropic-ai/tokenizer` SDK requires for the model-string lookup?

**Why it matters:** Opus 4.7 produces up to 35% more tokens for the same input. If the wrong
tokenizer is selected, block-size accounting is wrong, which can break breakpoint placement and
budget decisions.

**Resolution path:** Verify model strings against `@anthropic-ai/tokenizer` documentation.
Build a table lookup in the `tokenizer` module; validate in tests for both model versions (AC-14).

**Owner:** Lead engineer  
**Target:** 2 days

---

### Q009 — `tool_use`/`tool_result` Pair Atomicity

**Status: Resolved in Systems Design Document.**

**Resolution:** The Reorderer MUST NOT move `tool_use`/`tool_result` pairs individually. It may
only move whole pairs as a unit. A split invalidates the prefix from that point on.

**Implementation gate:** Reorderer test must assert pair atomicity (AC-16).

---

### Q_A — Keepalive Experiment Funding

**Question:** How will the keepalive experiment API calls be funded?

**Three options:**
- **Option A:** Pro/Max subscription — paced across several days to not exceed 5-hour usage
  windows; $0 additional cash cost; ~2 weeks elapsed
- **Option B:** Analytical-only — use published cache-arithmetic instead of live experiments;
  $0 cost; no empirical benchmarks
- **Option C:** Separate Anthropic API account — ~$80 up-front; fastest

**Current default ship config:** Hybrid policy (B1 adaptive + 1-hour TTL for prefixes > 50k
tokens) is the starting default; experiment results would validate or replace it.

**Blocks:** Empirical keepalive validation in M8 (optional — can ship with analytical default).

**Owner:** Project lead  
**Target:** Before M8

---

### Q010 — Refetch Interaction with Reorderer

**Question:** When the model calls `cachelane:expand` and a block is restored, how does the
Reorderer treat it on the immediately following turn?

**Background:** The restored block enters the suffix on the turn after refetch. On the next turn,
the Classifier re-evaluates its volatility. If it was originally `SEMI`, it may now qualify for
the middle region, but its `unused_turns` counter is 0.

**Open sub-questions:**
- Does the Reorderer immediately place it back in the middle/prefix, or does it stay in the suffix
  for one "warming" turn?
- Does the stable-middle heuristic (byte-identical twice) apply to a re-restored block?

**Owner:** Lead engineer  
**Target:** With M5 implementation

---

### Q011 — Mid-Turn Error and Turn-End Semantics

**Question:** What happens to `unused_turns` counters if the assistant errors mid-reply (before the
turn ends cleanly)?

**Background:** Turn end is defined as "the assistant stops talking and waits for the user." If the
assistant errors before that, it is unclear whether:
- The failed turn still triggers `unused_turns` increments (conservative: treat as turn-end)
- The failed turn is ignored (counters not ticked)

**Impact:** If errors don't tick counters, blocks can accumulate "free" turns during error storms.
If they do tick, errors accelerate stubbing.

**Owner:** Lead engineer  
**Target:** With orchestrator implementation (M3)

---

### Q012 — Reference-Detection Semantics Beyond the 3-Signal Rule

**Status: Resolved.**

**Resolution:** Only the three-signal deterministic detector is binding:
1. File paths in tool-call arguments
2. Block IDs (injected ULID prefix) in assistant text
3. 40-character shingle exact-match overlap

Any broader interpretation ("paraphrasing counts as a reference") is NOT implemented.
The quality gate (≥ 95% precision, ≥ 85% recall on the corpus) is the acceptance criterion.

---

## Previously Identified Contradictions (All Resolved)

| # | Contradiction | Resolution |
|---|--------------|------------|
| C1 | Sub-component pipeline order (Diagram 1 showed Classifier→Reorderer→Pruner) | **Classifier→Pruner→Reorderer is canonical.** D1 v2 corrected. Rationale: Pruner changes block sizes/volatility before Reorderer computes breakpoints. |
| C2 | Vocabulary drift (spec "stable/semi/volatile" vs. code "CACHED/WARM/HOT") | **STABLE / SEMI / VOLATILE is the only acceptable vocabulary everywhere** (spec, code, logs, tests). No alternative naming. Clarified in Phase 2 spec v2 §6.4. |
| C3 | Phase 2 spec section numbering (§6 guardrails printed as §7.x internally) | **Fixed in Phase 2 spec v2.** All §7.x headings corrected to §6.x. |
| C4 | Cache state tracker had no drawn interactions in D1 | **Fixed in D1 v2.** Interaction arrows added: reads counters, writes prefix hash, reads expiry, updates expiry. |
| C5 | Keepalive sequence not diagrammed | **Fixed: D5 added in Diagrams v2.** 10-second check loop, idle + expiry conditions shown. |
| C6 | `/compact` handling not diagrammed | **Fixed: D6 added in Diagrams v2.** Full sequence: hash detection → block removal → SEMI classification → deferred breakpoint. |
| C7 | Refetch flow not diagrammed | **Fixed: D7 added in Diagrams v2.** Full sequence: `cachelane:expand` → SQLite lookup → original tool call → counter reset. |
| C8 | 100-session corpus dependency implicit | **Fixed in Systems Design M4 milestone:** "PREREQUISITE: 100-session annotated corpus complete before M4 begins. 6-hour human annotation task; start during M2 or M3." |
