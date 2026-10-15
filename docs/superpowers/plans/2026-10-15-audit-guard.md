# CacheLane Audit + Cold-Cache Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `cachelane-audit`, a zero-dependency npm CLI that explains Claude Code cache rebuilds from local transcripts, plus a Claude Code plugin whose hooks block once before an expensive cold-cache rebuild.

**Architecture:**
- **Code:** TypeScript in `packages/audit/src`. Small pure modules (parse, classify, cost, report, guard), wrapped by thin hook and CLI layers.
- **Build:** tsup bundles `cli.ts` into one ESM file. The build copies that file into `plugin/bin/`, so the plugin runs it with `node` and never calls `npx`.
- **Tests:** root vitest picks up `packages/audit/src/__tests__`.

**Tech Stack:** Node 18+ stdlib only (runtime). TypeScript, tsup, vitest (dev, already at repo root).

**Spec:** `docs/superpowers/specs/2026-10-15-cachelane-audit-guard-design.md`

## Global Constraints

- Runtime dependencies: none. Only `node:*` imports in `packages/audit/src` outside tests.
- Node floor: `"engines": { "node": ">=18" }`. Tsup `target: "node18"`. Root tsconfig `lib` is ES2022, so don't use `Array.prototype.findLast`.
- Read usage metadata only. Never print or store prompt text. Prompts are stored only as sha256 fingerprints.
- Fail open. Every hook path returns allow (empty stdout, exit 0) on any error, a missing file, or more than 5 s elapsed.
- Rebuild rule: `write > 20_000` and `read < 0.5 * (prev.read + prev.write)` on the main chain.
- Cause order: `idle_expired`, `model_switch`, `compaction`, `proxy_stripped`, `prefix_changed`.
- Multipliers: write 1.25 (5m) / 2.0 (1h). Read = model read price / input price, default 0.1.
- Guard defaults: threshold 150_000 tokens, resubmit window 120_000 ms, compact summary estimate 40_000 tokens.
- Dollar figures are always labeled "at API price".
- No em dashes in user-facing strings or docs.

## File Map

| File | Responsibility |
|---|---|
| `packages/audit/package.json`, `tsconfig.json`, `tsup.config.ts`, `README.md` | Package metadata, type-check config, bundle + copy to plugin, npm readme |
| `packages/audit/src/types.ts` | `ApiCall`, `Session`, `Cause`, `Rebuild` |
| `packages/audit/src/parse.ts` | `parseSession(file, text?)`: transcript JSONL to `Session` |
| `packages/audit/src/classify.ts` | `written`, `contextOf`, `hitRatio`, `classifyRebuilds` |
| `packages/audit/src/prices.ts`, `cost.ts` | Price table, `priceFor`, `readMultiplier`, `units`, `writeUnits`, `toDollars` |
| `packages/audit/src/report.ts` | `findTranscripts`, `buildReport`, `renderText` |
| `packages/audit/src/guard.ts` | `loadState`, `saveState`, `resolveTtlMs`, `guardDecision` |
| `packages/audit/src/hooks.ts` | `promptHook`, `stopHook`, `defaultDeps` |
| `packages/audit/src/cli.ts` | argv/stdin wiring |
| `packages/audit/src/__tests__/*.test.ts`, `fixtures/*.jsonl` | Tests and synthetic transcripts |
| `plugin/.claude-plugin/plugin.json`, `plugin/hooks/hooks.json`, `plugin/commands/audit.md`, `plugin/bin/cachelane-audit.mjs` | Claude Code plugin (the bin is a build output, committed) |
| `.claude-plugin/marketplace.json` | Marketplace entry for `/plugin marketplace add` |
| root `package.json` | Add `build:audit`, `typecheck:audit` scripts |

---

### Task 1: Package scaffold, types, transcript parser

**Files:**
- Create: `packages/audit/package.json`, `packages/audit/tsconfig.json`, `packages/audit/src/types.ts`, `packages/audit/src/parse.ts`
- Create: `packages/audit/src/__tests__/fixtures/{idle,model-switch,compaction,prefix}.jsonl`
- Test: `packages/audit/src/__tests__/parse.test.ts`
- Modify: root `package.json` scripts

**Interfaces:**
- Produces:
  - `parseSession(file: string, text?: string): Session`
  - The types `ApiCall {id, model, ts, input, read, write5m, write1h}`, `Session {sessionId, project, calls, sidechainCalls, compactAt}`, `Cause`, and `Rebuild {call, prev, gapMs, cause}`

- [ ] **Step 1: Scaffold package files**

`packages/audit/package.json`:
```json
{
  "name": "cachelane-audit",
  "version": "0.1.0",
  "description": "See where your Claude Code input tokens went and why the prompt cache rebuilt. Zero dependencies.",
  "license": "Apache-2.0",
  "type": "module",
  "bin": { "cachelane-audit": "dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "repository": { "type": "git", "url": "git+https://github.com/Aditya-Tripuraneni/CacheLane.git", "directory": "packages/audit" },
  "keywords": ["claude-code", "prompt-caching", "anthropic", "tokens", "cost"]
}
```

`packages/audit/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "rootDir": "src", "noEmit": true },
  "include": ["src"]
}
```

Root `package.json` scripts, added after `"build"`:
```json
"build:audit": "tsup --config packages/audit/tsup.config.ts",
"typecheck:audit": "tsc -p packages/audit/tsconfig.json",
```

`packages/audit/src/types.ts`:
```ts
export type Cause = "idle_expired" | "model_switch" | "compaction" | "proxy_stripped" | "prefix_changed";

/** One de-duplicated API call from a Claude Code transcript (usage metadata only). */
export interface ApiCall {
  id: string;
  model: string;
  ts: number;
  input: number;
  read: number;
  write5m: number;
  write1h: number;
}

export interface Session {
  sessionId: string;
  project: string;
  calls: ApiCall[];
  sidechainCalls: ApiCall[];
  compactAt: number[];
}

export interface Rebuild {
  call: ApiCall;
  prev: ApiCall;
  gapMs: number;
  cause: Cause;
}
```

- [ ] **Step 2: Write fixtures** (one JSON object per line, real transcript shape)

`fixtures/idle.jsonl`. It contains a duplicate streamed chunk (m2), a sidechain call, a `<synthetic>` entry, and m3 two hours later:
```
{"type":"user","sessionId":"sess-idle","timestamp":"2026-10-01T09:59:59.000Z","message":{"role":"user","content":"hi"}}
{"type":"assistant","sessionId":"sess-idle","timestamp":"2026-10-01T10:00:00.000Z","isSidechain":false,"message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":5,"cache_read_input_tokens":0,"cache_creation_input_tokens":100000,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":100000}}}}
{"type":"assistant","sessionId":"sess-idle","timestamp":"2026-10-01T10:01:00.000Z","isSidechain":false,"message":{"id":"m2","model":"claude-opus-5-5","usage":{"input_tokens":3,"cache_read_input_tokens":100000,"cache_creation_input_tokens":2000,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":2000}}}}
{"type":"assistant","sessionId":"sess-idle","timestamp":"2026-10-01T10:01:00.000Z","isSidechain":false,"message":{"id":"m2","model":"claude-opus-5-5","usage":{"input_tokens":3,"cache_read_input_tokens":100000,"cache_creation_input_tokens":2000,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":2000}}}}
{"type":"assistant","sessionId":"sess-idle","timestamp":"2026-10-01T10:01:30.000Z","isSidechain":true,"message":{"id":"s1","model":"claude-opus-5-5","usage":{"input_tokens":2,"cache_read_input_tokens":0,"cache_creation_input_tokens":30000,"cache_creation":{"ephemeral_5m_input_tokens":30000,"ephemeral_1h_input_tokens":0}}}}
{"type":"assistant","sessionId":"sess-idle","timestamp":"2026-10-01T10:01:40.000Z","message":{"id":"syn1","model":"<synthetic>","usage":{"input_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}
{"type":"assistant","sessionId":"sess-idle","timestamp":"2026-10-01T12:01:00.000Z","isSidechain":false,"message":{"id":"m3","model":"claude-opus-5-5","usage":{"input_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":102000,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":102000}}}}
```

`fixtures/model-switch.jsonl`:
```
{"type":"assistant","sessionId":"sess-model","timestamp":"2026-10-01T10:00:00.000Z","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":5,"cache_read_input_tokens":0,"cache_creation_input_tokens":100000,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":100000}}}}
{"type":"assistant","sessionId":"sess-model","timestamp":"2026-10-01T10:01:00.000Z","message":{"id":"m2","model":"claude-opus-5-5","usage":{"input_tokens":3,"cache_read_input_tokens":100000,"cache_creation_input_tokens":2000,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":2000}}}}
{"type":"assistant","sessionId":"sess-model","timestamp":"2026-10-01T10:02:00.000Z","message":{"id":"m3","model":"claude-sonnet-5-5","usage":{"input_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":102000,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":102000}}}}
```

`fixtures/compaction.jsonl`:
```
{"type":"assistant","sessionId":"sess-compact","timestamp":"2026-10-01T10:00:00.000Z","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":5,"cache_read_input_tokens":0,"cache_creation_input_tokens":100000,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":100000}}}}
{"type":"assistant","sessionId":"sess-compact","timestamp":"2026-10-01T10:01:00.000Z","message":{"id":"m2","model":"claude-opus-5-5","usage":{"input_tokens":3,"cache_read_input_tokens":100000,"cache_creation_input_tokens":2000,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":2000}}}}
{"type":"system","subtype":"compact_boundary","sessionId":"sess-compact","timestamp":"2026-10-01T10:01:30.000Z","compactMetadata":{"trigger":"manual","preTokens":102000}}
{"type":"assistant","sessionId":"sess-compact","timestamp":"2026-10-01T10:02:00.000Z","message":{"id":"m3","model":"claude-opus-5-5","usage":{"input_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":30000,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":30000}}}}
```

`fixtures/prefix.jsonl`:
```
{"type":"assistant","sessionId":"sess-prefix","timestamp":"2026-10-01T10:00:00.000Z","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":5,"cache_read_input_tokens":0,"cache_creation_input_tokens":100000,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":100000}}}}
{"type":"assistant","sessionId":"sess-prefix","timestamp":"2026-10-01T10:01:00.000Z","message":{"id":"m2","model":"claude-opus-5-5","usage":{"input_tokens":3,"cache_read_input_tokens":100000,"cache_creation_input_tokens":2000,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":2000}}}}
{"type":"assistant","sessionId":"sess-prefix","timestamp":"2026-10-01T10:02:00.000Z","message":{"id":"m3","model":"claude-opus-5-5","usage":{"input_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":102000,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":102000}}}}
```

- [ ] **Step 3: Write the failing test.** First add the shared helper `packages/audit/src/__tests__/fixture.ts`:
```ts
import { fileURLToPath } from "node:url";

export const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}.jsonl`, import.meta.url));
```

Then `packages/audit/src/__tests__/parse.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseSession } from "../parse.js";
import { fixture } from "./fixture.js";

describe("parseSession", () => {
  const s = parseSession(fixture("idle"));

  it("de-duplicates streamed chunks by message id", () => {
    expect(s.calls.map((c) => c.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("separates sidechain calls and drops <synthetic> entries", () => {
    expect(s.sidechainCalls.map((c) => c.id)).toEqual(["s1"]);
  });

  it("reads the nested 5m/1h cache-write split", () => {
    expect(s.calls[0]).toMatchObject({ write1h: 100000, write5m: 0, read: 0, input: 5 });
  });

  it("falls back to the flat total as 5m when the split is absent", () => {
    const line = JSON.stringify({ type: "assistant", timestamp: "2026-10-01T10:00:00.000Z",
      message: { id: "x", model: "claude-opus-5-5", usage: { input_tokens: 1, cache_creation_input_tokens: 500 } } });
    expect(parseSession("/p/proj/s.jsonl", line).calls[0]).toMatchObject({ write5m: 500, write1h: 0 });
  });

  it("records compact_boundary timestamps", () => {
    expect(parseSession(fixture("compaction")).compactAt).toEqual([Date.parse("2026-10-01T10:01:30.000Z")]);
  });

  it("takes session id from entries and project from the directory name", () => {
    expect(s.sessionId).toBe("sess-idle");
    expect(s.project).toBe("fixtures");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run packages/audit/src/__tests__/parse.test.ts`
Expected: FAIL, cannot resolve `../parse.js`.

- [ ] **Step 5: Implement** `packages/audit/src/parse.ts`
```ts
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { ApiCall, Session } from "./types.js";

type Usage = {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};

type Entry = {
  type?: string;
  subtype?: string;
  sessionId?: string;
  timestamp?: string;
  isSidechain?: boolean;
  message?: { id?: string; model?: string; usage?: Usage };
};

export function parseSession(file: string, text: string = readFileSync(file, "utf8")): Session {
  const main = new Map<string, ApiCall>();
  const side = new Map<string, ApiCall>();
  const compactAt: number[] = [];
  let sessionId = basename(file, ".jsonl");

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e: Entry;
    try {
      e = JSON.parse(line) as Entry;
    } catch {
      continue;
    }
    if (e.sessionId) sessionId = e.sessionId;
    const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (e.type === "system" && e.subtype === "compact_boundary" && !Number.isNaN(ts)) {
      compactAt.push(ts);
      continue;
    }
    const m = e.message;
    if (e.type !== "assistant" || !m?.usage || !m.id || m.model === "<synthetic>" || Number.isNaN(ts)) continue;
    const u = m.usage;
    const split = u.cache_creation;
    const call: ApiCall = {
      id: m.id,
      model: m.model ?? "unknown",
      ts,
      input: u.input_tokens ?? 0,
      read: u.cache_read_input_tokens ?? 0,
      // The 5m/1h split is nested; the flat total is a 5m fallback when it is absent.
      write5m: split ? (split.ephemeral_5m_input_tokens ?? 0) : (u.cache_creation_input_tokens ?? 0),
      write1h: split?.ephemeral_1h_input_tokens ?? 0,
    };
    // Streamed responses repeat the same message id; keep the last entry.
    (e.isSidechain ? side : main).set(call.id, call);
  }

  const byTs = (a: ApiCall, b: ApiCall) => a.ts - b.ts;
  return {
    sessionId,
    project: basename(dirname(file)),
    calls: [...main.values()].sort(byTs),
    sidechainCalls: [...side.values()].sort(byTs),
    compactAt: compactAt.sort((a, b) => a - b),
  };
}
```

- [ ] **Step 6: Run tests and type-check.** `npx vitest run packages/audit` should PASS (6). `npm run typecheck:audit` should exit 0.

- [ ] **Step 7: Commit** `git add packages/audit package.json && git commit -m "feat(audit): package scaffold and transcript parser"`

---

### Task 2: Rebuild detection and cause classification

**Files:**
- Create: `packages/audit/src/classify.ts`
- Test: `packages/audit/src/__tests__/classify.test.ts`

**Interfaces:**
- Consumes: `parseSession`, `ApiCall`, `Session`, `Rebuild`
- Produces:
  - `written(c: ApiCall): number`
  - `contextOf(c: ApiCall): number`
  - `hitRatio(calls: ApiCall[]): number`
  - `classifyRebuilds(s: Session, baseUrlSet: boolean): Rebuild[]`
  - `REBUILD_MIN_WRITE`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { classifyRebuilds, hitRatio } from "../classify.js";
import { parseSession } from "../parse.js";
import { fixture } from "./fixture.js";

describe("classifyRebuilds", () => {
  it.each([
    ["idle", false, "idle_expired"],
    ["model-switch", false, "model_switch"],
    ["compaction", false, "compaction"],
    ["prefix", false, "prefix_changed"],
    ["prefix", true, "proxy_stripped"],
  ] as const)("%s (base url set: %s) -> %s", (name, baseUrlSet, cause) => {
    const rebuilds = classifyRebuilds(parseSession(fixture(name)), baseUrlSet);
    expect(rebuilds.map((r) => r.cause)).toEqual([cause]);
  });

  it("measures the idle gap", () => {
    const [r] = classifyRebuilds(parseSession(fixture("idle")), false);
    expect(r!.gapMs).toBe(2 * 3_600_000);
  });

  it("never counts a sidechain's first write as a rebuild", () => {
    const s = parseSession(fixture("idle"));
    expect(classifyRebuilds({ ...s, calls: s.calls.slice(0, 2) }, false)).toEqual([]);
  });
});

describe("hitRatio", () => {
  it("is reads over all input tokens", () => {
    expect(hitRatio(parseSession(fixture("prefix")).calls)).toBeCloseTo(100000 / 304012, 5);
  });

  it("is 0 with no calls", () => {
    expect(hitRatio([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** `npx vitest run packages/audit/src/__tests__/classify.test.ts` should FAIL (module not found).

- [ ] **Step 3: Implement** `packages/audit/src/classify.ts`
```ts
import type { ApiCall, Cause, Rebuild, Session } from "./types.js";

export const REBUILD_MIN_WRITE = 20_000;
const HOUR = 3_600_000;
const FIVE_MIN = 300_000;

export const written = (c: ApiCall): number => c.write5m + c.write1h;
export const contextOf = (c: ApiCall): number => c.input + c.read + written(c);

/** Share of input tokens served from cache. */
export function hitRatio(calls: ApiCall[]): number {
  let read = 0;
  let all = 0;
  for (const c of calls) {
    read += c.read;
    all += contextOf(c);
  }
  return all === 0 ? 0 : read / all;
}

export function classifyRebuilds(s: Session, baseUrlSet: boolean): Rebuild[] {
  const out: Rebuild[] = [];
  const proxySuspect = baseUrlSet && hitRatio(s.calls) < 0.5;
  let ttl = FIVE_MIN;
  for (let i = 1; i < s.calls.length; i++) {
    const prev = s.calls[i - 1]!;
    const call = s.calls[i]!;
    // The TTL in force is the tier of the most recent cache write.
    if (written(prev) > 0) ttl = prev.write1h > 0 ? HOUR : FIVE_MIN;
    if (written(call) <= REBUILD_MIN_WRITE || call.read >= 0.5 * (prev.read + written(prev))) continue;
    const gapMs = call.ts - prev.ts;
    const cause: Cause =
      gapMs > ttl ? "idle_expired"
      : call.model !== prev.model ? "model_switch"
      : s.compactAt.some((t) => t > prev.ts && t <= call.ts) ? "compaction"
      : proxySuspect ? "proxy_stripped"
      : "prefix_changed";
    out.push({ call, prev, gapMs, cause });
  }
  return out;
}
```

- [ ] **Step 4: Run tests.** `npx vitest run packages/audit` should PASS. `npm run typecheck:audit` should be clean.

- [ ] **Step 5: Commit** `git add packages/audit && git commit -m "feat(audit): rebuild detection and cause classification"`

---

### Task 3: Prices and cost units

**Files:**
- Create: `packages/audit/src/prices.ts`, `packages/audit/src/cost.ts`
- Test: `packages/audit/src/__tests__/cost.test.ts`

**Interfaces:**
- Produces:
  - `priceFor(model): {input:number; read?:number} | undefined`
  - `readMultiplier(model): number`
  - `units(c: ApiCall): number`
  - `writeUnits(c: ApiCall): number`
  - `toDollars(units: number, model: string): number | undefined`
  - `WRITE_5M = 1.25`, `WRITE_1H = 2`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { priceFor, readMultiplier, toDollars, units } from "../cost.js";

describe("priceFor", () => {
  it.each([
    ["claude-opus-5-5", 4],
    ["claude-sonnet-5-5", 2],
    ["claude-sonnet-5", 2],
    ["claude-opus-5-5[1m]", 4],
    ["us.anthropic.claude-sonnet-4-6", 3],
  ])("%s -> $%s/MTok input", (model, input) => {
    expect(priceFor(model)?.input).toBe(input);
  });

  it("is undefined for unknown models", () => {
    expect(priceFor("gpt-x")).toBeUndefined();
  });
});

describe("readMultiplier", () => {
  it.each([
    ["claude-opus-5-5", 0.05],
    ["claude-fable-5-1", 0.025],
    ["claude-sonnet-5-5", 0.1],
    ["claude-sonnet-4-6", 0.1],
    ["unknown", 0.1],
  ])("%s -> %s", (model, mult) => {
    expect(readMultiplier(model)).toBeCloseTo(mult, 10);
  });
});

describe("units", () => {
  it("weights input 1x, reads by model, 5m writes 1.25x, 1h writes 2x", () => {
    const c = { id: "x", model: "claude-opus-5-5", ts: 0, input: 10, read: 1000, write5m: 100, write1h: 100 };
    expect(units(c)).toBeCloseTo(10 + 50 + 125 + 200, 10);
  });
});

describe("toDollars", () => {
  it("prices units at the model's base input rate", () => {
    expect(toDollars(1_000_000, "claude-opus-5-5")).toBeCloseTo(4, 10);
  });

  it("is undefined for unpriced models", () => {
    expect(toDollars(1, "gpt-x")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** `npx vitest run packages/audit/src/__tests__/cost.test.ts` should FAIL.

- [ ] **Step 3: Implement** `packages/audit/src/prices.ts`
```ts
// $ per million input tokens, Anthropic first-party API list prices (cached 2026-10-06).
// `read` (cache-read $/MTok) is listed only where it differs from the default 0.1x of input.
// Haiku 5.5's price is for prompts up to 100K tokens. Bedrock/Vertex pricing differs.
export const PRICES: Record<string, { input: number; read?: number }> = {
  "claude-fable-5-1": { input: 10, read: 0.25 },
  "claude-fable-5": { input: 10 },
  "claude-opus-5-5": { input: 4, read: 0.2 },
  "claude-opus-5": { input: 5 },
  "claude-opus-4-8": { input: 5 },
  "claude-opus-4-7": { input: 5 },
  "claude-opus-4-6": { input: 5 },
  "claude-sonnet-5-5": { input: 2, read: 0.2 },
  "claude-sonnet-5": { input: 2 },
  "claude-sonnet-4-6": { input: 3 },
  "claude-haiku-5-5": { input: 0.1 },
  "claude-haiku-4-5": { input: 1 },
};
```

`packages/audit/src/cost.ts`:
```ts
import { PRICES } from "./prices.js";
import type { ApiCall } from "./types.js";

export const WRITE_5M = 1.25;
export const WRITE_1H = 2;

/** Longest price-table key the model id starts with (handles Bedrock prefixes and [1m] suffixes). */
export function priceFor(model: string): { input: number; read?: number } | undefined {
  const at = model.indexOf("claude-");
  const id = at >= 0 ? model.slice(at) : model;
  let best: string | undefined;
  for (const key of Object.keys(PRICES)) {
    if (id.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? PRICES[best] : undefined;
}

export function readMultiplier(model: string): number {
  const p = priceFor(model);
  return p?.read !== undefined ? p.read / p.input : 0.1;
}

/** Input cost in units: tokens weighted by price multiplier relative to base input. */
export function units(c: ApiCall): number {
  return c.input + c.read * readMultiplier(c.model) + writeUnits(c);
}

export function writeUnits(c: ApiCall): number {
  return c.write5m * WRITE_5M + c.write1h * WRITE_1H;
}

/** Dollars at API list price, or undefined for an unpriced model. */
export function toDollars(unitCount: number, model: string): number | undefined {
  const p = priceFor(model);
  return p ? (unitCount * p.input) / 1_000_000 : undefined;
}
```

- [ ] **Step 4: Run tests.** PASS, and `npm run typecheck:audit` is clean.

- [ ] **Step 5: Commit** `git add packages/audit && git commit -m "feat(audit): price table and cost units"`

---

### Task 4: Report building, rendering, and the audit CLI

**Files:**
- Create: `packages/audit/src/report.ts`, `packages/audit/src/cli.ts` (audit path only in this task; guard and hook commands are added in Task 6)
- Test: `packages/audit/src/__tests__/report.test.ts`

**Interfaces:**
- Consumes: `parseSession`, `classifyRebuilds`, `hitRatio`, `written`, `units`, `writeUnits`, `toDollars`
- Produces:
  - `findTranscripts(projectsDir: string, sinceMs: number, project?: string): string[]`
  - `buildReport(sessions: Session[], baseUrlSet: boolean, hidePaths?: boolean): AuditReport`
  - `renderText(r: AuditReport, days: number): string`
  - `AuditReport`, with fields `sessions, projects, calls, hitRatio, units, rebuildUnits, dollars, rebuildDollars, allPriced, causes, worst, recommendation`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, copyFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSession } from "../parse.js";
import { buildReport, findTranscripts, renderText } from "../report.js";
import { fixture } from "./fixture.js";

describe("buildReport", () => {
  const r = buildReport([parseSession(fixture("idle"))], false);

  it("counts sessions and calls including sidechains", () => {
    expect(r).toMatchObject({ sessions: 1, projects: 1, calls: 4 });
  });

  it("ranks causes by write cost", () => {
    expect(r.causes[0]).toMatchObject({ cause: "idle_expired", count: 1, units: 204000 });
  });

  it("lists the largest rebuilds", () => {
    expect(r.worst[0]).toMatchObject({ tokens: 102000, gapMin: 120, cause: "idle_expired", sessionId: "sess-idl" });
  });

  it("recommends the guard for idle rebuilds", () => {
    expect(r.recommendation).toContain("guard");
  });

  it("hashes project names with hidePaths", () => {
    expect(buildReport([parseSession(fixture("idle"))], false, true).worst[0]!.project).toMatch(/^[0-9a-f]{8}$/);
  });

  it("handles no sessions", () => {
    expect(buildReport([], false)).toMatchObject({ hitRatio: 0, causes: [], recommendation: "No cache rebuilds found. Nothing to fix." });
  });
});

describe("renderText", () => {
  it("prints the summary, causes and next step", () => {
    const text = renderText(buildReport([parseSession(fixture("idle"))], false), 30);
    expect(text).toContain("Cache hit ratio");
    expect(text).toContain("idle_expired");
    expect(text).toContain("at API price");
    expect(text).not.toContain("—");
  });
});

describe("findTranscripts", () => {
  it("filters by mtime and project", () => {
    const root = mkdtempSync(join(tmpdir(), "cl-audit-"));
    mkdirSync(join(root, "-Users-me-app"));
    mkdirSync(join(root, "-Users-me-other"));
    copyFileSync(fixture("idle"), join(root, "-Users-me-app", "a.jsonl"));
    copyFileSync(fixture("prefix"), join(root, "-Users-me-other", "b.jsonl"));
    utimesSync(join(root, "-Users-me-other", "b.jsonl"), new Date(0), new Date(0));
    expect(findTranscripts(root, Date.now() - 86_400_000)).toEqual([join(root, "-Users-me-app", "a.jsonl")]);
    expect(findTranscripts(root, 0, "-Users-me-other")).toEqual([join(root, "-Users-me-other", "b.jsonl")]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** `npx vitest run packages/audit/src/__tests__/report.test.ts` should FAIL.

- [ ] **Step 3: Implement** `packages/audit/src/report.ts`
```ts
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifyRebuilds, hitRatio, written } from "./classify.js";
import { toDollars, units, writeUnits } from "./cost.js";
import type { Cause, Session } from "./types.js";

export interface CauseRow { cause: Cause; count: number; units: number; dollars: number }
export interface WorstRow { project: string; sessionId: string; tokens: number; gapMin: number; cause: Cause }
export interface AuditReport {
  sessions: number;
  projects: number;
  calls: number;
  hitRatio: number;
  units: number;
  rebuildUnits: number;
  dollars: number;
  rebuildDollars: number;
  allPriced: boolean;
  causes: CauseRow[];
  worst: WorstRow[];
  recommendation: string;
}

const RECOMMEND: Record<Cause, string> = {
  idle_expired: "Turn on the cold-cache guard (cachelane plugin, or `cachelane-audit guard on`), or /clear before long breaks.",
  model_switch: "Stay on one model per session; each model has its own cache.",
  compaction: "Compaction rewrites the cache; compact before a break rather than after it.",
  proxy_stripped: "A proxy (ANTHROPIC_BASE_URL) may be stripping cache markers. Check it, or upgrade cachelane to 1.2.0 or later.",
  prefix_changed: "Avoid editing CLAUDE.md, MCP servers or settings mid-session; each edit rebuilds the cache.",
};

export function findTranscripts(projectsDir: string, sinceMs: number, project?: string): string[] {
  const out: string[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(projectsDir);
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (project && !d.includes(project)) continue;
    let files: string[];
    try {
      files = readdirSync(join(projectsDir, d));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(projectsDir, d, f);
      try {
        if (statSync(p).mtimeMs >= sinceMs) out.push(p);
      } catch {
        // file vanished between readdir and stat
      }
    }
  }
  return out;
}

export function buildReport(sessions: Session[], baseUrlSet: boolean, hidePaths = false): AuditReport {
  const name = (p: string) => (hidePaths ? createHash("sha256").update(p).digest("hex").slice(0, 8) : p);
  const allCalls = sessions.flatMap((s) => [...s.calls, ...s.sidechainCalls]);
  let total = 0;
  let dollars = 0;
  let allPriced = true;
  for (const c of allCalls) {
    const u = units(c);
    total += u;
    const d = toDollars(u, c.model);
    if (d === undefined) allPriced = false;
    else dollars += d;
  }

  const causes = new Map<Cause, CauseRow>();
  const worst: WorstRow[] = [];
  let rebuildUnits = 0;
  let rebuildDollars = 0;
  for (const s of sessions) {
    for (const r of classifyRebuilds(s, baseUrlSet)) {
      const u = writeUnits(r.call);
      const d = toDollars(u, r.call.model) ?? 0;
      rebuildUnits += u;
      rebuildDollars += d;
      const row = causes.get(r.cause) ?? { cause: r.cause, count: 0, units: 0, dollars: 0 };
      row.count++;
      row.units += u;
      row.dollars += d;
      causes.set(r.cause, row);
      worst.push({
        project: name(s.project),
        sessionId: s.sessionId.slice(0, 8),
        tokens: written(r.call),
        gapMin: Math.round(r.gapMs / 60_000),
        cause: r.cause,
      });
    }
  }

  const ranked = [...causes.values()].sort((a, b) => b.units - a.units);
  return {
    sessions: sessions.length,
    projects: new Set(sessions.map((s) => s.project)).size,
    calls: allCalls.length,
    hitRatio: hitRatio(allCalls),
    units: total,
    rebuildUnits,
    dollars,
    rebuildDollars,
    allPriced,
    causes: ranked,
    worst: worst.sort((a, b) => b.tokens - a.tokens).slice(0, 3),
    recommendation: ranked[0] ? RECOMMEND[ranked[0].cause] : "No cache rebuilds found. Nothing to fix.",
  };
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const usd = (n: number) => `$${n.toFixed(2)}`;

export function renderText(r: AuditReport, days: number): string {
  const share = r.units === 0 ? 0 : r.rebuildUnits / r.units;
  const priced = r.allPriced ? "" : ", priced models only";
  const lines = [
    `cachelane audit · last ${days} days · ${r.projects} projects · ${r.sessions} sessions · ${r.calls} API calls`,
    "",
    `Cache hit ratio          ${(r.hitRatio * 100).toFixed(1)}%`,
    `Input spend              ${fmt(r.units)} units (~${usd(r.dollars)} at API price${priced})`,
    `Spent on cache rebuilds  ${(share * 100).toFixed(0)}%, ${fmt(r.rebuildUnits)} units (~${usd(r.rebuildDollars)})`,
  ];
  if (r.causes.length > 0) {
    lines.push("", "Rebuild causes, by cost");
    for (const c of r.causes) {
      lines.push(`  ${c.cause.padEnd(16)} ${String(c.count).padStart(4)}x  ${fmt(c.units).padStart(7)} units  ~${usd(c.dollars)}`);
    }
    lines.push("", "Largest rebuilds");
    for (const w of r.worst) {
      lines.push(`  ${w.project}  ${w.sessionId}  ${fmt(w.tokens)} tokens after ${w.gapMin} min idle  (${w.cause})`);
    }
  }
  lines.push(
    "",
    `Next step: ${r.recommendation}`,
    "",
    "Units are input tokens weighted by price: cache reads 0.1x or less, cache writes 1.25x (5m) or 2x (1h).",
  );
  return lines.join("\n");
}
```

`packages/audit/src/cli.ts` (audit path):
```ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseSession } from "./parse.js";
import { buildReport, findTranscripts, renderText } from "./report.js";

const HELP = `cachelane-audit: where your Claude Code input tokens went, and why the prompt cache rebuilt

Usage:
  cachelane-audit [--days N] [--project PATH] [--json] [--no-paths]`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function baseUrlSet(home: string): boolean {
  if (process.env.ANTHROPIC_BASE_URL) return true;
  try {
    const s = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")) as { env?: Record<string, string> };
    return Boolean(s.env?.ANTHROPIC_BASE_URL);
  } catch {
    return false;
  }
}

function audit(args: string[]): void {
  const home = homedir();
  const days = Number(flag(args, "--days") ?? 30);
  const project = flag(args, "--project");
  const root = join(process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "projects");
  // Claude Code names project dirs after the path with non-alphanumerics replaced by "-".
  const files = findTranscripts(root, Date.now() - days * 86_400_000, project && resolve(project).replace(/[^A-Za-z0-9]/g, "-"));
  const report = buildReport(files.map((f) => parseSession(f)), baseUrlSet(home), args.includes("--no-paths"));
  console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : renderText(report, days));
}

const args = process.argv.slice(2);
if (args[0] === "--help" || args[0] === "-h") console.log(HELP);
else audit(args[0] === "audit" ? args.slice(1) : args);
```

- [ ] **Step 4: Run tests and type-check.** PASS and clean.

- [ ] **Step 5: Smoke-test against real transcripts.** Run `npx tsx packages/audit/src/cli.ts --days 30`. Expected: a summary with a hit ratio and a rebuild share. Then run `npx tsx packages/audit/src/cli.ts --json --no-paths | head -20` and expect valid JSON.

- [ ] **Step 6: Commit** `git add packages/audit && git commit -m "feat(audit): report, text/JSON rendering, audit CLI"`

---

### Task 5: Guard decision logic

**Files:**
- Create: `packages/audit/src/guard.ts`
- Test: `packages/audit/src/__tests__/guard.test.ts`

**Interfaces:**
- Consumes: `contextOf`, `toDollars`, `WRITE_5M`, `WRITE_1H`, `ApiCall`
- Produces:
  - `GuardState {enabled, threshold, sessions, blocked}`
  - `loadState(path): GuardState`
  - `saveState(path, state, now): void`
  - `resolveTtlMs(env, settings: unknown[], lastWrite?: ApiCall): number`
  - `guardDecision(i: GuardInput): GuardResult`
  - `DEFAULT_THRESHOLD`, `RESUBMIT_WINDOW_MS`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_THRESHOLD, guardDecision, loadState, resolveTtlMs, saveState, type GuardState } from "../guard.js";
import type { ApiCall } from "../types.js";

const HOUR = 3_600_000;
const call = (read: number, write1h = 10_000): ApiCall => ({ id: "x", model: "claude-opus-5-5", ts: 0, input: 0, read, write5m: 0, write1h });
const fresh = (): GuardState => ({ enabled: true, threshold: DEFAULT_THRESHOLD, sessions: {}, blocked: {} });
const input = (over: Partial<Parameters<typeof guardDecision>[0]> = {}) => ({
  sessionId: "s", prompt: "refactor auth", now: 2 * HOUR, lastResponseAt: 0, lastCall: call(190_000), ttlMs: HOUR, state: fresh(), ...over,
});

describe("guardDecision", () => {
  it("blocks the first prompt after a cold, large cache", () => {
    const r = guardDecision(input());
    expect(r.action).toBe("block");
    expect(r.action === "block" && r.reason).toContain("went cold 2h 0m ago");
    expect(r.action === "block" && r.reason).toContain("/compact");
  });

  it("lets the same prompt through when re-sent within 2 minutes", () => {
    const state = fresh();
    guardDecision(input({ state }));
    expect(guardDecision(input({ state, now: 2 * HOUR + 60_000 })).action).toBe("allow");
  });

  it.each([
    ["warm cache", { now: 30 * 60_000 }],
    ["small context", { lastCall: call(50_000) }],
    ["disabled", { state: { ...fresh(), enabled: false } }],
    ["no last response", { lastResponseAt: undefined }],
  ])("allows with %s", (_label, over) => {
    expect(guardDecision(input(over)).action).toBe("allow");
  });
});

describe("resolveTtlMs", () => {
  it.each([
    ["FORCE_PROMPT_CACHING_5M wins", { FORCE_PROMPT_CACHING_5M: "1", CLAUDE_CODE_PROMPT_CACHE_TTL: "1h" }, [], undefined, 300_000],
    ["env var beats settings", { CLAUDE_CODE_PROMPT_CACHE_TTL: "1h" }, [{ promptCacheTtl: "5m" }], undefined, HOUR],
    ["first setting with a value", {}, [null, { promptCacheTtl: "5m" }], call(0), 300_000],
    ["falls back to last write tier", {}, [], call(0, 5), HOUR],
    ["defaults to 5m", {}, [], undefined, 300_000],
  ] as const)("%s", (_label, env, settings, lastWrite, expected) => {
    expect(resolveTtlMs(env, [...settings], lastWrite)).toBe(expected);
  });
});

describe("state file", () => {
  it("returns defaults for a corrupt file", () => {
    const p = join(mkdtempSync(join(tmpdir(), "cl-guard-")), "guard.json");
    writeFileSync(p, "not json");
    expect(loadState(p)).toEqual(fresh());
  });

  it("prunes entries older than 7 days on save", () => {
    const p = join(mkdtempSync(join(tmpdir(), "cl-guard-")), "nested", "guard.json");
    const now = 30 * 24 * HOUR;
    saveState(p, { ...fresh(), sessions: { old: 0, recent: now - HOUR } }, now);
    expect(JSON.parse(readFileSync(p, "utf8")).sessions).toEqual({ recent: now - HOUR });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** `npx vitest run packages/audit/src/__tests__/guard.test.ts` should FAIL.

- [ ] **Step 3: Implement** `packages/audit/src/guard.ts`
```ts
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { contextOf } from "./classify.js";
import { toDollars, WRITE_1H, WRITE_5M } from "./cost.js";
import type { ApiCall } from "./types.js";

export const DEFAULT_THRESHOLD = 150_000;
export const RESUBMIT_WINDOW_MS = 120_000;
// ponytail: fixed estimate; calibrate from compact_boundary preTokens in real transcripts.
const COMPACT_SUMMARY_TOKENS = 40_000;
const HOUR = 3_600_000;
const FIVE_MIN = 300_000;
const WEEK = 7 * 24 * HOUR;

export interface GuardState {
  enabled: boolean;
  threshold: number;
  sessions: Record<string, number>;
  blocked: Record<string, number>;
}

export interface GuardInput {
  sessionId: string;
  prompt: string;
  now: number;
  lastResponseAt?: number;
  lastCall?: ApiCall;
  ttlMs: number;
  state: GuardState;
}

export type GuardResult = { action: "allow" } | { action: "block"; reason: string };

const isRecord = (v: unknown): v is Record<string, number> => typeof v === "object" && v !== null;

export function loadState(path: string): GuardState {
  try {
    const s = JSON.parse(readFileSync(path, "utf8")) as Partial<GuardState>;
    return {
      enabled: s.enabled !== false,
      threshold: typeof s.threshold === "number" ? s.threshold : DEFAULT_THRESHOLD,
      sessions: isRecord(s.sessions) ? s.sessions : {},
      blocked: isRecord(s.blocked) ? s.blocked : {},
    };
  } catch {
    return { enabled: true, threshold: DEFAULT_THRESHOLD, sessions: {}, blocked: {} };
  }
}

export function saveState(path: string, s: GuardState, now: number): void {
  for (const m of [s.sessions, s.blocked]) {
    for (const [k, t] of Object.entries(m)) if (now - t > WEEK) delete m[k];
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(s));
}

const asTtl = (v: unknown) => (v === "1h" ? HOUR : v === "5m" ? FIVE_MIN : undefined);

/** Claude Code's main-conversation TTL precedence, falling back to the tier of the last cache write. */
export function resolveTtlMs(env: Record<string, string | undefined>, settings: unknown[], lastWrite?: ApiCall): number {
  if (env.FORCE_PROMPT_CACHING_5M === "1") return FIVE_MIN;
  const fromEnv = asTtl(env.CLAUDE_CODE_PROMPT_CACHE_TTL);
  if (fromEnv) return fromEnv;
  for (const s of settings) {
    const t = asTtl((s as { promptCacheTtl?: unknown } | null)?.promptCacheTtl);
    if (t) return t;
  }
  return lastWrite && lastWrite.write1h > 0 ? HOUR : FIVE_MIN;
}

export function guardDecision(i: GuardInput): GuardResult {
  const { state, lastCall } = i;
  if (!state.enabled || !lastCall || i.lastResponseAt === undefined) return { action: "allow" };
  const idle = i.now - i.lastResponseAt;
  const context = contextOf(lastCall);
  if (idle <= i.ttlMs || context < state.threshold) return { action: "allow" };

  const fp = createHash("sha256").update(`${i.sessionId}\0${i.prompt}`).digest("hex");
  const blockedAt = state.blocked[fp];
  if (blockedAt !== undefined && i.now - blockedAt <= RESUBMIT_WINDOW_MS) {
    delete state.blocked[fp];
    return { action: "allow" };
  }
  state.blocked[fp] = i.now;
  return { action: "block", reason: blockReason(context, idle, i.ttlMs, lastCall.model) };
}

function blockReason(context: number, idleMs: number, ttlMs: number, model: string): string {
  const mult = ttlMs >= HOUR ? WRITE_1H : WRITE_5M;
  const cont = context * mult;
  const compact = context + COMPACT_SUMMARY_TOKENS * mult;
  const money = (u: number) => {
    const d = toDollars(u, model);
    return d === undefined ? "" : ` (~$${d.toFixed(2)} at API price)`;
  };
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  const h = Math.floor(idleMs / HOUR);
  const m = Math.round((idleMs % HOUR) / 60_000);
  return [
    `cachelane: your prompt cache went cold ${h}h ${m}m ago (${ttlMs >= HOUR ? "1h" : "5m"} TTL). Context: ${k(context)} tokens.`,
    `  continue   rewrites ${k(context)} tokens at ${mult}x = ${k(cont)} units${money(cont)}`,
    `  /compact   ~${k(context)} at 1x + ~${k(COMPACT_SUMMARY_TOKENS)} summary = ~${k(compact)} units${money(compact)}, estimate`,
    "  /clear     ~0 units, but drops the conversation",
    "Re-send the same message within 2 minutes to continue anyway. Turn off with: cachelane-audit guard off",
  ].join("\n");
}
```

- [ ] **Step 4: Run tests and type-check.** PASS and clean.

- [ ] **Step 5: Commit** `git add packages/audit && git commit -m "feat(audit): cold-cache guard decision and state"`

---

### Task 6: Hook handlers and CLI guard/hook commands

**Files:**
- Create: `packages/audit/src/hooks.ts`
- Modify: `packages/audit/src/cli.ts` (add `guard`, `hook`)
- Test: `packages/audit/src/__tests__/hooks.test.ts`

**Interfaces:**
- Consumes: `parseSession`, `written`, `guardDecision`, `loadState`, `saveState`, `resolveTtlMs`
- Produces:
  - `HookDeps {statePath, now, env, home}`
  - `defaultDeps(): HookDeps`
  - `promptHook(input, deps): string` ("" means allow)
  - `stopHook(input, deps): void`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState } from "../guard.js";
import { promptHook, stopHook, type HookDeps } from "../hooks.js";
import { fixture } from "./fixture.js";

const LAST = Date.parse("2026-10-01T12:01:00.000Z"); // m3 in idle.jsonl, 102k context, 1h tier

function setup(now: number): HookDeps {
  const dir = mkdtempSync(join(tmpdir(), "cl-hooks-"));
  const deps = { statePath: join(dir, "guard.json"), now, env: {}, home: dir };
  saveState(deps.statePath, { ...loadState(deps.statePath), threshold: 50_000 }, now);
  return deps;
}
const input = (prompt = "next step") => ({ session_id: "sess-idle", transcript_path: fixture("idle"), prompt, cwd: tmpdir() });

describe("promptHook", () => {
  it("blocks with Claude Code's decision JSON after the cache went cold", () => {
    const out = JSON.parse(promptHook(input(), setup(LAST + 2 * 3_600_000)));
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("went cold 2h 0m ago");
  });

  it("allows the resubmitted prompt", () => {
    const deps = setup(LAST + 2 * 3_600_000);
    promptHook(input(), deps);
    expect(promptHook(input(), { ...deps, now: deps.now + 30_000 })).toBe("");
  });

  it("uses the Stop timestamp as last activity", () => {
    const deps = setup(LAST + 2 * 3_600_000);
    stopHook(input(), { ...deps, now: deps.now - 60_000 });
    expect(promptHook(input(), deps)).toBe("");
  });

  it("allows when the transcript is missing", () => {
    expect(promptHook({ ...input(), transcript_path: "/nope.jsonl" }, setup(LAST))).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** `npx vitest run packages/audit/src/__tests__/hooks.test.ts` should FAIL.

- [ ] **Step 3: Implement** `packages/audit/src/hooks.ts`
```ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { written } from "./classify.js";
import { guardDecision, loadState, resolveTtlMs, saveState } from "./guard.js";
import { parseSession } from "./parse.js";

export interface HookDeps {
  statePath: string;
  now: number;
  env: Record<string, string | undefined>;
  home: string;
}

export function defaultDeps(): HookDeps {
  const home = homedir();
  return { statePath: join(home, ".cachelane", "guard.json"), now: Date.now(), env: process.env, home };
}

type HookInput = { session_id?: string; transcript_path?: string; prompt?: string; cwd?: string };

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** UserPromptSubmit. Returns stdout to print ("" = allow). Never throws. */
export function promptHook(input: HookInput, d: HookDeps): string {
  try {
    if (!input.session_id || !input.transcript_path || !existsSync(input.transcript_path)) return "";
    const state = loadState(d.statePath);
    if (!state.enabled) return "";
    const session = parseSession(input.transcript_path);
    const lastCall = session.calls.at(-1);
    const lastWrite = [...session.calls].reverse().find((c) => written(c) > 0);
    const cwd = input.cwd ?? process.cwd();
    const settings = [
      readJson(join(cwd, ".claude", "settings.local.json")),
      readJson(join(cwd, ".claude", "settings.json")),
      readJson(join(d.home, ".claude", "settings.json")),
    ];
    const result = guardDecision({
      sessionId: input.session_id,
      prompt: input.prompt ?? "",
      now: d.now,
      lastResponseAt: state.sessions[input.session_id] ?? lastCall?.ts,
      lastCall,
      ttlMs: resolveTtlMs(d.env, settings, lastWrite),
      state,
    });
    saveState(d.statePath, state, d.now);
    return result.action === "block" ? JSON.stringify({ decision: "block", reason: result.reason }) : "";
  } catch {
    return "";
  }
}

/** Stop. Records when the session last got a response. Never throws. */
export function stopHook(input: HookInput, d: HookDeps): void {
  try {
    if (!input.session_id) return;
    const state = loadState(d.statePath);
    state.sessions[input.session_id] = d.now;
    saveState(d.statePath, state, d.now);
  } catch {
    // fail open
  }
}
```

Changes to `cli.ts`:
- Import `defaultDeps, promptHook, stopHook` from `./hooks.js` and `loadState, saveState` from `./guard.js`.
- Extend `HELP` with:
  ```
    cachelane-audit guard on|off|status|threshold <tokens>
    cachelane-audit hook prompt|stop        (used by the Claude Code plugin)
  ```
- Replace the dispatch at the bottom with:
```ts
function guard(args: string[]): void {
  const d = defaultDeps();
  const state = loadState(d.statePath);
  const [sub, value] = args;
  if (sub === "on" || sub === "off") state.enabled = sub === "on";
  else if (sub === "threshold" && Number(value) > 0) state.threshold = Number(value);
  else if (sub !== "status") {
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  saveState(d.statePath, state, d.now);
  console.log(`guard ${state.enabled ? "on" : "off"} · threshold ${state.threshold} tokens · state ${d.statePath}`);
}

async function hook(kind: string | undefined): Promise<void> {
  // Fail open: anything slower than 5 s exits with no output, which allows the prompt.
  setTimeout(() => process.exit(0), 5_000).unref();
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input: Record<string, string> = {};
  try {
    input = JSON.parse(raw) as Record<string, string>;
  } catch {
    return;
  }
  if (kind === "prompt") {
    const out = promptHook(input, defaultDeps());
    if (out) process.stdout.write(out);
  } else if (kind === "stop") {
    stopHook(input, defaultDeps());
  }
}

const args = process.argv.slice(2);
if (args[0] === "guard") guard(args.slice(1));
else if (args[0] === "hook") await hook(args[1]);
else if (args[0] === "--help" || args[0] === "-h") console.log(HELP);
else audit(args[0] === "audit" ? args.slice(1) : args);
```

- [ ] **Step 4: Run tests and type-check.** PASS and clean.

- [ ] **Step 5: End-to-end hook smoke test.** Run:

  `echo '{"session_id":"x","transcript_path":"/nope","prompt":"hi"}' | npx tsx packages/audit/src/cli.ts hook prompt; echo "exit=$?"`

  Expected: no output, `exit=0`.

- [ ] **Step 6: Commit** `git add packages/audit && git commit -m "feat(audit): guard hooks and CLI commands"`

---

### Task 7: Bundle, plugin, marketplace, package README

**Files:**
- Create: `packages/audit/tsup.config.ts`, `packages/audit/README.md`
- Create: `plugin/.claude-plugin/plugin.json`, `plugin/hooks/hooks.json`, `plugin/commands/audit.md`, `.claude-plugin/marketplace.json`
- Generated and committed: `plugin/bin/cachelane-audit.mjs`

**Interfaces:**
- Consumes: `packages/audit/src/cli.ts` (the `hook prompt|stop` and audit commands)

- [ ] **Step 1: Add the bundle config** `packages/audit/tsup.config.ts` (paths are relative to the repo root, where the script runs)
```ts
import fs from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "packages/audit/src/cli.ts" },
  outDir: "packages/audit/dist",
  format: ["esm"],
  platform: "node",
  target: "node18",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  async onSuccess() {
    // The plugin runs this file directly with node; no npm install, no npx.
    fs.mkdirSync("plugin/bin", { recursive: true });
    fs.copyFileSync("packages/audit/dist/cli.js", "plugin/bin/cachelane-audit.mjs");
  },
});
```

- [ ] **Step 2: Plugin files**

`plugin/.claude-plugin/plugin.json`:
```json
{
  "name": "cachelane",
  "version": "0.1.0",
  "description": "Warns before a message rebuilds a large expired prompt cache, and audits where your input tokens went.",
  "license": "Apache-2.0",
  "repository": "https://github.com/Aditya-Tripuraneni/CacheLane"
}
```

`plugin/hooks/hooks.json`:
```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/cachelane-audit.mjs\" hook prompt", "timeout": 10 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/cachelane-audit.mjs\" hook stop", "timeout": 10 } ] }
    ]
  }
}
```

`plugin/commands/audit.md`:
```markdown
---
description: Show where your Claude Code input tokens went and why the prompt cache rebuilt
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/cachelane-audit.mjs" $ARGUMENTS`

Summarize the audit above in 3 bullets: the cache hit ratio, the share of spend on rebuilds with its top cause, and the recommended next step.
```

`.claude-plugin/marketplace.json`:
```json
{
  "name": "cachelane",
  "owner": { "name": "CacheLane" },
  "plugins": [
    {
      "name": "cachelane",
      "source": "./plugin",
      "description": "Cold-cache guard and token audit for Claude Code"
    }
  ]
}
```

- [ ] **Step 3: Package README** `packages/audit/README.md`
````markdown
# cachelane-audit

See where your Claude Code input tokens went, and why the prompt cache rebuilt. Reads your local transcripts (`~/.claude/projects`). Usage metadata only, nothing leaves your machine. Zero dependencies.

```bash
npx cachelane-audit              # last 30 days
npx cachelane-audit --days 7 --project .
npx cachelane-audit --json --no-paths
```

It reports:
- Your cache hit ratio.
- The share of input spend that went to cache rebuilds.
- What caused each rebuild: idle past the cache TTL, model switch, compaction, a proxy stripping cache markers, or a prefix change.

## Cold-cache guard (Claude Code plugin)

```
/plugin marketplace add Aditya-Tripuraneni/CacheLane
/plugin install cachelane@cachelane
```

When you come back to a session whose cache has expired and whose context is large (150k tokens by default), the guard blocks your first message once. It shows what continuing, `/compact`, and `/clear` would cost. To proceed anyway, send the same message again within 2 minutes.

```bash
npx cachelane-audit guard off | on | status | threshold 200000
```

Dollar figures use Anthropic API list prices. On a Pro/Max plan, read them as relative usage.
````

- [ ] **Step 4: Build and verify the bundle.** Run:
```bash
npm run build:audit
head -1 plugin/bin/cachelane-audit.mjs          # expect: #!/usr/bin/env node
grep -oE 'from "[^"]+"' plugin/bin/cachelane-audit.mjs | sort -u   # expect only node:* specifiers
```

- [ ] **Step 5: Validate the plugin.** Run `claude plugin validate plugin` and `claude plugin validate .`. Expected: both pass. Fix any reported schema issue and re-run.

- [ ] **Step 6: Commit** `git add packages/audit plugin .claude-plugin && git commit -m "feat(audit): bundle, Claude Code plugin and marketplace entry"`

---

### Task 8: Verification gate

- [ ] **Step 1: Run the full repo checks on Node 20.** `npx vitest run`, `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:audit`. All must be green.
- [ ] **Step 2: Check package size and dependencies.** From `packages/audit`, run `npm pack --dry-run`. Expected: under 100 KB, and the files are only `dist/cli.js`, `package.json` and `README.md`.
- [ ] **Step 3: Check the Node matrix.** For each of v18, v20, v22 and v24, run `nvm exec <v> node plugin/bin/cachelane-audit.mjs --days 30 --json --no-paths | head -3`. Expected: valid JSON on every version.
- [ ] **Step 4: Check timing.** Run `time node plugin/bin/cachelane-audit.mjs --days 30 > /dev/null`. Record the number. Also run a prompt hook against the largest local transcript and confirm it takes well under the 5 s budget.
- [ ] **Step 5: Paste the outputs into the PR description.**
