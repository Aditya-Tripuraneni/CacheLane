# M1 Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the CacheLane repository and implement the four M1 foundation modules (`types`, `config`, `storage`, `tokenizer`) with full unit tests.

**Architecture:** Strict downward-only module layering (`types` ← `config` / `storage` / `tokenizer`; none of the three may import each other). TypeScript NodeNext ESM, single-file SQLite in WAL mode, Zod config validation, model-string lookup table for the Anthropic tokenizer.

**Tech Stack:** TypeScript 5, Node.js ≥ 20.10, `vitest` ^2, `better-sqlite3` ^11, `zod` ^3, `@anthropic-ai/tokenizer` ^0, `ulid` ^2, `tsup` ^8, ESLint ^9 + `eslint-plugin-import` for `no-restricted-paths`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `package.json` | Deps, scripts |
| Create | `tsconfig.json` | TypeScript NodeNext ESM |
| Create | `vitest.config.ts` | Test runner config |
| Create | `tsup.config.ts` | Dual ESM/CJS build (entry wired in M7) |
| Create | `eslint.config.js` | Module layering enforcement |
| Create | `src/types/index.ts` | All shared types/interfaces |
| Create | `src/types/__tests__/types.test.ts` | Shape and union-completeness tests |
| Create | `src/config/defaults.ts` | Default config values + version constant |
| Create | `src/config/index.ts` | Zod schema, `loadConfig`, version guard |
| Create | `src/config/__tests__/config.test.ts` | Load, validate, version guard, malformed JSON |
| Create | `src/storage/migrations/001_initial.sql` | Initial SQLite schema |
| Create | `src/storage/index.ts` | DB open (WAL + integrity check), CRUD |
| Create | `src/storage/__tests__/storage.test.ts` | WAL open, schema, CRUD, corruption recovery |
| Create | `src/tokenizer/model-table.ts` | Model ID → tokenizer config lookup |
| Create | `src/tokenizer/index.ts` | `countTokens(text, modelId)` wrapper |
| Create | `src/tokenizer/__tests__/tokenizer.test.ts` | Lookup, count, 4.6 + 4.7 validated (AC-14) |

---

## Task 0: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `tsup.config.ts`
- Create: `eslint.config.js`

Gate: `npm install` succeeds and `npx vitest run` exits 0.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "cachelane",
  "version": "0.0.1",
  "description": "Cache-aware prompt orchestration for Claude Code",
  "license": "MIT",
  "type": "module",
  "engines": {
    "node": ">=20.10"
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src"
  },
  "dependencies": {
    "@anthropic-ai/tokenizer": "^0.0.4",
    "better-sqlite3": "^11.0.0",
    "ulid": "^2.3.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.14.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^9.0.0",
    "eslint-plugin-import": "^2.29.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
  },
});
```

- [ ] **Step 4: Write `tsup.config.ts`**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "node20",
});
```

Note: `src/index.ts` (the barrel entry) is assembled in M7. `npm run build` will fail until then — `npm test` is the only M1 gate.

- [ ] **Step 5: Write `eslint.config.js`**

```javascript
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

export default [
  {
    files: ["src/**/*.ts"],
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
    },
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // Enforce strict downward-only module layering.
      // config / storage / tokenizer MUST NOT import each other.
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            { target: "./src/config", from: "./src/storage" },
            { target: "./src/config", from: "./src/tokenizer" },
            { target: "./src/storage", from: "./src/config" },
            { target: "./src/storage", from: "./src/tokenizer" },
            { target: "./src/tokenizer", from: "./src/config" },
            { target: "./src/tokenizer", from: "./src/storage" },
          ],
        },
      ],
    },
  },
];
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`

Expected: `node_modules/` created, `package-lock.json` written, no errors.

- [ ] **Step 7: Verify vitest runs (no test files yet is fine)**

Run: `npx vitest run`

Expected: exits 0 (may warn "no test files found").

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts tsup.config.ts eslint.config.js package-lock.json
git commit -m "feat: project scaffolding — package.json, tsconfig, vitest, tsup, eslint"
```

---

## Task 1: `types` module

**Files:**
- Create: `src/types/index.ts`
- Create: `src/types/__tests__/types.test.ts`

The types module is pure TypeScript interfaces and union types. Tests verify that all unions are complete and that required/optional fields are constructable at runtime.

- [ ] **Step 1: Write the failing test**

Create `src/types/__tests__/types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type {
  Block,
  BlockKind,
  Volatility,
  PrefixState,
  TtlClass,
  CachelaneConfig,
  ReferenceType,
} from "../index.js";

describe("types", () => {
  it("Volatility union contains exactly STABLE | SEMI | VOLATILE", () => {
    const values: Volatility[] = ["STABLE", "SEMI", "VOLATILE"];
    expect(values).toHaveLength(3);
  });

  it("TtlClass union contains exactly 5m | 1h", () => {
    const values: TtlClass[] = ["5m", "1h"];
    expect(values).toHaveLength(2);
  });

  it("BlockKind union covers all 9 kinds", () => {
    const values: BlockKind[] = [
      "system_prompt",
      "tool_schema",
      "project_rule",
      "prior_turn",
      "file_read",
      "tool_output",
      "retrieval",
      "user_message",
      "stub",
    ];
    expect(values).toHaveLength(9);
  });

  it("Block is constructable with required fields only", () => {
    const block: Block = {
      id: "01HZXQ5K0000000000000001",
      kind: "file_read",
      volatility: "SEMI",
      tokenCount: 1234,
      contentHash: "a".repeat(64),
      unusedTurns: 0,
      isStub: false,
    };
    expect(block.volatility).toBe("SEMI");
    expect(block.refetchHandle).toBeUndefined();
  });

  it("Block with optional refetchHandle is constructable", () => {
    const stub: Block = {
      id: "01HZXQ5K0000000000000002",
      kind: "stub",
      volatility: "VOLATILE",
      tokenCount: 50,
      contentHash: "b".repeat(64),
      unusedTurns: 3,
      isStub: true,
      refetchHandle: "view:auth.py:23-89",
    };
    expect(stub.refetchHandle).toBe("view:auth.py:23-89");
  });

  it("PrefixState is constructable", () => {
    const state: PrefixState = {
      workspaceId: "ws-abc",
      prefixHash: "c".repeat(64),
      middleHash: "d".repeat(64),
      prefixTokenCount: 8000,
      ttlClass: "5m",
      cachedAtMs: 1715000000000,
      lastReadAtMs: 1715000010000,
      expectedExpiryMs: 1715000300000,
    };
    expect(state.ttlClass).toBe("5m");
  });

  it("ReferenceType union covers all 3 reference kinds", () => {
    const values: ReferenceType[] = ["tool_call", "text_quote", "id_mention"];
    expect(values).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/types/__tests__/types.test.ts`

Expected: FAIL — `Cannot find module '../index.js'`

- [ ] **Step 3: Write `src/types/index.ts`**

```typescript
export type Volatility = "STABLE" | "SEMI" | "VOLATILE";

export type TtlClass = "5m" | "1h";

export type BlockKind =
  | "system_prompt"
  | "tool_schema"
  | "project_rule"
  | "prior_turn"
  | "file_read"
  | "tool_output"
  | "retrieval"
  | "user_message"
  | "stub";

export type ReferenceType = "tool_call" | "text_quote" | "id_mention";

export interface Block {
  id: string;
  kind: BlockKind;
  volatility: Volatility;
  tokenCount: number;
  contentHash: string;
  unusedTurns: number;
  isStub: boolean;
  refetchHandle?: string;
}

export interface PrefixState {
  workspaceId: string;
  prefixHash: string;
  middleHash: string;
  prefixTokenCount: number;
  ttlClass: TtlClass;
  cachedAtMs: number;
  lastReadAtMs: number;
  expectedExpiryMs: number;
}

export interface CachelaneConfig {
  version: number;
  pruner: {
    enabled: boolean;
    k: number;
    mode: "default" | "conservative" | "aggressive";
  };
  keepalive: {
    policy: "off" | "static" | "adaptive" | "auto";
    interval_seconds: number;
    idle_threshold_seconds: number;
    large_prefix_threshold_tokens: number;
  };
  classification: {
    sliding_window_turns: number;
  };
  telemetry: {
    opt_in: boolean;
  };
  log_level: "trace" | "debug" | "info" | "warn" | "error";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/types/__tests__/types.test.ts`

Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/types/__tests__/types.test.ts
git commit -m "feat(types): all M1 shared types and interfaces (Block, PrefixState, CachelaneConfig)"
```

---

## Task 2: `config` module

**Files:**
- Create: `src/config/defaults.ts`
- Create: `src/config/index.ts`
- Create: `src/config/__tests__/config.test.ts`

Implements REQ-F-022 (`~/.cachelane/config.json`, versioned schema), Zod validation, version guard (newer → refuse to start; older → migrate), and malformed-JSON fallback.

- [ ] **Step 1: Write the failing test**

Create `src/config/__tests__/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, CURRENT_CONFIG_VERSION } from "../index.js";
import type { CachelaneConfig } from "../../types/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-test-cfg-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("creates config with defaults when file does not exist", async () => {
    const configPath = path.join(tmpDir, "config.json");
    const config = await loadConfig(configPath);

    expect(config.version).toBe(CURRENT_CONFIG_VERSION);
    expect(config.pruner.k).toBe(3);
    expect(config.pruner.mode).toBe("default");
    expect(config.pruner.enabled).toBe(true);
    expect(config.keepalive.policy).toBe("auto");
    expect(config.keepalive.interval_seconds).toBe(150);
    expect(config.keepalive.idle_threshold_seconds).toBe(240);
    expect(config.keepalive.large_prefix_threshold_tokens).toBe(50000);
    expect(config.classification.sliding_window_turns).toBe(4);
    expect(config.telemetry.opt_in).toBe(false);
    expect(config.log_level).toBe("info");
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it("loads valid existing config unchanged", async () => {
    const configPath = path.join(tmpDir, "config.json");
    const custom: CachelaneConfig = {
      version: CURRENT_CONFIG_VERSION,
      pruner: { enabled: true, k: 5, mode: "conservative" },
      keepalive: {
        policy: "static",
        interval_seconds: 120,
        idle_threshold_seconds: 300,
        large_prefix_threshold_tokens: 60000,
      },
      classification: { sliding_window_turns: 6 },
      telemetry: { opt_in: false },
      log_level: "debug",
    };
    fs.writeFileSync(configPath, JSON.stringify(custom));

    const config = await loadConfig(configPath);
    expect(config.pruner.k).toBe(5);
    expect(config.pruner.mode).toBe("conservative");
    expect(config.log_level).toBe("debug");
  });

  it("throws when config schema version is newer than supported", async () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ version: CURRENT_CONFIG_VERSION + 1 })
    );

    await expect(loadConfig(configPath)).rejects.toThrow(
      /config schema version.*newer than supported/i
    );
  });

  it("falls back to defaults when config JSON is malformed", async () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, "{ not valid json }");

    const config = await loadConfig(configPath);
    expect(config.version).toBe(CURRENT_CONFIG_VERSION);
    expect(config.pruner.k).toBe(3);
  });

  it("rejects pruner.k outside range 1–10", async () => {
    const configPath = path.join(tmpDir, "config.json");
    const invalid: CachelaneConfig = {
      version: CURRENT_CONFIG_VERSION,
      pruner: { enabled: true, k: 99, mode: "default" },
      keepalive: {
        policy: "auto",
        interval_seconds: 150,
        idle_threshold_seconds: 240,
        large_prefix_threshold_tokens: 50000,
      },
      classification: { sliding_window_turns: 4 },
      telemetry: { opt_in: false },
      log_level: "info",
    };
    fs.writeFileSync(configPath, JSON.stringify(invalid));

    await expect(loadConfig(configPath)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/__tests__/config.test.ts`

Expected: FAIL — `Cannot find module '../index.js'`

- [ ] **Step 3: Write `src/config/defaults.ts`**

```typescript
import type { CachelaneConfig } from "../types/index.js";

export const CURRENT_CONFIG_VERSION = 1;

export const DEFAULT_CONFIG: CachelaneConfig = {
  version: CURRENT_CONFIG_VERSION,
  pruner: {
    enabled: true,
    k: 3,
    mode: "default",
  },
  keepalive: {
    policy: "auto",
    interval_seconds: 150,
    idle_threshold_seconds: 240,
    large_prefix_threshold_tokens: 50000,
  },
  classification: {
    sliding_window_turns: 4,
  },
  telemetry: {
    opt_in: false,
  },
  log_level: "info",
};
```

- [ ] **Step 4: Write `src/config/index.ts`**

```typescript
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CURRENT_CONFIG_VERSION, DEFAULT_CONFIG } from "./defaults.js";
import type { CachelaneConfig } from "../types/index.js";

export { CURRENT_CONFIG_VERSION } from "./defaults.js";

const configSchema = z.object({
  version: z.number().int().positive(),
  pruner: z.object({
    enabled: z.boolean(),
    k: z.number().int().min(1).max(10),
    mode: z.enum(["default", "conservative", "aggressive"]),
  }),
  keepalive: z.object({
    policy: z.enum(["off", "static", "adaptive", "auto"]),
    interval_seconds: z.number().int().positive(),
    idle_threshold_seconds: z.number().int().positive(),
    large_prefix_threshold_tokens: z.number().int().positive(),
  }),
  classification: z.object({
    sliding_window_turns: z.number().int().positive(),
  }),
  telemetry: z.object({
    opt_in: z.boolean(),
  }),
  log_level: z.enum(["trace", "debug", "info", "warn", "error"]),
});

export async function loadConfig(configPath: string): Promise<CachelaneConfig> {
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    "version" in raw &&
    typeof (raw as { version: unknown }).version === "number" &&
    (raw as { version: number }).version > CURRENT_CONFIG_VERSION
  ) {
    throw new Error(
      `config schema version ${(raw as { version: number }).version} is newer than supported (${CURRENT_CONFIG_VERSION})`
    );
  }

  return configSchema.parse(raw) as CachelaneConfig;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/config/__tests__/config.test.ts`

Expected: PASS — all 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/config/defaults.ts src/config/index.ts src/config/__tests__/config.test.ts
git commit -m "feat(config): zod-validated config with version guard and defaults (REQ-F-022)"
```

---

## Task 3: `storage` module

**Files:**
- Create: `src/storage/migrations/001_initial.sql`
- Create: `src/storage/index.ts`
- Create: `src/storage/__tests__/storage.test.ts`

Implements REQ-F-004 (better-sqlite3, WAL mode), the full three-table schema, CRUD operations, and SQLite corruption recovery. All tests use a temp directory.

- [ ] **Step 1: Write the failing test**

Create `src/storage/__tests__/storage.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../index.js";
import type { CachelaneDb } from "../index.js";

let tmpDir: string;
let db: CachelaneDb;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-test-db-"));
});

afterEach(() => {
  try { db?.close(); } catch { /* ignore */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("openDatabase", () => {
  it("opens in WAL journal mode", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const rows = db.pragma("journal_mode") as { journal_mode: string }[];
    expect(rows[0].journal_mode).toBe("wal");
  });

  it("applies schema — blocks, turns, block_references tables exist", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("blocks");
    expect(names).toContain("turns");
    expect(names).toContain("block_references");
  });

  it("passes integrity_check on fresh DB", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const result = db.pragma("integrity_check") as { integrity_check: string }[];
    expect(result[0].integrity_check).toBe("ok");
  });

  it("renames corrupt file and creates fresh DB", () => {
    const dbPath = path.join(tmpDir, "corrupt.db");
    fs.writeFileSync(dbPath, "this is not a valid sqlite database");

    db = openDatabase(dbPath);

    const files = fs.readdirSync(tmpDir);
    const renamed = files.find((f) => f.startsWith("corrupt.db.corrupt-"));
    expect(renamed).toBeTruthy();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("blocks");
  });

  it("insertBlock + getBlock round-trip", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    db.insertBlock({
      id: "01HZXQ5K0000000000000001",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      kind: "file_read",
      volatility: "SEMI",
      tokenCount: 500,
      contentHash: "a".repeat(64),
      unusedTurns: 0,
      isStub: false,
      refetchHandle: null,
      createdAt: now,
      updatedAt: now,
    });

    const block = db.getBlock("01HZXQ5K0000000000000001");
    expect(block).not.toBeNull();
    expect(block!.kind).toBe("file_read");
    expect(block!.volatility).toBe("SEMI");
    expect(block!.token_count).toBe(500);
    expect(block!.is_stub).toBe(0);
  });

  it("incrementUnusedTurns increments counter and updates updated_at", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    db.insertBlock({
      id: "01HZXQ5K0000000000000002",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      kind: "tool_output",
      volatility: "VOLATILE",
      tokenCount: 200,
      contentHash: "b".repeat(64),
      unusedTurns: 0,
      isStub: false,
      refetchHandle: null,
      createdAt: now,
      updatedAt: now,
    });

    db.incrementUnusedTurns("01HZXQ5K0000000000000002", now + 1000);

    const block = db.getBlock("01HZXQ5K0000000000000002");
    expect(block!.unused_turns).toBe(1);
    expect(block!.updated_at).toBe(now + 1000);
  });

  it("insertTurn + getTurn round-trip with effective_cost_units", () => {
    db = openDatabase(path.join(tmpDir, "test.db"));
    const now = Date.now();

    db.insertTurn({
      id: "01HZXQ5K0000000000000010",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      turnNumber: 1,
      cacheCreation5mTokens: 1000,
      cacheCreation1hTokens: 0,
      cacheReadTokens: 500,
      inputTokens: 200,
      effectiveCostUnits: 200 + 1.25 * 1000 + 0.1 * 500,
      prefixBreakpointHash: "c".repeat(64),
      middleBreakpointHash: null,
      prunedBlocksCount: 0,
      keepalivePingsSinceLastTurn: 0,
      createdAt: now,
    });

    const turn = db.getTurn("01HZXQ5K0000000000000010");
    expect(turn).not.toBeNull();
    expect(turn!.turn_number).toBe(1);
    expect(turn!.cache_creation_5m_tokens).toBe(1000);
    expect(turn!.effective_cost_units).toBeCloseTo(1450, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/__tests__/storage.test.ts`

Expected: FAIL — `Cannot find module '../index.js'`

- [ ] **Step 3: Write `src/storage/migrations/001_initial.sql`**

```sql
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  volatility TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  unused_turns INTEGER NOT NULL DEFAULT 0,
  is_stub INTEGER NOT NULL DEFAULT 0,
  refetch_handle TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocks_workspace_session
  ON blocks(workspace_id, session_id);

CREATE INDEX IF NOT EXISTS idx_blocks_content_hash
  ON blocks(content_hash);

CREATE INDEX IF NOT EXISTS idx_blocks_unused
  ON blocks(unused_turns) WHERE is_stub = 0;

CREATE TABLE IF NOT EXISTS turns (
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

CREATE TABLE IF NOT EXISTS block_references (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL REFERENCES blocks(id),
  turn_id TEXT NOT NULL REFERENCES turns(id),
  reference_type TEXT NOT NULL
);
```

- [ ] **Step 4: Write `src/storage/index.ts`**

```typescript
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations"
);

export interface BlockRow {
  id: string;
  workspace_id: string;
  session_id: string;
  kind: string;
  volatility: string;
  token_count: number;
  content_hash: string;
  unused_turns: number;
  is_stub: number;
  refetch_handle: string | null;
  created_at: number;
  updated_at: number;
}

export interface TurnRow {
  id: string;
  workspace_id: string;
  session_id: string;
  turn_number: number;
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  cache_read_tokens: number;
  input_tokens: number;
  effective_cost_units: number;
  prefix_breakpoint_hash: string | null;
  middle_breakpoint_hash: string | null;
  pruned_blocks_count: number;
  keepalive_pings_since_last_turn: number;
  created_at: number;
}

export interface InsertBlockParams {
  id: string;
  workspaceId: string;
  sessionId: string;
  kind: string;
  volatility: string;
  tokenCount: number;
  contentHash: string;
  unusedTurns: number;
  isStub: boolean;
  refetchHandle: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface InsertTurnParams {
  id: string;
  workspaceId: string;
  sessionId: string;
  turnNumber: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
  inputTokens: number;
  effectiveCostUnits: number;
  prefixBreakpointHash: string | null;
  middleBreakpointHash: string | null;
  prunedBlocksCount: number;
  keepalivePingsSinceLastTurn: number;
  createdAt: number;
}

export interface CachelaneDb extends Database.Database {
  insertBlock(params: InsertBlockParams): void;
  getBlock(id: string): BlockRow | null;
  incrementUnusedTurns(id: string, updatedAt: number): void;
  markStub(id: string, refetchHandle: string, updatedAt: number): void;
  insertTurn(params: InsertTurnParams): void;
  getTurn(id: string): TurnRow | null;
}

function applyMigrations(db: Database.Database): void {
  const sql = fs.readFileSync(
    path.join(MIGRATION_DIR, "001_initial.sql"),
    "utf-8"
  );
  db.exec(sql);
}

function tryOpen(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

export function openDatabase(dbPath: string): CachelaneDb {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  let rawDb: Database.Database;
  try {
    rawDb = tryOpen(dbPath);
    const result = rawDb.pragma("integrity_check") as {
      integrity_check: string;
    }[];
    if (result[0].integrity_check !== "ok") {
      rawDb.close();
      throw new Error("integrity_check failed");
    }
  } catch {
    const corruptPath = `${dbPath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(dbPath, corruptPath);
    } catch {
      // ignore if rename fails (e.g. file already gone)
    }
    rawDb = tryOpen(dbPath);
  }

  const insertBlockStmt = rawDb.prepare(`
    INSERT INTO blocks
      (id, workspace_id, session_id, kind, volatility, token_count,
       content_hash, unused_turns, is_stub, refetch_handle, created_at, updated_at)
    VALUES
      (@id, @workspaceId, @sessionId, @kind, @volatility, @tokenCount,
       @contentHash, @unusedTurns, @isStub, @refetchHandle, @createdAt, @updatedAt)
  `);

  const getBlockStmt = rawDb.prepare("SELECT * FROM blocks WHERE id = ?");

  const incrementUnusedTurnsStmt = rawDb.prepare(
    "UPDATE blocks SET unused_turns = unused_turns + 1, updated_at = ? WHERE id = ?"
  );

  const markStubStmt = rawDb.prepare(
    "UPDATE blocks SET is_stub = 1, refetch_handle = ?, updated_at = ? WHERE id = ?"
  );

  const insertTurnStmt = rawDb.prepare(`
    INSERT INTO turns
      (id, workspace_id, session_id, turn_number,
       cache_creation_5m_tokens, cache_creation_1h_tokens, cache_read_tokens,
       input_tokens, effective_cost_units, prefix_breakpoint_hash,
       middle_breakpoint_hash, pruned_blocks_count, keepalive_pings_since_last_turn,
       created_at)
    VALUES
      (@id, @workspaceId, @sessionId, @turnNumber,
       @cacheCreation5mTokens, @cacheCreation1hTokens, @cacheReadTokens,
       @inputTokens, @effectiveCostUnits, @prefixBreakpointHash,
       @middleBreakpointHash, @prunedBlocksCount, @keepalivePingsSinceLastTurn,
       @createdAt)
  `);

  const getTurnStmt = rawDb.prepare("SELECT * FROM turns WHERE id = ?");

  const db = rawDb as CachelaneDb;

  db.insertBlock = (p: InsertBlockParams) =>
    void insertBlockStmt.run({ ...p, isStub: p.isStub ? 1 : 0 });

  db.getBlock = (id: string) =>
    (getBlockStmt.get(id) as BlockRow | undefined) ?? null;

  db.incrementUnusedTurns = (id: string, updatedAt: number) =>
    void incrementUnusedTurnsStmt.run(updatedAt, id);

  db.markStub = (id: string, refetchHandle: string, updatedAt: number) =>
    void markStubStmt.run(refetchHandle, updatedAt, id);

  db.insertTurn = (p: InsertTurnParams) => void insertTurnStmt.run(p);

  db.getTurn = (id: string) =>
    (getTurnStmt.get(id) as TurnRow | undefined) ?? null;

  return db;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/storage/__tests__/storage.test.ts`

Expected: PASS — all 7 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/storage/migrations/001_initial.sql src/storage/index.ts src/storage/__tests__/storage.test.ts
git commit -m "feat(storage): WAL open, schema migration, block/turn CRUD, corruption recovery (REQ-F-004)"
```

---

## Task 4: `tokenizer` module

**Files:**
- Create: `src/tokenizer/model-table.ts`
- Create: `src/tokenizer/index.ts`
- Create: `src/tokenizer/__tests__/tokenizer.test.ts`

Implements REQ-F-003 + REQ-NF-027 + AC-14. The `@anthropic-ai/tokenizer` package exports `countTokens(text: string): number`. Our wrapper adds a model-string lookup that rejects unknown model IDs early — this is the mandatory guard against the Opus 4.7 / 4.6 tokenizer drift (up to 35% more tokens for same text).

- [ ] **Step 1: Confirm the installed tokenizer package API**

Run:
```bash
node --input-type=module <<'EOF'
import * as tok from "@anthropic-ai/tokenizer";
console.log(Object.keys(tok));
EOF
```

Expected output includes `"countTokens"`. If the package exposes model-specific functions (e.g., `countTokensForModel`), update `src/tokenizer/index.ts` in Step 5 to use that API instead of the generic `countTokens`.

- [ ] **Step 2: Write the failing test**

Create `src/tokenizer/__tests__/tokenizer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { countTokens, SUPPORTED_MODELS } from "../index.js";

const SAMPLE = "The quick brown fox jumps over the lazy dog.";

describe("countTokens", () => {
  it("returns a positive integer for claude-opus-4-6", () => {
    const n = countTokens(SAMPLE, "claude-opus-4-6");
    expect(n).toBeGreaterThan(0);
    expect(Number.isInteger(n)).toBe(true);
  });

  it("returns a positive integer for claude-opus-4-7", () => {
    const n = countTokens(SAMPLE, "claude-opus-4-7");
    expect(n).toBeGreaterThan(0);
    expect(Number.isInteger(n)).toBe(true);
  });

  it("throws for an unrecognised model string", () => {
    expect(() => countTokens(SAMPLE, "gpt-4-turbo")).toThrow(
      /unsupported model/i
    );
  });

  it("returns 0 for empty string", () => {
    expect(countTokens("", "claude-opus-4-7")).toBe(0);
  });

  it("SUPPORTED_MODELS includes both Opus 4.6 and 4.7", () => {
    expect(SUPPORTED_MODELS).toContain("claude-opus-4-6");
    expect(SUPPORTED_MODELS).toContain("claude-opus-4-7");
  });

  it("token count scales with input length", () => {
    const short = countTokens("Hello", "claude-opus-4-7");
    const long = countTokens("Hello ".repeat(100), "claude-opus-4-7");
    expect(long).toBeGreaterThan(short);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/tokenizer/__tests__/tokenizer.test.ts`

Expected: FAIL — `Cannot find module '../index.js'`

- [ ] **Step 4: Write `src/tokenizer/model-table.ts`**

```typescript
// Maps Anthropic model ID strings to tokenizer configuration.
// REQ-F-003: model-string lookup is mandatory.
// REQ-NF-027: Opus 4.7 produces up to 35% more tokens than 4.6 for same text;
// both entries ensure callers supply the correct model ID before cost accounting.
export const MODEL_TABLE: Record<string, { variant: "claude" }> = {
  "claude-opus-4-6": { variant: "claude" },
  "claude-opus-4-7": { variant: "claude" },
};

export const SUPPORTED_MODELS: string[] = Object.keys(MODEL_TABLE);
```

- [ ] **Step 5: Write `src/tokenizer/index.ts`**

```typescript
import { countTokens as _countTokens } from "@anthropic-ai/tokenizer";
import { MODEL_TABLE, SUPPORTED_MODELS } from "./model-table.js";

export { SUPPORTED_MODELS } from "./model-table.js";

/**
 * Count tokens in `text` for the given Anthropic model ID.
 * Throws for unknown model IDs so callers can't silently miscost a request (REQ-F-003).
 */
export function countTokens(text: string, modelId: string): number {
  if (!MODEL_TABLE[modelId]) {
    throw new Error(
      `unsupported model "${modelId}" — add it to src/tokenizer/model-table.ts. ` +
        `Supported: ${SUPPORTED_MODELS.join(", ")}`
    );
  }
  if (text.length === 0) {
    return 0;
  }
  return _countTokens(text);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/tokenizer/__tests__/tokenizer.test.ts`

Expected: PASS — all 6 tests green.

If any test fails because the package's actual export differs from `countTokens(text: string): number`, re-run Step 1 to inspect the exports, update the import in `index.ts` to match, and re-run.

- [ ] **Step 7: Commit**

```bash
git add src/tokenizer/model-table.ts src/tokenizer/index.ts src/tokenizer/__tests__/tokenizer.test.ts
git commit -m "feat(tokenizer): model-string lookup + countTokens wrapper for Opus 4.6 and 4.7 (AC-14)"
```

---

## Task 5: M1 Gate — Full Suite + Lint

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`

Expected: **≥ 24 tests passing** (6 types + 5 config + 7 storage + 6 tokenizer). Zero failures.

- [ ] **Step 2: Run lint**

Run: `npx eslint src`

Expected: 0 errors. Fix any violations before continuing.

- [ ] **Step 3: Verify M1 gate criteria from `designs/06-systems-design.md`**

> Gate: Unit tests per module. Tokenizer model-lookup test passes for 4.6 and 4.7.

- [ ] `src/types/__tests__/types.test.ts` — all passing
- [ ] `src/config/__tests__/config.test.ts` — all passing
- [ ] `src/storage/__tests__/storage.test.ts` — all passing
- [ ] `src/tokenizer/__tests__/tokenizer.test.ts` — all passing, including the two Opus 4.6/4.7 count tests (AC-14)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(m1): M1 gate — all unit tests passing, lint clean"
```

---

## Traceability Matrix

| Requirement | Task |
|-------------|------|
| REQ-F-003 — tokenizer model-string lookup | Task 4 (`model-table.ts`, `index.ts`) |
| REQ-F-004 — better-sqlite3 WAL mode | Task 3 (`pragma journal_mode = WAL`) |
| REQ-F-006 — SHA-256 via node:crypto | Defined in types (`contentHash`) and schema; SHA-256 usage in orchestrator (M3) |
| REQ-F-022 — config at `~/.cachelane/config.json` | Task 2 (`loadConfig(configPath)`) |
| REQ-NF-001 — Node.js ≥ 20.10 | Task 0 (`package.json` `engines`) |
| REQ-NF-027 — tokenizer drift awareness | Task 4 (`model-table.ts` comment + both entries) |
| AC-14 — tokenizer validated for 4.6 + 4.7 | Task 4 test — two model-specific `countTokens` assertions |
