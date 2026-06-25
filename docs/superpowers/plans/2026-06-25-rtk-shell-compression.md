# RTK-style Shell Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add command-aware compression of Bash `tool_result` outputs to CacheLane by extending the existing `src/compressor/` module with a deterministic `shell` compressor and six command profiles.

**Architecture:** A new `shellCompressor` implements the existing `ToolOutputCompressor` interface and registers ahead of `json`/`log` in the registry. `compress()` is extended to build a `tool_use_id → { command, exit_code }` map from Bash `tool_use` blocks and pass the originating command into `CompressorInput`. Each profile is a pure deterministic function so compressed bytes stay cache-stable. All existing infrastructure (never-worse guard, retention, fail-open, event accounting) is reused.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Node ≥ 20.10, Vitest, `@anthropic-ai/tokenizer`. No new npm dependencies.

## Global Constraints

- **Pipeline order is canonical:** `compress → classify → prune → reorder`. Compression stays first; do not reorder. (`src/proxy/server.ts:402`)
- **Vocabulary:** `STABLE | SEMI | VOLATILE` only — no synonyms — anywhere (code, logs, tests, comments).
- **Naming:** cross-boundary types (config fields, `CompressorInput`/`BlockCompressEvent` fields, content types) use `snake_case`; in-process working types (profile params, local helpers) may use `camelCase`.
- **Fail-open:** any error in compression returns the original, unmutated block. Never drop or corrupt a block.
- **Determinism:** every profile must produce byte-identical output for the same `(command, rawOutput, exitCode)` — no timestamps, durations, or hash-map iteration ordering. This guards the merge-blocking cache-stability gate.
- **No new npm deps without an ADR.**
- **Node version:** use Node 20 (`nvm use 20`) — storage native bindings fail on Node 24.
- **Import extensions:** all relative imports use the `.js` extension (ESM convention in this repo).
- **Test discipline:** fixtures as JSON; table-driven (`describe.each`) for the six profiles; one assertion per test where possible.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/compressor/shell-profiles.ts` | **new** — the six pure profile functions + a `matchProfile(command)` dispatcher. No I/O, no dependencies on registry/index. |
| `src/compressor/shell-compress.ts` | **new** — `compressShell()` orchestration: pick profile, run it, decide failure-retention. |
| `src/compressor/registry.ts` | **modify** — add `shellCompressor`; route precedence shell → json → log → passthrough. |
| `src/compressor/types.ts` | **modify** — add `command?`/`exit_code?` to `CompressorInput`; `"shell"` to `ContentType`; `profile_id?` to `BlockCompressEvent`; `shell`/`shell_profiles` to `CompressorConfig`. |
| `src/compressor/index.ts` | **modify** — build `tool_use_id → { command, exit_code }` map; thread it into `routeCompression`. |
| `src/types/index.ts` | **modify** — mirror the config fields on `CachelaneConfig.compression`. |
| `src/config/defaults.ts` | **modify** — default `shell: true`, all profiles enabled. |
| `src/compressor/__tests__/shell-profiles.test.ts` | **new** — per-profile fixtures + determinism + failure tests. |
| `src/compressor/__tests__/shell-correlation.test.ts` | **new** — `compress()` command-correlation + routing tests. |

---

## Task 1: Extend types for shell compression

**Files:**
- Modify: `src/compressor/types.ts`
- Modify: `src/types/index.ts:98-112`

**Interfaces:**
- Consumes: nothing (foundational).
- Produces:
  - `ContentType = "json" | "log" | "shell" | "passthrough"`
  - `CompressorInput` gains `command?: string; exit_code?: number;`
  - `BlockCompressEvent` gains `profile_id?: string;`
  - `CompressorConfig` gains `compressors.shell: boolean` and optional `shell_profiles?: Record<string, boolean>`

- [ ] **Step 1: Add the `shell` content type and input fields in `src/compressor/types.ts`**

Change the `ContentType` union and `CompressorInput`:

```typescript
export type ContentType = "json" | "log" | "shell" | "passthrough";
```

```typescript
export interface CompressorInput {
  tool_use_id: string;
  content: string;
  mode: CompressionMode;
  json_max_array_items: number;
  command?: string;
  exit_code?: number;
}
```

Add `profile_id` to `BlockCompressEvent` (after `compressor_id`):

```typescript
export interface BlockCompressEvent {
  tool_use_id: string;
  content_type: ContentType;
  original_tokens: number;
  compressed_tokens: number;
  tokens_saved: number;
  compressor_id?: string;
  profile_id?: string;
  mode?: CompressionMode;
  lossiness?: CompressionLossiness;
  outcome?: CompressionOutcome;
  latency_ms?: number;
  token_model?: string;
  retention_handle?: string;
}
```

Extend `CompressorConfig.compressors` and add `shell_profiles`:

```typescript
export interface CompressorConfig {
  enabled: boolean;
  exclude: string[];
  json_max_array_items: number;
  mode?: CompressionMode;
  compressors?: {
    json: boolean;
    log: boolean;
    shell: boolean;
  };
  shell_profiles?: Record<string, boolean>;
  retention?: {
    enabled: boolean;
    min_original_tokens: number;
    ttl_days: number;
  };
}
```

- [ ] **Step 2: Mirror the config fields on `CachelaneConfig` in `src/types/index.ts:98-112`**

```typescript
  compression: {
    enabled: boolean;
    mode: "lossless" | "balanced" | "aggressive";
    exclude: string[];
    json_max_array_items: number;
    compressors: {
      json: boolean;
      log: boolean;
      shell: boolean;
    };
    shell_profiles?: Record<string, boolean>;
    retention: {
      enabled: boolean;
      min_original_tokens: number;
      ttl_days: number;
    };
  };
```

- [ ] **Step 3: Run the type-check to confirm the new fields don't break existing references**

Run: `npx tsc --noEmit`
Expected: FAIL — `src/config/defaults.ts` is missing the new required `shell` field (caught next task). No other errors. This confirms the type change propagates only where expected.

- [ ] **Step 4: Commit**

```bash
git add src/compressor/types.ts src/types/index.ts
git commit -m "feat(compressor): add shell content type and config fields"
```

---

## Task 2: Default config + per-profile toggles

**Files:**
- Modify: `src/config/defaults.ts:51-65`
- Test: `src/config/__tests__/config.test.ts`

**Interfaces:**
- Consumes: `CompressorConfig` shape from Task 1.
- Produces: `DEFAULT_CONFIG.compression.compressors.shell === true`; all six profile ids default-enabled.

- [ ] **Step 1: Write the failing test in `src/config/__tests__/config.test.ts`**

Add this test (append to the existing describe block):

```typescript
import { DEFAULT_CONFIG } from "../defaults.js";

it("enables the shell compressor by default", () => {
  expect(DEFAULT_CONFIG.compression.compressors.shell).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/__tests__/config.test.ts -t "shell compressor"`
Expected: FAIL — `shell` is `undefined`.

- [ ] **Step 3: Update `DEFAULT_CONFIG.compression` in `src/config/defaults.ts:51-65`**

```typescript
  compression: {
    enabled: true,
    mode: "lossless",
    exclude: [],
    json_max_array_items: 20,
    compressors: {
      json: true,
      log: true,
      shell: true,
    },
    shell_profiles: {
      "git-status": true,
      "git-diff": true,
      "git-log": true,
      "pkg-install": true,
      "test-run": true,
      "build": true,
    },
    retention: {
      enabled: false,
      min_original_tokens: 1000,
      ttl_days: 7,
    },
  },
```

- [ ] **Step 4: Run test + type-check to verify pass**

Run: `npx vitest run src/config/__tests__/config.test.ts -t "shell compressor" && npx tsc --noEmit`
Expected: PASS; `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/config/defaults.ts src/config/__tests__/config.test.ts
git commit -m "feat(config): default-enable shell compressor and profile toggles"
```

---

## Task 3: Profile dispatcher + `git-status` profile

**Files:**
- Create: `src/compressor/shell-profiles.ts`
- Test: `src/compressor/__tests__/shell-profiles.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `interface ShellProfileResult { content: string; profile_id: string; }`
  - `type ShellProfile = (rawOutput: string, exitCode: number | undefined) => string;`
  - `function matchProfile(command: string): { id: string; run: ShellProfile } | null`
  - `const SHELL_PROFILE_IDS: readonly string[]` (the six ids)

- [ ] **Step 1: Write the failing test in `src/compressor/__tests__/shell-profiles.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { matchProfile } from "../shell-profiles.js";

describe("matchProfile", () => {
  it("matches `git status` to the git-status profile", () => {
    expect(matchProfile("git status")?.id).toBe("git-status");
  });

  it("returns null for an unknown command", () => {
    expect(matchProfile("cowsay hi")).toBeNull();
  });
});

describe("git-status profile", () => {
  const raw = [
    "On branch main",
    "Changes to be committed:",
    "\tmodified:   src/a.ts",
    "Changes not staged for commit:",
    "\tmodified:   src/b.ts",
    "Untracked files:",
    "\tsrc/c.ts",
  ].join("\n");

  it("summarizes counts by category", () => {
    const out = matchProfile("git status")!.run(raw, 0);
    expect(out).toBe("staged: 1 (src/), modified: 1 (src/), untracked: 1 (src/)");
  });

  it("is deterministic across repeated runs", () => {
    const a = matchProfile("git status")!.run(raw, 0);
    const b = matchProfile("git status")!.run(raw, 0);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/compressor/__tests__/shell-profiles.test.ts`
Expected: FAIL — cannot resolve `../shell-profiles.js`.

- [ ] **Step 3: Create `src/compressor/shell-profiles.ts` with the dispatcher and git-status profile**

```typescript
export type ShellProfile = (rawOutput: string, exitCode: number | undefined) => string;

export const SHELL_PROFILE_IDS = [
  "git-status",
  "git-diff",
  "git-log",
  "pkg-install",
  "test-run",
  "build",
] as const;

function topDir(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "./" : `${path.slice(0, slash)}/`;
}

function gitStatus(rawOutput: string): string {
  const lines = rawOutput.split("\n");
  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];
  let section: "staged" | "modified" | "untracked" | null = null;

  for (const line of lines) {
    if (line.startsWith("Changes to be committed")) { section = "staged"; continue; }
    if (line.startsWith("Changes not staged")) { section = "modified"; continue; }
    if (line.startsWith("Untracked files")) { section = "untracked"; continue; }
    const m = line.match(/^\t(?:[a-z ]+:\s+)?(.+)$/);
    if (!m || section === null) continue;
    const path = m[1]!.trim();
    if (section === "staged") staged.push(path);
    else if (section === "modified") modified.push(path);
    else untracked.push(path);
  }

  const fmt = (label: string, items: string[]): string | null => {
    if (items.length === 0) return null;
    const dirs = [...new Set(items.map(topDir))].sort();
    return `${label}: ${items.length} (${dirs.join(", ")})`;
  };

  return [fmt("staged", staged), fmt("modified", modified), fmt("untracked", untracked)]
    .filter((s): s is string => s !== null)
    .join(", ");
}

const PROFILES: { id: string; matches: RegExp; run: ShellProfile }[] = [
  { id: "git-status", matches: /^git\s+status\b/, run: (raw) => gitStatus(raw) },
];

export function matchProfile(command: string): { id: string; run: ShellProfile } | null {
  const trimmed = command.trim();
  const found = PROFILES.find((p) => p.matches.test(trimmed));
  return found ? { id: found.id, run: found.run } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/compressor/__tests__/shell-profiles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compressor/shell-profiles.ts src/compressor/__tests__/shell-profiles.test.ts
git commit -m "feat(compressor): add profile dispatcher and git-status profile"
```

---

## Task 4: Add `git-diff`, `git-log`, `pkg-install`, `test-run`, `build` profiles

**Files:**
- Modify: `src/compressor/shell-profiles.ts`
- Test: `src/compressor/__tests__/shell-profiles.test.ts`

**Interfaces:**
- Consumes: `ShellProfile`, `PROFILES`, `matchProfile` from Task 3.
- Produces: five more profile functions registered in `PROFILES`.

- [ ] **Step 1: Write failing table-driven tests in `src/compressor/__tests__/shell-profiles.test.ts`**

Append:

```typescript
describe.each([
  {
    id: "git-diff",
    command: "git diff",
    raw: "diff --git a/src/a.ts b/src/a.ts\n@@ -1,2 +1,3 @@\n+added\n-removed\n context",
    expected: "src/a.ts: +1 -1",
  },
  {
    id: "git-log",
    command: "git log -n 2",
    raw: "commit abc1234\nAuthor: Jane <j@x.io>\n\n    Fix bug\n\ncommit def5678\nAuthor: Bob <b@x.io>\n\n    Add thing",
    expected: "abc1234 Fix bug (Jane)\ndef5678 Add thing (Bob)",
  },
  {
    id: "pkg-install",
    command: "npm install",
    raw: "npm warn deprecated foo@1.0.0\nadded 42 packages in 3s\nnpm fund ...",
    expected: "added 42 packages\nwarn deprecated foo@1.0.0",
  },
  {
    id: "test-run",
    command: "vitest run",
    raw: "✓ a.test.ts > works\n✗ b.test.ts > fails\n  expected 1 received 2\nTests 1 failed | 1 passed",
    expected: "1 failed, 1 passed\n✗ b.test.ts > fails\n  expected 1 received 2",
  },
  {
    id: "build",
    command: "tsc",
    raw: "src/a.ts(3,5): error TS2322: Type error\nsrc/a.ts(9,1): error TS1005: ; expected\nDone.",
    expected: "src/a.ts:\n  (3,5) error TS2322: Type error\n  (9,1) error TS1005: ; expected",
  },
])("$id profile", ({ id, command, raw, expected }) => {
  it("produces the expected summary", () => {
    expect(matchProfile(command)!.run(raw, 1)).toBe(expected);
  });
  it("matches its command", () => {
    expect(matchProfile(command)!.id).toBe(id);
  });
  it("is deterministic", () => {
    expect(matchProfile(command)!.run(raw, 1)).toBe(matchProfile(command)!.run(raw, 1));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/compressor/__tests__/shell-profiles.test.ts`
Expected: FAIL — `matchProfile("git diff")` returns null (profiles not registered).

- [ ] **Step 3: Add the five profile functions and register them in `src/compressor/shell-profiles.ts`**

Add these functions above the `PROFILES` array:

```typescript
function gitDiff(rawOutput: string): string {
  const lines = rawOutput.split("\n");
  const perFile = new Map<string, { adds: number; dels: number }>();
  let current: string | null = null;
  for (const line of lines) {
    const fileMatch = line.match(/^diff --git a\/(\S+) b\/\S+/);
    if (fileMatch) { current = fileMatch[1]!; perFile.set(current, { adds: 0, dels: 0 }); continue; }
    if (current === null) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) perFile.get(current)!.adds++;
    else if (line.startsWith("-") && !line.startsWith("---")) perFile.get(current)!.dels++;
  }
  return [...perFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, { adds, dels }]) => `${file}: +${adds} -${dels}`)
    .join("\n");
}

function gitLog(rawOutput: string): string {
  const commits: string[] = [];
  const blocks = rawOutput.split(/^commit /m).filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    const sha = block.slice(0, 7);
    const authorMatch = block.match(/^Author:\s+([^<]+?)\s*</m);
    const author = authorMatch ? authorMatch[1]!.trim() : "?";
    const bodyLines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const subject = bodyLines.find((l) => !l.startsWith("commit") && !l.startsWith("Author:") && !l.startsWith("Date:")) ?? "";
    commits.push(`${sha} ${subject} (${author})`);
  }
  return commits.join("\n");
}

function pkgInstall(rawOutput: string): string {
  const lines = rawOutput.split("\n");
  const added = lines.find((l) => /added \d+ package/.test(l));
  const summary = added ? added.replace(/ in .*$/, "").trim() : "";
  const warns = lines
    .filter((l) => /\b(warn|error)\b/i.test(l))
    .map((l) => l.replace(/^npm\s+/, "").trim());
  return [summary, ...new Set(warns)].filter(Boolean).join("\n");
}

function testRun(rawOutput: string): string {
  const lines = rawOutput.split("\n");
  const tally = lines.find((l) => /\d+\s+(failed|passed)/i.test(l));
  const failedMatch = tally?.match(/(\d+)\s+failed/i);
  const passedMatch = tally?.match(/(\d+)\s+passed/i);
  const header = `${failedMatch ? failedMatch[1] : 0} failed, ${passedMatch ? passedMatch[1] : 0} passed`;
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^[✗×]/.test(line.trim())) {
      failures.push(line.trim());
      const next = lines[i + 1];
      if (next && /expected|received|assert/i.test(next)) failures.push(`  ${next.trim()}`);
    }
  }
  return [header, ...failures].join("\n");
}

function build(rawOutput: string): string {
  const byFile = new Map<string, string[]>();
  for (const line of rawOutput.split("\n")) {
    const m = line.match(/^(\S+?)\((\d+),(\d+)\):\s+(error.*)$/);
    if (!m) continue;
    const [, file, row, col, msg] = m;
    if (!byFile.has(file!)) byFile.set(file!, []);
    byFile.get(file!)!.push(`  (${row},${col}) ${msg}`);
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, errs]) => `${file}:\n${errs.join("\n")}`)
    .join("\n");
}
```

Replace the `PROFILES` array with all six:

```typescript
const PROFILES: { id: string; matches: RegExp; run: ShellProfile }[] = [
  { id: "git-status", matches: /^git\s+status\b/, run: (raw) => gitStatus(raw) },
  { id: "git-diff", matches: /^git\s+diff\b/, run: (raw) => gitDiff(raw) },
  { id: "git-log", matches: /^git\s+log\b/, run: (raw) => gitLog(raw) },
  { id: "pkg-install", matches: /^(npm|pnpm|yarn)\s+(install|i|ci)\b/, run: (raw) => pkgInstall(raw) },
  { id: "test-run", matches: /^(jest|vitest|pytest)\b/, run: (raw) => testRun(raw) },
  { id: "build", matches: /^(tsc|next\s+build|webpack)\b/, run: (raw) => build(raw) },
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/compressor/__tests__/shell-profiles.test.ts`
Expected: PASS (all profiles, including the determinism cases).

- [ ] **Step 5: Commit**

```bash
git add src/compressor/shell-profiles.ts src/compressor/__tests__/shell-profiles.test.ts
git commit -m "feat(compressor): add git-diff, git-log, pkg-install, test-run, build profiles"
```

---

## Task 5: `compressShell` orchestration with failure detection

**Files:**
- Create: `src/compressor/shell-compress.ts`
- Test: `src/compressor/__tests__/shell-profiles.test.ts` (add a `compressShell` describe block)

**Interfaces:**
- Consumes: `matchProfile` from Task 3; `CompressorInput`, `CompressorOutput` from `types.ts`.
- Produces:
  - `function compressShell(input: CompressorInput): { output: CompressorOutput; profile_id: string } | null`
  - Returns `null` when no profile matches the command (so the registry falls through to json/log).
  - On `exit_code !== 0` and `0`-or-undefined alike, returns the summary; lossiness is `"lossy"`.

- [ ] **Step 1: Write the failing test (append to `shell-profiles.test.ts`)**

```typescript
import { compressShell } from "../shell-compress.js";

describe("compressShell", () => {
  it("returns null when the command has no matching profile", () => {
    expect(compressShell({ tool_use_id: "t1", content: "x", mode: "balanced", json_max_array_items: 20, command: "cowsay" })).toBeNull();
  });

  it("returns null when no command is present", () => {
    expect(compressShell({ tool_use_id: "t1", content: "x", mode: "balanced", json_max_array_items: 20 })).toBeNull();
  });

  it("compresses git status and reports the profile id", () => {
    const result = compressShell({
      tool_use_id: "t1",
      content: "On branch main\nUntracked files:\n\tsrc/c.ts",
      mode: "balanced",
      json_max_array_items: 20,
      command: "git status",
      exit_code: 0,
    });
    expect(result?.profile_id).toBe("git-status");
    expect(result?.output.content_type).toBe("shell");
    expect(result?.output.lossiness).toBe("lossy");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/compressor/__tests__/shell-profiles.test.ts -t compressShell`
Expected: FAIL — cannot resolve `../shell-compress.js`.

- [ ] **Step 3: Create `src/compressor/shell-compress.ts`**

```typescript
import { matchProfile } from "./shell-profiles.js";
import type { CompressorInput, CompressorOutput } from "./types.js";

export function compressShell(
  input: CompressorInput,
): { output: CompressorOutput; profile_id: string } | null {
  if (input.command === undefined) return null;
  const profile = matchProfile(input.command);
  if (profile === null) return null;

  const content = profile.run(input.content, input.exit_code);
  return {
    profile_id: profile.id,
    output: {
      content,
      content_type: "shell",
      compressor_id: "shell",
      lossiness: "lossy",
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/compressor/__tests__/shell-profiles.test.ts -t compressShell`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compressor/shell-compress.ts src/compressor/__tests__/shell-profiles.test.ts
git commit -m "feat(compressor): add compressShell orchestration"
```

---

## Task 6: Register `shellCompressor` in the registry (precedence shell → json → log)

**Files:**
- Modify: `src/compressor/registry.ts`
- Test: `src/compressor/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `compressShell` (Task 5); existing `ToolOutputCompressor`, `routeCompression`.
- Produces:
  - `shellCompressor: ToolOutputCompressor`
  - `createDefaultRegistry()` returns `[shellCompressor, jsonCompressor, logCompressor, passthroughCompressor]`
  - `routeCompression` result for a shell-matched input has `compressor_id === "shell"`.

- [ ] **Step 1: Write the failing test in `src/compressor/__tests__/registry.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { routeCompression } from "../registry.js";

describe("shell routing precedence", () => {
  it("routes a git-status output to the shell compressor when a command is present", () => {
    const out = routeCompression({
      tool_use_id: "t1",
      content: "On branch main\nUntracked files:\n\tsrc/c.ts",
      mode: "balanced",
      json_max_array_items: 20,
      command: "git status",
    });
    expect(out.compressor_id).toBe("shell");
    expect(out.content_type).toBe("shell");
  });

  it("falls through to log/passthrough when no command matches a profile", () => {
    const out = routeCompression({
      tool_use_id: "t1",
      content: "plain text output",
      mode: "balanced",
      json_max_array_items: 20,
      command: "cowsay",
    });
    expect(out.compressor_id).not.toBe("shell");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/compressor/__tests__/registry.test.ts -t "shell routing"`
Expected: FAIL — output `compressor_id` is `"log"`/`"passthrough"`, not `"shell"`.

- [ ] **Step 3: Add `shellCompressor` and register it first in `src/compressor/registry.ts`**

Add the import at the top:

```typescript
import { compressShell } from "./shell-compress.js";
```

Add the compressor (before `createDefaultRegistry`):

```typescript
export const shellCompressor: ToolOutputCompressor = {
  id: "shell",
  supportedModes: ["lossless", "balanced", "aggressive"],
  detect: (input) =>
    compressShell(input) !== null
      ? { matched: true, confidence: 100, content_type: "shell" }
      : { matched: false, confidence: 0, content_type: "passthrough" },
  compress: (input) => {
    const result = compressShell(input);
    if (result === null) {
      return { content: input.content, content_type: "passthrough", compressor_id: "passthrough", lossiness: "passthrough" };
    }
    return result.output;
  },
};
```

Update `createDefaultRegistry` to put shell first:

```typescript
export function createDefaultRegistry(): ToolOutputCompressor[] {
  return [shellCompressor, jsonCompressor, logCompressor, passthroughCompressor];
}
```

Note: `detect`/`compress` both call `compressShell`; that's two cheap matches per block. Acceptable — profiles are pure string ops well under the 10ms budget. Do not cache across the boundary (keeps the compressor stateless and deterministic).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/compressor/__tests__/registry.test.ts`
Expected: PASS (new tests + existing registry tests unaffected — shell returns no-match for inputs without a matching command).

- [ ] **Step 5: Commit**

```bash
git add src/compressor/registry.ts src/compressor/__tests__/registry.test.ts
git commit -m "feat(compressor): register shell compressor with top precedence"
```

---

## Task 7: Command correlation in `compress()` + profile_id event + failure retention

**Files:**
- Modify: `src/compressor/index.ts`
- Test: `src/compressor/__tests__/shell-correlation.test.ts` (new)

**Interfaces:**
- Consumes: `compress()` existing signature; `AnthropicMessage`, `AnthropicToolUseContent` from `../orchestrator/types.js`.
- Produces:
  - `compress()` builds a `Map<string, { command: string; exit_code?: number }>` from Bash `tool_use` blocks and threads `command`/`exit_code` into each block's `routeCompression` via `CompressorInput`.
  - `BlockCompressEvent.profile_id` is populated for shell-compressed blocks.
  - When `exit_code !== 0` and a profile matched, the original is retained via the existing `maybeRetainOriginal` path regardless of `min_original_tokens` (so failures are always expandable).

- [ ] **Step 1: Write the failing test in `src/compressor/__tests__/shell-correlation.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { compress } from "../index.js";
import type { CompressorConfig } from "../types.js";
import type { AnthropicMessage } from "../../orchestrator/types.js";

const config: CompressorConfig = {
  enabled: true,
  exclude: [],
  json_max_array_items: 20,
  mode: "balanced",
  compressors: { json: true, log: true, shell: true },
};

const messages: AnthropicMessage[] = [
  {
    role: "assistant",
    content: [
      { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "git status" } },
    ],
  },
  {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: "On branch main\nUntracked files:\n\tsrc/c.ts\n\tsrc/d.ts",
      },
    ],
  },
];

describe("shell command correlation", () => {
  it("compresses a tool_result using the originating Bash command and tags profile_id", () => {
    const result = compress(messages, config, { model: "claude-sonnet-4-6" });
    const event = result.events.find((e) => e.tool_use_id === "toolu_1");
    expect(event?.content_type).toBe("shell");
    expect(event?.profile_id).toBe("git-status");
    expect(event?.tokens_saved).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/compressor/__tests__/shell-correlation.test.ts`
Expected: FAIL — `content_type` is `"log"`/`"passthrough"` and `profile_id` is undefined (command not yet threaded through).

- [ ] **Step 3: Build the command map and thread it through `compress()` in `src/compressor/index.ts`**

Add a helper near the top of the file (after imports):

```typescript
interface CommandInfo {
  command: string;
  exit_code?: number;
}

function buildCommandMap(messages: AnthropicMessage[]): Map<string, CommandInfo> {
  const map = new Map<string, CommandInfo>();
  for (const msg of messages) {
    for (const block of msg.content) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as { type?: string }).type === "tool_use" &&
        (block as { name?: string }).name === "Bash"
      ) {
        const id = (block as { id?: string }).id;
        const input = (block as { input?: unknown }).input;
        const command =
          typeof input === "object" && input !== null && typeof (input as { command?: unknown }).command === "string"
            ? (input as { command: string }).command
            : undefined;
        if (typeof id === "string" && command !== undefined) {
          map.set(id, { command });
        }
      }
    }
  }
  return map;
}
```

Change `compressBlock` to accept `CommandInfo` and pass it into `routeCompression`. Update the signature and the `routeCompression` call:

```typescript
function compressBlock(
  block: ToolResultContentBlock,
  config: CompressorConfig,
  options: CompressOptions,
  commandInfo: CommandInfo | undefined,
): { compressed: ToolResultContentBlock; event: BlockCompressEvent } | null {
```

Inside `compressBlock`, where `routeCompression` is called (currently `index.ts:128`), add the command fields:

```typescript
    const routed = routeCompression({
      tool_use_id: block.tool_use_id,
      content: text,
      mode,
      json_max_array_items: config.json_max_array_items,
      command: commandInfo?.command,
      exit_code: commandInfo?.exit_code,
    });
```

Add `profile_id` to the returned event. Compute it from the routed compressor:

```typescript
    const profileId =
      routed.compressor_id === "shell" && commandInfo !== undefined
        ? matchProfile(commandInfo.command)?.id
        : undefined;
```

…and include `profile_id: useCompressed ? profileId : undefined,` in the `event` object.

Add the import at the top of `index.ts`:

```typescript
import { matchProfile } from "./shell-profiles.js";
```

In `compress()`, build the map once and pass the matching entry per block. Replace the `msg.content.map` body's `compressBlock` call:

```typescript
  const commandMap = buildCommandMap(messages);
```

(place this right after `const events: BlockCompressEvent[] = [];`), then:

```typescript
        const toolBlock = block as ToolResultContentBlock;
        const result = compressBlock(toolBlock, config, options, commandMap.get(toolBlock.tool_use_id));
```

- [ ] **Step 4: Run the correlation test to verify it passes**

Run: `npx vitest run src/compressor/__tests__/shell-correlation.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failure-retention test (append to `shell-correlation.test.ts`)**

```typescript
it("retains the original on a failed command regardless of min_original_tokens", () => {
  const failMessages: AnthropicMessage[] = [
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "vitest run" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "✗ b.test.ts > fails\n  expected 1 received 2\nTests 1 failed | 0 passed" }] },
  ];
  const retained: string[] = [];
  const retentionConfig: CompressorConfig = {
    ...config,
    retention: { enabled: true, min_original_tokens: 1_000_000, ttl_days: 7 },
  };
  compress(failMessages, retentionConfig, {
    model: "claude-sonnet-4-6",
    retainOriginal: () => { retained.push("toolu_2"); return "handle_2"; },
  });
  expect(retained).toContain("toolu_2");
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/compressor/__tests__/shell-correlation.test.ts -t "failed command"`
Expected: FAIL — retention is gated by `min_original_tokens` (1,000,000), so `retainOriginal` is never called.

- [ ] **Step 7: Add failure-retention override in `maybeRetainOriginal` (`src/compressor/index.ts:48-84`)**

Thread the exit code and profile match into the retention decision. Change `maybeRetainOriginal`'s params to accept `is_failure: boolean`, and relax the `min_original_tokens` gate when it is a failure:

In the guard condition, replace:

```typescript
    params.originalTokens < retention.min_original_tokens
```

with:

```typescript
    (params.originalTokens < retention.min_original_tokens && !params.is_failure)
```

Add `is_failure: boolean;` to the `maybeRetainOriginal` params type, and at its call site inside `compressBlock` pass:

```typescript
        is_failure: commandInfo?.exit_code !== undefined && commandInfo.exit_code !== 0,
```

- [ ] **Step 8: Run both correlation tests to verify they pass**

Run: `npx vitest run src/compressor/__tests__/shell-correlation.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/compressor/index.ts src/compressor/__tests__/shell-correlation.test.ts
git commit -m "feat(compressor): correlate Bash command, tag profile_id, retain on failure"
```

---

## Task 8: Cache-stability regression test

**Files:**
- Test: `src/compressor/__tests__/shell-correlation.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `compress()` from Task 7.
- Produces: a guard test asserting byte-identical compressed output across 3 identical-input runs (mirrors the merge-blocking cache-stability gate at the compressor level).

- [ ] **Step 1: Write the determinism/stability test**

```typescript
import { createHash } from "node:crypto";

describe("shell compression cache stability", () => {
  it("produces byte-identical output across 3 identical runs", () => {
    const run = () => {
      const r = compress(messages, config, { model: "claude-sonnet-4-6" });
      return JSON.stringify(r.messages);
    };
    const hashes = [run(), run(), run()].map((s) => createHash("sha256").update(s).digest("hex"));
    expect(new Set(hashes).size).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/compressor/__tests__/shell-correlation.test.ts -t "cache stability"`
Expected: PASS (profiles are deterministic; this is a regression guard, expected green on first run).

- [ ] **Step 3: Commit**

```bash
git add src/compressor/__tests__/shell-correlation.test.ts
git commit -m "test(compressor): guard shell-compression cache stability"
```

---

## Task 9: Surface `profile_id` in the report dashboard

**Files:**
- Modify: `src/report/query.ts` (compression-event query/aggregation)
- Modify: `src/report/render-html.ts` (savings table)
- Test: `src/report/__tests__/query.test.ts`

**Interfaces:**
- Consumes: `BlockCompressEvent.profile_id` (Task 1); existing report query that reads compression events.
- Produces: per-profile savings aggregation surfaced in the dashboard (RTK `rtk gain` equivalent).

> **Note:** the exact aggregation shape depends on how `src/report/query.ts` currently groups compression events. Before writing code, read `src/report/query.ts` and `src/report/types.ts` to find the existing compression-savings aggregation and extend it with a `by_profile` grouping keyed on `profile_id`. Follow the established grouping pattern in that file rather than inventing a new one.

- [ ] **Step 1: Read the current compression aggregation**

Run: `grep -n "compress\|profile\|by_\|group" src/report/query.ts src/report/types.ts`
Identify the function that aggregates `BlockCompressEvent`s and the type it returns.

- [ ] **Step 2: Write the failing test in `src/report/__tests__/query.test.ts`**

Following the existing test style in that file, add a test that feeds two shell events with distinct `profile_id`s (e.g. `"git-status"`, `"test-run"`) and asserts the aggregation returns a `by_profile` map with per-profile `tokens_saved` summed correctly. (Use the same fixture/seed helpers the existing tests use — read them first.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/report/__tests__/query.test.ts -t "by_profile"`
Expected: FAIL — aggregation has no `by_profile` field.

- [ ] **Step 4: Add the `by_profile` grouping**

Extend the aggregation function (and its return type in `src/report/types.ts`) with a `by_profile: Record<string, { tokens_saved: number; count: number }>`, summing over events that have a `profile_id`. Then add a small table to `src/report/render-html.ts` rendering profile → tokens saved, mirroring the existing savings table markup.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/report/__tests__/query.test.ts && npx vitest run src/report/__tests__/render-html.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/report/query.ts src/report/render-html.ts src/report/types.ts src/report/__tests__/query.test.ts
git commit -m "feat(report): surface per-profile shell-compression savings"
```

---

## Task 10: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `nvm use 20 && npm test`
Expected: all green, including new shell-compressor and report tests.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Paste all three outputs** into the completion report before claiming done (per `verification-before-completion`).

- [ ] **Step 5: Final commit if any lint/type fixes were needed**

```bash
git add -A
git commit -m "chore(compressor): verification fixes for shell compression"
```

---

## Self-Review

**Spec coverage:**
- §3.1 command correlation → Task 7 ✓
- §3.3 routing precedence shell→json→log→passthrough → Task 6 ✓
- §4 six profiles → Tasks 3–4 ✓
- §4 determinism → Tasks 3, 4, 8 ✓
- §5 cache interaction → Task 8 (regression guard) ✓
- §6.1 analytics/profile_id → Tasks 1, 7, 9 ✓
- §6.2 failure tee/recovery → Task 7 (steps 5–7) ✓
- §6.3 per-profile config → Tasks 1, 2 ✓
- §7 fail-open → reuses existing `compressBlock` try/catch (unchanged); covered by existing tests + new no-match fall-through (Task 6) ✓
- §8 testing strategy → Tasks 3–9 (fixtures, table-driven, determinism, stability, never-worse via existing guard, fail-open, correlation) ✓

**Open questions from spec §11 resolved in plan:**
1. Failure retention vs global toggle → Task 7 retains on failure regardless of `min_original_tokens` but still requires `retention.enabled` (privacy posture stays explicit). If the binding spec demands retention even when globally off, that's a follow-up — flagged, not silently assumed.
2. Bash tool identification → Task 7 keys on `name === "Bash"`. **Verify** during execution that Claude Code uses exactly `"Bash"` as the tool name; adjust the match if the harness differs.
3. Exit code availability → Task 7's `CommandInfo.exit_code` is currently always `undefined` (Bash `tool_use.input` carries no exit code). Failure detection therefore degrades to "never a failure" until a source for exit code is wired. **This is a known limitation** — documented here, not hidden. A follow-up can parse exit status from `tool_result` text signatures if needed.
4. Profile match specificity → Tasks 3–4 use anchored leading-token regexes (`^git\s+status\b`, `^(npm|pnpm|yarn)\s+(install|i|ci)\b`, etc.).

**Placeholder scan:** Task 9 intentionally defers exact aggregation shape to a read-first step because the report module's grouping pattern must be followed, not invented — every other task has complete code. This is a deliberate "follow the existing pattern" instruction, not a TBD.

**Type consistency:** `CompressorInput.command`/`exit_code`, `BlockCompressEvent.profile_id`, `compressors.shell`, `matchProfile`, `compressShell`, `shellCompressor`, `content_type: "shell"` are used identically across Tasks 1–9.

**Known limitation (carry into execution):** exit-code-driven failure recovery (§6.2) is structurally complete but inert until a real exit-code source exists (open question 3). Flag this to the user at execution time.
