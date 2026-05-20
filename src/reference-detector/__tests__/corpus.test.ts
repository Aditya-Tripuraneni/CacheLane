import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectReferences } from "../index.js";
import type { DetectionBlock, AssistantMessage } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = resolve(__dirname, "corpus");

// REQ-NF-008, REQ-NF-009, AC-5, AC-6
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

type CorpusMetrics = {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
};

function loadCorpus(): CorpusEntry[] {
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) =>
    JSON.parse(readFileSync(resolve(CORPUS_DIR, f), "utf-8")) as CorpusEntry,
  );
}

function scoreCorpus(entries: CorpusEntry[]): CorpusMetrics {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

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

    for (const trueId of trueRefIds) {
      if (!result.referenced_ids.has(trueId)) {
        falseNegatives++;
      }
    }
  }

  return { truePositives, falsePositives, falseNegatives };
}

function isSyntheticBaseline(entry: CorpusEntry): boolean {
  const n = Number(entry.id.replace("corpus-", ""));
  return Number.isInteger(n) && n >= 1 && n <= 20;
}

describe("corpus gate — REQ-NF-008, REQ-NF-009 (CI-blocking, AC-5, AC-6)", () => {
  // CI ships with 20 synthetic fixtures (corpus-001..020).
  // Run `node scripts/extract-corpus.mjs` locally to generate real-session
  // fixtures (corpus-021+) that are gitignored and never pushed to remote.
  it("corpus directory contains at least 20 entries (AC-6 synthetic baseline)", () => {
    const entries = loadCorpus();
    expect(entries.length).toBeGreaterThanOrEqual(20);
  });

  it(`precision >= ${PRECISION_THRESHOLD * 100}% across all corpus entries`, () => {
    const entries = loadCorpus();
    const { truePositives, falsePositives } = scoreCorpus(entries);

    const precision =
      truePositives + falsePositives === 0
        ? 1.0
        : truePositives / (truePositives + falsePositives);

    const precisionMsg = `Precision ${(precision * 100).toFixed(1)}% below required ${PRECISION_THRESHOLD * 100}% (REQ-NF-008). truePositives=${truePositives}, falsePositives=${falsePositives}`;
    expect(precision, precisionMsg).toBeGreaterThanOrEqual(PRECISION_THRESHOLD);
  });

  it(`recall >= ${RECALL_THRESHOLD * 100}% across all corpus entries`, () => {
    const entries = loadCorpus();
    const { truePositives, falseNegatives } = scoreCorpus(entries);

    const recall =
      truePositives + falseNegatives === 0
        ? 1.0
        : truePositives / (truePositives + falseNegatives);

    const recallMsg = `Recall ${(recall * 100).toFixed(1)}% below required ${RECALL_THRESHOLD * 100}% (REQ-NF-009). truePositives=${truePositives}, falseNegatives=${falseNegatives}`;
    expect(recall, recallMsg).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
  });

  it("committed synthetic baseline has no false positives or false negatives", () => {
    const entries = loadCorpus().filter(isSyntheticBaseline);
    const metrics = scoreCorpus(entries);

    expect(entries).toHaveLength(20);
    expect(metrics.falsePositives).toBe(0);
    expect(metrics.falseNegatives).toBe(0);
  });

  it("prints per-entry breakdown for diagnostic visibility", () => {
    const entries = loadCorpus();
    const rows: string[] = [];

    for (const entry of entries) {
      const result = detectReferences(entry.detection_blocks, entry.assistant_message);
      const trueRefIds = new Set(entry.ground_truth.referenced_block_ids);
      const tp = [...result.referenced_ids].filter((id) => trueRefIds.has(id)).length;
      const fp = [...result.referenced_ids].filter((id) => !trueRefIds.has(id)).length;
      const fn = [...trueRefIds].filter((id) => !result.referenced_ids.has(id)).length;
      rows.push(`  ${entry.id}: TP=${tp} FP=${fp} FN=${fn} — ${entry.description}`);
    }

    // Log breakdown (always visible in vitest --reporter=verbose)
    console.log("\nCorpus breakdown:\n" + rows.join("\n"));

    // The test itself is a structural check — it passes as long as all entries are processed
    expect(rows.length).toBe(entries.length);
  });
});
