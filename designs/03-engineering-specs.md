# 03 — Engineering Specifications

**Purpose:** All functional/non-functional requirements, API contracts, data models, acceptance criteria.  
**Scope:** Phase 2 implementation requirements — what must be built and how it will be verified.  
**Source:** `Cachelane_Phase2_Engineering_Specifications_v2_1.docx` (v2, May 2026).

> **Section-numbering note:** The original doc had a printing bug where §6 "Agent implementation
> guardrails" printed its subsections as §7.1–7.7. Fixed in v2 — all references below use the
> corrected §6.x numbering.

---

## Functional Requirements

### REQ-F-001 through REQ-F-010 — Transport & Storage Foundation

| ID | Requirement | Source |
|----|-------------|--------|
| REQ-F-001 | The system SHALL be distributed as an MCP server using `@modelcontextprotocol/sdk` (TypeScript) over **stdio transport** (no network ports). | §1.1, D8 |
| REQ-F-002 | The orchestrator SHALL read Anthropic API usage fields on every turn: `cache_creation_input_tokens`, `cache_read_input_tokens`, `ephemeral_5m_input_tokens`, `ephemeral_1h_input_tokens` via `@anthropic-ai/sdk`. | §1.1 |
| REQ-F-003 | Block-size accounting SHALL use `@anthropic-ai/tokenizer` with a **model-string lookup** to select the correct tokenizer per request (supports both Opus 4.6 and 4.7). | §1.1, Q8 |
| REQ-F-004 | Persistent storage SHALL be a single-file SQLite database via `better-sqlite3` in WAL mode. No external store. | §1.1, §1.2.2, D5 |
| REQ-F-005 | In-memory cache-state tracking SHALL live in the orchestrator process using plain `Map`/`Set`; restart recovery relies on the on-disk SQLite log as the authoritative source. | §1.1 |
| REQ-F-006 | Hashing for prefix fingerprinting and block deduplication SHALL use SHA-256 via `node:crypto`. | §1.1 |
| REQ-F-007 | The CLI SHALL be implemented with `commander`. | §1.1 |
| REQ-F-008 | Logging SHALL be structured JSON via `pino`, with `pino-pretty` in dev. Log lines SHALL include billable usage fields. | §1.1, §1.4 |
| REQ-F-009 | Local logs SHALL be written to `~/.cachelane/logs/`, **rotated daily**, with **7-day retention**. | §1.4 |
| REQ-F-010 | The system SHALL expose a `cachelane stats` CLI command that reads directly from the SQLite log (no external metrics service). | §1.4 |

### REQ-F-011 through REQ-F-020 — Telemetry, Privacy & Security

| ID | Requirement | Source |
|----|-------------|--------|
| REQ-F-011 | The system SHALL implement opt-in anonymous telemetry reporting cache-hit ratio, average reduction, and model used; **default OFF**; permanently disable-able. | §1.4 |
| REQ-F-012 | Telemetry MUST NOT be enabled by default; activation requires an explicit command. | §1.4, Q7, D9 |
| REQ-F-013 | All processing SHALL occur locally. No request bodies, prompts, or completions may leave the user's machine except in the direct path to `api.anthropic.com`. | §1.5, D7 |
| REQ-F-014 | The reference log SHALL store **block IDs, classifications, token counts, usage counters only** — NOT block contents. | §1.5 |
| REQ-F-015 | Block contents SHALL live only transiently in the orchestrator process and SHALL NOT be persisted. | §1.5 |
| REQ-F-016 | The Anthropic API key SHALL be read from the user's existing Claude Code config; Cachelane MUST NOT read, store, or forward it outside the originating API call. | §1.5 |
| REQ-F-017 | The system SHALL respect Anthropic workspace-level cache isolation (effective since Feb 2026): Cachelane MUST use Claude Code's existing workspace ID and MUST NOT share prefixes across workspaces. | §1.5, Q6 |
| REQ-F-018 | The reference log SHALL be keyed by workspace ID. | Q6 |
| REQ-F-019 | The system SHALL implement a synthetic **keepalive ping** mechanism: a minimal API call (`max_tokens=1`, one-token user message) that touches the same prefix to reset its TTL. | §2.1 |
| REQ-F-020 | Keepalive pings MUST NOT fire when a real turn just touched the cache (idle-only triggering). | §2.2, B1 |

### REQ-F-021 through REQ-F-030 — Orchestration Logic

| ID | Requirement | Source |
|----|-------------|--------|
| REQ-F-021 | The default ship configuration SHALL be a **hybrid keepalive policy**: adaptive 4-minute idle trigger for short prefixes, automatically switching to 1-hour TTL when prefix size P > 50k tokens. | §2.4.6 |
| REQ-F-022 | A `cachelane.config.json` (`~/.cachelane/config.json`) SHALL expose manual override knobs for keepalive policy and all other configurable parameters. | §2.4.6 |
| REQ-F-023 | The K-pruner SHALL use a **three-signal deterministic reference detector**: (a) file paths quoted in tool calls, (b) block IDs cited in assistant text, (c) 40-character shingle exact substring overlap. | §1.2.3, Q1 |
| REQ-F-024 | Cachelane SHALL inject a short ID prefix on every stubbable block (used by the reference detector and for refetch via `cachelane:expand`). | §1.2.3 |
| REQ-F-025 | The system MUST NOT use embeddings, vector stores, or any ML model dependency for reference detection. | §1.2.3, D6 |
| REQ-F-026 | The K-pruner default value of K SHALL be **K=3**, with `--aggressive` mode (K=2) and `--conservative` mode (K=5). | Q3 |
| REQ-F-027 | The classifier SHALL be fingerprint-based and **conservative**: a block defaults to `VOLATILE` unless it matches a stable signature (hash of file paths + last-modified mtimes for stable candidates). | Q2 |
| REQ-F-028 | The reorderer MUST NOT reorder `tool_use`/`tool_result` pairs individually; it MAY only move whole pairs as a unit (invariant preserves byte-identical prefix). | Q9 |
| REQ-F-029 | A second `cache_control` breakpoint at the middle-suffix boundary SHALL be placed **only if** the same turn-window has been seen byte-identical at least twice (dynamic placement). | Q4 |
| REQ-F-030 | When Claude Code's `/compact` runs, Cachelane SHALL treat the new compacted history as a fresh middle region and reset all per-block counters for replaced blocks. | Q5 |

### REQ-F-031 through REQ-F-037 — Distribution & Packaging

| ID | Requirement | Source |
|----|-------------|--------|
| REQ-F-031 | The interaction with `/compact` SHALL be documented in the README. | Q5 |
| REQ-F-032 | The system SHALL be packaged as an npm package and dual-published as a Claude Code plugin via `.claude-plugin` manifest. | §1.1 |
| REQ-F-033 | Releases SHALL be signed via **npm provenance** through GitHub Actions. | §1.1 |
| REQ-F-034 | Build/bundling SHALL be performed with `tsup` (esbuild), emitting both ESM and CJS. | §1.1 |
| REQ-F-035 | The CLI SHALL provide a privacy doc in the README and a `cachelane stats --opt-in` command for telemetry opt-in. | Q7, D9 |
| REQ-F-036 | `[INFERRED]` Stubs created by the K-pruner SHALL preserve the block's identifier and be refetchable on demand — pruning is non-lossy at the application layer. | Project context |
| REQ-F-037 | `[INFERRED]` The orchestrator SHALL forward requests directly to `api.anthropic.com` on the user's behalf (no gateway). | §3.3 |

---

## Non-Functional Requirements

### REQ-NF-001 through REQ-NF-007 — Environment & Footprint

| ID | Requirement | Target | Source |
|----|-------------|--------|--------|
| REQ-NF-001 | Runtime: Node.js | **≥ 20.10** (native fetch, stable test runner) | §1.3 |
| REQ-NF-002 | Claude Code version | **≥ 0.6** (MCP server registration + PostResponse hooks) | §1.3 |
| REQ-NF-003 | OS support | macOS, Linux, Windows (better-sqlite3 prebuilds) | §1.3 |
| REQ-NF-004 | Installed disk footprint | **< 5 MB** | §1.3 |
| REQ-NF-005 | Reference-log growth | **~1 KB per turn** on typical sessions | §1.3 |
| REQ-NF-006 | Resident memory (steady state) | **< 50 MB** | §1.3 |
| REQ-NF-007 | No daemon / background process beyond the MCP server lifetime | (architectural constraint) | §1.3 |

### REQ-NF-008 through REQ-NF-016 — Quality Gates

| ID | Requirement | Target | Source |
|----|-------------|--------|--------|
| REQ-NF-008 | Reference-detection precision | **≥ 95%** against 100-session annotated corpus (CI gate) | Q1, §6.3 |
| REQ-NF-009 | Reference-detection recall | **≥ 85%** against 100-session annotated corpus (CI gate) | Q1, §6.3 |
| REQ-NF-010 | Cache-stability assertion | Request bodies byte-identical (SHA-256) from prompt start through `cache_control` breakpoint across 3 consecutive identical-input runs | §6.2 |
| REQ-NF-011 | Hot-path performance characterisation | Orchestrator work is microseconds (1 SHA-256 + 1 classification + 1 SQLite write); network is the bottleneck | §1.2.1 |
| REQ-NF-012 | CI cache-stability scenarios | **≥ 5 scenarios** (empty/large tool schemas, middle present/empty, active-pruning stub-just-created) | §6.2 |
| REQ-NF-013 | _removed_ — PR LOC cap not enforced (M1 scaffolding bundle grandfathered; project decided to drop this guardrail) | _n/a_ | §6.5 (waived) |
| REQ-NF-014 | Tests included in same PR | No "follow-up test" merges | §6.5 |
| REQ-NF-015 | Reviewer time budget | 30 min/PR; up to 90 min for cache-stability or pruner PRs | §6.6 |
| REQ-NF-016 | Total v1.0 human review time target | **~18 hours** across 2–3 calendar weeks | §3.4.3 |

### REQ-NF-017 through REQ-NF-029 — Cost & Metrics

| ID | Requirement | Target | Source |
|----|-------------|--------|--------|
| REQ-NF-017 | Total agent token spend target | **$180–$340** to v1.0 | §3.4.1 |
| REQ-NF-018 | Upfront cash spend | **$0** (or $20 optional domain; $80 if separate API account) | §3.2 |
| REQ-NF-019 | Recurring cash spend | **$0** (up to $10/mo only if telemetry enabled and > 100k users) | §3.3 |
| REQ-NF-020 | Cache-stability test gate | Failure **blocks merge — no exceptions** | §6.2 |
| REQ-NF-021 | Cache-stability test (breakpoint-change PRs) | Must pass **twice on independent runs** | §6.5 |
| REQ-NF-022 | Effective input-token cost formula | `input_tokens + 1.25×cache_creation_5m + 2.0×cache_creation_1h + 0.1×cache_read` | §2.4.4 |
| REQ-NF-023 | Cache hit ratio formula | `cache_read_input_tokens / (input + cache_creation + cache_read)` | §2.4.4 |
| REQ-NF-024 | Latency metric | Wall-clock time-to-first-token on first real turn after a pause | §2.4.4 |
| REQ-NF-025 | Eviction-event metric | Count of turns where `cache_creation > 0` despite a previously-cached prefix | §2.4.4 |
| REQ-NF-026 | Telemetry backend (if enabled) | Cloudflare Workers free tier (`https://telemetry.cachelane.dev/v1/report`) | §3.3 |
| REQ-NF-027 | Tokenizer drift awareness | Opus 4.7 produces up to **35% more tokens** than 4.6 for the same input; model-string table lookup is mandatory | §1.1, Q8 |
| REQ-NF-028 | `[INFERRED]` Test framework | `vitest` (native TS, ESM-native) | §1.1 |
| REQ-NF-029 | `[INFERRED]` E2E API isolation | `nock`-recorded fixtures for deterministic prompt assembly in CI; real API calls only for cache-measurement experiments | §1.1, §2.4.5 |

---

## API Contracts

### C-1: Anthropic Messages API (south-bound, consumed)

- **Client SDK:** `@anthropic-ai/sdk`
- **Required response fields read per turn:**
  - `cache_creation_input_tokens`
  - `cache_read_input_tokens`
  - `ephemeral_5m_input_tokens`
  - `ephemeral_1h_input_tokens`
- **Cache semantics:** byte-exact prefix matching with TTL. Workspace-isolated since Feb 2026.
- **Pricing:** 0.1× read, 1.25× 5-min write, 2.0× 1-hour write.

### C-2: Keepalive Ping Request

- **Payload:** one-token user message; `max_tokens=1`; identical prefix to current session
- **Effect:** resets the prefix's TTL
- **Per-ping billable cost (model):** ~`0.1 × P + 5` base-input-token units

### C-3: MCP Server (Cachelane ↔ Claude Code)

- **Transport:** stdio (no network port)
- **SDK:** `@modelcontextprotocol/sdk` ^1.x
- **Host requirement:** Claude Code ≥ 0.6
- **MCP tools exposed:** `cachelane:stats`, `cachelane:explain`, `cachelane:expand`

### C-4: Telemetry Endpoint (opt-in, operated by project)

- **URL:** `https://telemetry.cachelane.dev/v1/report`
- **Default state:** OFF
- **Payload fields (allowed):** `installation_id` (random UUID), `version`, `reporting_period_ms`, `turns`, `cache_hit_ratio`, `pruner_enabled`, `keepalive_policy`, `effective_cost_units_total`, `no_cachelane_baseline_total`
- **Payload fields (forbidden):** `workspace_id`, `session_id`, file paths, block contents, model name, API key, IP-correlatable timestamps
- **Rate:** at most once per hour per installation
- **Response:** 204

### C-5: CLI Surface (commander)

```
cachelane install
cachelane stats [--since <ISO-duration>]
cachelane stats --opt-in
cachelane explain [--turn <N>]
cachelane pin <file|glob>
cachelane exclude <file|glob>
cachelane prune --aggressive | --conservative | --default
cachelane keepalive <off|static|adaptive|auto>
cachelane disable
cachelane enable
cachelane doctor
cachelane uninstall [--purge]
```

### C-6: Configuration File

- **Path:** `~/.cachelane/config.json`
- **Schema version field:** `"version": 1`
- **Key fields (with defaults):**

| Field | Default | Range/values | Effect |
|-------|---------|-------------|--------|
| `pruner.enabled` | `true` | boolean | Toggle K-pruning |
| `pruner.k` | `3` | 1–10 | Idle-turn threshold |
| `pruner.mode` | `"default"` | `default \| conservative \| aggressive` | Overrides K |
| `keepalive.policy` | `"auto"` | `off \| static \| adaptive \| auto` | Keepalive strategy |
| `keepalive.interval_seconds` | `150` | positive int | Check loop interval |
| `keepalive.idle_threshold_seconds` | `240` | positive int | Min idle before ping |
| `keepalive.large_prefix_threshold_tokens` | `50000` | positive int | Switch to 1h TTL above this |
| `classification.sliding_window_turns` | `4` | positive int | Recent-turn window size |
| `telemetry.opt_in` | `false` | boolean | Telemetry opt-in |
| `log_level` | `"info"` | `trace \| debug \| info \| warn \| error` | Pino log level |

- **Migration:** newer-than-supported config schema → refuse to start; older → run migration

---

## Data Models

> **Convention:** storage and API-contract types use `snake_case` (e.g. the `Block` interface
> below, the `blocks/turns/block_references` rows, and `CachelaneConfig` fields). In-process
> working types (function parameters, request payloads handled in code) may use `camelCase`.
> Rule of thumb: if it crosses a process / storage / network boundary, snake_case.

### Entity: Block (in-memory, transient)

```typescript
interface Block {
  // Identity
  id: string;                       // ULID; assigned on first observation
  workspace_id: string;             // Claude Code workspace identifier
  session_id: string;               // Claude Code session identifier

  // Classification
  kind: BlockKind;                  // see enum below — 11 values
  volatility: Volatility;           // "STABLE" | "SEMI" | "VOLATILE"
  is_pinned: boolean;               // true if matched by config.classification.pin

  // Content (transient; never persisted)
  // content: AnthropicContentBlock — deferred to M2 (no consumer in M1)
  content_hash: string;             // SHA-256 of canonical serialization

  // Accounting
  token_count: number;              // tokens under the current model's tokenizer
  added_at_turn: number;            // turn number when first observed
  last_referenced_at_turn: number;  // turn number of most recent reference
  unused_turns: number;             // counter for K-pruning; starts at 0

  // Stub state
  is_stub: boolean;                 // true if currently materialized as a stub
  stub_summary: string | null;      // one-line summary if stubbed; else null
  refetch_handle: string | null;    // tool invocation to restore content
}

type BlockKind =
  | "system_prompt"
  | "tool_schema"
  | "claude_md"
  | "project_rules"
  | "prior_turn"
  | "tool_use_result_pair"
  | "file_read"
  | "retrieval_result"
  | "tool_output"
  | "user_message"
  | "stub";
```

### Entity: ReferenceLog row (SQLite `blocks` table)

```sql
CREATE TABLE blocks (
  id              TEXT PRIMARY KEY,         -- ULID
  workspace_id    TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  kind            TEXT NOT NULL,
  volatility      TEXT NOT NULL,            -- "STABLE" | "SEMI" | "VOLATILE"
  is_pinned       INTEGER NOT NULL DEFAULT 0,
  token_count     INTEGER NOT NULL,
  added_at_turn   INTEGER NOT NULL,
  last_referenced_at_turn INTEGER NOT NULL,
  unused_turns    INTEGER NOT NULL DEFAULT 0,
  is_stub         INTEGER NOT NULL DEFAULT 0,
  stub_summary    TEXT,
  refetch_handle  TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_blocks_session ON blocks(workspace_id, session_id);
CREATE INDEX idx_blocks_hash    ON blocks(content_hash);
CREATE INDEX idx_blocks_unused  ON blocks(unused_turns) WHERE is_stub = 0;
```

**Block contents are NEVER persisted** — only metadata.

### Entity: Turn (SQLite `turns` table)

```sql
CREATE TABLE turns (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  turn_number     INTEGER NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_creation_5m_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_creation_1h_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens          INTEGER NOT NULL DEFAULT 0,
  effective_cost_units       REAL NOT NULL,  -- computed at write time
  prefix_breakpoint_hash     TEXT,
  middle_breakpoint_hash     TEXT,
  pruned_blocks_count        INTEGER NOT NULL DEFAULT 0,
  keepalive_pings_since_last_turn INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_turns_session_num ON turns(workspace_id, session_id, turn_number);
```

Column names (`cache_creation_5m_tokens`, `cache_creation_1h_tokens`) deliberately mirror the
Anthropic API response fields (`ephemeral_5m_input_tokens`, `ephemeral_1h_input_tokens`,
`cache_creation_input_tokens`) so the orchestrator does not need a translation layer.

### Entity: BlockReference (SQLite `block_references` table, append-only audit log)

```sql
CREATE TABLE block_references (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id        TEXT NOT NULL REFERENCES blocks(id),
  turn_id         TEXT NOT NULL REFERENCES turns(id),
  reference_type  TEXT NOT NULL,    -- "tool_call" | "text_quote" | "id_mention"
  evidence        TEXT NOT NULL,    -- short string showing what matched
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_refs_block ON block_references(block_id);
CREATE INDEX idx_refs_turn  ON block_references(turn_id);
-- 90-day retention cap (enforced at write time once retention job lands; M4+)
```

### Entity: CacheStateTracker (in-memory only)

```typescript
interface PrefixState {
  workspace_id: string;
  prefix_hash: string;
  middle_hash: string | null;
  prefix_token_count: number;
  ttl_class: "5m" | "1h";
  cached_at_ms: number;
  last_read_at_ms: number;
  expected_expiry_ms: number;
}
// Map<workspace_id, PrefixState>
// Resets on process restart; next turn pays one cache-write penalty
```

### Entity: Turn (logical model)

- One user message + one assistant reply (tool calls inside the reply do not split the turn)
- Contains zero or more `(tool_use, tool_result)` pairs
- The Reorderer moves `(tool_use, tool_result)` pairs **only as atomic units** (splitting would
  invalidate the prefix from that point on)

---

## Acceptance Criteria

| ID | Criterion | REQ mapping |
|----|-----------|-------------|
| AC-1 | Cache-stability test fires the same logical prompt 3× against a recorded fixture; request bodies byte-identical (SHA-256) from prompt start through `cache_control` breakpoint | REQ-NF-010, REQ-NF-020 |
| AC-2 | Cache-stability suite includes ≥ 5 scenarios (empty schemas; large schemas; middle included; middle empty; active-pruning stub-just-created) | REQ-NF-012 |
| AC-3 | Cache-stability test failure blocks merge with no exceptions | REQ-NF-020 |
| AC-4 | PRs modifying `cache_control` breakpoint placement pass cache-stability test twice on independent runs | REQ-NF-021 |
| AC-5 | Reference-detection precision ≥ 95% and recall ≥ 85% against the 100-session corpus, asserted in CI | REQ-NF-008, REQ-NF-009 |
| AC-6 | The 100-session annotated corpus exists in-repo **before** any pruner code is written | §6.3 Step 1 |
| AC-7 | Each major component PR includes a spec-to-code diff document mapping every named spec concept to its code symbol | §6.4 |
| AC-8 | _removed_ — see REQ-NF-013 waiver. M1 scaffolding bundle grandfathered; no PR LOC cap enforced. | _n/a_ |
| AC-9 | Every PR includes its own tests; no "tests in follow-up" merges | REQ-NF-014 |
| AC-10 | Reviewer checklist applied to every PR: CI green; spec-to-code diff reviewed; no new non-deterministic ops/timestamps/Date.now/Math.random/Map iteration in hot paths; new deps audited; PR description explains "why" | §6.6 |
| AC-11 | Keepalive experiment: 11 conditions × 5 scenarios × 30 sessions; report mean/median/95% CI of net effective cost; paired Wilcoxon signed-rank vs A1 baseline | §2.4.5 |
| AC-12 | Effective input-token cost computed as `input_tokens + 1.25×cache_creation_5m + 2.0×cache_creation_1h + 0.1×cache_read` | REQ-NF-022 |
| AC-13 | v1 keepalive default shipped as the empirically-derived hybrid policy after §2 experiments | REQ-F-021 |
| AC-14 | Tokenizer selected via model-string table lookup; validated for both Opus 4.6 and 4.7 | REQ-F-003, Q8 |
| AC-15 | Reference log keyed by workspace ID; verified locally that no prefix is shared across workspaces | REQ-F-017, REQ-F-018 |
| AC-16 | Reorderer test asserts `(tool_use, tool_result)` pairs are only moved together | REQ-F-028 |
| AC-17 | Local logs rotated daily with 7-day retention in `~/.cachelane/logs/` | REQ-F-009 |
| AC-18 | Telemetry: off by default; opt-in via explicit command; documented privacy policy in README | REQ-F-011, REQ-F-012 |
| AC-19 | Steady-state memory < 50 MB; installed disk < 5 MB; reference log ~1 KB/turn | REQ-NF-004 to REQ-NF-006 |
| AC-20 | npm package emits dual ESM/CJS via tsup; publishes with npm provenance from GitHub Actions on tag | REQ-F-032 to REQ-F-034 |
| AC-21 | Phase 2 readiness checklist (all 7 rows) approved before systems-design authoring begins | §7 |

---

## Edge Cases & Failure Modes

| # | Scenario | Required behaviour |
|---|----------|--------------------|
| E1 | Process restart | SQLite reference log is authoritative; in-memory cache state resets; next turn pays one cache-write penalty |
| E2 | `/compact` runs | Reset `unused_turns` for all replaced blocks; classify compacted summary as `SEMI`; defer middle breakpoint until seen byte-identical twice |
| E3 | `(tool_use, tool_result)` pair split by reorderer | **Must not happen.** Pairs are only moved as atomic units (REQ-F-028). A split invalidates the prefix from that point. |
| E4 | Tokenizer drift Opus 4.6 → 4.7 | Up to 35% more tokens for same text; must use model-string lookup (REQ-F-003) or cost predictions are wrong |
| E5 | Cache TTL expiry between turns (idle session) | Keepalive worker mitigates; TTL expiry is also tracked as an eviction-event metric |
| E6 | Multi-workspace prefix sharing | Violates Anthropic's Feb 2026 isolation; must key reference log by workspace ID (REQ-F-017, REQ-F-018) |
| E7 | Middle-region speculative cache write (unstable middle) | Wastes 1.25× write; mitigated by the "twice seen" heuristic (REQ-F-029) |
| E8 | SQLite write failure | Log; drop the per-block counter update for this turn; **continue** (fail-open) |
| E9 | SQLite corruption (detected on startup) | Rename to `cachelane.db.corrupt-{timestamp}`; create new empty DB; warn user |
| E10 | Hook exception | Log stack; return unmutated request; pass-through for one turn (fail-open) |
| E11 | Non-deterministic serialisation / timestamp leakage in prefix | Cache-stability test catches this; `Date.now`, `Math.random`, `Map` iteration order are flagged in PR checklist |
| E12 | Refetch unavailable (block's original source gone) | `[INFERRED]` Must handle gracefully; return error to model, do not crash |
| E13 | Two Claude Code instances sharing same SQLite | WAL mode handles concurrent readers + serialised writers safely |
| E14 | `better-sqlite3` native build failure | Prebuilt binaries used; `cachelane doctor` checks Node version |
| E15 | Config schema newer than supported | Refuse to start (avoid silent demotion) |
| E16 | Config schema older than current | Run migration automatically |

---

## Phase 2 Scope Boundaries

**In scope (v1.0):**
- M1 — cache-aware orchestration (classify → prune → reorder + breakpoints + keepalive)
- M2 — trajectory-aware K-pruning
- MCP server over stdio
- SQLite reference log
- CLI (install, stats, explain, pin, exclude, prune, keepalive, disable/enable, doctor, uninstall)
- Opt-in telemetry (off by default)
- Dual ESM/CJS npm package + Claude Code plugin marketplace listing

**Deferred to v1.1+:**
- M3 — tokenizer-aware rewriting (D3, fast-follow)
- M4 — speculative inclusion (overlaps Token Savior)
- M5 — cross-session decision distillation (overlaps memsearch)
- Tracker reconstruction on restart
- Shared team caches

**Explicitly rejected:**
- Embeddings / vector stores / ML model dependencies (D6)
- External Redis / DuckDB
- JSON-on-disk storage
- Hosted backend / cloud infrastructure (D7)
- External APM (Sentry, Datadog)
- Formal verification / model checkers

---

## Open Questions

| ID | Question | Owner | Target |
|----|----------|-------|--------|
| Q001 | Reference-detection precision and recall on real sessions | Lead engineer | 2 weeks after Phase 2 approval |
| Q002 | Classifier accuracy on real-world content | Lead engineer | 2 weeks (parallel with Q001) |
| Q003 | Optimal K value(s) — K=3 is a starting point | Lead engineer | 3 weeks after approval |
| Q007 | Telemetry: off-by-default confirmed; `--opt-in` command shape TBD | Project lead | Before v1 release |
| Q008 | Tokenizer model-string table for Opus 4.6 and 4.7 | Lead engineer | 2 days |

See [`07-open-questions.md`](07-open-questions.md) for complete list.
