import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectDetailedReferences,
  detectReferences,
} from "../three-signal-detector.js";
import type { ReferenceTurn } from "../types.js";

const fixturesPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "reference-turns.json",
);

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8")) as Record<
  string,
  ReferenceTurn
>;

describe("detectReferences", () => {
  it("detects Signal 1: file path in tool-call input using basename fallback", () => {
    const ids = detectReferences(fixtures.filePathTurn);
    expect(ids.has("block-file")).toBe(true);
  });

  it("detects Signal 2: id_token mention in assistant text", () => {
    const refs = detectDetailedReferences(fixtures.idTokenTurn);
    expect(refs).toEqual([
      {
        block_id: "block-id",
        reference_type: "id_mention",
        evidence: "id_token=a1b2c3d4",
      },
    ]);
  });

  it("detects Signal 3: exact 40-character shingle overlap", () => {
    const refs = detectDetailedReferences(fixtures.shingleTurn);
    expect(refs[0]).toMatchObject({
      block_id: "block-shingle",
      reference_type: "text_quote",
    });
    expect(refs[0].evidence).toMatch(/^shingle_sha256=/);
  });

  it("does not emit false positives for unrelated blocks", () => {
    const ids = detectReferences(fixtures.negativeTurn);
    expect(ids.size).toBe(0);
  });

  it("returns the union of all three signals without duplicate block IDs", () => {
    const turn: ReferenceTurn = {
      turn_number: 7,
      assistant_text:
        "Mention a1b2c3d4 and quote abcdefghijabcdefghijabcdefghijabcdefghij.",
      tool_calls: [{ name: "Edit", input: { file_path: "src/auth.py" } }],
      blocks_in_prompt: [
        fixtures.filePathTurn.blocks_in_prompt[0],
        fixtures.idTokenTurn.blocks_in_prompt[0],
        fixtures.shingleTurn.blocks_in_prompt[0],
        {
          id: "block-duplicate",
          id_token: "a1b2c3d4",
          kind: "tool_output",
          content: "also mentions the same token",
        },
      ],
    };

    const refs = detectDetailedReferences(turn);
    expect(refs.map((r) => r.block_id).sort()).toEqual([
      "block-duplicate",
      "block-file",
      "block-id",
      "block-shingle",
    ]);
  });

  it("handles 100 blocks and 10 KB assistant text within the M4 budget", () => {
    const blocks = Array.from({ length: 100 }, (_, i) => ({
      id: `block-${i}`,
      id_token: `tok${i}`.padEnd(8, "x"),
      kind: "tool_output" as const,
      content: `block ${i} `.repeat(30),
    }));
    const turn: ReferenceTurn = {
      turn_number: 8,
      assistant_text: "x".repeat(10_000),
      tool_calls: [],
      blocks_in_prompt: blocks,
    };

    const start = performance.now();
    const ids = detectReferences(turn);
    const elapsed = performance.now() - start;

    expect(ids.size).toBe(0);
    expect(elapsed).toBeLessThan(10);
  });
});
