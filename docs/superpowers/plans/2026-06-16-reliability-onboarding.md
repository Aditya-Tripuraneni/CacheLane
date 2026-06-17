# Reliability & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CacheLane verifiably working: chain-aware `doctor` checks (upstream detection + reachability probe + cache-read sanity + fail-open rate) and a `cachelane verify` self-test that proves the pipeline mutates and rehydrates losslessly.

**Architecture:** Extend `src/cli/doctor.ts` with config-aware and DB-aware checks (probe gated behind `--probe`); add a pure `src/cli/verify.ts` that runs the in-process pipeline against a synthetic request and asserts mutate + stub + rehydrate + fail-open. Reuse the exact fallback-rate logic from `src/server/health.ts` so doctor and the MCP health tool agree.

**Tech Stack:** TypeScript, vitest, `node:net` (TCP probe), better-sqlite3. Reuses `loadConfig`, `getRecentTurnExplanations`, `getStats`, the orchestrator pipeline, `pruneExpiredBlocks`, `expandStub`. Node 20.

**Spec:** [docs/superpowers/specs/2026-06-16-reliability-onboarding-design.md](../specs/2026-06-16-reliability-onboarding-design.md)

---

## File Structure

- Modify: `src/cli/doctor.ts` — add `upstream`, `upstream_reachable`, `cache_reads`, `fallback_rate` checks; add `--probe` plumbing.
- Create: `src/cli/verify.ts` — `runVerify(opts)` offline self-test.
- Modify: `src/cli/index.ts` — add `--probe` to `doctor`; add `cachelane verify` command.
- Modify: `src/cli/__tests__/doctor`/`verify` tests.
- Create: `src/cli/__tests__/verify.test.ts`.
- Modify: `README.md` — chaining section adds `doctor --probe` guidance.

### Ground-truth facts (verified in code)

- `runDoctor(env)` (`src/cli/doctor.ts:25`) builds `DoctorCheck[]` and returns `{ ok, checks }`. Currently checks node/config/database/mcp/hooks/data.
- `config.proxy` fields: `upstream_host, upstream_port, upstream_ssl, upstream_path_prefix` (`src/types/index.ts:74`); defaults `api.anthropic.com:443 ssl` (`config/defaults.ts:31`).
- `config.health`: `fallback_warning_threshold_pct` (default 5), `fallback_window_turns` (default 20).
- Fallback logic in `src/server/health.ts:13` — fraction of `!ex.mutated` over recent `getRecentTurnExplanations` ; `> 0.05` ⇒ degraded.
- `loadConfig(configPath)` from `src/config/index.ts`; `cachelaneConfigPath(env)`, `cachelaneDbPath(env)` from `src/cli/paths.ts`.
- Existing local-server test fixture pattern: `src/proxy/__tests__/helpers/cache-sim-upstream.ts`.

---

## Task 1: Refactor doctor to accept options + config

**Files:**
- Modify: `src/cli/doctor.ts`
- Test: `src/cli/__tests__/` (existing doctor test, if present, else cli.test.ts)

- [ ] **Step 1: Write a failing test for the new `upstream` check (default upstream)**

Create/extend `src/cli/__tests__/doctor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runDoctor } from "../doctor.js";

describe("doctor upstream check", () => {
  it("reports default upstream as ok without probing", () => {
    const report = runDoctor(process.env, { probe: false });
    const upstream = report.checks.find((c) => c.name === "upstream");
    expect(upstream).toBeDefined();
    expect(upstream!.ok).toBe(true);
    expect(upstream!.detail).toContain("default");
    // no probe attempted by default
    expect(report.checks.find((c) => c.name === "upstream_reachable")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/cli/__tests__/doctor.test.ts`
Expected: FAIL — `runDoctor` takes one arg / no `upstream` check.

- [ ] **Step 3: Add options param + upstream check**

Modify `src/cli/doctor.ts`. Add an options interface and the upstream check. Replace the `runDoctor` signature and append the check before the `return`:

```ts
export interface DoctorOptions {
  probe?: boolean;
}

export function runDoctor(
  env: NodeJS.ProcessEnv = process.env,
  options: DoctorOptions = {},
): DoctorReport {
  const checks: DoctorCheck[] = [];
  const configPath = cachelaneConfigPath(env);
  const dbPath = cachelaneDbPath(env);
  // ... existing node/config/database/mcp/hooks/data checks unchanged ...
```

After the existing checks (before computing `ok`), add:

```ts
  // Upstream / chaining awareness.
  let upstreamConfig: { host: string; port: number; ssl: boolean } | null = null;
  try {
    const config = loadConfig(configPath);
    upstreamConfig = {
      host: config.proxy.upstream_host,
      port: config.proxy.upstream_port,
      ssl: config.proxy.upstream_ssl,
    };
  } catch {
    upstreamConfig = null;
  }

  if (upstreamConfig) {
    const isDefault =
      upstreamConfig.host === "api.anthropic.com" &&
      upstreamConfig.port === 443 &&
      upstreamConfig.ssl === true;
    checks.push({
      name: "upstream",
      ok: true,
      detail: isDefault
        ? "default (api.anthropic.com)"
        : `chained → ${upstreamConfig.host}:${upstreamConfig.port} (${upstreamConfig.ssl ? "https" : "http"})`,
    });
  }
```

Make sure `loadConfig` is imported (it already is at the top of `doctor.ts`).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/cli/__tests__/doctor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/doctor.ts src/cli/__tests__/doctor.test.ts
git commit -m "feat(doctor): upstream/chaining awareness check"
```

---

## Task 2: Reachability probe (gated on --probe)

**Files:**
- Modify: `src/cli/doctor.ts`
- Test: `src/cli/__tests__/doctor.test.ts`

- [ ] **Step 1: Write the failing test (probe a reachable + unreachable port)**

Append to `src/cli/__tests__/doctor.test.ts`:

```ts
import net from "node:net";
import { probeUpstream } from "../doctor.js";

describe("probeUpstream", () => {
  it("resolves ok=true for a reachable port", async () => {
    const server = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as net.AddressInfo).port;
    const result = await probeUpstream("127.0.0.1", port, 1000);
    server.close();
    expect(result.ok).toBe(true);
  });

  it("resolves ok=false for an unreachable port", async () => {
    const result = await probeUpstream("127.0.0.1", 1, 500);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/cli/__tests__/doctor.test.ts`
Expected: FAIL — `probeUpstream` not exported.

- [ ] **Step 3: Implement probeUpstream + wire into runDoctor (async)**

Add to `src/cli/doctor.ts` (import `net` at top: `import net from "node:net";`):

```ts
export function probeUpstream(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean, detail: string) => {
      socket.destroy();
      resolve({ ok, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true, `reachable ${host}:${port}`));
    socket.once("timeout", () => done(false, `timeout connecting ${host}:${port}`));
    socket.once("error", (err) => done(false, err.message));
    socket.connect(port, host);
  });
}
```

Because the probe is async, add a separate async wrapper rather than changing `runDoctor` to async (keeps existing sync callers working). Add:

```ts
export async function runDoctorAsync(
  env: NodeJS.ProcessEnv = process.env,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const report = runDoctor(env, options);
  if (!options.probe) return report;

  try {
    const config = loadConfig(cachelaneConfigPath(env));
    const isDefault =
      config.proxy.upstream_host === "api.anthropic.com" &&
      config.proxy.upstream_port === 443 &&
      config.proxy.upstream_ssl === true;
    // Only probe a non-default (chained) upstream; the default Anthropic host
    // is assumed reachable and we avoid an outbound connection on plain doctor.
    if (!isDefault) {
      const probe = await probeUpstream(
        config.proxy.upstream_host,
        config.proxy.upstream_port,
        2000,
      );
      report.checks.push({ name: "upstream_reachable", ok: probe.ok, detail: probe.detail });
    }
  } catch {
    // fail-open: a probe failure is a warning, never a crash
  }

  report.ok = report.checks.every((c) => c.ok);
  return report;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/cli/__tests__/doctor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/doctor.ts src/cli/__tests__/doctor.test.ts
git commit -m "feat(doctor): TCP reachability probe for chained upstream (--probe)"
```

---

## Task 3: Cache-reads + fail-open-rate checks (shared with health.ts)

**Files:**
- Modify: `src/cli/doctor.ts`
- Modify: `src/server/health.ts` (extract shared fallback computation)
- Test: `src/cli/__tests__/doctor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/cli/__tests__/doctor.test.ts`:

```ts
import { computeFallbackRate } from "../doctor.js";

describe("computeFallbackRate", () => {
  it("matches health.ts threshold semantics", () => {
    const explanations = [
      { mutated: true }, { mutated: true }, { mutated: false },
    ] as { mutated: boolean }[];
    const { fallback_count, total, fraction } = computeFallbackRate(explanations);
    expect(fallback_count).toBe(1);
    expect(total).toBe(3);
    expect(fraction).toBeCloseTo(1 / 3, 5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/cli/__tests__/doctor.test.ts`
Expected: FAIL — `computeFallbackRate` not exported.

- [ ] **Step 3: Implement the shared computation + DB checks**

Add to `src/cli/doctor.ts`:

```ts
export function computeFallbackRate(
  explanations: { mutated: boolean }[],
): { fallback_count: number; total: number; fraction: number } {
  const total = explanations.length;
  const fallback_count = explanations.filter((e) => !e.mutated).length;
  return { fallback_count, total, fraction: total === 0 ? 0 : fallback_count / total };
}
```

Refactor `src/server/health.ts` to use it (import from `../cli/doctor.js`), replacing its inline `fallbackCount`/`fallbackPercentage` with `computeFallbackRate(recentExplanations)`. Keep the `> 0.05` threshold and the same `explanation` text. This guarantees doctor and the MCP health tool agree.

Then extend `runDoctorAsync` to add the two DB-backed checks (open the DB read-only, fail-open):

```ts
  try {
    const config = loadConfig(cachelaneConfigPath(env));
    const db = openDatabase(cachelaneDbPath(env));
    try {
      const workspaceId =
        env.CACHELANE_WORKSPACE_ID && env.CACHELANE_WORKSPACE_ID.length > 0
          ? env.CACHELANE_WORKSPACE_ID
          : undefined;
      const recent = db.getRecentTurnExplanations({
        workspace_id: workspaceId ?? "default",
        limit: config.health.fallback_window_turns,
      });
      const { fallback_count, total, fraction } = computeFallbackRate(recent);
      const thresholdFrac = config.health.fallback_warning_threshold_pct / 100;
      report.checks.push({
        name: "fallback_rate",
        ok: fraction <= thresholdFrac,
        detail: `${fallback_count} of last ${total} turns failed open (${(fraction * 100).toFixed(1)}%)`,
      });

      const stats = db.getStats({ scope: "workspace", workspace_id: workspaceId ?? "default" });
      const cacheReadsOk = stats.turns < 3 || stats.cache_hit_ratio > 0;
      report.checks.push({
        name: "cache_reads",
        ok: cacheReadsOk,
        detail: cacheReadsOk
          ? `cache hit ratio ${(stats.cache_hit_ratio * 100).toFixed(1)}%`
          : `cache reads ~0 over ${stats.turns} turns — a chained proxy may be stripping cacheable content`,
      });
    } finally {
      db.close();
    }
  } catch {
    // fail-open
  }

  report.ok = report.checks.every((c) => c.ok);
  return report;
```

(Place these before the final `report.ok = ...; return report;` — consolidate into one recompute at the end.) Import `openDatabase` from `../storage/index.js`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/cli/__tests__/doctor.test.ts src/server/__tests__/health.test.ts`
Expected: PASS (health tests still pass with the refactor).

- [ ] **Step 5: Commit**

```bash
git add src/cli/doctor.ts src/server/health.ts src/cli/__tests__/doctor.test.ts
git commit -m "feat(doctor): fail-open rate + cache-reads checks (shared with health)"
```

---

## Task 4: Wire --probe into the CLI doctor command

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Update the doctor command to use runDoctorAsync + --probe**

Replace the existing `doctor` command action in `src/cli/index.ts`:

```ts
  program
    .command("doctor")
    .description("Check local CacheLane installation health")
    .option("--json", "Print stable JSON")
    .option("--probe", "Probe a chained upstream's reachability (outbound connection)")
    .action(async (cmd: JsonCommandOptions & { probe?: boolean }) => {
      const { runDoctorAsync, formatDoctor } = await import("./doctor.js");
      const report = await runDoctorAsync(env, { probe: Boolean(cmd.probe) });
      io.stdout(cmd.json ? jsonLine(report) : `${formatDoctor(report)}\n`);
    });
```

(`formatDoctor` already renders any `DoctorCheck[]`, so the new checks display automatically.)

- [ ] **Step 2: Verify compile + existing CLI tests**

Run: `npx tsc --noEmit && npx vitest run src/cli/__tests__/cli.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): doctor --probe flag"
```

---

## Task 5: `cachelane verify` offline self-test

**Files:**
- Create: `src/cli/verify.ts`
- Test: `src/cli/__tests__/verify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/cli/__tests__/verify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runVerify } from "../verify.js";

describe("runVerify (offline)", () => {
  it("passes all core checks on a healthy synthetic session", () => {
    const report = runVerify();
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c.ok]));
    expect(byName["mutates"]).toBe(true);
    expect(byName["stubs"]).toBe(true);
    expect(byName["rehydrates"]).toBe(true);
    expect(byName["fail_open"]).toBe(true);
    expect(report.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/cli/__tests__/verify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement verify.ts**

Create `src/cli/verify.ts`. It seeds an in-memory DB, runs the real pipeline on a synthetic 2-message request, then a multi-turn idle to force a stub, then `expandStub`, then an injected-error fail-open check.

```ts
import { createHash } from "node:crypto";
import { openDatabase } from "../storage/index.js";
import { handlePreRequest } from "../hooks/pre-request.js";
import { CacheStateTracker } from "../orchestrator/index.js";
import { pruneExpiredBlocks, expandStub } from "../pruner/index.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";

export interface VerifyCheck { name: string; ok: boolean; detail: string }
export interface VerifyReport { ok: boolean; checks: VerifyCheck[] }

const WS = "verify-ws";
const SESSION = "verify-session";

export function runVerify(): VerifyReport {
  const checks: VerifyCheck[] = [];
  const db = openDatabase(":memory:");
  const tracker = new CacheStateTracker();
  try {
    // 1) mutate: a request with a system prompt + tools should place breakpoints.
    const request = {
      model: "claude-opus-4-7",
      system: [{ type: "text" as const, text: "You are a helpful assistant." }],
      tools: [{ name: "Read", description: "read a file", input_schema: { type: "object" } }],
      messages: [{ role: "user" as const, content: "hello" }],
    };
    const classifications = [{ kind: "user_message" as const, volatility: "VOLATILE" as const, isPinned: false, signals: [] }];
    const result = handlePreRequest({
      db, tracker, workspace_id: WS, session_id: SESSION, current_turn: 1,
      original_request: request as never, message_classifications: classifications as never,
      block_placements: [], pruner: DEFAULT_CONFIG.pruner,
    });
    checks.push({ name: "mutates", ok: result.mutated, detail: result.mutated ? "breakpoints placed" : "no mutation" });

    // 2) stub: insert a tool_output block at turn 1, prune at turn 5 (age >= K=3).
    const blockId = "verifyaa";
    db.insertBlock({
      id: blockId, workspace_id: WS, session_id: SESSION, content_hash: createHash("sha256").update("data").digest("hex"),
      kind: "tool_output", volatility: "VOLATILE", is_pinned: false, token_count: 10,
      added_at_turn: 1, last_referenced_at_turn: 1, unused_turns: 0, is_stub: false,
      stub_summary: null, refetch_handle: JSON.stringify({ type: "tool_use", id: blockId }),
      restored_at_turn: null, created_at: 1, updated_at: 1,
    });
    const prune = pruneExpiredBlocks(db, { workspace_id: WS, session_id: SESSION, k: 3, current_turn: 5, enabled: true });
    const stubbed = prune.pruned_blocks_count >= 1;
    checks.push({ name: "stubs", ok: stubbed, detail: stubbed ? "idle block stubbed at K=3" : "no stub produced" });

    // 3) rehydrate: expandStub returns ok with a refetch handle.
    const expand = expandStub(db, { workspace_id: WS, session_id: SESSION, block_id: blockId, turn_number: 6, updated_at: 6 });
    checks.push({ name: "rehydrates", ok: expand.ok, detail: expand.ok ? "stub rehydrated via cachelane_expand" : `expand failed: ${expand.ok === false ? expand.error.code : ""}` });

    // 4) fail-open: a malformed classification length must return unmutated.
    const failOpen = handlePreRequest({
      db, tracker, workspace_id: WS, session_id: SESSION, current_turn: 7,
      original_request: request as never,
      message_classifications: [] as never, // length mismatch => fail open
      block_placements: [], pruner: DEFAULT_CONFIG.pruner,
    });
    const failedOpen = failOpen.mutated === false && failOpen.signals.includes("error:fallback");
    checks.push({ name: "fail_open", ok: failedOpen, detail: failedOpen ? "returns unmutated request on error" : "did not fail open" });

    return { ok: checks.every((c) => c.ok), checks };
  } finally {
    db.close();
  }
}

export function formatVerify(report: VerifyReport): string {
  const lines = report.checks.map((c) => `  ${c.ok ? "ok " : "FAIL"} ${c.name}: ${c.detail}`);
  lines.push(report.ok
    ? "→ CacheLane core is working. Run `cachelane verify --live` to confirm cache reads."
    : "→ Some checks failed. Run `cachelane doctor` for installation health.");
  return lines.join("\n");
}
```

Note for executor: confirm the exact `Classification` shape and `handlePreRequest` input field names against `src/hooks/pre-request.ts` (uses `message_classifications`, `block_placements`, `pruner`, `current_turn`). Adjust the `as never` casts to the real exported types (`Classification[]`, `PromptBlockPlacement[]`) — they are exported from `src/classifier` and `src/pruner`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/cli/__tests__/verify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/verify.ts src/cli/__tests__/verify.test.ts
git commit -m "feat(cli): cachelane verify offline self-test"
```

---

## Task 6: Wire `verify` command into CLI

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add the command**

Insert into `createCachelaneCli` (near the `doctor` command):

```ts
  program
    .command("verify")
    .description("Self-test that the CacheLane pipeline mutates, stubs, and rehydrates losslessly")
    .option("--json", "Print stable JSON")
    .action(async (cmd: JsonCommandOptions) => {
      const { runVerify, formatVerify } = await import("./verify.js");
      const report = runVerify();
      io.stdout(cmd.json ? jsonLine(report) : `${formatVerify(report)}\n`);
      if (!report.ok) process.exitCode = 1;
    });
```

(`--live` mode is roadmap; this task ships the offline self-test only, per spec §2 tier 1.)

- [ ] **Step 2: Compile + smoke test**

Run: `npx tsc --noEmit`
Expected: PASS.

Add to `src/cli/__tests__/cli.test.ts`:

```ts
it("verify --json reports ok true on a healthy pipeline", async () => {
  const out: string[] = [];
  const program = createCachelaneCli({ env: process.env, io: { stdout: (t) => out.push(t), stderr: () => {} } });
  await program.parseAsync(["node", "cachelane", "verify", "--json"]);
  const report = JSON.parse(out.join(""));
  expect(report.ok).toBe(true);
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/cli/__tests__/cli.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts src/cli/__tests__/cli.test.ts
git commit -m "feat(cli): cachelane verify command"
```

---

## Task 7: README chaining guidance

**Files:**
- Modify: `README.md` (chaining section, around line 321)

- [ ] **Step 1: Add a verification line**

In the "Chaining with another proxy" section, after the caveats paragraph, add:

```markdown
**Verify the chain is healthy:** after wiring two proxies together, run
`cachelane doctor --probe` to confirm CacheLane's configured upstream is reachable and that
cache reads are still firing. If `cache_reads` warns that reads dropped to ~0, the other layer
may be stripping content CacheLane needs to cache — see the caveats above.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: chaining verification via doctor --probe"
```

---

## Task 8: Full verification

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual smoke**

Run: `npx tsx src/cli/index.ts verify` then `npx tsx src/cli/index.ts doctor`
Expected: verify prints a green checklist; doctor prints checks incl. `upstream`, `fallback_rate`, `cache_reads`.

- [ ] **Step 4: Paste output, then mark done.**

---

## Self-review notes

- **Spec coverage:** chain-aware doctor — upstream (Task 1), reachability probe (Task 2), cache_reads + fallback_rate (Task 3), `--probe` wiring (Task 4); verify offline self-test with 4 checks incl. fail-open (Task 5–6); fail-open visibility via the `fallback_rate` doctor check + shared `computeFallbackRate` (Task 3); README (Task 7). `--live` verify explicitly deferred to roadmap per spec. ✅
- **Type consistency:** `DoctorOptions`, `runDoctorAsync`, `probeUpstream`, `computeFallbackRate` introduced in Tasks 1–3 and reused unchanged. `VerifyReport`/`VerifyCheck`/`runVerify`/`formatVerify` stable across Tasks 5–6. `formatDoctor` already renders arbitrary checks — no change needed. ✅
- **Shared logic:** `computeFallbackRate` is the single source for both `doctor` and `server/health.ts` (Task 3 refactors health to use it), preventing drift. ✅
- **Fail-open:** every new probe/DB read is wrapped so doctor never throws. ✅
- **Open item for executor:** verify the precise `handlePreRequest` input types and `Classification` shape (Task 5 note) and replace `as never` casts with the real exported types.
