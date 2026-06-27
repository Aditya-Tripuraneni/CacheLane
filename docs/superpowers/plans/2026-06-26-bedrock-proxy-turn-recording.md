# Bedrock Proxy Turn-Recording Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CacheLane proxy the single source of turn records on Bedrock so pruning/keepalive savings reach the dashboard, instead of being overwritten by prune-blind Stop-hook rows.

**Architecture:** Two writers currently target the `turns` table's `UNIQUE(workspace_id, session_id, turn_number)` index — the proxy (request path, knows real prune count) and the `cachelane hook stop` Stop-hook (post-hoc transcript reader, hardcodes `pruned_blocks_count: 0`). On Bedrock the proxy is NOT bypassed (Claude Code points `ANTHROPIC_BEDROCK_BASE_URL` and `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` at `127.0.0.1:7332`), so both run and the hook's worse row wins. Fix: (1) gate the hook's turn recording so it skips when the proxy is the active recorder, (2) make the proxy insert an upsert so a stale row never silently blocks a richer one, then (3) redeploy current code + migrate the live DB together and verify.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), better-sqlite3, vitest, tsup, Node 20.

## Global Constraints

- **Vocabulary:** `STABLE | SEMI | VOLATILE` are the only volatility class names — no synonyms.
- **Naming:** storage/API-contract types use `snake_case` (DB columns, `Block`, `CachelaneConfig` fields); in-process working types may use `camelCase`.
- **Fail-open:** any error in CacheLane must return the unmutated request / not crash Claude Code. The hook already wraps everything in try/catch that fails open — preserve that.
- **Node version:** Node 20 required (`nvm use 20`); better-sqlite3 native binding fails on Node 24.
- **No new npm deps** without an ADR.
- **Cache-stability gate:** SHA-256 of the prefix region must be byte-identical across 3 consecutive identical-input runs — do not introduce nondeterminism into request mutation.
- **Test discipline:** TDD, red test first; fixtures as JSON; one assertion per test where practical.

---

### Task 1: Gate the Stop-hook so it does not record turns when the proxy is the active recorder

**Problem this solves:** `handleHookEvent` in `src/cli/index.ts` unconditionally inserts a turn row per transcript API call with `pruned_blocks_count: 0` and `signals: ["mode:hook"]`. On Bedrock the proxy already records each turn (with the true prune count), so the hook row is redundant and, worse, occupies the `UNIQUE(workspace_id, session_id, turn_number)` slot. We add a gate: when the proxy is the active Bedrock recorder, the hook skips turn insertion entirely.

**Detection signal:** Claude Code routes Bedrock traffic through the proxy by setting `ANTHROPIC_BEDROCK_BASE_URL` (and/or `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`) to the local proxy origin. When either env var points at `127.0.0.1`/`localhost` on the configured proxy port, the proxy owns recording. This is a pure function of `env`, so it is trivially testable.

**Files:**
- Create: `src/cli/proxy-active.ts`
- Modify: `src/cli/index.ts` (the `handleHookEvent` function, around lines 206–274 — add an early gate before the `for (const call of calls)` insert loop)
- Test: `src/cli/__tests__/proxy-active.test.ts`

**Interfaces:**
- Produces: `proxyIsActiveRecorder(env: NodeJS.ProcessEnv): boolean` — returns `true` when a Bedrock base-url / endpoint env var points at a loopback host (`127.0.0.1` or `localhost`), meaning the local CacheLane proxy is intercepting and will record turns itself.
- Consumes (in `index.ts`): existing `handleHookEvent(env, parsed)` already has `env` in scope.

- [ ] **Step 1: Write the failing test**

```ts
// src/cli/__tests__/proxy-active.test.ts
import { describe, it, expect } from "vitest";
import { proxyIsActiveRecorder } from "../proxy-active.js";

describe("proxyIsActiveRecorder", () => {
  it("is true when ANTHROPIC_BEDROCK_BASE_URL points at the loopback proxy", () => {
    expect(proxyIsActiveRecorder({ ANTHROPIC_BEDROCK_BASE_URL: "http://127.0.0.1:7332" })).toBe(true);
  });

  it("is true when AWS_ENDPOINT_URL_BEDROCK_RUNTIME points at localhost", () => {
    expect(proxyIsActiveRecorder({ AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "http://localhost:7332" })).toBe(true);
  });

  it("is false when no proxy env var is set", () => {
    expect(proxyIsActiveRecorder({})).toBe(false);
  });

  it("is false when the base url points at a remote Bedrock host", () => {
    expect(
      proxyIsActiveRecorder({
        ANTHROPIC_BEDROCK_BASE_URL: "https://bedrock-runtime.us-east-1.amazonaws.com",
      }),
    ).toBe(false);
  });

  it("is false when the env var is set but not a valid URL", () => {
    expect(proxyIsActiveRecorder({ ANTHROPIC_BEDROCK_BASE_URL: "not-a-url" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/__tests__/proxy-active.test.ts`
Expected: FAIL — `Cannot find module '../proxy-active.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/cli/proxy-active.ts

/**
 * True when a Bedrock base-url / endpoint env var points at a loopback host,
 * i.e. the local CacheLane proxy is intercepting Bedrock traffic and will
 * record each turn itself (with the real prune count). In that case the Stop
 * hook must NOT also insert a turn row — its prune-blind row would occupy the
 * UNIQUE(workspace_id, session_id, turn_number) slot and hide the proxy's data.
 */
export function proxyIsActiveRecorder(env: NodeJS.ProcessEnv): boolean {
  const candidates = [env.ANTHROPIC_BEDROCK_BASE_URL, env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME];
  for (const raw of candidates) {
    if (!raw) continue;
    let host: string;
    try {
      host = new URL(raw).hostname;
    } catch {
      continue;
    }
    if (host === "127.0.0.1" || host === "localhost") return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/__tests__/proxy-active.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the gate into `handleHookEvent`**

In `src/cli/index.ts`, add the import near the other `../cli`-local imports at the top of the file:

```ts
import { proxyIsActiveRecorder } from "./proxy-active.js";
```

Then in `handleHookEvent`, immediately after `const calls = parseTranscriptApiCalls(content); if (calls.length === 0) return;` and BEFORE `const db = openDatabase(...)`, add:

```ts
    // Proxy-only recording on Bedrock: when the local proxy is intercepting
    // Bedrock traffic it records every turn with the true prune count. The Stop
    // hook must not also insert turns — its prune-blind row (pruned_blocks_count:
    // 0) would win the UNIQUE(workspace_id, session_id, turn_number) slot and
    // hide the proxy's data. See docs/superpowers/plans/2026-06-26-bedrock-proxy-turn-recording.md
    if (proxyIsActiveRecorder(env)) return;
```

- [ ] **Step 6: Write a test proving the gate is honored in `handleHookEvent`**

Add to `src/cli/__tests__/proxy-active.test.ts` a behavioral guard. Because `handleHookEvent` is module-private, assert the gate at the unit boundary already covered in Steps 1–4, and additionally add a regression note test that documents the contract:

```ts
describe("Stop-hook recording gate contract", () => {
  it("loopback proxy env disables hook turn recording", () => {
    // Mirrors the early-return guard added to handleHookEvent: when the proxy
    // is the active recorder the hook performs no DB writes.
    const env = { ANTHROPIC_BEDROCK_BASE_URL: "http://127.0.0.1:7332" };
    expect(proxyIsActiveRecorder(env)).toBe(true);
  });
});
```

- [ ] **Step 7: Run the full CLI test suite**

Run: `npx vitest run src/cli`
Expected: PASS — no existing CLI test regresses. (`src/cli/__tests__/cli.test.ts` exercises hook routing; confirm it does not set a loopback Bedrock env var, otherwise its expectations about hook recording must be reconciled — if it does, that is a real finding to surface, not to silently patch.)

- [ ] **Step 8: Commit**

```bash
git add src/cli/proxy-active.ts src/cli/__tests__/proxy-active.test.ts src/cli/index.ts
git commit -m "fix: Stop-hook skips turn recording when proxy is the active Bedrock recorder"
```

---

### Task 2: Make the proxy turn insert an upsert instead of INSERT OR IGNORE

**Problem this solves:** `insertTurnStmt` in `src/storage/data-access.ts:277` uses `INSERT OR IGNORE`. A pre-existing row on the same `UNIQUE(workspace_id, session_id, turn_number)` slot (e.g. a legacy hook row, or a retry) silently drops the proxy's richer row. After Task 1 the hook no longer competes, but `INSERT OR IGNORE` is still wrong: it means a proxy retry or any future second writer is discarded rather than reconciled. Convert to an upsert that, on conflict, overwrites with the row that carries real prune/keepalive data.

**Caution — turn id is the PRIMARY KEY:** `turns.id` is `TEXT PRIMARY KEY` and the proxy uses a fresh `randomUUID()` per turn. The meaningful conflict is on the `(workspace_id, session_id, turn_number)` UNIQUE index, NOT on `id`. The upsert's `ON CONFLICT` target must therefore be the composite index, and must update `id` too so the row's identity becomes the proxy's. Verify both constraints with the test below.

**Files:**
- Modify: `src/storage/data-access.ts:277-290` (the `insertTurnStmt` prepared statement)
- Test: `src/storage/__tests__/storage.test.ts` (add a new `describe` block; do not modify existing tests)

**Interfaces:**
- Consumes: existing `db.insertTurn(row: TurnRow)` signature is unchanged — only the SQL changes.
- Produces: after a second `insertTurn` with the same `(workspace_id, session_id, turn_number)` but different `id` and a higher `pruned_blocks_count`, the stored row reflects the second call's `id` and `pruned_blocks_count`.

- [ ] **Step 1: Write the failing test**

```ts
// Add to src/storage/__tests__/storage.test.ts
describe("insertTurn upsert on (workspace, session, turn_number) conflict", () => {
  it("overwrites a prior row on the same composite slot with the newer row's id and prune count", () => {
    const db = openDatabase(":memory:");
    try {
      const base = {
        workspace_id: "ws_test",
        session_id: "sess_test",
        turn_number: 1,
        model: "claude-test",
        provider: "anthropic",
        input_tokens: 100,
        output_tokens: 10,
        cache_creation_5m_tokens: 0,
        cache_creation_1h_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        effective_cost_units: 100,
        prefix_breakpoint_hash: null,
        middle_breakpoint_hash: null,
        keepalive_pings_since_last_turn: 0,
        signals: null,
        request_mutated: 1,
        created_at: 1000,
      };
      // First writer: prune-blind (simulates a legacy/hook row)
      db.insertTurn({ ...base, id: "hook-row-id", pruned_blocks_count: 0 });
      // Second writer: proxy row with real prune count, fresh UUID-style id
      db.insertTurn({ ...base, id: "proxy-row-uuid", pruned_blocks_count: 3 });

      const stored = db.getTurnByNumber("ws_test", "sess_test", 1);
      expect(stored?.id).toBe("proxy-row-uuid");
      expect(stored?.pruned_blocks_count).toBe(3);

      // And there is exactly one row for the slot (no duplicate).
      const all = db.getRecentTurns({ workspace_id: "ws_test", session_id: "sess_test", limit: 10 });
      expect(all.filter((t) => t.turn_number === 1).length).toBe(1);
    } finally {
      db.close();
    }
  });
});
```

NOTE: Confirm the exact accessor names (`getTurnByNumber`, `getRecentTurns`) against `src/storage/index.ts` / `data-access.ts` before running; if the public method is named differently, use the actual exported name. Do not invent a method.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/__tests__/storage.test.ts -t "upsert on"`
Expected: FAIL — with `INSERT OR IGNORE`, the second insert is ignored, so `stored.id` is still `"hook-row-id"` and `pruned_blocks_count` is `0`.

- [ ] **Step 3: Rewrite the prepared statement as an upsert**

Replace `src/storage/data-access.ts:277-290` with:

```ts
  const insertTurnStmt = rawDb.prepare(`
    INSERT INTO turns
      (id, workspace_id, session_id, turn_number, model, provider,
       input_tokens, output_tokens,
       cache_creation_5m_tokens, cache_creation_1h_tokens, cache_read_tokens, cache_write_tokens,
       effective_cost_units, prefix_breakpoint_hash, middle_breakpoint_hash,
       pruned_blocks_count, keepalive_pings_since_last_turn, signals, request_mutated, created_at)
    VALUES
      (@id, @workspace_id, @session_id, @turn_number, @model, @provider,
       @input_tokens, @output_tokens,
       @cache_creation_5m_tokens, @cache_creation_1h_tokens, @cache_read_tokens, @cache_write_tokens,
       @effective_cost_units, @prefix_breakpoint_hash, @middle_breakpoint_hash,
       @pruned_blocks_count, @keepalive_pings_since_last_turn, @signals, @request_mutated, @created_at)
    ON CONFLICT(workspace_id, session_id, turn_number) DO UPDATE SET
      id = excluded.id,
      model = excluded.model,
      provider = excluded.provider,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_creation_5m_tokens = excluded.cache_creation_5m_tokens,
      cache_creation_1h_tokens = excluded.cache_creation_1h_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      cache_write_tokens = excluded.cache_write_tokens,
      effective_cost_units = excluded.effective_cost_units,
      prefix_breakpoint_hash = excluded.prefix_breakpoint_hash,
      middle_breakpoint_hash = excluded.middle_breakpoint_hash,
      pruned_blocks_count = excluded.pruned_blocks_count,
      keepalive_pings_since_last_turn = excluded.keepalive_pings_since_last_turn,
      signals = excluded.signals,
      request_mutated = excluded.request_mutated,
      created_at = excluded.created_at
  `);
```

NOTE on the `id` PRIMARY KEY: updating `id` to `excluded.id` is safe only if no OTHER row already holds that `id`. Since the proxy generates a fresh `randomUUID()` per turn, a collision on `id` is astronomically unlikely. If a future caller reuses ids, this UPDATE could itself raise a PK conflict — acceptable, because that would be a genuine duplicate-id bug worth surfacing, and fail-open in the proxy catch handles it. Do not add suppression for it here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/storage/__tests__/storage.test.ts -t "upsert on"`
Expected: PASS.

- [ ] **Step 5: Run the full storage suite + migrations suite**

Run: `npx vitest run src/storage`
Expected: PASS — existing insert/idempotency tests still hold. If any existing test depended on `INSERT OR IGNORE` no-op-on-duplicate-`id` semantics, that is a real interaction to surface in review (the upsert now updates instead of ignoring) — flag it, do not silently rewrite the assertion.

- [ ] **Step 6: Commit**

```bash
git add src/storage/data-access.ts src/storage/__tests__/storage.test.ts
git commit -m "fix: turns insert upserts on (workspace,session,turn_number) so the prune-aware row wins"
```

---

### Task 3: Redeploy current code, migrate the live DB, and verify proxy rows land

**Problem this solves:** The running proxy + hooks are the globally-installed `cachelane@1.0.16` (built Jun 15; bundles migrations ≤005; no `provider`/`cache_write_tokens` columns). The live DB at `~/.cachelane/cachelane.db` is frozen at migration 005. None of the current repo code (Tasks 1–2, plus the existing provider/Bedrock-signing work) is deployed. This task ships it and confirms the fix end-to-end. It is operational, not TDD — but every command has an explicit expected result, and the DB is backed up first so it is reversible.

**Files:** none modified (deploy + verify only).

**Pre-req:** Tasks 1 and 2 are committed and `npm test` is green.

- [ ] **Step 1: Confirm Node 20 and a green build**

Run:
```bash
nvm use 20
npm run build
npm test
```
Expected: build succeeds; full vitest suite passes. If the suite is red, STOP — do not deploy on a red baseline.

- [ ] **Step 2: Stop the running proxy**

The proxy currently runs as pid 21604 (or look it up). Stopping it releases the DB file handle so migrations can apply cleanly.

Run:
```bash
lsof -nP -iTCP:7332 -sTCP:LISTEN
```
Expected: one node process listening on 127.0.0.1:7332. Note its PID.

Then ask the human partner to stop it (or, with explicit consent, kill that PID). Do NOT kill arbitrary processes without confirming it is the CacheLane proxy.

- [ ] **Step 3: Back up the live DB (reversible safety net)**

Run:
```bash
cp ~/.cachelane/cachelane.db ~/.cachelane/cachelane.db.bak-$(date +%Y%m%d-%H%M%S)
ls -la ~/.cachelane/cachelane.db.bak-*
```
Expected: a fresh timestamped backup alongside the existing `cachelane.db.bak-fix`.

- [ ] **Step 4: Reinstall the global package from this repo**

Run (from the repo root):
```bash
npm install -g .
cachelane --version
```
Expected: version reflects the current repo `package.json` (NOT `1.0.16`). Confirm the global `dist/migrations/` now contains files through `011_provider_columns.sql`:
```bash
ls "$(npm root -g)/cachelane/dist/migrations/"
```
Expected: `001_*.sql` … `011_provider_columns.sql`.

- [ ] **Step 5: Apply migrations to the live DB**

Migrations run automatically on DB open. Trigger an open via any read command, then verify:
```bash
cachelane config 2>/dev/null || true
sqlite3 ~/.cachelane/cachelane.db "SELECT id FROM schema_migrations ORDER BY id;"
```
Expected: migrations `001` … `011` all listed. Then confirm the new columns exist:
```bash
sqlite3 ~/.cachelane/cachelane.db "SELECT provider, cache_write_tokens FROM turns LIMIT 1;"
```
Expected: no "no such column" error (returns a row or empty set).

- [ ] **Step 6: Restart the proxy**

Restart via the same mechanism that launched it originally (the user's normal CacheLane startup). Confirm:
```bash
lsof -nP -iTCP:7332 -sTCP:LISTEN
```
Expected: a node process listening again on 127.0.0.1:7332, running the new build.

- [ ] **Step 7: Generate a few Bedrock turns and verify proxy rows now land**

Run a short Claude Code interaction on Bedrock (the user's normal workflow — a few turns in a session that exercises tool calls so blocks accumulate past K=2). Then:
```bash
sqlite3 -header ~/.cachelane/cachelane.db \
  "SELECT signals, COUNT(*) FROM turns GROUP BY signals;"
sqlite3 -header ~/.cachelane/cachelane.db \
  "SELECT turn_number, pruned_blocks_count, prefix_breakpoint_hash IS NOT NULL AS has_prefix, signals \
   FROM turns ORDER BY created_at DESC LIMIT 8;"
sqlite3 ~/.cachelane/cachelane.db "SELECT COUNT(*) FROM turn_explanations;"
```
Expected, for the NEW turns (created after restart):
- `signals` shows proxy signals (e.g. `["prefix_cached"]` or similar), NOT `["mode:hook"]`.
- At least some turns have `pruned_blocks_count > 0` once a session runs past K=2 turns with idle tool results.
- `has_prefix = 1` (proxy-only field is now populated).
- `turn_explanations` row count is now > 0.

- [ ] **Step 8: Confirm the dashboard reflects pruning**

Run the live benchmark dashboard the user normally uses and confirm `Pruned blocks` is now > 0 for the new session and `Keepalive pings` populates when applicable.

Expected: dashboard `Pruned blocks` counter increases on the new turns. If it still reads 0 for proxy-recorded turns, that is a NEW finding — root-cause it (systematic-debugging) rather than declaring done.

- [ ] **Step 9: Document the outcome (no code commit needed)**

Record in the branch's final summary: applied migrations, before/after `signals` distribution, and the first observed `pruned_blocks_count > 0` proxy turn. This is the evidence that the fix works end-to-end.

---

## Self-Review

**Spec coverage:**
- Recorder collision (hook vs proxy) → Task 1 (gate hook) + Task 2 (upsert guard). ✅
- Stale deployment / frozen migrations → Task 3 (redeploy + migrate). ✅
- Verification that savings reach the dashboard → Task 3 Steps 7–8. ✅
- "Proxy-only on Bedrock" decision → Task 1 gate implements exactly this; safe because 100% of the user's Bedrock traffic transits the loopback proxy. ✅

**Placeholder scan:** No TBD/“add error handling”/“similar to Task N”. Code shown in full for each code step. Two explicit "confirm the real method name / real env" notes are verification instructions, not placeholders. ✅

**Type consistency:** `proxyIsActiveRecorder(env)` used identically in Task 1 Steps 3 & 5. `insertTurn` row shape in Task 2 matches the existing `insertTurnStmt` named params (`@provider`, `@cache_write_tokens`, etc. from data-access.ts:285-289). Accessor names in Task 2 Step 1 are flagged for confirmation against the real storage API before running. ✅

**Known risk flagged for reviewer:** Task 2's upsert updates `id = excluded.id`; since `id` is the PRIMARY KEY, this is safe only under unique ids (proxy uses randomUUID). Documented inline; do not suppress a genuine duplicate-id error.
