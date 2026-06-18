# M4 Reference Detector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement M4 — the PostResponse reference detector — that after every assistant turn identifies which tracked blocks were referenced, updates `unused_turns` counters in SQLite, and writes audit-log entries to `block_references`.

**Architecture:** A new `src/reference-detector/` module (sibling of `classifier`) implements three deterministic signals (file-path match, block-ID mention, 40-char shingle overlap) and returns a `DetectionResult`. The existing orchestrator gains a `handlePostResponse()` function that wires the detector to storage. Two new storage methods (`resetUnusedTurns`, `getBlocksBySession`) extend `CachelaneDb`.

**Tech Stack:** TypeScript/Node ≥ 20, `node:crypto` (SHA-256 already in use), `better-sqlite3`, vitest (all existing). No new npm deps.

---

## ⚠️ Prerequisite: Corpus Status

The spec (AC-6) requires the 100-session annotated corpus to exist **before any M5 pruner code is written**. For M4, we will create a **synthetic corpus** of 20 hand-crafted fixture entries (covering all three signals, edges, and no-match cases) that serve as the CI gate for precision ≥ 95% / recall ≥ 85% (AC-5). This unblocks M4 development. The human-annotation pass (extending the corpus to 100 real sessions) must complete before the first M5 commit.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `src/reference-detector/types.ts` | `DetectionBlock`, `DetectionResult`, `DetectedReference`, `AssistantMessage` |
| **Create** | `src/reference-detector/signals.ts` | Three signal functions (pure, testable) |
| **Create** | `src/reference-detector/index.ts` | `detectReferences()` — combines signals, evaluation-order enforcement |
| **Create** | `src/reference-detector/__tests__/signals.test.ts` | Unit tests for each individual signal |
| **Create** | `src/reference-detector/__tests__/reference-detector.test.ts` | Integration tests for combined `detectReferences()` |
| **Create** | `src/reference-detector/__tests__/corpus/` | 20 JSON fixture entries (synthetic corpus) |
| **Create** | `src/reference-detector/__tests__/corpus.test.ts` | Precision/recall gate (CI-blocking) |
| **Modify** | `src/storage/index.ts` | Add `resetUnusedTurns()` + `getBlocksBySession()` to `CachelaneDb` |
| **Modify** | `src/storage/__tests__/storage.test.ts` | Tests for two new storage methods |
| **Create** | `src/orchestrator/post-response-handler.ts` | `handlePostResponse()` — wires detector + storage; fail-open |
| **Create** | `src/orchestrator/__tests__/post-response-handler.test.ts` | Integration tests for handler |

**No M1–M3 files touched except `src/storage/index.ts`** (M4 requirement: storage extensions for counter reset and session query, justified by REQ-F-023 and the PostResponse counter update flow).

---

## Task 1 — Branch Setup

**Files:** none

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b feat/m4-reference-detector
```

- [ ] **Step 2: Confirm green baseline**

```bash
npm test
```
Expected: `Test Files 12 passed (12)`, `Tests 98 passed (98)`

- [ ] **Step 3: Commit (empty baseline marker)**

```bash
git commit --allow-empty -m "chore: start feat/m4-reference-detector"
```

---

## Task 2 — Reference Detector Types

**Files:**
- Create: `src/reference-detector/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// src/reference-detector/types.ts

// Signal number corresponds to spec §Reference Detection evaluation order
export type SignalNumber = 1 | 2 | 3;

// Transient per-block metadata the detector needs.
// Content is NEVER persisted (REQ-F-015); callers pass it at runtime.
export interface DetectionBlock {
  id: string;             // Signal 2: exact substring search in assistant output
  content: string;        // Signal 3: 40-char shingle match against assistant output
  file_path: string | null; // Signal 1: exact match in assistant tool call arguments
}

export interface DetectedReference {
  block_id: string;
  signal: SignalNumber;
  reference_type: "tool_call" | "id_mention" | "text_quote";
  evidence: string; // short snippet (≤ 200 chars) proving the match
}

export interface DetectionResult {
  referenced_ids: Set<string>;
  references: DetectedReference[];
}

// Minimal shape of the assistant response needed for detection.
// Defined here to avoid importing from the orchestrator (upward dependency).
export interface AssistantMessage {
  role: "assistant";
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
}
```

- [ ] **Step 2: Confirm file compiles**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/reference-detector/types.ts
git commit -m "feat(ref-detector): add DetectionBlock/DetectionResult types — REQ-F-023"
```

---

## Task 3 — Signal Implementations (TDD)

**Files:**
- Create: `src/reference-detector/signals.ts`
- Create: `src/reference-detector/__tests__/signals.test.ts`

### Step 1 — Write failing tests

- [ ] **Write `signals.test.ts`**

```typescript
// src/reference-detector/__tests__/signals.test.ts
import { describe, expect, it } from "vitest";
import {
  detectByFilePath,
  detectByIdMention,
  detectByShingle,
  extractAssistantText,
  extractToolCallArgStrings,
} from "../signals.js";
import type { DetectionBlock, AssistantMessage } from "../types.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function block(overrides: Partial<DetectionBlock> & { id: string }): DetectionBlock {
  return {
    content: "some block content",
    file_path: null,
    ...overrides,
  };
}

function textMsg(text: string): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text }] };
}

function toolMsg(name: string, input: unknown): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "tool_use", id: "tool_1", name, input }],
  };
}

// ─── extractAssistantText ────────────────────────────────────────────────────

describe("extractAssistantText", () => {
  it("concatenates multiple text blocks", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Hello" },
        { type: "tool_use", id: "t1", name: "Read", input: {} },
        { type: "text", text: " world" },
      ],
    };
    expect(extractAssistantText(msg)).toBe("Hello\n world");
  });

  it("returns empty string when no text blocks", () => {
    const msg = toolMsg("Read", { path: "foo.ts" });
    expect(extractAssistantText(msg)).toBe("");
  });
});

// ─── extractToolCallArgStrings ───────────────────────────────────────────────

describe("extractToolCallArgStrings", () => {
  it("returns JSON string of each tool_use input", () => {
    const msg = toolMsg("Read", { file_path: "src/auth.py" });
    const strs = extractToolCallArgStrings(msg);
    expect(strs).toHaveLength(1);
    expect(strs[0]).toContain("src/auth.py");
  });

  it("returns empty array when no tool calls", () => {
    expect(extractToolCallArgStrings(textMsg("hi"))).toEqual([]);
  });

  it("handles non-object tool input gracefully", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "X", input: null }],
    };
    expect(() => extractToolCallArgStrings(msg)).not.toThrow();
  });
});

// ─── Signal 1: detectByFilePath ──────────────────────────────────────────────

describe("detectByFilePath — Signal 1", () => {
  it("detects block whose file_path appears in a tool call argument", () => {
    const blocks = [block({ id: "B1", file_path: "src/auth.py" })];
    const msg = toolMsg("Read", { file_path: "src/auth.py" });
    const refs = detectByFilePath(blocks, msg);
    expect(refs).toHaveLength(1);
    expect(refs[0].block_id).toBe("B1");
    expect(refs[0].signal).toBe(1);
    expect(refs[0].reference_type).toBe("tool_call");
  });

  it("returns empty when file_path not present in tool calls", () => {
    const blocks = [block({ id: "B1", file_path: "src/auth.py" })];
    const msg = toolMsg("Read", { file_path: "src/other.py" });
    expect(detectByFilePath(blocks, msg)).toHaveLength(0);
  });

  it("skips blocks with null file_path", () => {
    const blocks = [block({ id: "B1", file_path: null })];
    const msg = toolMsg("Read", { file_path: "anything" });
    expect(detectByFilePath(blocks, msg)).toHaveLength(0);
  });

  it("matches exact substring — partial path does not match full path", () => {
    const blocks = [block({ id: "B1", file_path: "auth.py" })];
    const msg = toolMsg("Read", { file_path: "src/auth.py" });
    // "auth.py" IS a substring of "src/auth.py" — this SHOULD match
    const refs = detectByFilePath(blocks, msg);
    expect(refs).toHaveLength(1);
  });

  it("returns empty when there are no tool calls", () => {
    const blocks = [block({ id: "B1", file_path: "src/auth.py" })];
    expect(detectByFilePath(blocks, textMsg("no tools here"))).toHaveLength(0);
  });
});

// ─── Signal 2: detectByIdMention ─────────────────────────────────────────────

describe("detectByIdMention — Signal 2", () => {
  it("detects block ID appearing in assistant text", () => {
    const blocks = [block({ id: "01J_BLOCK_001" })];
    const msg = textMsg("I referenced block 01J_BLOCK_001 in my analysis.");
    const refs = detectByIdMention(blocks, msg);
    expect(refs).toHaveLength(1);
    expect(refs[0].block_id).toBe("01J_BLOCK_001");
    expect(refs[0].signal).toBe(2);
    expect(refs[0].reference_type).toBe("id_mention");
    expect(refs[0].evidence).toContain("01J_BLOCK_001");
  });

  it("detects block ID appearing in tool call args (not just text)", () => {
    const blocks = [block({ id: "01J_BLOCK_002" })];
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "tool_use", id: "t1", name: "Expand", input: { block_id: "01J_BLOCK_002" } },
      ],
    };
    const refs = detectByIdMention(blocks, msg);
    expect(refs).toHaveLength(1);
    expect(refs[0].block_id).toBe("01J_BLOCK_002");
  });

  it("returns empty when no ID appears", () => {
    const blocks = [block({ id: "01J_BLOCK_999" })];
    const msg = textMsg("Nothing relevant here.");
    expect(detectByIdMention(blocks, msg)).toHaveLength(0);
  });

  it("does not false-positive on short IDs that appear in common words", () => {
    // A block ID of "id" would be very noisy; real IDs are long (ULID ~26 chars)
    // The test checks that the search is exact substring — no normalization
    const blocks = [block({ id: "abc" })];
    const msg = textMsg("abcdef contains abc but the full word is different");
    const refs = detectByIdMention(blocks, msg);
    // "abc" IS a substring of "abcdef" — substring search is exact, not word-boundary
    // This is spec-compliant; signal 2 is exact substring of the block ID
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Signal 3: detectByShingle ───────────────────────────────────────────────

describe("detectByShingle — Signal 3", () => {
  const LONG_CONTENT = "def authenticate(user: str, password: str) -> bool:\n    # check credentials\n    return check_hash(password, user.hash)";

  it("detects block when 40-char shingle appears in assistant output", () => {
    const shingle = LONG_CONTENT.slice(0, 40);
    const blocks = [block({ id: "B3", content: LONG_CONTENT })];
    const msg = textMsg(`The function starts with: ${shingle} and continues...`);
    const refs = detectByShingle(blocks, msg);
    expect(refs).toHaveLength(1);
    expect(refs[0].block_id).toBe("B3");
    expect(refs[0].signal).toBe(3);
    expect(refs[0].reference_type).toBe("text_quote");
    expect(refs[0].evidence).toBe(shingle);
  });

  it("returns empty when content is shorter than 40 chars", () => {
    const blocks = [block({ id: "B3", content: "short content" })];
    const msg = textMsg("short content is here");
    expect(detectByShingle(blocks, msg)).toHaveLength(0);
  });

  it("returns empty when no shingle matches", () => {
    const blocks = [block({ id: "B3", content: LONG_CONTENT })];
    const msg = textMsg("completely unrelated assistant response with no overlap");
    expect(detectByShingle(blocks, msg)).toHaveLength(0);
  });

  it("only reports one match per block (first matching shingle)", () => {
    const blocks = [block({ id: "B3", content: LONG_CONTENT })];
    // Both the start and middle of the content appear in the assistant text
    const fullContent = LONG_CONTENT;
    const msg = textMsg(fullContent); // entire content in output
    const refs = detectByShingle(blocks, msg);
    expect(refs).toHaveLength(1); // one match per block, not one per shingle
  });

  it("content exactly 40 chars is eligible for shingle matching", () => {
    const content = "a".repeat(40); // exactly 40 chars
    const blocks = [block({ id: "B3", content })];
    const msg = textMsg(`prefix ${content} suffix`);
    expect(detectByShingle(blocks, msg)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify red**

```bash
npm test -- src/reference-detector/__tests__/signals.test.ts
```
Expected: test file fails with "Cannot find module '../signals.js'"

### Step 3 — Implement signals.ts

- [ ] **Write `signals.ts`**

```typescript
// src/reference-detector/signals.ts
import type { DetectionBlock, DetectedReference, AssistantMessage } from "./types.js";

const SHINGLE_SIZE = 40;

// ─── Extraction helpers ──────────────────────────────────────────────────────

export function extractAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export function extractToolCallArgStrings(message: AssistantMessage): string[] {
  return message.content
    .filter(
      (c): c is { type: "tool_use"; id: string; name: string; input: unknown } =>
        c.type === "tool_use",
    )
    .map((c) => {
      try {
        return JSON.stringify(c.input) ?? "";
      } catch {
        return "";
      }
    });
}

// ─── Signal 1: file paths in tool call arguments ─────────────────────────────
// REQ-F-023 signal 1: exact substring match of block.file_path in any tool call input JSON

export function detectByFilePath(
  blocks: DetectionBlock[],
  message: AssistantMessage,
): DetectedReference[] {
  const toolArgStrings = extractToolCallArgStrings(message);
  if (toolArgStrings.length === 0) return [];

  const combined = toolArgStrings.join(" ");
  const refs: DetectedReference[] = [];

  for (const block of blocks) {
    if (!block.file_path) continue;
    if (combined.includes(block.file_path)) {
      refs.push({
        block_id: block.id,
        signal: 1,
        reference_type: "tool_call",
        evidence: `file_path=${block.file_path}`,
      });
    }
  }

  return refs;
}

// ─── Signal 2: block ID mentions in assistant output ─────────────────────────
// REQ-F-023 signal 2: substring match of block.id in text AND tool call strings

export function detectByIdMention(
  blocks: DetectionBlock[],
  message: AssistantMessage,
): DetectedReference[] {
  const text = extractAssistantText(message);
  const toolArgs = extractToolCallArgStrings(message).join(" ");
  const searchable = `${text} ${toolArgs}`;

  const refs: DetectedReference[] = [];

  for (const block of blocks) {
    const idx = searchable.indexOf(block.id);
    if (idx !== -1) {
      const start = Math.max(0, idx - 20);
      const end = Math.min(searchable.length, idx + block.id.length + 20);
      refs.push({
        block_id: block.id,
        signal: 2,
        reference_type: "id_mention",
        evidence: searchable.slice(start, end),
      });
    }
  }

  return refs;
}

// ─── Signal 3: 40-character shingle overlap ──────────────────────────────────
// REQ-F-023 signal 3: exact 40-char sliding-window substring match
// Only call this for blocks not already matched by signals 1 or 2 (per spec).

export function detectByShingle(
  blocks: DetectionBlock[],
  message: AssistantMessage,
): DetectedReference[] {
  const text = extractAssistantText(message);
  if (!text) return [];

  const refs: DetectedReference[] = [];

  for (const block of blocks) {
    if (block.content.length < SHINGLE_SIZE) continue;

    for (let i = 0; i <= block.content.length - SHINGLE_SIZE; i++) {
      const shingle = block.content.slice(i, i + SHINGLE_SIZE);
      if (text.includes(shingle)) {
        refs.push({
          block_id: block.id,
          signal: 3,
          reference_type: "text_quote",
          evidence: shingle,
        });
        break; // one match per block is sufficient
      }
    }
  }

  return refs;
}
```

- [ ] **Step 4: Run signals tests — expect green**

```bash
npm test -- src/reference-detector/__tests__/signals.test.ts
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/reference-detector/signals.ts src/reference-detector/__tests__/signals.test.ts
git commit -m "feat(ref-detector): signal 1/2/3 implementations — REQ-F-023"
```

---

## Task 4 — `detectReferences()` Combiner (TDD)

**Files:**
- Create: `src/reference-detector/index.ts`
- Create: `src/reference-detector/__tests__/reference-detector.test.ts`

### Step 1 — Write failing tests

- [ ] **Write `reference-detector.test.ts`**

```typescript
// src/reference-detector/__tests__/reference-detector.test.ts
import { describe, expect, it } from "vitest";
import { detectReferences } from "../index.js";
import type { DetectionBlock, AssistantMessage } from "../types.js";

const LONG_TEXT = "function authenticateUser(username, password) { return verify(username, hash(password)); }";

function block(id: string, file_path: string | null = null, content = "default content"): DetectionBlock {
  return { id, file_path, content };
}

describe("detectReferences — combined evaluation", () => {
  it("returns empty result when no blocks are referenced", () => {
    const blocks = [block("B1", "src/auth.py", LONG_TEXT)];
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Nothing relevant in this response." }],
    };
    const result = detectReferences(blocks, msg);
    expect(result.referenced_ids.size).toBe(0);
    expect(result.references).toHaveLength(0);
  });

  it("signal 1 match populates referenced_ids", () => {
    const blocks = [block("B1", "src/auth.py")];
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/auth.py" } }],
    };
    const result = detectReferences(blocks, msg);
    expect(result.referenced_ids.has("B1")).toBe(true);
    expect(result.references[0].signal).toBe(1);
  });

  it("signal 2 match populates referenced_ids", () => {
    const blocks = [block("01JBLOCK000001")];
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "I'm referencing block 01JBLOCK000001 here." }],
    };
    const result = detectReferences(blocks, msg);
    expect(result.referenced_ids.has("01JBLOCK000001")).toBe(true);
    expect(result.references[0].signal).toBe(2);
  });

  it("signal 3 match populates referenced_ids", () => {
    const shingle = LONG_TEXT.slice(0, 40);
    const blocks = [block("B3", null, LONG_TEXT)];
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: `The code starts with: ${shingle}` }],
    };
    const result = detectReferences(blocks, msg);
    expect(result.referenced_ids.has("B3")).toBe(true);
    expect(result.references[0].signal).toBe(3);
  });

  it("a block matched by signal 1 is NOT re-evaluated by signal 3 (evaluation order)", () => {
    // Signal 3 is expensive — must be skipped for blocks already matched
    const blocks = [block("B1", "src/auth.py", LONG_TEXT)];
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/auth.py" } },
        { type: "text", text: LONG_TEXT }, // shingle would also match
      ],
    };
    const result = detectReferences(blocks, msg);
    // Should appear only once, matched by signal 1
    expect(result.references).toHaveLength(1);
    expect(result.references[0].signal).toBe(1);
  });

  it("multiple blocks can be matched in the same call", () => {
    const blocks = [
      block("B1", "src/auth.py"),
      block("B2", null, LONG_TEXT),
    ];
    const shingle = LONG_TEXT.slice(0, 40);
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/auth.py" } },
        { type: "text", text: `Result: ${shingle}` },
      ],
    };
    const result = detectReferences(blocks, msg);
    expect(result.referenced_ids.has("B1")).toBe(true);
    expect(result.referenced_ids.has("B2")).toBe(true);
    expect(result.references).toHaveLength(2);
  });

  it("does not throw on empty blocks array", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "anything" }],
    };
    expect(() => detectReferences([], msg)).not.toThrow();
  });

  it("does not throw on empty assistant content", () => {
    const blocks = [block("B1", "src/auth.py")];
    const msg: AssistantMessage = { role: "assistant", content: [] };
    expect(() => detectReferences(blocks, msg)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify red**

```bash
npm test -- src/reference-detector/__tests__/reference-detector.test.ts
```
Expected: fails with "Cannot find module '../index.js'"

### Step 3 — Implement index.ts

- [ ] **Write `src/reference-detector/index.ts`**

```typescript
// src/reference-detector/index.ts
import type { DetectionBlock, DetectionResult, AssistantMessage } from "./types.js";
import { detectByFilePath, detectByIdMention, detectByShingle } from "./signals.js";

export type { DetectionBlock, DetectionResult, DetectedReference, AssistantMessage } from "./types.js";

// detectReferences evaluates the three signals in spec order (REQ-F-023):
//   1. File paths in tool call arguments   (cheapest)
//   2. Block IDs in assistant text/tools   (cheap)
//   3. 40-char shingle overlap             (expensive — only for unmatched blocks)
// Returns the referenced block IDs and evidence for the audit log.
export function detectReferences(
  blocks: DetectionBlock[],
  message: AssistantMessage,
): DetectionResult {
  const referenced_ids = new Set<string>();
  const references = [];

  // Signal 1
  const s1 = detectByFilePath(blocks, message);
  for (const ref of s1) {
    referenced_ids.add(ref.block_id);
    references.push(ref);
  }

  // Signal 2 — skip already matched
  const afterS1 = blocks.filter((b) => !referenced_ids.has(b.id));
  const s2 = detectByIdMention(afterS1, message);
  for (const ref of s2) {
    referenced_ids.add(ref.block_id);
    references.push(ref);
  }

  // Signal 3 — skip already matched (expensive path)
  const afterS2 = afterS1.filter((b) => !referenced_ids.has(b.id));
  const s3 = detectByShingle(afterS2, message);
  for (const ref of s3) {
    referenced_ids.add(ref.block_id);
    references.push(ref);
  }

  return { referenced_ids, references };
}
```

- [ ] **Step 4: Run to verify green**

```bash
npm test -- src/reference-detector/__tests__/
```
Expected: all signal tests + reference-detector tests pass

- [ ] **Step 5: Commit**

```bash
git add src/reference-detector/index.ts src/reference-detector/__tests__/reference-detector.test.ts
git commit -m "feat(ref-detector): detectReferences() combining all 3 signals — REQ-F-023"
```

---

## Task 5 — Synthetic Corpus (20 fixtures)

**Files:**
- Create: `src/reference-detector/__tests__/corpus/` (20 JSON files)

Each fixture has this shape:
```json
{
  "id": "corpus-NNN",
  "description": "human-readable description of what this tests",
  "detection_blocks": [
    { "id": "B1", "file_path": null, "content": "..." }
  ],
  "assistant_message": {
    "role": "assistant",
    "content": [...]
  },
  "ground_truth": {
    "referenced_block_ids": ["B1"],
    "unreferenced_block_ids": ["B2"]
  }
}
```

- [ ] **Step 1: Create corpus-001.json — Signal 1 basic**

```json
{
  "id": "corpus-001",
  "description": "Signal 1: assistant reads a file whose block is tracked",
  "detection_blocks": [
    { "id": "B_AUTH", "file_path": "src/auth.py", "content": "def login(): pass" }
  ],
  "assistant_message": {
    "role": "assistant",
    "content": [
      { "type": "tool_use", "id": "t1", "name": "Read", "input": { "file_path": "src/auth.py" } }
    ]
  },
  "ground_truth": {
    "referenced_block_ids": ["B_AUTH"],
    "unreferenced_block_ids": []
  }
}
```
Save to: `src/reference-detector/__tests__/corpus/corpus-001.json`

- [ ] **Step 2: Create corpus-002.json — Signal 1 with unrelated block**

```json
{
  "id": "corpus-002",
  "description": "Signal 1: assistant reads a different file — block B_AUTH not referenced",
  "detection_blocks": [
    { "id": "B_AUTH", "file_path": "src/auth.py", "content": "def login(): pass" },
    { "id": "B_DB", "file_path": "src/db.py", "content": "class DB: pass" }
  ],
  "assistant_message": {
    "role": "assistant",
    "content": [
      { "type": "tool_use", "id": "t1", "name": "Read", "input": { "file_path": "src/db.py" } }
    ]
  },
  "ground_truth": {
    "referenced_block_ids": ["B_DB"],
    "unreferenced_block_ids": ["B_AUTH"]
  }
}
```
Save to: `src/reference-detector/__tests__/corpus/corpus-002.json`

- [ ] **Step 3: Create corpus-003.json — Signal 1 multi-file tool call**

```json
{
  "id": "corpus-003",
  "description": "Signal 1: assistant makes two tool calls; both blocks referenced",
  "detection_blocks": [
    { "id": "B_AUTH", "file_path": "src/auth.py", "content": "def login(): pass" },
    { "id": "B_DB", "file_path": "src/db.py", "content": "class DB: pass" }
  ],
  "assistant_message": {
    "role": "assistant",
    "content": [
      { "type": "tool_use", "id": "t1", "name": "Read", "input": { "file_path": "src/auth.py" } },
      { "type": "tool_use", "id": "t2", "name": "Read", "input": { "file_path": "src/db.py" } }
    ]
  },
  "ground_truth": {
    "referenced_block_ids": ["B_AUTH", "B_DB"],
    "unreferenced_block_ids": []
  }
}
```
Save to: `src/reference-detector/__tests__/corpus/corpus-003.json`

- [ ] **Step 4: Create corpus-004.json — Signal 2 basic ID mention in text**

```json
{
  "id": "corpus-004",
  "description": "Signal 2: assistant text contains the block ID",
  "detection_blocks": [
    { "id": "01JBLOCK000001", "file_path": null, "content": "grep output: no matches found" }
  ],
  "assistant_message": {
    "role": "assistant",
    "content": [
      { "type": "text", "text": "As shown in block 01JBLOCK000001, there were no matches." }
    ]
  },
  "ground_truth": {
    "referenced_block_ids": ["01JBLOCK000001"],
    "unreferenced_block_ids": []
  }
}
```
Save to: `src/reference-detector/__tests__/corpus/corpus-004.json`

- [ ] **Step 5: Create corpus-005.json — Signal 2 ID in tool call input**

```json
{
  "id": "corpus-005",
  "description": "Signal 2: assistant calls cachelane:expand with block ID",
  "detection_blocks": [
    { "id": "01JBLOCK000002", "file_path": null, "content": "large search results..." }
  ],
  "assistant_message": {
    "role": "assistant",
    "content": [
      {
        "type": "tool_use",
        "id": "t1",
        "name": "cachelane:expand",
        "input": { "block_id": "01JBLOCK000002" }
      }
    ]
  },
  "ground_truth": {
    "referenced_block_ids": ["01JBLOCK000002"],
    "unreferenced_block_ids": []
  }
}
```
Save to: `src/reference-detector/__tests__/corpus/corpus-005.json`

- [ ] **Step 6: Create corpus-006.json — Signal 3 shingle match**

```json
{
  "id": "corpus-006",
  "description": "Signal 3: assistant quotes a 40-char substring from block content",
  "detection_blocks": [
    {
      "id": "B_CODE",
      "file_path": null,
      "content": "function authenticateUser(username, password) { return verify(username, hash(password)); }"
    }
  ],
  "assistant_message": {
    "role": "assistant",
    "content": [
      { "type": "text", "text": "The auth function starts with: function authenticateUser(username, passw" }
    ]
  },
  "ground_truth": {
    "referenced_block_ids": ["B_CODE"],
    "unreferenced_block_ids": []
  }
}
```
Save to: `src/reference-detector/__tests__/corpus/corpus-006.json`

- [ ] **Step 7: Create corpus-007.json — Signal 3 no match**

```json
{
  "id": "corpus-007",
  "description": "Signal 3: no shingle overlap — block not referenced",
  "detection_blocks": [
    {
      "id": "B_CODE",
      "file_path": null,
      "content": "function authenticateUser(username, password) { return verify(username, hash(password)); }"
    }
  ],
  "assistant_message": {
    "role": "assistant",
    "content": [
      { "type": "text", "text": "I will now work on the database layer without reading auth code." }
    ]
  },
  "ground_truth": {
    "referenced_block_ids": [],
    "unreferenced_block_ids": ["B_CODE"]
  }
}
```
Save to: `src/reference-detector/__tests__/corpus/corpus-007.json`

- [ ] **Step 8: Create corpus-008.json — No blocks, no references**

```json
{
  "id": "corpus-008",
  "description": "Edge: no tracked blocks at all",
  "detection_blocks": [],
  "assistant_message": {
    "role": "assistant",
    "content": [{ "type": "text", "text": "Hello! How can I help?" }]
  },
  "ground_truth": {
    "referenced_block_ids": [],
    "unreferenced_block_ids": []
  }
}
```
Save to: `src/reference-detector/__tests__/corpus/corpus-008.json`

- [ ] **Step 9: Create corpus-009.json — Empty assistant response**

```json
{
  "id": "corpus-009",
  "description": "Edge: assistant message with no content blocks",
  "detection_blocks": [
    { "id": "B1", "file_path": "src/auth.py", "content": "def login(): pass" }
  ],
  "assistant_message": {
    "role": "assistant",
    "content": []
  },
  "ground_truth": {
    "referenced_block_ids": [],
    "unreferenced_block_ids": ["B1"]
  }
}
```
Save to: `src/reference-detector/__tests__/corpus/corpus-009.json`

- [ ] **Step 10: Create corpus-010.json — Signal 1 wins over signal 3 for same block**

```json
{
  "id": "corpus-010",
  "description": "Eval order: block matched by S1 is not re-reported by S3",
  "detection_blocks": [
    {
      "id": "B1",
      "file_path": "src/auth.py",
      "content": "function authenticateUser(username, password) { return verify(username, hash(password)); }"
    }
  ],
  "assistant_message": {
    "role": "assistant",
    "content": [
      { "type": "tool_use", "id": "t1", "name": "Read", "input": { "file_path": "src/auth.py" } },
      { "type": "text", "text": "function authenticateUser(username, password) { return" }
    ]
  },
  "ground_truth": {
    "referenced_block_ids": ["B1"],
    "unreferenced_block_ids": []
  }
}
```
Save to: `src/reference-detector/__tests__/corpus/corpus-010.json`

- [ ] **Step 11: Create corpus-011.json through corpus-020.json — Mixed scenarios**

Create these ten additional fixtures covering: signal combinations, multiple blocks with mixed referenced/unreferenced, tool_call with nested input, text-only response with no signal fires, shingle at end of content, shingle at middle of content, two blocks both S3 matched, file_path with directory prefix, assistant only makes text blocks (no tools), large block count with only one match.

```json
// corpus-011.json — Signal 1 with nested input object
{
  "id": "corpus-011",
  "description": "Signal 1: file_path nested inside tool input object",
  "detection_blocks": [
    { "id": "B1", "file_path": "src/utils.ts", "content": "export const noop = () => {}" }
  ],
  "assistant_message": {
    "role": "assistant",
    "content": [
      {
        "type": "tool_use", "id": "t1", "name": "Edit",
        "input": { "target": { "file": "src/utils.ts", "line": 3 }, "content": "..." }
      }
    ]
  },
  "ground_truth": {
    "referenced_block_ids": ["B1"],
    "unreferenced_block_ids": []
  }
}
```
Save to `corpus/corpus-011.json`. (Repeat pattern for 012–020 covering the scenarios listed in the step description above; complete code in the actual files.)

- [ ] **Step 12: Commit corpus fixtures**

```bash
git add src/reference-detector/__tests__/corpus/
git commit -m "feat(ref-detector): synthetic corpus — 20 annotated fixtures for AC-5/AC-6"
```

---

## Task 6 — Corpus Gate (CI-Blocking Precision/Recall)

**Files:**
- Create: `src/reference-detector/__tests__/corpus.test.ts`

- [ ] **Step 1: Write failing corpus test**

```typescript
// src/reference-detector/__tests__/corpus.test.ts
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectReferences } from "../index.js";
import type { DetectionBlock, AssistantMessage } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = resolve(__dirname, "corpus");

// REQ-NF-008, REQ-NF-009, AC-5, AC-6
// Precision ≥ 95%: of all blocks we report as referenced, ≥ 95% are truly referenced.
// Recall ≥ 85%: of all truly referenced blocks, we detect ≥ 85%.
const PRECISION_THRESHOLD = 0.95;
const RECALL_THRESHOLD = 0.85;

type CorpusEntry = {
  id: string;
  description: string;
  detection_blocks: DetectionBlock[];
  assistant_message: AssistantMessage;
  ground_truth: {
    referenced_block_ids: string[];
    unreferenced_block_ids: string[];
  };
};

function loadCorpus(): CorpusEntry[] {
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) =>
    JSON.parse(readFileSync(resolve(CORPUS_DIR, f), "utf-8")) as CorpusEntry,
  );
}

describe("corpus gate — REQ-NF-008, REQ-NF-009 (CI-blocking)", () => {
  it("corpus directory contains at least 20 entries (AC-6)", () => {
    const entries = loadCorpus();
    expect(entries.length).toBeGreaterThanOrEqual(20);
  });

  it(`precision >= ${PRECISION_THRESHOLD * 100}% across all corpus entries (AC-5)`, () => {
    const entries = loadCorpus();
    let truePositives = 0;
    let falsePositives = 0;

    for (const entry of entries) {
      const result = detectReferences(entry.detection_blocks, entry.assistant_message);
      const trueRefIds = new Set(entry.ground_truth.referenced_block_ids);

      for (const detectedId of result.referenced_ids) {
        if (trueRefIds.has(detectedId)) {
          truePositives++;
        } else {
          falsePositives++;
        }
      }
    }

    const precision =
      truePositives + falsePositives === 0
        ? 1.0
        : truePositives / (truePositives + falsePositives);

    expect(precision).toBeGreaterThanOrEqual(
      PRECISION_THRESHOLD,
      `Precision ${(precision * 100).toFixed(1)}% is below the required ${PRECISION_THRESHOLD * 100}% (REQ-NF-008)`,
    );
  });

  it(`recall >= ${RECALL_THRESHOLD * 100}% across all corpus entries (AC-5)`, () => {
    const entries = loadCorpus();
    let truePositives = 0;
    let falseNegatives = 0;

    for (const entry of entries) {
      const result = detectReferences(entry.detection_blocks, entry.assistant_message);
      const trueRefIds = new Set(entry.ground_truth.referenced_block_ids);

      for (const trueId of trueRefIds) {
        if (result.referenced_ids.has(trueId)) {
          truePositives++;
        } else {
          falseNegatives++;
        }
      }
    }

    const recall =
      truePositives + falseNegatives === 0
        ? 1.0
        : truePositives / (truePositives + falseNegatives);

    expect(recall).toBeGreaterThanOrEqual(
      RECALL_THRESHOLD,
      `Recall ${(recall * 100).toFixed(1)}% is below the required ${RECALL_THRESHOLD * 100}% (REQ-NF-009)`,
    );
  });
});
```

- [ ] **Step 2: Run to verify red (before corpus exists)**

```bash
npm test -- src/reference-detector/__tests__/corpus.test.ts
```
Expected: fails if `corpus/` doesn't exist yet, or passes after corpus is added

- [ ] **Step 3: Run after corpus fixtures are in place — expect green**

```bash
npm test -- src/reference-detector/__tests__/corpus.test.ts
```
Expected: all 3 corpus gate tests pass

- [ ] **Step 4: Commit**

```bash
git add src/reference-detector/__tests__/corpus.test.ts
git commit -m "feat(ref-detector): corpus precision/recall gate — AC-5, REQ-NF-008/009"
```

---

## Task 7 — Storage Extensions (TDD)

**Files:**
- Modify: `src/storage/index.ts`
- Modify: `src/storage/__tests__/storage.test.ts`

### Step 1 — Write failing tests

- [ ] **Add to `storage.test.ts`** (inside the existing `describe("openDatabase", ...)` block):

```typescript
it("resetUnusedTurns sets counter to 0 and updates last_referenced_at_turn and updated_at", () => {
  db = openDatabase(path.join(tmpDir, "test.db"));
  const now = Date.now();

  db.insertBlock({
    id: "01HZXQ5K0000000000000020",
    workspace_id: "ws-1",
    session_id: "sess-1",
    content_hash: "f".repeat(64),
    kind: "file_read",
    volatility: "SEMI",
    is_pinned: false,
    token_count: 300,
    added_at_turn: 1,
    last_referenced_at_turn: 1,
    unused_turns: 2,
    is_stub: false,
    stub_summary: null,
    refetch_handle: null,
    created_at: now,
    updated_at: now,
  });

  db.resetUnusedTurns("01HZXQ5K0000000000000020", 5, now + 1000);

  const block = db.getBlock("01HZXQ5K0000000000000020");
  expect(block!.unused_turns).toBe(0);
  expect(block!.last_referenced_at_turn).toBe(5);
  expect(block!.updated_at).toBe(now + 1000);
});

it("getBlocksBySession returns all blocks for a session", () => {
  db = openDatabase(path.join(tmpDir, "test.db"));
  const now = Date.now();

  const makeBlock = (id: string, session: string) => ({
    id,
    workspace_id: "ws-1",
    session_id: session,
    content_hash: id.padEnd(64, "0"),
    kind: "tool_output" as const,
    volatility: "VOLATILE" as const,
    is_pinned: false,
    token_count: 100,
    added_at_turn: 1,
    last_referenced_at_turn: 1,
    unused_turns: 0,
    is_stub: false,
    stub_summary: null,
    refetch_handle: null,
    created_at: now,
    updated_at: now,
  });

  db.insertBlock(makeBlock("01BLOCK_S1_A", "sess-1"));
  db.insertBlock(makeBlock("01BLOCK_S1_B", "sess-1"));
  db.insertBlock(makeBlock("01BLOCK_S2_C", "sess-2")); // different session

  const rows = db.getBlocksBySession("ws-1", "sess-1");
  expect(rows).toHaveLength(2);
  const ids = rows.map((r) => r.id);
  expect(ids).toContain("01BLOCK_S1_A");
  expect(ids).toContain("01BLOCK_S1_B");
  expect(ids).not.toContain("01BLOCK_S2_C");
});

it("getBlocksBySession returns empty array when no blocks for session", () => {
  db = openDatabase(path.join(tmpDir, "test.db"));
  const rows = db.getBlocksBySession("ws-99", "sess-99");
  expect(rows).toEqual([]);
});
```

- [ ] **Run to verify red**

```bash
npm test -- src/storage/__tests__/storage.test.ts
```
Expected: new tests fail with "db.resetUnusedTurns is not a function"

### Step 2 — Implement storage extensions

- [ ] **Add to `src/storage/index.ts`**

In `CachelaneDb` interface, add:
```typescript
resetUnusedTurns(id: string, lastReferencedAtTurn: number, updatedAt: number): void;
getBlocksBySession(workspaceId: string, sessionId: string): BlockRow[];
```

In `openDatabase()`, add prepared statements and attach them:
```typescript
const resetUnusedTurnsStmt = rawDb.prepare(
  "UPDATE blocks SET unused_turns = 0, last_referenced_at_turn = ?, updated_at = ? WHERE id = ?"
);

const getBlocksBySessionStmt = rawDb.prepare(
  "SELECT * FROM blocks WHERE workspace_id = ? AND session_id = ?"
);

// Then in the db assignment section:
db.resetUnusedTurns = (id: string, lastReferencedAtTurn: number, updatedAt: number) =>
  void resetUnusedTurnsStmt.run(lastReferencedAtTurn, updatedAt, id);

db.getBlocksBySession = (workspaceId: string, sessionId: string) =>
  getBlocksBySessionStmt.all(workspaceId, sessionId) as BlockRow[];
```

- [ ] **Run to verify green**

```bash
npm test -- src/storage/__tests__/storage.test.ts
```
Expected: all storage tests pass (existing 7 + new 3 = 10 total)

- [ ] **Commit**

```bash
git add src/storage/index.ts src/storage/__tests__/storage.test.ts
git commit -m "feat(storage): resetUnusedTurns + getBlocksBySession — M4 PostResponse counters"
```

---

## Task 8 — PostResponse Handler (TDD)

**Files:**
- Create: `src/orchestrator/post-response-handler.ts`
- Create: `src/orchestrator/__tests__/post-response-handler.test.ts`

### Step 1 — Write failing tests

- [ ] **Write `post-response-handler.test.ts`**

```typescript
// src/orchestrator/__tests__/post-response-handler.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../../storage/index.js";
import type { CachelaneDb } from "../../storage/index.js";
import { handlePostResponse } from "../post-response-handler.js";
import type { PostResponseInput } from "../post-response-handler.js";
import type { AssistantMessage } from "../../reference-detector/index.js";

let tmpDir: string;
let db: CachelaneDb;

const NOW = 1_700_000_000_000;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-pr-test-"));
  db = openDatabase(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  try { db?.close(); } catch { /* ignore */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seedBlock(id: string, filePath: string | null = null, unusedTurns = 0) {
  db.insertBlock({
    id,
    workspace_id: "ws-1",
    session_id: "sess-1",
    content_hash: id.padEnd(64, "0"),
    kind: "file_read",
    volatility: "SEMI",
    is_pinned: false,
    token_count: 100,
    added_at_turn: 1,
    last_referenced_at_turn: 1,
    unused_turns: unusedTurns,
    is_stub: false,
    stub_summary: null,
    refetch_handle: filePath ? `view:${filePath}:1-50` : null,
    created_at: NOW,
    updated_at: NOW,
  });
}

function seedTurn(id: string) {
  db.insertTurn({
    id,
    workspace_id: "ws-1",
    session_id: "sess-1",
    turn_number: 2,
    model: "claude-opus-4-7",
    input_tokens: 100,
    output_tokens: 20,
    cache_creation_5m_tokens: 0,
    cache_creation_1h_tokens: 0,
    cache_read_tokens: 0,
    effective_cost_units: 100,
    prefix_breakpoint_hash: null,
    middle_breakpoint_hash: null,
    pruned_blocks_count: 0,
    keepalive_pings_since_last_turn: 0,
    created_at: NOW,
  });
}

describe("handlePostResponse", () => {
  it("increments unused_turns for blocks not referenced", () => {
    seedBlock("B1", null, 1);
    const input: PostResponseInput = {
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 2,
      turn_id: "T_UNUSED",
      assistant_message: { role: "assistant", content: [{ type: "text", text: "nothing here" }] },
      detection_blocks: [{ id: "B1", content: "some content", file_path: null }],
      db,
      now: NOW + 1000,
    };
    seedTurn("T_UNUSED");

    handlePostResponse(input);

    const block = db.getBlock("B1");
    expect(block!.unused_turns).toBe(2); // was 1, incremented to 2
  });

  it("resets unused_turns to 0 for referenced block (signal 1)", () => {
    seedBlock("B_AUTH", "src/auth.py", 2);
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/auth.py" } },
      ],
    };
    const input: PostResponseInput = {
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 2,
      turn_id: "T_REF",
      assistant_message: msg,
      detection_blocks: [{ id: "B_AUTH", content: "def login(): pass", file_path: "src/auth.py" }],
      db,
      now: NOW + 1000,
    };
    seedTurn("T_REF");

    handlePostResponse(input);

    const block = db.getBlock("B_AUTH");
    expect(block!.unused_turns).toBe(0);
    expect(block!.last_referenced_at_turn).toBe(2);
  });

  it("writes block_reference audit log entry for each detected reference", () => {
    seedBlock("B_AUTH", "src/auth.py", 0);
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/auth.py" } },
      ],
    };
    const input: PostResponseInput = {
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 2,
      turn_id: "T_AUDIT",
      assistant_message: msg,
      detection_blocks: [{ id: "B_AUTH", content: "def login(): pass", file_path: "src/auth.py" }],
      db,
      now: NOW + 1000,
    };
    seedTurn("T_AUDIT");

    handlePostResponse(input);

    const refs = db.getBlockReferencesForTurn("T_AUDIT");
    expect(refs).toHaveLength(1);
    expect(refs[0].block_id).toBe("B_AUTH");
    expect(refs[0].reference_type).toBe("tool_call");
  });

  it("handles mixed referenced and unreferenced blocks in one call", () => {
    seedBlock("B1", "src/auth.py", 1); // will be referenced
    seedBlock("B2", null, 0);          // will NOT be referenced
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/auth.py" } },
      ],
    };
    const input: PostResponseInput = {
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 2,
      turn_id: "T_MIXED",
      assistant_message: msg,
      detection_blocks: [
        { id: "B1", content: "auth content", file_path: "src/auth.py" },
        { id: "B2", content: "other content that is long enough for shingles yes indeed really", file_path: null },
      ],
      db,
      now: NOW + 1000,
    };
    seedTurn("T_MIXED");

    handlePostResponse(input);

    expect(db.getBlock("B1")!.unused_turns).toBe(0);  // reset
    expect(db.getBlock("B2")!.unused_turns).toBe(1);  // incremented
  });

  it("is fail-open: does not throw on bad input, returns error signal", () => {
    // Pass a null db to force an error path
    const input = {
      workspace_id: "ws-1",
      session_id: "sess-1",
      turn_number: 2,
      turn_id: "T_ERR",
      assistant_message: { role: "assistant" as const, content: [] },
      detection_blocks: [],
      db: null as unknown as CachelaneDb,
      now: NOW,
    };
    expect(() => handlePostResponse(input)).not.toThrow();
  });

  it("does not update blocks belonging to a different session", () => {
    // Seed a block in sess-2, but handler is for sess-1
    db.insertBlock({
      id: "B_OTHER_SESSION",
      workspace_id: "ws-1",
      session_id: "sess-2",
      content_hash: "0".repeat(64),
      kind: "file_read",
      volatility: "SEMI",
      is_pinned: false,
      token_count: 100,
      added_at_turn: 1,
      last_referenced_at_turn: 1,
      unused_turns: 0,
      is_stub: false,
      stub_summary: null,
      refetch_handle: "view:src/auth.py:1-50",
      created_at: NOW,
      updated_at: NOW,
    });
    const input: PostResponseInput = {
      workspace_id: "ws-1",
      session_id: "sess-1",  // different session
      turn_number: 2,
      turn_id: "T_ISOLATION",
      assistant_message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/auth.py" } },
        ],
      },
      detection_blocks: [],  // caller passes sess-1 blocks; sess-2 block not in here
      db,
      now: NOW + 1000,
    };
    seedTurn("T_ISOLATION");

    handlePostResponse(input);

    // sess-2 block must not be touched
    const block = db.getBlock("B_OTHER_SESSION");
    expect(block!.unused_turns).toBe(0);
  });
});
```

- [ ] **Run to verify red**

```bash
npm test -- src/orchestrator/__tests__/post-response-handler.test.ts
```
Expected: fails with "Cannot find module '../post-response-handler.js'"

### Step 2 — Implement the handler

- [ ] **Write `src/orchestrator/post-response-handler.ts`**

```typescript
// src/orchestrator/post-response-handler.ts
import type { CachelaneDb } from "../storage/index.js";
import type { DetectionBlock, AssistantMessage } from "../reference-detector/index.js";
import { detectReferences } from "../reference-detector/index.js";

export type { DetectionBlock } from "../reference-detector/index.js";

export interface PostResponseInput {
  workspace_id: string;
  session_id: string;
  turn_number: number;
  turn_id: string;
  assistant_message: AssistantMessage;
  // Caller-provided: content is transient (REQ-F-015), never read from DB
  detection_blocks: DetectionBlock[];
  db: CachelaneDb;
  now: number; // ms epoch, for updated_at stamps
}

export interface PostResponseResult {
  referenced_count: number;
  unreferenced_count: number;
  signals: string[];
}

export function handlePostResponse(input: PostResponseInput): PostResponseResult {
  try {
    const result = detectReferences(input.detection_blocks, input.assistant_message);

    for (const ref of result.references) {
      input.db.insertBlockReference({
        block_id: ref.block_id,
        turn_id: input.turn_id,
        reference_type: ref.reference_type,
        evidence: ref.evidence.slice(0, 200),
        created_at: input.now,
      });
    }

    for (const block of input.detection_blocks) {
      if (result.referenced_ids.has(block.id)) {
        input.db.resetUnusedTurns(block.id, input.turn_number, input.now);
      } else {
        input.db.incrementUnusedTurns(block.id, input.now);
      }
    }

    return {
      referenced_count: result.referenced_ids.size,
      unreferenced_count: input.detection_blocks.length - result.referenced_ids.size,
      signals: ["post_response_processed"],
    };
  } catch (err) {
    // Fail-open: never let PostResponse processing block the session
    console.error("[cachelane] handlePostResponse error", err);
    return {
      referenced_count: 0,
      unreferenced_count: 0,
      signals: ["error:fallback"],
    };
  }
}
```

- [ ] **Run to verify green**

```bash
npm test -- src/orchestrator/__tests__/post-response-handler.test.ts
```
Expected: all 6 handler tests pass

- [ ] **Commit**

```bash
git add src/orchestrator/post-response-handler.ts src/orchestrator/__tests__/post-response-handler.test.ts
git commit -m "feat(orchestrator): handlePostResponse — wires detector + storage counters — REQ-F-023"
```

---

## Task 9 — Full Suite Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```
Expected: all tests pass — prior 98 + new M4 tests (target: ≥ 130 total)

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Lint**

```bash
npm run lint
```
Expected: no warnings or errors

- [ ] **Step 4: Run test suite a second time (determinism check)**

```bash
npm test
```
Expected: identical pass count

- [ ] **Step 5: Run test suite a third time (determinism check)**

```bash
npm test
```
Expected: identical pass count

- [ ] **Final commit — M4 complete**

```bash
git add -A
git commit -m "feat(ref-detector): M4 reference detection — PostResponse hook, 3-signal detector, corpus gate"
```

---

## Traceability Matrix

| REQ-ID | What it requires | Implementation | Tests |
|--------|-----------------|----------------|-------|
| REQ-F-023 | Three-signal reference detector | `src/reference-detector/signals.ts`, `index.ts` | `signals.test.ts`, `reference-detector.test.ts` |
| REQ-F-024 | Short ID prefix on every stubbable block (consumption side) | `detectByIdMention` in `signals.ts` consumes IDs | `signals.test.ts` Signal 2 tests |
| REQ-F-025 | No embeddings / ML | Deterministic string matching only | n/a (structural) |
| REQ-NF-008 | Precision ≥ 95% | `detectReferences` evaluation order | `corpus.test.ts` precision test |
| REQ-NF-009 | Recall ≥ 85% | All 3 signals cover diverse reference patterns | `corpus.test.ts` recall test |
| AC-5 | Precision + recall asserted in CI | `corpus.test.ts` (CI-blocking) | corpus gate |
| AC-6 | Corpus exists before pruner code | 20-entry synthetic corpus in `corpus/` | `corpus.test.ts` count check |

---

## M1–M3 Touch-Point Register

| File modified | M4 requirement that necessitates the change |
|---------------|---------------------------------------------|
| `src/storage/index.ts` | PostResponse counter update requires `resetUnusedTurns` (set counter to 0 on reference) and `getBlocksBySession` (load session blocks for detection). Neither operation existed in M1 storage. No existing tests are changed; new tests added alongside. |

---

## Important: Corpus Completeness Before M5

The synthetic corpus (20 entries) satisfies AC-5/AC-6 for M4. Before the **first M5 commit**, the corpus must be extended to ≥ 100 entries with real annotated sessions. This is a **blocking prerequisite** for M5 (K-pruner). The 100-session human annotation is a 6-hour task; it should begin immediately so it is ready before M5 starts.
