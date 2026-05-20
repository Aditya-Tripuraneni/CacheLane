// scripts/corpus/eval.ts
//
// THE GATE. Runs the deterministic three-signal detector against the frozen
// corpus labels and computes precision/recall. No model here — fully
// reproducible. Imported by the M4 vitest CI test.
//
// Spec thresholds (REQ-NF-008/009, Systems Design §4.3): precision >= 95%,
// recall >= 85%, measured against the 100-session corpus (amendable to ~30 with
// a documented power-analysis rationale + two-engineer doc reconciliation).
//
// Two numbers are reported:
//   - overall precision/recall  -> the spec gate
//   - implicit-only recall      -> recall over judge/human-sourced labels only.
//     This is the number that actually validates the detector, because grading
//     Signals 1 & 2 against mechanical labels is circular (the labels and the
//     signals use the same logic). Watch this one.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BlockLabel, CorpusTurn, LabeledSession } from "./types.js";
import { isExplicit } from "./types.js";

import { detectReferences } from "../../src/references/three-signal-detector.js";

export interface EvalResult {
  precision: number;
  recall: number;
  implicitRecall: number;
  tp: number;
  fp: number;
  fn: number;
  implicitTp: number;
  implicitFn: number;
}

export function loadCorpus(dir: string): LabeledSession[] {
  const sessionsDir = join(dir, "sessions");
  return readdirSync(sessionsDir)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => JSON.parse(readFileSync(join(sessionsDir, f), "utf8")) as LabeledSession);
}

export function evaluate(corpus: LabeledSession[]): EvalResult {
  let tp = 0, fp = 0, fn = 0;
  let implicitTp = 0, implicitFn = 0;

  for (const session of corpus) {
    const labelByKey = new Map<string, BlockLabel>();
    for (const l of session.labels) labelByKey.set(`${l.turn_number}:${l.block_id}`, l);

    for (const turn of session.turns) {
      const predicted: Set<string> = detectReferences(turn as CorpusTurn);

      for (const b of turn.blocks_in_prompt) {
        const truth = labelByKey.get(`${turn.turn_number}:${b.id}`);
        if (!truth) continue; // unlabeled block — skip
        const pred = predicted.has(b.id);

        if (pred && truth.referenced) tp++;
        else if (pred && !truth.referenced) fp++;
        else if (!pred && truth.referenced) fn++;

        // implicit slice: only judge/human-sourced positives
        if (!isExplicit(truth.source) && truth.referenced) {
          if (pred) implicitTp++;
          else implicitFn++;
        }
      }
    }
  }

  return {
    precision: tp + fp ? tp / (tp + fp) : 1,
    recall: tp + fn ? tp / (tp + fn) : 1,
    implicitRecall: implicitTp + implicitFn ? implicitTp / (implicitTp + implicitFn) : 1,
    tp, fp, fn, implicitTp, implicitFn,
  };
}

// Allow running standalone: `tsx scripts/corpus/eval.ts corpus`
if (process.argv[1]?.endsWith("eval.ts") || process.argv[1]?.endsWith("eval.js")) {
  const dir = process.argv[2] ?? "corpus";
  const r = evaluate(loadCorpus(dir));
  console.error(`precision: ${(r.precision * 100).toFixed(1)}%  (gate >= 95%)`);
  console.error(`recall:    ${(r.recall * 100).toFixed(1)}%  (gate >= 85%)`);
  console.error(`implicit-only recall: ${(r.implicitRecall * 100).toFixed(1)}%  <-- the number that actually matters`);
  const pass = r.precision >= 0.95 && r.recall >= 0.85;
  if (!pass) {
    console.error("GATE FAILED");
    process.exit(1);
  }
  if (r.implicitRecall < 0.85) {
    console.error("WARNING: overall gate passed but implicit recall is low — the detector is leaning on explicit signals and missing conceptual references.");
  }
  console.error("GATE PASSED");
}
