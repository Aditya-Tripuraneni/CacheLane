# Zero-Config Auto-Proxy: Making CacheLane Invisible Infrastructure

**Date:** 2026-05-24
**Status:** Draft — engineering plan, not yet implemented
**Owner:** TBD
**Estimated milestone:** M8 (post-M7 cleanup, before public npm release)

---

## TL;DR

CacheLane's active cache optimization (the `cache_control` marker placement that delivers 70–87% savings) currently only runs through an HTTP proxy that the user must start manually with `cachelane proxy`. The MCP hooks path (`UserPromptSubmit`, `Stop`) is a passive recorder and does **not** mutate API requests — it only records what Claude Code's native caching already produces.

**Goal:** A user runs `npm install -g cachelane` and `cachelane install` once. From that moment on, every Claude Code session (current window, future windows, resumed conversations, multiple concurrent windows) routes through CacheLane's pipeline automatically. The user never sees the word "proxy" again. The word "proxy" must not appear in any README, install instruction, or troubleshooting flow that a normal user touches.

**Why this is non-trivial:** The proxy is the only mechanism that can inject `cache_control` markers — MCP servers and Claude Code hooks cannot modify the outgoing API request body. The proxy is architecturally required. The problem is making it lifecycle-managed, multi-session-safe, crash-recoverable, and completely invisible.

---

## 1. Problem Statement

### 1.1 What's broken today

The current state has two paths, and only one of them actually optimizes:

| Path | What runs | What it does |
|------|-----------|--------------|
| MCP hooks (`UserPromptSubmit`, `Stop`) | `handleHookEvent` in `src/cli/index.ts` | Reads Claude Code's transcript file after the API call. Records `input_tokens`, `cache_read_tokens`, etc. into SQLite. Hardcodes `prefix_breakpoint_hash: null`, `middle_breakpoint_hash: null`, `pruned_blocks_count: 0`. **The orchestrator, classifier, and pruner never run.** |
| HTTP proxy (`cachelane proxy`) | `startProxy` in `src/proxy/server.ts` | Intercepts `POST /v1/messages?beta=true`. Runs the full pipeline: classifier → pruner (currently no-op, see §3.4) → orchestrator → request mutator. Places `cache_control` markers. Records real cache hits driven by CacheLane's placement. |

The hook path can never inject `cache_control` markers because Claude Code's hook API is read-only — hooks observe events, they don't rewrite request bodies. This is a Claude Code architectural constraint, not a CacheLane bug.

### 1.2 The UX failure

Today, to actually get CacheLane optimization, a user must:

1. Open one terminal and run `cachelane proxy` (and leave it running)
2. Open a second terminal with `ANTHROPIC_BASE_URL=http://127.0.0.1:7332 CACHELANE_SESSION_ID=... claude`
3. Remember to restart the proxy after every reboot
4. Pick a unique session ID per Claude Code window or lose session isolation

This is acceptable for engineering verification (e.g., the May 23 live benchmark sessions that proved the pipeline correctness). It is **not** acceptable for a public npm package distributed through the Claude marketplace.

### 1.3 The end-state UX

```
$ npm install -g cachelane
$ cachelane install
  - Registered MCP server: cachelane
  - Registered hooks: UserPromptSubmit, Stop
  - Configured ANTHROPIC_BASE_URL in ~/.claude/settings.json
  Done. CacheLane will run automatically on the next Claude Code session.

$ claude
  [Claude Code starts, MCP server starts, proxy starts inline,
   all requests now route through CacheLane. User sees nothing.]
```

That is the only acceptable user workflow. There is no `cachelane proxy` command in the public surface. There is no `ANTHROPIC_BASE_URL` the user has to type. Multiple windows just work. Resume just works. Reboot just works.

---

## 2. Why a Proxy at All (Architectural Justification)

Before discussing the implementation, the proxy's existence must be defended, because the obvious instinct is "the MCP server should do this."

**It cannot.** Here is the constraint matrix:

| Mechanism | Can read request? | Can modify request body? | Can add headers? | Reaches Anthropic? |
|-----------|-------------------|--------------------------|------------------|--------------------|
| MCP tool call | No (separate channel) | No | No | No |
| `UserPromptSubmit` hook | Reads transcript only after | **No** | No | No |
| `PreToolUse` hook | Fires for tool calls, not API calls | No (tool calls only) | No | No |
| `Stop` hook | Reads transcript after | No | No | No |
| HTTP proxy via `ANTHROPIC_BASE_URL` | Yes | **Yes** | Yes | Yes (forwards) |
| Anthropic SDK fork | Yes | Yes | Yes | Yes |

The proxy is the only point in the request lifecycle where `cache_control` placement can happen without either (a) Anthropic adding a CacheLane-specific extension point to the Claude Code binary, or (b) shipping a forked Claude Code, both of which are out of scope.

**Conclusion:** The proxy is non-negotiable. The question is purely how to hide it.

---

## 3. Architecture

### 3.1 Component Layout

```
   ┌──────────────────────────────────────────────────────────────┐
   │                       Claude Code                            │
   │   (process started by `claude` CLI, reads ~/.claude/settings)│
   └────────────────┬─────────────────────────────────────────────┘
                    │
                    │ stdio (MCP protocol)            HTTP (every API call)
                    │                                  uses ANTHROPIC_BASE_URL
                    ▼                                              │
   ┌──────────────────────────────────┐                            │
   │     `cachelane mcp` process      │                            │
   │  (spawned by Claude Code on      │                            │
   │  every session start)            │                            │
   │                                  │                            │
   │  ┌────────────────────────────┐  │                            │
   │  │ MCP stdio server           │  │                            │
   │  │  - cachelane:stats         │  │                            │
   │  │  - cachelane:explain       │  │                            │
   │  │  - cachelane:expand        │  │                            │
   │  └────────────────────────────┘  │                            │
   │                                  │                            │
   │  ┌────────────────────────────┐  │   ◄────────────────────────┘
   │  │ HTTP proxy (port 7332)     │ ◄───── intercepts requests
   │  │  - classifier              │
   │  │  - pruner                  │
   │  │  - orchestrator            │
   │  │  - request mutator         │
   │  │  - response recorder       │
   │  └────────────┬───────────────┘
   │               │
   │   writes ──► ~/.cachelane/cachelane.db     (SQLite, WAL mode)
   │   writes ──► ~/.cachelane/cachelane.log    (rotating, JSON lines)
   │               │
   └───────────────┼──────────────────┘
                   │
                   ▼
         api.anthropic.com:443 (TLS, original auth headers preserved)
```

Key change vs. today: the MCP server and the proxy are **the same OS process**. There is one binary, started by Claude Code, that does both jobs.

### 3.2 Why one process and not two

Two processes (separate `cachelane mcp` + separate `cachelane proxy`) was considered and rejected:

| Option | Pro | Con |
|--------|-----|-----|
| Two processes | Clean separation | Lifecycle: who starts proxy? Who kills it? Orphan risk on Claude Code crash. Need PID files, signal handling, IPC. |
| One process (MCP starts proxy as inline async server) | Lifecycle bound to Claude Code automatically. No orphans. Shared DB handle. Simpler tests. | Port 7332 collision if two Claude Code windows; must handle gracefully. |

One process is correct. Port collision is the only real issue and it's bounded (one well-defined edge case, addressed in §4.3).

### 3.3 Process Lifecycle

```
Claude Code window opens
    │
    ▼
Claude Code reads ~/.claude/settings.json
    │
    │  finds: ANTHROPIC_BASE_URL=http://127.0.0.1:7332
    │  finds: mcpServers.cachelane = { command: "cachelane", args: ["mcp"] }
    ▼
Claude Code spawns: `cachelane mcp` (stdio)
    │
    ▼
cachelane mcp process boots:
    1. openDatabase(~/.cachelane/cachelane.db)
    2. Attempt to bind 127.0.0.1:7332
       - SUCCESS  → become the proxy (this process owns 7332)
       - EADDRINUSE → log "another CacheLane instance is the proxy", skip proxy boot, still serve MCP
    3. Connect MCP stdio transport
    4. Block on stdio (MCP server lifecycle)
    │
    ▼
[Claude Code session runs.
 API calls hit 127.0.0.1:7332, get mutated, forwarded to Anthropic.
 MCP tools called for stats/explain/expand.]
    │
    ▼
Claude Code window closes
    │
    ▼
Claude Code sends SIGTERM to `cachelane mcp` stdio child
    │
    ▼
cachelane mcp process handles shutdown:
    1. Stop accepting new HTTP connections
    2. Drain in-flight responses (with 5s timeout)
    3. Close DB
    4. Exit 0
```

### 3.4 K-Pruner Activation (Sub-Goal of This Milestone)

The proxy currently passes `block_placements: []` always — so K-pruning is a no-op even on the proxy path. This is a **prerequisite** for this milestone (or scoped as M8.5, decided during planning) because without it the claim "the proxy does everything the hooks couldn't" is false.

Required work:
- `post-response` path inside the proxy must extract tool-result blocks from the stream and `insertBlock()` them into `blocks` table
- `pre-request` path must `db.getBlocksForSession()` and pass populated `block_placements`
- `pruner` already implements the K-counter logic correctly — it's just never fed real data

This is tracked separately under `src/pruner/` but **must ship together with the auto-proxy** or the milestone is incomplete.

### 3.5 Settings.json mutation

`cachelane install` modifies `~/.claude/settings.json`:

```jsonc
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:7332"
  },
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "... cachelane hook user-prompt-submit" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "... cachelane hook stop" }] }]
  }
}
```

`mcpServers.cachelane` continues to live in `~/.claude.json` (or wherever Claude Code stores MCP registrations).

**Mutation rules** (all enforced by the install command):
- Never overwrite an existing `env.ANTHROPIC_BASE_URL` that does not point at `127.0.0.1:7332` — refuse with a clear error, exit non-zero
- Never clobber unrelated keys in `settings.json`
- Round-trip-safe: re-running `cachelane install` is a no-op if the config is already correct
- `cachelane uninstall` removes only what we added; leaves untouched keys alone

### 3.6 Session ID propagation (the hardest piece)

In the multi-window case, **the proxy serves multiple Claude Code sessions concurrently**, but each request must be attributed to the correct session for stats, classification carry-over, and pruner state.

Today the proxy reads `CACHELANE_SESSION_ID` once at startup. This must change.

**Proposed mechanism:** Claude Code MCP env vars + per-request session header.

1. When Claude Code starts the `cachelane mcp` child, it passes the session ID in env (mechanism TBD — open question §10.1). The MCP child knows its own session ID.
2. The first MCP child to start (the one that wins port 7332) is the "proxy owner." It tracks **all** session IDs across **all** Claude Code windows.
3. Each subsequent MCP child registers its session ID with the proxy owner via a local control channel (loopback socket on a second port, or a SQLite-backed registry, or an in-process route for the same PID — TBD).
4. The proxy receives an HTTP request. It must determine which session_id the request belongs to. **Options:**
   - **a)** Inject `x-cachelane-session-id` header into Claude Code's outgoing requests via the env-level base URL — not possible, env vars can't inject headers.
   - **b)** Single Claude Code per machine — not acceptable, multi-window is required.
   - **c)** Use Anthropic API key as a heuristic — fails if user uses one key everywhere (the common case).
   - **d)** Match the request to a session by inspecting the message history hash against the most-recently-seen turn for each session — fragile, expensive.
   - **e)** **Per-window proxy on a dynamic port.** Each `cachelane mcp` instance binds its own loopback port; `ANTHROPIC_BASE_URL` is set **per session** by Claude Code via the MCP env injection mechanism, not globally in `settings.json`. — This is likely the right answer but requires Claude Code to support per-session env vars from MCP. Needs verification with Claude Code docs.

**Recommended path (subject to verification):** Option (e). Each Claude Code session gets its own proxy port. No coordination between sessions needed; each is an island. Settings.json contains a placeholder URL pattern that Claude Code resolves at session start from the MCP env.

If option (e) is infeasible after investigation, fallback is option (d) with strict isolation guarantees (each request must match exactly one session; ambiguous matches fail closed to recording-only mode).

**This open question blocks the implementation. Resolve it before writing code.**

### 3.7 Schema, logging, and operational concerns

#### 3.7.1 SQLite configuration

The proxy, the MCP server, and any in-flight CLI invocations (`cachelane stats`, `cachelane explain`) all open the same SQLite file concurrently. WAL mode is required for concurrent reader / single-writer access without lock contention.

Required on every `openDatabase()` call:
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;   -- 5s wait before SQLITE_BUSY
```

The `busy_timeout` value drives the "5s fail-open" decision in §5.5; both must be kept consistent.

#### 3.7.2 Schema changes required

| Table | Column | Purpose | Notes |
|-------|--------|---------|-------|
| `turns` | `signals` (TEXT, JSON array, nullable) | Records fail-open events and other diagnostic signals | Already in `TurnExplanationRecord`; verify also on `turns` row directly so `cachelane stats` can aggregate without joining |
| `turns` | `request_mutated` (INTEGER, 0/1) | True only when the orchestrator ran and produced a mutation | Lets `cachelane stats` count fallback turns without parsing the `signals` JSON |
| `blocks` | (entire table population) | K-pruner feed | Schema already exists in `src/storage/migrations.ts`; the gap is the proxy not writing to it. See §3.4 |
| `block_references` | (already exists) | Reference-detection inputs to pruner | Verify writes happen on the proxy path, not just hooks |

Migrations follow the existing pattern in `src/storage/migrations.ts`. Each schema change gets a numbered migration file. No destructive migrations.

#### 3.7.3 Logging

Structured logs in JSON-lines format at `~/.cachelane/cachelane.log`. Rotation: 10MB per file, 5 files retained (50MB max). Implemented with a small homegrown rotator — no new npm dep.

Log levels:
- `error` — anything that triggered fail-open, all uncaught exceptions
- `warn` — non-fatal degradation (port already bound, stale session detected)
- `info` — startup, shutdown, mutation success counts (one line per turn)
- `debug` — full pipeline trace; off by default, enabled with `CACHELANE_DEBUG=1`

Every log line carries: `ts`, `level`, `pid`, `session_id` (when known), `event` (machine-parseable tag), `message` (human-readable). Errors carry `err.name`, `err.message`, `err.stack`.

#### 3.7.4 Troubleshooting surface

A user whose savings ratio is unexpectedly low needs a path to diagnosis without us. Required artifacts:

| Command | What it tells the user |
|---------|------------------------|
| `cachelane doctor` | One-screen health summary: install status, last 10 turns' fallback rate, port-bind status, DB writability, log file size |
| `cachelane explain --turn N` | Per-turn detail: `prefix_breakpoint_hash`, `signals`, `request_mutated`. If `prefix_breakpoint_hash` is null, the orchestrator didn't run |
| `cachelane stats` | Adds "Pipeline fallback turns: N" line; non-zero means see §5.8 |
| `~/.cachelane/cachelane.log` | Raw JSON-lines; user can grep for `"level":"error"` |

Documentation must include a troubleshooting page that maps each symptom (no savings, errors in log, port conflict) to one of these tools.

### 3.8 Configuration

User-overrideable settings live at `~/.cachelane/config.json`. The install command creates this file with defaults; manual edits are honored.

```jsonc
{
  "proxy": {
    "port": 7332,                    // override if 7332 is taken
    "host": "127.0.0.1",             // never 0.0.0.0 in v1
    "drain_timeout_ms": 5000,
    "upstream_host": "api.anthropic.com",
    "upstream_port": 443,
    "upstream_ssl": true
  },
  "features": {
    "auto_proxy": false,             // feature flag for Phase 1 rollout; default true after Phase 6
    "k_pruner": true,
    "keepalive": true
  },
  "health": {
    "fallback_warning_threshold_pct": 5,   // when degraded status fires
    "fallback_window_turns": 20            // over how many recent turns
  },
  "logging": {
    "level": "info",
    "max_file_bytes": 10485760,
    "max_files": 5
  }
}
```

A power user whose 7332 is occupied:
```bash
$ cachelane config set proxy.port 8765
$ cachelane install        # rewrites ANTHROPIC_BASE_URL with the new port
```

The install command **must** re-read this config every time it runs to pick up port overrides. The proxy at startup reads it the same way. No environment-variable overrides except `CACHELANE_DEBUG` and `CACHELANE_HOME` (existing).

---

## 4. User-Facing Workflows

### 4.1 First install

```
$ npm install -g cachelane
$ cachelane install

  CacheLane installed.
  - SQLite database: ~/.cachelane/cachelane.db
  - Claude Code MCP server registered
  - Claude Code hooks registered (UserPromptSubmit, Stop)
  - Claude Code ANTHROPIC_BASE_URL configured

  Next: open Claude Code as usual. CacheLane will run automatically.
```

Idempotent. Re-running it produces the same end state with no errors.

### 4.2 First session after install

User opens Claude Code. They notice nothing. They type. Claude Code responds. Behind the scenes:
1. `cachelane mcp` started by Claude Code
2. Proxy bound on 127.0.0.1:7332 (or per-session port, see §3.6)
3. First request goes out, gets mutated, hits Anthropic, comes back, gets recorded
4. `cachelane stats` shows turn 1

If anything in step 2 fails (port locked by an unrelated process, DB locked, settings.json corrupted), CacheLane logs to `~/.cachelane/cachelane.log` and **fails open** — Claude Code keeps working with no caching optimization. The user is not blocked.

### 4.3 Second window opened while the first is running

User opens a second `claude` window while the first is still active.

Behavior depends on §3.6 resolution. Under option (e) (per-window proxy): second window gets its own port, both work independently.

Under fallback (shared proxy): the first window's proxy owns 7332. The second window's `cachelane mcp` instance:
1. Tries to bind 7332 → `EADDRINUSE`
2. Falls back to "proxy client" mode: just runs MCP stdio server, no proxy
3. Both windows route to the shared proxy on 7332
4. Proxy attributes requests to sessions via mechanism (d)

Either way, both windows must show correct, isolated stats in their own `cachelane:stats` queries.

### 4.4 User closes a window, opens it later (resume same conversation)

Claude Code supports resuming conversations. From CacheLane's perspective:

| Concern | What happens |
|---------|--------------|
| SQLite DB | Persists. All prior turns, classifications, pruner state, keepalive log all intact. |
| In-memory `CacheStateTracker` | Lost when the previous `cachelane mcp` exited. **Must rebuild from DB on resume.** This is a new requirement: `CacheStateTracker.fromDb(session_id)` constructor. |
| Anthropic's prompt cache | Lives on Anthropic's servers, governed by 5m/1h TTL. If resume happens within TTL, first turn cache-hits; if outside TTL, first turn cold-writes, turn 2 onward hits. **This is expected and correct behavior.** |
| Block table (for K-pruning) | Persists in DB. Pruner picks up where it left off — blocks idle for K turns get stubbed even if the K-turn window spans a session close. |

The user perceives this as "it just works." Worst case after a long absence: one cold turn, then back to ~85% savings.

### 4.5 User goes idle mid-session

Already covered: the keepalive ping mechanism (`src/keepalive/`) is supposed to fire heartbeats during idle periods to keep Anthropic's cache warm past the 5m boundary.

**Open issue:** Keepalive is currently never triggered through the proxy. It must be wired into the proxy lifecycle as part of this milestone, or the "leave it idle and come back" UX has a cold-turn penalty every time the user pauses for more than 5 minutes.

### 4.6 User uninstalls

```
$ cachelane uninstall
```

Removes MCP registration, removes hooks from settings.json, removes `ANTHROPIC_BASE_URL` from settings.json env block, leaves the SQLite DB intact (so reinstall preserves history). `--purge` flag also deletes the DB.

After uninstall, Claude Code routes directly to api.anthropic.com again. No residual config.

### 4.7 User upgrades CacheLane

```
$ npm install -g cachelane@latest
```

On next session, the new `cachelane mcp` binary runs. Anything that requires re-running `cachelane install` (e.g., schema changes in settings.json) must be detected by the binary on startup and either auto-migrated or surfaced with `[cachelane] re-run \`cachelane install\` to apply config updates`.

DB migrations run on every MCP boot via the existing `src/storage/migrations.ts`.

### 4.8 Migration for existing manual-proxy users

A non-trivial number of users already running CacheLane via the manual proxy path (e.g., the May 23 live-benchmark setup, the `live-test` and `172f0060` sessions). On upgrade to the auto-proxy version, the following conflicts can arise and **must** be handled:

| Pre-existing state | Conflict | Migration action |
|--------------------|----------|------------------|
| User exported `ANTHROPIC_BASE_URL=http://127.0.0.1:7332` in their shell rc file | Auto-proxy installs the same URL in `~/.claude/settings.json`. No conflict if values match. | `cachelane install` detects matching values and prints "shell-level env var is redundant; safe to remove from your shell rc." |
| User exported a different `ANTHROPIC_BASE_URL` (e.g., own proxy on 9999) | Settings.json install would create ambiguity (Claude Code's resolution order between settings.json env and shell env is platform-dependent) | `cachelane install` refuses, exits non-zero, prints: "Detected shell-level ANTHROPIC_BASE_URL=...:9999 — remove it before installing, or use `cachelane config set proxy.port 9999` if you want CacheLane on that port." |
| User has `cachelane proxy` running in another terminal at upgrade time | Port 7332 already bound; new MCP-spawned proxy can't claim it | New MCP enters proxy-client mode (§5.1); on next boot when manual proxy is dead, new MCP becomes the owner. No data loss. |
| User has a shell alias `claude='ANTHROPIC_BASE_URL=... CACHELANE_SESSION_ID=... claude'` | `CACHELANE_SESSION_ID` may conflict with auto-assigned per-session IDs | `cachelane doctor` detects this on first run after upgrade and recommends removing the alias |
| User has historical session IDs (e.g., `live-test`) in DB | These appear in `cachelane sessions` output forever | No action needed — historical sessions are immutable records, not active state |

`cachelane install` runs a pre-install validation step (`installValidate()`) that emits human-readable warnings for each conflict before writing any files. Validation never modifies state. If validation reports any error-level finding, install aborts and the user is told what to fix.

A separate command `cachelane migrate` (new, optional) helps users move from manual-proxy to auto-proxy: it parses the user's shell rc files, suggests deletions, and offers to print the suggested `cachelane config set` commands. It never edits the user's shell rc directly — that's the user's territory.

---

## 5. Failure Modes and Edge Cases

This section is **exhaustive on purpose**. Every item must have either a test or a documented decision to defer.

### 5.1 Port-related failures

| Scenario | Behavior | Test |
|----------|----------|------|
| Port 7332 free at boot | Bind, run as proxy | Integration test: start MCP, assert port bound |
| Port 7332 held by another CacheLane instance | Second instance enters client mode (or per-window-port mode under (e)) | Multi-instance test: start two MCPs back-to-back, assert second doesn't crash |
| Port 7332 held by an unrelated process | Log warning, skip proxy, MCP still works, user sees no caching | Test: bind 7332 from a fixture process, then start MCP, assert clean error + MCP still functional |
| Port released mid-session (proxy crashed) | Next request fails open to upstream; CacheStateTracker entries marked stale | Crash test: kill the proxy thread inside the MCP process, assert next request goes through unmutated and stats record the failure |

### 5.2 Settings.json corruption / conflict

| Scenario | Behavior | Test |
|----------|----------|------|
| settings.json missing | Create with only our keys | Install test on clean home dir |
| settings.json present, no env block | Add env block + our key | Install test on existing settings without env |
| settings.json has unrelated env vars | Merge, leave others alone | Install test with `env.FOO=bar` pre-set |
| settings.json has `ANTHROPIC_BASE_URL` pointing elsewhere (user has their own proxy) | Refuse with clear error; do not overwrite | Install test with conflicting URL pre-set |
| settings.json is malformed JSON | Refuse with clear error; do not write | Install test with broken JSON |
| settings.json was modified by another tool between read and write | Last-writer-wins, accept the risk (CC doesn't lock the file) | Documented limitation |

### 5.3 Network and HTTP edge cases

| Scenario | Behavior | Test |
|----------|----------|------|
| Anthropic returns 429 | Pass through unchanged; record nothing (no usage to record) | Mock upstream test |
| Anthropic returns 5xx | Pass through; record turn with error flag | Mock upstream test |
| Streaming SSE response | Pass chunks through immediately; parse usage from final `message_delta`; never buffer the full response in memory | Existing `src/proxy/server.ts` test, harden |
| Very large request body (>10MB) | Stream upload; don't buffer fully before mutating | Test with synthetic 10MB request |
| Client disconnects mid-stream | Abort upstream, release DB connection | Existing handling in `proxyAndRecord` — test |
| Anthropic-specific beta headers (`anthropic-beta`) | Pass through unchanged | Header pass-through test |
| `accept-encoding: gzip` from client | Already stripped — we cannot parse gzip for usage extraction | Existing `sanitiseForwardHeaders` — test |
| Connection reuse / keep-alive | Each upstream request opens its own connection (no shared pool) — acceptable for v1, revisit if latency complaints | Decision logged |
| Anthropic response has no `usage` field (early stream termination) | Don't insert a turn row; log `warn:no-usage`; client still gets whatever response bytes arrived | Mock upstream: send `message_start` then close socket; assert no DB write |
| Request body is malformed JSON | Already handled in `src/proxy/server.ts` — fall through to forwardUpstream unchanged | Existing test, verify still green |
| HTTP/2 between Claude Code and proxy | Node `http.createServer` is HTTP/1.1 only. Claude Code's HTTP client must negotiate down to HTTP/1.1 for local. **Verify** — if Claude Code insists on HTTP/2 to localhost, we need `http2.createServer` | Open task: capture Claude Code's `Connection:` and `:method` framing against the proxy |
| IPv6 loopback only (`::1`) | Bind to both `127.0.0.1` and `[::1]:7332`, or detect and bind whichever resolves; `ANTHROPIC_BASE_URL` must use the right one | Test on a host with IPv4 disabled |
| DNS resolution failure for `api.anthropic.com` | Upstream connection errors; pass 502 back to Claude Code; record turn with `signals: ["error:upstream-dns"]` | Mock DNS failure |
| Corporate VPN intercepting localhost | The proxy is local; VPN should not intercept loopback. If it does, document as out-of-scope (user-system issue) | Documented limitation |
| Mid-session `CLAUDE.md` edit (prefix bytes change) | Prefix hash rotates on next turn; Anthropic cache invalidates; one cold-write turn; back to warm after | No test needed — emergent behavior, document in user docs |
| SIGINT to MCP (user Ctrl+C on `claude`) | Same as SIGTERM: drain + close DB + exit. On Windows, handle `CTRL_BREAK_EVENT` equivalently | Platform-specific tests |
| Drain timeout (5s) exceeded during shutdown | Force-close remaining HTTP connections; log `warn:drain-timeout` with count of dropped requests; still close DB and exit 0 | Crash test: hold a fake-upstream response open for >5s, signal shutdown, assert clean exit and warning log |

### 5.4 Process and lifecycle edge cases

| Scenario | Behavior | Test |
|----------|----------|------|
| Claude Code force-kills `cachelane mcp` (no SIGTERM) | OS releases port and DB lock automatically. Next session starts clean. | OS-level test; manually verify on Linux + macOS + Windows |
| `cachelane mcp` crashes mid-request | In-flight client connection gets reset; client sees error. Recorded turn is incomplete; not inserted (transaction rollback). | Crash injection test |
| Two `cachelane install` runs concurrently | File lock on settings.json; second runs after first. Final state correct. | Concurrency test |
| User runs `cachelane proxy` manually after install | Old behavior still works; uses a different port if 7332 taken. **Do not expose this command in public docs.** | Backward compat test |
| User's $PATH doesn't include cachelane after install | Install warns; provides install location | Install path detection test |
| Multiple Anthropic API keys (e.g., user has their own + the default) | Pass through whatever Claude Code sends; CacheLane is API-key-agnostic | Key passthrough test |

### 5.5 Database edge cases

| Scenario | Behavior | Test |
|----------|----------|------|
| DB locked by another process | Wait with timeout; fail open after 5s | Concurrency test using two DB handles |
| DB file deleted while running | Reopen on next write; warn | OS-level test |
| Schema migration mid-upgrade | Migrations run in transaction; partial-failure rolls back | Existing migration tests |
| Disk full | All inserts fail; log error; fail open | Inject ENOSPC |

### 5.6 Session ID and multi-window edge cases

| Scenario | Behavior | Test |
|----------|----------|------|
| Two windows share a session ID by accident | Stats merge; **acceptable** because session_id is supposed to be unique | Document behavior |
| Window A active, window B resumes session A's conversation | Conversation history is loaded by Claude Code; CacheLane sees a new session ID, treats as fresh session. Cache warm-up cost on first turn. | Document expected behavior; manual test |
| Session ID rotates mid-conversation (Claude Code bug?) | New session gets cold start; old session orphaned | Defensive code: alert in `cachelane doctor` if orphaned sessions appear |

### 5.7 Cache TTL edge cases

| Scenario | Behavior | Test |
|----------|----------|------|
| User idle >5m, keepalive disabled | First turn after wake cold-writes, turn 2+ hits | Existing benchmark turn 6 illustrates this |
| User idle >5m, keepalive enabled | Heartbeat pings fired during idle, cache stays warm | Keepalive integration test (already exists, verify wired) |
| User idle >1h | Even 1h cache expires; cold start required | Document |
| Two windows hammering the same prefix | Both benefit from the cache; no negative interaction | Concurrent test |

### 5.8 Fail-open invisibility (critical gap)

This is the most dangerous failure mode in the entire system because it is **silent by design**.

When the CacheLane pipeline throws an exception at any point (bad request body, orchestrator bug, DB lock, unexpected model ID), the proxy catches it and forwards the original unmutated request to Anthropic. Claude Code receives a valid response. The user sees nothing wrong.

What is actually happening:
- Claude Code's own native `5m` `cache_control` markers are on the request (Claude Code places these itself before the proxy sees it)
- Anthropic caches on those native markers
- `cache_read_input_tokens` is non-zero in the response
- `cachelane stats` shows a non-zero cache hit ratio

**This means `cache_read_input_tokens > 0` does NOT prove CacheLane is working.** It only proves Anthropic's cache is active, which is true even without CacheLane because Claude Code does its own native caching.

The only reliable proof that CacheLane specifically contributed:
1. `prefix_breakpoint_hash` is non-null in the turn explanation — this field is only written when the CacheLane orchestrator ran and successfully placed a marker
2. `cache_creation_1h_tokens > 0` in some turns — Claude Code's native caching only places `5m` TTL markers; only CacheLane places `1h` markers. If `cache_creation_1h_tokens` is non-zero, the CacheLane proxy ran for that turn
3. Controlled A/B comparison: savings ratio with CacheLane active vs. the same session without it

If the pipeline silently fails open across many turns, the user would observe:
- Normal `cache_read_input_tokens` in stats (from Claude Code's native caching)
- `prefix_breakpoint_hash: null` in every `cachelane explain` (CacheLane's tells)
- Slightly lower savings ratio than expected (but not zero — native caching still helps)
- No error messages anywhere

**Required fixes before public release:**

| Fix | Where | What |
|-----|-------|------|
| Record fail-open events | `src/proxy/server.ts` catch block | Insert a turn record with `signals: ["error:fallback"]` and `prefix_breakpoint_hash: null` so the failure is visible in the DB |
| Surface in `cachelane stats` | `src/cli/format.ts` | Show a "Pipeline fallback turns: N" counter alongside cache hit ratio. Non-zero means CacheLane failed silently on N turns. |
| Surface in `cachelane doctor` | `src/cli/doctor.ts` | Report "X turns in the last session used fallback mode" as a warning |
| Alert threshold | `cachelane:health` MCP tool (new) | Return `status: "degraded"` if more than 5% of recent turns were fallbacks, `status: "ok"` otherwise. Claude Code can surface this as a tool result. |

Until these fixes are in, the "Optimization is real" claim in §6 is not fully provable from the DB alone. An engineer reviewing the system must look at `prefix_breakpoint_hash` in individual turn explanations to verify CacheLane ran — not just at `cache_read_input_tokens`.

### 5.9 Cross-platform

| Platform | Risk | Test |
|----------|------|------|
| Linux | Reference platform | CI |
| macOS | Different path conventions (`~/Library/Application Support/Claude Code/` vs `~/.claude/`); verify install writes to whichever Claude Code actually reads | CI on macOS runner; manual smoke to confirm hooks fire |
| Windows | Path separators, no fork(), Claude Code MCP path differences, paths with spaces (e.g. `C:\Users\First Last\...`), `.cmd` shim wrapping the node binary | CI on Windows runner; manual smoke; explicit test with spaces in user home |
| WSL | Mix of Linux+Windows paths in env vars; localhost resolution between WSL and Windows host | Manual smoke (developer environment); document if Claude Code on Windows host needs to talk to proxy in WSL guest |

### 5.10 Performance, load, and memory

| Scenario | Acceptance bar | Test |
|----------|----------------|------|
| Per-request latency overhead (proxy pipeline) | p50 < 5ms, p99 < 20ms over a 1000-request stress | Latency regression test in CI; fail PR if p99 regresses >25% from baseline |
| Concurrent in-flight requests | At least 16 concurrent without dropped requests or DB errors | Concurrency test |
| Per-session `CacheStateTracker` memory growth | < 50KB per session steady-state after 100 turns | Memory snapshot test; assert sessions evicted from memory ≤30 min after last activity |
| DB growth over a long session | ≤ 2KB per turn average; 10,000 turns < 20MB | Calculate from existing schema, add CI assertion |
| Multi-window memory | 4 windows × 100 turns < 5MB resident in the MCP process | Stress test |
| Proxy thread / event-loop blocking | No synchronous work in the hot path > 5ms; classifier and orchestrator run inside the same event loop, not workers, but must yield | Profile under load; add `process.cpuUsage()` instrumentation in tests |

The proxy runs **on the same event loop as the MCP stdio server**. This is intentional (one process, simpler crash semantics) but means the orchestrator must never make synchronous I/O or block on CPU for >5ms. SQLite reads are synchronous (better-sqlite3) but small; verify under load.

### 5.11 In-process proxy crash (proxy thread dies, MCP survives)

The proxy and MCP server share one Node process. If an uncaught exception in the HTTP handler escapes the global error handler, two outcomes:

| Outcome | What happens | Required behavior |
|---------|--------------|-------------------|
| Process crashes entirely | Claude Code's MCP child dies; Claude Code may restart it; port is released and re-bound on restart | Acceptable. Claude Code is responsible for MCP restart, not us. |
| Process survives but HTTP server is in a bad state | `ANTHROPIC_BASE_URL` still points at 7332 but the proxy doesn't accept connections | **Not acceptable** — would silently break every request. Mitigation: wrap the HTTP server in a heartbeat self-check; if a synthetic request to `127.0.0.1:7332/health` fails 3× in a row, exit the process so Claude Code restarts us. |

Required code in §3.3 lifecycle: a `process.on('uncaughtException')` and `process.on('unhandledRejection')` handler that exits the process with code 1 rather than letting it limp along. The HTTP server's `error` event must propagate to the same exit path.

---

## 6. What This Proves

When this milestone is complete and the test suite is green, we have proven:

1. **Zero-config install**: A user with no prior CacheLane state can run `npm install -g cachelane && cachelane install` and have a fully functional, optimizing CacheLane in their next Claude Code session, with no further commands. (Test: §7.4 E2E install test.)

2. **Optimization is real**: The proxy is actually mutating requests and CacheLane's markers are the ones driving the cache — not Claude Code's native markers. **Important:** `cache_read_input_tokens > 0` alone does NOT prove this. Claude Code places its own native `5m` markers independently; Anthropic would report cache reads even if CacheLane failed silently. The correct proof is: (a) `prefix_breakpoint_hash` is non-null in the turn explanation, meaning the CacheLane orchestrator ran; and (b) `cache_creation_1h_tokens > 0` in some turns, which can only come from CacheLane since Claude Code's native caching only uses `5m` TTL. (Test: §7.2 request-mutation integration test — intercept the outgoing request at the mock-Anthropic boundary and assert it contains exactly the `cache_control` markers the CacheLane orchestrator placed, with no additional native markers, because `stripCc` removes Claude Code's originals before CacheLane places its own.)

3. **Multi-window correctness**: Two Claude Code windows running simultaneously produce two isolated session records with independent classifier state, independent pruner state, and correct per-session stats. Neither window blocks or corrupts the other. (Test: §7.3 multi-window concurrency test.)

4. **Resume correctness**: A user can close Claude Code, wait an arbitrary duration, reopen, and CacheLane recovers in-memory state from the DB without data loss and without elevated cost beyond the cold-start of Anthropic's cache. (Test: §7.3 resume integration test.)

5. **Failure-open guarantee**: Every documented failure mode in §5 either degrades gracefully to no-optimization mode (user sees no error, just slightly higher cost) or surfaces a clear, actionable error message. CacheLane **never** blocks a Claude Code request. (Test: §7.5 fault injection suite.)

6. **No proxy artifact in user docs**: A grep for "proxy" in `README.md`, install instructions, marketplace listing, and any user-facing CLI help output returns zero results. (Test: §7.6 docs lint.)

---

## 7. Test Strategy

Five tiers. All five must be green to merge.

### 7.1 Unit tests (fast, deterministic)

- `src/cli/install.test.ts`: Each settings.json mutation rule from §5.2 has a test case.
- `src/cli/uninstall.test.ts`: Removes only what we added.
- `src/proxy/lifecycle.test.ts` (new): Port binding logic, port collision detection, graceful shutdown.
- `src/proxy/session-router.test.ts` (new): Per-request session ID resolution per the chosen §3.6 mechanism.
- `src/orchestrator/cache-state-tracker.test.ts`: Add `fromDb()` constructor test for resume.

Target: <5 seconds total. Runs on every commit.

### 7.2 Integration tests (medium, real SQLite, mock Anthropic)

Use the existing mock-Anthropic harness (already in `src/proxy/__tests__/server.test.ts`).

#### 7.2.1 Pipeline smoke test (required — gates every merge)

This is the single most important test in the suite. It validates the entire pipeline in one shot — classification, breakpoint placement, request mutation, proxy interception, response parsing, DB write, and cost accounting — replacing what is currently only verifiable by watching the live-benchmark dashboard manually.

**Setup:** Spin up CacheLane's proxy server in-process pointed at a fake upstream HTTP server (infrastructure already exists in `src/proxy/__tests__/server.test.ts`). The fake upstream does not simulate a real LLM — it returns a minimal well-formed Anthropic streaming response with a realistic `usage` payload.

**Execution:**

1. Fire **turn 1** through the proxy: a full synthetic request containing a system prompt, tool schemas, and a user message. The fake upstream responds with a well-formed SSE body including `cache_creation_input_tokens: N` (where N mirrors the stable prefix token count) and `cache_read_input_tokens: 0`.

2. Fire **turn 2** through the proxy: identical system prompt and tool schemas, new user message only. The fake upstream responds with `cache_creation_input_tokens: 0` and `cache_read_input_tokens: N` — simulating a real Anthropic cache hit on the prefix placed in turn 1.

**Assertions** (queried directly from SQLite after turn 2 completes):

| # | Assert | What it proves |
|---|--------|----------------|
| 1 | A `TurnRow` exists for both turns with `input_tokens > 0` | Proxy intercepted both requests and the recorder parsed the response correctly |
| 2 | Turn 2 `cache_read_tokens > 0` | Orchestrator placed a valid `cache_control` breakpoint on turn 1; fake upstream echoed back `cache_read_input_tokens`; response parser extracted it and wrote it to the DB |
| 3 | Turn 2 `effective_cost_units` is strictly less than `baseline_cost_units` (i.e. `input_tokens × 1.0`) | Savings computation is correct end-to-end using the formula `input×1.0 + cache_write_5m×1.25 + cache_write_1h×2.0 + cache_read×0.1` |
| 4 | Turn 1 `prefix_breakpoint_hash` is non-null and equals turn 2 `prefix_breakpoint_hash` | The same prefix hash was placed on both turns, confirming prefix stability across turns |
| 5 | The request body received by the fake upstream on turn 2 contains a `cache_control` block in the expected position | CacheLane mutated the request — not Claude Code's native markers (which `stripCc` removes before our markers are placed) |

**Why five assertions and not three:** Assertions 1–3 are what the user described. Assertions 4 and 5 are added because assertion 2 alone (`cache_read_tokens > 0`) does not prove CacheLane placed the markers — it only proves the DB write worked. Assertion 5 closes that gap by inspecting what actually left the machine.

**Location:** `src/proxy/__tests__/pipeline-smoke.test.ts` (new file). Runs in the standard `npm test` suite. Target runtime: <3 seconds.

#### 7.2.2 Additional integration tests

- **Request mutation**: Assert `cache_control` markers in the exact positions the orchestrator placed them, for the full set of request shapes (tools present, tools absent, string content, array content).
- **Multi-window concurrency**: Spawn two proxy instances (or two session IDs against a shared proxy), send interleaved requests, assert correct per-session attribution in the DB with no cross-contamination.
- **Resume**: Run a 5-turn session, kill the proxy, restart, verify turn 6 starts with hydrated `CacheStateTracker` state rebuilt from DB.
- **TTL expiry simulation**: Fake upstream returns `cache_read_input_tokens: 0` on turn 6 (simulating expiry), verify cold-write + re-warm pattern matches DB records.
- **Fail-open recording**: Force the orchestrator to throw mid-pipeline; assert the turn is still recorded in DB with `signals: ["error:fallback"]` and `prefix_breakpoint_hash: null`.

### 7.3 End-to-end tests (slow, real Anthropic via fake API key, full Claude Code binary)

A new test harness, `e2e/`, that:
- Boots a fake `claude` binary (or a real Claude Code in a sandbox with a mock API key)
- Runs through scripted user flows
- Asserts DB state and proxy logs

Scenarios:
- Fresh install → first session → expected stats
- Install → close → reopen → expected stats
- Install → window A + window B → expected isolation
- Install → uninstall → confirm clean removal

These tests run on every PR but are slow (~5 min each). Tagged separately from fast suites.

### 7.4 Install/uninstall acceptance test

A scripted environment where:
1. Start from a clean home directory
2. Run `npm pack && npm install -g ./cachelane-*.tgz`
3. Run `cachelane install`
4. Verify settings.json, MCP registration, hook registration, DB creation, all match spec
5. Run `cachelane uninstall`
6. Verify all artifacts removed except DB (unless `--purge`)
7. Run install again → verify identical state to step 4 (idempotency)

### 7.5 Fault injection / chaos suite

For each row in §5:
- Set up the failure condition (locked port, malformed settings, killed process, etc.)
- Assert CacheLane fails open or produces the documented error
- Assert no data corruption in DB
- Assert next clean session works normally

### 7.6 Documentation lint

Mechanical checks:
- No occurrence of "proxy", "ANTHROPIC_BASE_URL", "port 7332" in user-facing README, install docs, or marketplace listing
- All examples in user docs use only `cachelane install`, `cachelane stats`, `cachelane uninstall`
- Internal/developer docs may freely mention proxy mechanics

### 7.7 Baseline A/B comparison harness

§5.8 and §6 both rely on a "savings ratio with CacheLane vs. without it" comparison to fully prove the optimization is real. This requires a record-only-no-mutate mode the comparison can run against.

Required:
- A new config flag `features.mutation_enabled` (default true). When false, the proxy still intercepts, parses, classifies, computes hashes, and records the would-have-mutated state into `turns.signals: ["mode:baseline"]` — but forwards the **original unmutated** body upstream
- A `cachelane benchmark compare` command that runs the same recorded agent trace (from `src/agent-traces/`) twice: once with mutation on, once with mutation off, and produces a side-by-side report (effective cost units, cache hit ratio, savings ratio per turn)
- This is the only way to ground-truth the claim "CacheLane added value above Claude Code's native caching"

The harness lives in `src/benchmark/baseline-compare.ts` (new file). The existing `src/benchmark/recorded.ts` already supports replaying traces; this adds the A/B layer on top.

Expected output of a successful comparison:
```
Trace: scenarios/long-coding-session.json (50 turns)

                              Baseline (no CacheLane)  With CacheLane   Delta
Turns                                              50              50      —
Total input tokens                          1,247,832       1,247,832      0
Cache hit ratio                                 47.2%           86.4%   +39.2pp
Effective cost units                          723,401         168,529   -76.7%
1h cache writes                                     0          18,234   +∞
Average prefix_breakpoint_hash on turn        null         <non-null>
```

The non-null `prefix_breakpoint_hash` with mutation on vs. null with mutation off is the smoking gun proof that CacheLane specifically produced the delta.

---

## 8. Required Infrastructure

To execute this plan, the following infrastructure must exist or be built:

| Item | Status | Notes |
|------|--------|-------|
| Mock Anthropic upstream | Exists (`src/proxy/__tests__/server.test.ts`) | Extend with TTL simulation, error injection |
| SQLite test fixtures | Exists | Add multi-session fixture |
| CI matrix: Linux/macOS/Windows | Linux only today | Add macOS + Windows runners to GitHub Actions |
| E2E harness with Claude Code binary | Does not exist | Build new `e2e/` dir; decide between (a) recording fake transcripts and replaying, (b) sandboxed real Claude Code with throwaway API key |
| Fault injection harness | Does not exist | Wrapper around proxy lifecycle that can simulate crashes, port locks, FS errors |
| Docs lint script | Does not exist | Simple grep-based CI step |
| Benchmark replay harness | Exists (`src/agent-traces/`) | Use to regression-test cache hit rates across versions |

The E2E harness is the largest single piece of new infrastructure. Recommended approach: record real Claude Code traffic against a known-good build, replay the recordings against new builds, assert byte-for-byte equivalence of proxy outputs (modulo timestamps).

---

## 9. Acceptance Criteria (Gate to Merge)

This milestone is **not** done until all of the following are true. Partial completion is not acceptable.

- [ ] `npm install -g cachelane && cachelane install` produces a fully functioning CacheLane installation on Linux, macOS, and Windows with no further commands.
- [ ] First turn of first session after install demonstrably uses CacheLane-placed `cache_control` markers — proven by (a) `prefix_breakpoint_hash` non-null in `cachelane explain` and (b) `cache_creation_1h_tokens > 0` in the turn record. `cache_read_input_tokens > 0` alone is not sufficient proof (Claude Code's native caching produces this independently).
- [ ] Two simultaneous Claude Code windows both show correct, isolated stats; neither blocks the other; both achieve cache hits driven by CacheLane.
- [ ] Closing and reopening Claude Code preserves DB state and rebuilds in-memory state from DB; first turn after reopen does not error.
- [ ] K-pruning is operational: a session with many tool-result blocks shows non-zero `pruned_blocks` in `cachelane stats`.
- [ ] Keepalive pings fire during idle periods of >4 minutes and are visible in the DB.
- [ ] Every failure mode in §5 has either a passing test or a documented decision to defer with rationale.
- [ ] Docs lint (§7.6) passes: no user-facing mention of "proxy."
- [ ] `cachelane uninstall` removes everything we added and nothing else; settings.json round-trips byte-equal modulo our keys.
- [ ] Benchmark against the M7 baseline shows no regression in savings ratio on the same recorded agent traces.
- [ ] Cache-stability gate (CLAUDE.md invariant) passes: SHA-256 of the prefix region is byte-identical across 3 consecutive identical-input runs after install.
- [ ] Pipeline smoke test (§7.2.1) passes — all five assertions green.
- [ ] Baseline A/B harness (§7.7) produces a side-by-side report on at least one recorded scenario showing CacheLane savings > 50% relative to baseline.
- [ ] `cachelane:health` MCP tool returns `status: "ok"` for a clean install and `status: "degraded"` when fallback rate exceeds threshold.
- [ ] `cachelane.log` is being written with structured JSON lines and respects rotation limits (verified by integration test with synthetic log floods).
- [ ] Latency regression test (§5.10) green: proxy p99 < 20ms over a 1000-request stress.
- [ ] Memory test (§5.10) green: 4 windows × 100 turns < 5MB resident in the MCP process.
- [ ] Conflict-aware install: `cachelane install` correctly refuses when a foreign `ANTHROPIC_BASE_URL` is already set (§4.8).
- [ ] All §10 open questions are answered and the resolutions are reflected in the design before code lands.

---

## 10. Open Questions (Resolve Before Implementation)

These must be answered before writing code. Each blocks a design decision.

### 10.1 How does Claude Code propagate session ID to the MCP child?

Claude Code's MCP integration may or may not pass the current Claude Code session ID into the MCP child process environment. If it does, we read it from env. If it doesn't, we need a different mechanism (the MCP child queries Claude Code for the current session ID via... what? an MCP tool call invoked at startup? a side-channel file?). **Action:** Read Claude Code's MCP docs and verify experimentally.

### 10.2 Does Claude Code support per-session env vars from MCP config?

Critical for option (e) in §3.6. If `mcpServers.cachelane.env` can include per-session interpolation (e.g., `${session_id}`), we can give each session its own proxy port and the whole multi-window problem evaporates. If it can't, we need the shared-proxy design and option (d) heuristics. **Action:** Read Claude Code MCP env docs.

### 10.3 Is there a way to inject HTTP headers into Claude Code's outgoing requests without modifying the binary?

If yes (e.g., via a proxy header injection config), option (a) in §3.6 becomes available and is cleaner than any alternative. **Action:** Audit Claude Code config schema.

### 10.4 What is the canonical install path for global npm packages on Windows, and does `cachelane install` need a shim?

npm on Windows installs to `%APPDATA%\npm\` and uses .cmd shims. Claude Code's MCP server registration path may not handle these gracefully. **Action:** Manual test on Windows.

### 10.5 What is Claude Code's behavior when ANTHROPIC_BASE_URL points at a server that's down?

If Claude Code times out aggressively, our "fail open" requires the proxy to **always** be up before Claude Code makes its first request. If Claude Code retries gracefully, we have more slack. **Action:** Time the gap between MCP server start (when our proxy boots) and Claude Code's first API call.

### 10.6 Do we need to support Claude Code Web (claude.ai/code) and IDE extensions, or only the CLI?

The plan assumes CLI. The proxy approach works for any client that respects `ANTHROPIC_BASE_URL`. Web client probably doesn't; IDE extensions probably do. **Action:** Define supported clients explicitly in the README.

### 10.7 Does Claude Code ever place 1h-TTL `cache_control` markers natively?

This question is load-bearing for §5.8, §6, §9, and §14 — all rely on the claim "if `cache_creation_1h_tokens > 0`, then CacheLane mutated the request because Claude Code's native caching only places 5m markers."

If Claude Code uses the `extended-cache-ttl-2025-04-11` beta header or any future variant and places its own 1h markers, this proof point collapses. The fallback would be: rely solely on `prefix_breakpoint_hash` being non-null (which is unambiguous because that field is internal to CacheLane).

**Action:** Capture and inspect raw outgoing requests from a Claude Code session with the proxy disabled. Look for `cache_control: { ttl: "1h" }` in `tools`, `system`, or `messages`. If found anywhere natively, update the proofs in §6 and §9 to drop the `cache_creation_1h_tokens` assertion and rely on `prefix_breakpoint_hash` alone, plus assertion 5 of §7.2.1 (request-body inspection at the upstream boundary).

### 10.8 Glossary

For engineers not yet familiar with the CacheLane vocabulary (see also `designs/01-system-overview.md` and `CLAUDE.md`):

| Term | Meaning |
|------|---------|
| `STABLE` / `SEMI` / `VOLATILE` | The three volatility classes the classifier assigns to each block. STABLE never changes turn-to-turn (system prompt, tool schemas, CLAUDE.md). SEMI changes occasionally (long-lived tool results, references). VOLATILE changes every turn (latest user message, fresh tool calls). Vocabulary is canonical — no synonyms ever. |
| Prefix breakpoint | The first `cache_control` marker, placed at the boundary between the STABLE region and the SEMI region. Caches the long-lived part of the prompt at 1h TTL. |
| Middle breakpoint | The second `cache_control` marker, placed at the boundary between the SEMI region and the VOLATILE region. Caches the medium-lived part at 5m TTL. |
| `cache_control` marker | An Anthropic API field on tool/system/message blocks: `{ type: "ephemeral", ttl: "5m" \| "1h" }`. Tells Anthropic to cache everything up to and including this block. |
| K-pruning | An optimization where a tool-result block idle for ≥ K consecutive turns is replaced with a refetchable stub (`<pruned:block_id>`). Reduces token count without losing information — stub can be expanded via `cachelane:expand` MCP tool. |
| Keepalive ping | A cheap synthetic request sent during long idle periods to keep Anthropic's prompt cache warm past the 5m TTL boundary. |
| `prefix_hash` / `middle_hash` | SHA-256 of the bytes in the prefix or middle region. Used to detect when the cache key has rotated. The CLAUDE.md "cache-stability gate" asserts these are byte-identical across identical-input runs. |
| Fail-open | When any CacheLane component throws, forward the **original unmutated** request to Anthropic so the user is never blocked. The cost is silently losing optimization for that turn. |
| Pipeline | The ordered chain: Classifier → Pruner → Reorderer → Mutator. Order is canonical; Pruner must run before Reorderer because pruning changes block token counts. |

---

## 11. Rollout Plan

1. **Pre-flight**: Resolve all open questions (§10). Without these answers, the design is incomplete and will be reworked mid-implementation.
2. **Phase 1 — Single-session auto-proxy + K-pruner wiring**: Bind proxy from MCP server on a fixed port; one Claude Code window at a time. Hook up `block_placements` in the proxy path; verify K-pruning produces non-zero `pruned_blocks` in benchmarks. Ship behind a feature flag (`cachelane.config.json: { features: { auto_proxy: true } }`, see §3.8) to early adopters first. **K-pruner ships with auto-proxy** because §3.4 designates it a hard requirement — without it, the "proxy does everything hooks couldn't" claim is false.
3. **Phase 2 — Multi-window**: Resolve §3.6 and implement chosen approach. Multi-window tests must be green.
4. **Phase 3 — Keepalive wiring**: Integrate keepalive into proxy lifecycle. Verify warm-cache idle behavior.
5. **Phase 4 — Cross-platform CI**: macOS + Windows runners green.
6. **Phase 5 — Docs lint + acceptance suite**: All gate criteria (§9) green.
7. **Phase 6 — Marketplace listing**: Submit to Claude marketplace with the verified install flow.
8. **Phase 7 — Monitoring**: After public release, monitor `cachelane doctor` telemetry (opt-in) for unexpected failure modes from real users.

Each phase is independently mergeable to `main` behind the feature flag. The flag is removed in Phase 6 once acceptance criteria are met.

---

## 12. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Claude Code does not support per-session MCP env (§10.2) | High | Fallback to shared proxy with header/heuristic routing; degraded UX for multi-window users |
| Anthropic changes the `cache_control` API mid-rollout | Medium | Existing model-table and tokenizer abstractions absorb API changes; monitor Anthropic changelog |
| User has another process bound to 7332 (corporate proxy, dev server, dormant Docker container) | Medium | Detect `EADDRINUSE`, fall back to `cachelane config set proxy.port <other>` flow (§3.8); fail open if user does nothing; document in troubleshooting (§3.7) |
| Claude Code marketplace review rejects the install model | Medium | Engage with Anthropic marketplace team early; share this plan for pre-review feedback |
| Performance: proxy adds latency to every request | Medium | Existing benchmarks show <5ms p50 overhead; add latency regression test to CI |
| Security: localhost proxy can be hit by other local processes | Low | Bind to 127.0.0.1 only (never 0.0.0.0); accept the bound API key passthrough as in-scope for v1 |

---

## 13. Out of Scope (Explicit Non-Goals)

To prevent scope creep, the following are **not** part of this milestone:

- Support for non-Claude-Code clients (Cursor, Continue, custom integrations) — they can use the manual proxy if they want, but they are not first-class
- TLS termination from CacheLane proxy — Claude Code talks plain HTTP to the local proxy; CacheLane talks HTTPS to Anthropic; no need to MITM
- Authentication on the local proxy — anything on the user's localhost is trusted by assumption
- Hosted CacheLane (cloud SaaS) — this plan is for the local-only model
- Anthropic API features beyond messages + cache_control (e.g., files API, batches) — those use different endpoints and bypass the proxy entirely; acceptable

---

## 14. Definition of Done

When a maintainer can run the following and have it work end-to-end without intervention, the milestone is done:

```bash
# Clean machine, real-world dependencies
$ docker run --rm -it node:20-bookworm bash
# Inside container:
$ npm install -g @anthropic-ai/claude-code   # Claude Code CLI
$ npm install -g cachelane
$ cachelane install
$ ANTHROPIC_API_KEY=sk-ant-... claude --print "hello"
# (Anthropic responds)
$ cachelane stats --json | jq '.turns, .cache_hit_ratio, .savings_ratio'
$ cachelane explain --turn 1 --json | jq '.explanation.prefix_breakpoint_hash, .explanation.middle_breakpoint_hash'
# Both hashes must be non-null on turn 1.
# If prefix_breakpoint_hash is null, the orchestrator never ran — milestone is not done.
```

Three things in the Docker example matter:
1. **`node:20-bookworm`** — Node 20 is required (`better-sqlite3` native binding fails on Node 24, per CLAUDE.md). Ubuntu's default `nodejs` package is too old. Don't substitute.
2. **Claude Code must be installed** — the litmus test exercises the full integration; without `@anthropic-ai/claude-code` on the PATH, there's nothing for `cachelane install` to register against.
3. **Read `prefix_breakpoint_hash`, not `cache_read_input_tokens`** — see §5.8 and §6.

The presence of a non-null `prefix_breakpoint_hash` on turn 1 is the single most important assertion in this entire plan. It proves the CacheLane orchestrator ran and placed markers — not Claude Code's native caching. `cache_read_input_tokens > 0` is NOT sufficient proof because Claude Code places its own native `5m` markers independently; Anthropic would report cache reads even if CacheLane's pipeline failed silently. Look for `prefix_breakpoint_hash` and `cache_creation_1h_tokens > 0`. Everything else flows from those two signals.
