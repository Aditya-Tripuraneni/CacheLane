import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectDetailedReferences } from "../three-signal-detector.js";
import type { ReferenceBlock, ReferenceTurn } from "../types.js";
import type { BlockKind } from "../../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = resolve(__dirname, "corpus-synthetic");

// REQ-NF-008, REQ-NF-009 — tested against the LIVE src/references/ detector
const PRECISION_THRESHOLD = 0.95;
const RECALL_THRESHOLD = 0.85;

// --- Corpus fixture types ---
interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface CorpusEntry {
  id: string;
  description: string;
  detection_blocks: Array<{ id: string; file_path: string | null; content: string }>;
  assistant_message: { role: string; content: ContentBlock[] };
  ground_truth: {
    referenced_block_ids: string[];
    unreferenced_block_ids: string[];
  };
}

// --- Adapter: convert corpus fixture format → ReferenceTurn ---
function toReferenceTurn(entry: CorpusEntry): ReferenceTurn {
  const textParts = entry.assistant_message.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "");

  const toolCalls = entry.assistant_message.content
    .filter((c) => c.type === "tool_use")
    .map((c) => ({
      name: c.name ?? "",
      input: (c.input ?? {}) as Record<string, unknown>,
    }));

  const blocks: ReferenceBlock[] = entry.detection_blocks.map((b) => ({
    id: b.id,
    id_token: b.id,
    kind: "tool_output" as BlockKind,
    ...(b.file_path !== null ? { file_path: b.file_path } : {}),
    content: b.content,
  }));

  return {
    turn_number: 1,
    assistant_text: textParts.join("\n"),
    tool_calls: toolCalls,
    blocks_in_prompt: blocks,
  };
}

function loadCorpus(): CorpusEntry[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(resolve(CORPUS_DIR, f), "utf-8")) as CorpusEntry);
}

function scoreCorpus(entries: CorpusEntry[]): {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
} {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const entry of entries) {
    const turn = toReferenceTurn(entry);
    const refs = detectDetailedReferences(turn);
    const detectedIds = new Set(refs.map((r) => r.block_id));
    const trueIds = new Set(entry.ground_truth.referenced_block_ids);

    for (const id of detectedIds) {
      if (trueIds.has(id)) truePositives++;
      else falsePositives++;
    }
    for (const id of trueIds) {
      if (!detectedIds.has(id)) falseNegatives++;
    }
  }

  return { truePositives, falsePositives, falseNegatives };
}

describe("corpus-synthetic gate — live detector (REQ-NF-008, REQ-NF-009)", () => {
  it("corpus directory contains exactly 20 synthetic entries (AC-6 baseline)", () => {
    const entries = loadCorpus();
    expect(entries).toHaveLength(20);
  });

  it(`precision >= ${PRECISION_THRESHOLD * 100}% on synthetic corpus`, () => {
    const entries = loadCorpus();
    const { truePositives, falsePositives } = scoreCorpus(entries);
    const precision =
      truePositives + falsePositives === 0
        ? 1.0
        : truePositives / (truePositives + falsePositives);
    expect(
      precision,
      `Precision ${(precision * 100).toFixed(1)}% — TP=${truePositives} FP=${falsePositives}`,
    ).toBeGreaterThanOrEqual(PRECISION_THRESHOLD);
  });

  it(`recall >= ${RECALL_THRESHOLD * 100}% on synthetic corpus`, () => {
    const entries = loadCorpus();
    const { truePositives, falseNegatives } = scoreCorpus(entries);
    const recall =
      truePositives + falseNegatives === 0
        ? 1.0
        : truePositives / (truePositives + falseNegatives);
    expect(
      recall,
      `Recall ${(recall * 100).toFixed(1)}% — TP=${truePositives} FN=${falseNegatives}`,
    ).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
  });
});
