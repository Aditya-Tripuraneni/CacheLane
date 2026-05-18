# 06 — Systems Design

**Purpose:** Technology stack, module layout, data schemas, performance budgets, failure modes, and release milestones.  
**Scope:** Implementation-level reference — the "how" of building Cachelane.  
**Source:** `Cachelane_Systems_Design_Document_1.docx` (v1.0, May 2026).

---

## Goals & Non-Goals

**Goals:**
- Reduce input-token costs via K-pruning (non-lossy, refetchable stubs)
- Maximise cache hits via block reordering + two `cache_control` breakpoints
- Refresh prompt cache TTL via keepalive worker
- **Fail open:** never make Claude Code slower or less reliable
- Local-only operation — zero-cost regime, per-user
- Respect Anthropic workspace cache isolation (Feb 5, 2026)

**Non-Goals:**
- Tokenizer-aware rewriting (Phase 1 M3) — deferred to v1.1
- Tracker reconstruction on restart — deferred to v1.1 (one cache-write penalty on cold start is acceptable)
- Shared team caches — explicitly out of scope; would leave the zero-cost regime
- Retry of Anthropic API 5xx — "that's the API client's job"

---

## Infrastructure & Technology Choices

| Layer | Choice | Version | Rationale |
|-------|--------|---------|-----------|
| Language / runtime | TypeScript, Node.js | ≥ 20.10 | Native fetch, stable test runner |
| MCP framework | `@modelcontextprotocol/sdk` | ^1.x (MIT) | Official MCP; Claude Code ≥ 0.6 required |
| API client | `@anthropic-ai/sdk` | ^0.x (MIT) | First-party Anthropic client |
| Tokenizer | `@anthropic-ai/tokenizer` | ^0.x | Resolves Opus 4.6 vs 4.7 differences |
| Persistent storage | `better-sqlite3` | ^11.x | Synchronous SQLite in WAL mode; prebuilt binaries |
| ID generation | `ulid` | ^2.x | Block IDs |
| CLI | `commander` | ^12.x | CLI parsing |
| Logging | `pino` + `pino-pretty` | ^9.x + ^11.x | Structured logging, daily rotation |
| Config validation | `zod` | ^3.x | Schema validation |
| Tests | `vitest` + `nock` | ^2.x + ^14.x | Unit/integration; nock for recorded API fixtures |
| Build | `tsup` (esbuild) | ^8.x | Dual ESM/CJS output |
| Lint | `eslint` + `@typescript-eslint` | ^9.x + ^8.x | Includes `no-restricted-paths` for module layering |
| Distribution | npm tarball + Claude Code marketplace | — | GitHub Actions signs provenance |
| Hosted services | None (local-only) | — | Optional telemetry endpoint: `https://telemetry.cachelane.dev/v1/report` |

---

## High-Level Architecture

### Module Layout (8 modules, strictly layered)

```
types
  ├── config
  ├── storage
  ├── tokenizer
  └── classifier
        └── orchestrator   (hot path — classify → prune → reorder per turn)
              └── keepalive
                    └── server   (MCP server — cachelane:stats, :explain, :expand)
                          └── cli
```

**Dependency rule:** Strict downward-only imports, enforced by `eslint-plugin-import / no-restricted-paths`.
Violations **block merge**.

### Component Locations

| Component | Location |
|-----------|----------|
| Orchestrator process | RAM |
| Classifier, Pruner, Reorderer, Keepalive worker, MCP server, Cache-state tracker | In orchestrator process |
| SQLite reference log | `~/.cachelane/cachelane.db` |
| Config file | `~/.cachelane/config.json` |
| Log files | `~/.cachelane/logs/*.log` (daily rotation, 7-day retention) |
| Claude Code integration | `~/.claude/mcp.json` (MCP registration), `~/.claude/hooks/` (hooks) |

---

## Data Architecture

### Storage Tiers

| Tier | What's stored | Persistence | Reset condition |
|------|--------------|-------------|-----------------|
| In-memory (`CacheStateTracker`) | Per-prefix: hash, ttl_class, cached_at_ms, last_read_at_ms, expected_expiry_ms | RAM only | Process restart |
| SQLite (`~/.cachelane/cachelane.db`) | Per-block metadata (NOT contents), turn records, reference audit log | On-disk | Explicit purge |
| Block content | Transient in orchestrator only | Never persisted | Each turn |

**Block contents are NEVER stored anywhere.** Only metadata (id, kind, hashes, counters).

### SQLite Schema

#### `blocks` table

```sql
CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  volatility TEXT NOT NULL,    -- "STABLE" | "SEMI" | "VOLATILE"
  token_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  unused_turns INTEGER NOT NULL DEFAULT 0,
  is_stub INTEGER NOT NULL DEFAULT 0,
  refetch_handle TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_blocks_workspace_session ON blocks(workspace_id, session_id);
CREATE INDEX idx_blocks_content_hash ON blocks(content_hash);
CREATE INDEX idx_blocks_unused ON blocks(unused_turns) WHERE is_stub = 0;
```

#### `turns` table

```sql
CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  cache_creation_5m_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_1h_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  effective_cost_units REAL NOT NULL,
  prefix_breakpoint_hash TEXT,
  middle_breakpoint_hash TEXT,
  pruned_blocks_count INTEGER NOT NULL DEFAULT 0,
  keepalive_pings_since_last_turn INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, session_id, turn_number)
);
```

**Effective cost formula (stored at write time):**
`effective_cost_units = input_tokens + 1.25×cache_creation_5m + 2.0×cache_creation_1h + 0.1×cache_read`

#### `block_references` table (append-only audit log)

```sql
CREATE TABLE block_references (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL REFERENCES blocks(id),
  turn_id TEXT NOT NULL REFERENCES turns(id),
  reference_type TEXT NOT NULL  -- "tool_call" | "text_quote" | "id_mention"
);
-- 90-day retention cap
```

### Retention Policy

| Data | Retention |
|------|-----------|
| Log files | 7-day, daily rotation |
| `block_references` | 90-day cap |
| `blocks` + `turns` | Unbounded in v1 |
| Heavy user estimate (5 sessions/day × 50 turns × 1 year) | ~100 MB |

### Schema Migration

- Migrations in `src/storage/migrations/001_initial.sql`
- Config schema versioned (`"version": 1`)
- **Newer-than-supported config:** refuse to start
- **Older config:** run migration automatically

---

## API Surface

### MCP Tools (north-bound, consumed by the model at runtime)

| Tool | Inputs | Returns |
|------|--------|---------|
| `cachelane:stats` | `scope: "session" \| "workspace" \| "all"` (default `session`), `since: ISO duration` | `turns`, `cache_hit_ratio`, `effective_cost_units`, `no_cachelane_cost_units`, `savings_ratio`, pruner stats, keepalive stats |
| `cachelane:explain` | `turn: number` (default most recent) | Region breakdown, breakpoint hashes, pruner decisions array with reasons, full usage block |
| `cachelane:expand` | `block_id: string` (8-char prefix accepted) | Re-issues original refetch command; restored content enters suffix on next turn |

### CLI Commands

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

### Telemetry (opt-in, south-bound)

- `POST https://telemetry.cachelane.dev/v1/report` — at most once/hour
- Payload: `installation_id`, `version`, `reporting_period_ms`, `turns`, `cache_hit_ratio`,
  `pruner_enabled`, `keepalive_policy`, `effective_cost_units_total`, `no_cachelane_baseline_total`
- **Forbidden fields:** workspace_id, session_id, file paths, block contents, model name, API key
- Response: 204. Default: OFF.

---

## Per-Turn Overhead Budget

All orchestrator work must be invisible relative to the Anthropic API round-trip (~200ms RTT).

| Operation | Target |
|-----------|--------|
| Block decomposition | < 1 ms |
| Classification (all blocks) | < 2 ms (O(N), N ≤ 200) |
| Storage load (counter SELECT) | < 5 ms |
| Pruning | < 1 ms (O(N)) |
| Reordering + sort | < 2 ms (O(N log N)) |
| Breakpoint placement | < 0.5 ms (constant time) |
| **Total PreRequest overhead** | **< 12 ms** (< 6% of 200ms RTT) |
| Reference detection (PostResponse) | < 10 ms (100 blocks + 10KB response) |
| Storage update (counter UPDATE) | < 5 ms |
| **Total PostResponse overhead** | **< 20 ms** (response already streaming — latency-invisible) |

---

## Memory Budget

| Component | Budget |
|-----------|--------|
| Orchestrator process RSS (steady state) | < 50 MB |
| Per-session `SessionState` | ~50 KB (100 blocks × ~500 B metadata) |
| Cache state tracker | ~1 KB per workspace |
| 10 workspaces × 50-turn sessions | ~30 MB |

---

## Scalability Model

- One Claude Code session = one Cachelane MCP server process (~10 MB each)
- 20 concurrent sessions → 20 processes
- SQLite WAL mode: concurrent readers + serialised writers; < 5 writes/turn is far below SQLite's limits
- No central backend, no autoscaling, no shared state across users

**Bottleneck:** Signal 3 of reference detection (40-char shingle, O(B × |text|)) is the most
expensive operation — bounded at ~5 ms for typical sessions.

---

## Reliability & Failure Handling

**Core principle: fail open.** "Cachelane never makes Claude Code slower or less reliable than it
would have been without Cachelane installed."

| Failure | Response |
|---------|----------|
| Anthropic 5xx | Bubble up unchanged; don't retry |
| Anthropic 4xx (bad `cache_control`) | Log full payload (key redacted); bubble up; increment counter |
| SQLite write failure | Log; drop counter update for this turn; **continue** |
| SQLite read failure | Return defaults (`unused_turns = 0`); continue |
| SQLite corruption (startup `PRAGMA integrity_check`) | Rename to `.corrupt-{timestamp}`; create empty DB; warn |
| Hook exception | Log stack; return unmutated request; pass-through for one turn |
| Keepalive ping fails | Log info; retry next interval; do NOT crash worker |
| Reference detection panic | Default to "no references"; increment all counters |
| Disk full on log rotation | Log to stderr; skip persistence; continue |
| Malformed config JSON | Fall back to defaults; refuse to overwrite user config |
| Config schema newer than supported | Refuse to start |
| Config schema older | Run migration |
| Process restart | Cache state tracker resets; next turn pays one cache-write penalty |

**Graceful shutdown:** SIGTERM → stop accepting hooks → finish in-flight → flush storage → exit
within 2 seconds.

**Self-diagnosis:** `cachelane doctor` checks Node ≥ 20.10, Claude Code ≥ 0.6, hook registration,
MCP registration, SQLite writability, config parseability, recent cache-hit ratio (warns if < 0.2
sustained over 50 turns — indicates prefix-instability bug).

---

## Security & Privacy

**Trust boundaries:**
- User's local machine = trusted
- Claude Code = trusted (host process)
- Anthropic API = trusted at TLS protocol level
- Block content = untrusted for logs/telemetry (may contain secrets)

**API key handling:** Read from environment; never written to disk, logs, or memory beyond request
lifetime. Telemetry payload allowlist prevents key inclusion.

**Log sanitisation:**
- `info` (default): never includes block content
- `debug`: may include `block_id`, `kind`, `token_count`, `content_hash` — never raw content
- `trace` (per-session opt-in): first 200 chars of content with regex redaction for secret patterns
  (`sk-...`, Bearer tokens, AWS keys)

**MCP attack surface:**
- `cachelane:stats` / `cachelane:explain` — aggregate numbers/metadata only; cannot leak content
- `cachelane:expand` — `block_id` looked up in local SQLite; refetch command restored from DB,
  NOT constructed from input → prevents injection

**Supply chain:**
- npm provenance (signed attestation linking tarball to source commit via GitHub Actions)
- All deps pinned exactly in `package-lock.json`
- Dependabot PRs reviewed by two engineers
- Weekly `npm audit` + GitHub Advanced Security; fails build on high-severity unpatched vulns

---

## Observability

| Signal | Implementation |
|--------|---------------|
| Logging | Pino structured JSON, `~/.cachelane/logs/*.log`, daily rotation, 7-day retention |
| Metrics | `cachelane:stats` and `cachelane stats` CLI — cache_hit_ratio, effective_cost_units, savings_ratio, pruner/keepalive stats |
| Per-turn trace | `cachelane:explain` — region breakdown, breakpoint placement, pruner decisions, full usage block |
| Alerting | `cachelane doctor` warns if cache_hit_ratio < 0.2 for > 50 consecutive turns |
| Post-release monitoring | Expected band 0.5–0.85; persistent dip below 0.3 = regression |

---

## Deployment & Operations

**Environments:** Local only. No staging/prod fleet. Dev/test via vitest + nock fixtures.

**CI gates (every PR must pass all):**
1. vitest + lint + cache-stability test + corpus gate (where applicable)
2. Spec-to-code diff attached; vocabulary drift reconciled (must use `STABLE | SEMI | VOLATILE`)
3. No new mutable global state, non-deterministic hot-path ops, `Date.now`/`Math.random`/Map
   iteration order in prefix path
4. No new dependencies without explicit reviewer approval
5. PR description explains why
6. Primary + secondary reviewer approval
7. If touching `cache_control` placement: cache-stability test passes **twice on independent runs**

**Review model:**
- Primary reviewer: deep review (30 min routine, up to 90 min for cache-stability/pruner)
- Secondary reviewer: 10-min sanity pass for scope creep and vocabulary drift
- High-stakes PRs (cache_control placement, K-pruner, API client): both engineers deep-review

---

## Milestones

| Milestone | Deliverables | Gate |
|-----------|-------------|------|
| **M1: Foundations** | `types`, `config`, `storage`, `tokenizer` modules; SQLite schema applied; tokenizer model-lookup test passes for 4.6 and 4.7 | Unit tests per module |
| **M2: Classifier** | `classifier` module; classifies every `BlockKind` correctly against fixture set | Unit tests covering all §3.2 BlockKind entries |
| **M3: Orchestrator core** | Reorderer, breakpoint placement, request mutation. No pruning yet. | **Cache-stability test active and gating**: SHA-256 of prefix region byte-identical across 3 consecutive identical-input runs |
| **M4: Reference detection** | PostResponse hook, reference detection, storage updates. **PREREQUISITE: 100-session annotated corpus complete before M4 begins (6-hour human annotation task; start during M2 or M3 so it's ready in time)** | Precision ≥ 95%, recall ≥ 85% on corpus (CI gate) |
| **M5: K-pruner** | Stub materialisation, refetch flow, `cachelane:expand` | Integration test: 6-turn synthetic session; pruning kicks in at turn 4 |
| **M6: Keepalive** | Background worker, adaptive + auto policies | Time-mocked integration test: verify pings fire only when expected |
| **M7: MCP server + CLI** | `cachelane:stats`, `cachelane:explain` wired; all CLI commands | E2E test against recorded Claude Code session |
| **M8: Polish + benchmark** | Docs, README, benchmark harness, optional keepalive experiment (§2.4) | Empirical benchmark report; `doctor` passes on macOS, Linux, Windows |
| **M9: Release** | npm publish with provenance; Claude Code marketplace listing | Tag, release notes, manual smoke test on fresh machine |

**Critical dependency:** The 100-session annotated corpus gates M4 and must start during M2 or M3.

---

## Release Artifacts (M9)

- `cachelane@1.0.0` npm tarball with provenance attestation
- GitHub release: signed tag, changelog, attached benchmark report
- Claude Code marketplace listing
- `README.md` (install, usage, privacy policy, multi-workspace notes)
- `BENCHMARK.md` (reproducible savings scripts)

---

## Post-Release Operations

**Monitoring (opt-in telemetry):**
- Expected cache-hit ratio band: **0.5–0.85**
- Regression indicator: persistent dip below **0.3**
- Patch releases: quick-turn for cache-stability bugs
- Regular releases: weekly cadence

**v1.1 deferred features:**
- Tokenizer-aware rewriting (M3)
- Tracker reconstruction on restart
- Shared team caches (requires deliberate decision — exits zero-cost regime)

---

## Operational Runbook Hooks

| Condition | Action |
|-----------|--------|
| Installation issue | `cachelane doctor` — checks Node version, Claude Code version, hooks, MCP registration, SQLite writability |
| Suspected Cachelane bug / A-B test | `cachelane disable` → hooks become no-ops → `cachelane enable` to restore |
| Reinstall | `cachelane install --force` (idempotent; refuses to overwrite without `--force`) |
| Full wipe | `cachelane uninstall --purge` (removes `~/.cachelane/` data) |
| SQLite corruption | Automatic: rename to `.corrupt-{timestamp}`, create empty DB, warn in log |
| Hook exception | Automatic: log stack, return unmutated request, pass-through for one turn |
| Pruner too aggressive | `cachelane prune --conservative` (K=5) |
| Keepalive tuning | `cachelane keepalive <off|static|adaptive|auto>` |
| `/compact` detected | Automatic: reset `unused_turns` for replaced blocks, classify compacted summary as `SEMI`, defer middle breakpoint until seen twice |

---

## Open Questions

| ID | Question |
|----|----------|
| Q001 | Reference-detection accuracy on real sessions — blocks M4 |
| Q003 | Optimal K value — experiment deferred |
| Q007 | Telemetry `--opt-in` command shape — pending project-lead decision |
| Q_A | Keepalive experiment funding (Option A/B/C) — pending project-lead decision |
