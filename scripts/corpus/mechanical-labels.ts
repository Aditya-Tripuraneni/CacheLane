// scripts/corpus/mechanical-labels.ts
//
// Layer 1: deterministic labeling. Produces ONLY positives — cases that are
// mechanically certain from the trajectory (Signal-1 and Signal-2 equivalents).
//
// IMPORTANT: a block that is NOT mechanically positive is NOT automatically a
// negative. Presence in context is not non-use. Undecided blocks become the
// "residual" handed to the judge / human. The only ground-truth negatives in
// the corpus come from the judge/human saying "not referenced".
//
// Provenance matters for the eval: labels sourced here are "explicit". Grading
// Signals 1 & 2 against them is grading the detector on its own homework, so
// eval.ts reports an implicit-only recall slice computed over judge/human
// labels — that is the number that actually validates the detector.

import type { BlockLabel, CorpusBlock, CorpusTurn, ToolCall } from "./types.js";

const PATH_KEYS = ["file_path", "path", "filePath", "notebook_path", "target_file", "command"];

function basename(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const parts = norm.split("/");
  return parts[parts.length - 1] || norm;
}

function pathsInToolCall(tc: ToolCall): string[] {
  const found: string[] = [];
  for (const k of PATH_KEYS) {
    const v = tc.input[k];
    if (typeof v === "string") found.push(v);
  }
  // Also scan any string value that contains a slash (catches Bash commands etc.)
  for (const v of Object.values(tc.input)) {
    if (typeof v === "string" && v.includes("/")) found.push(v);
  }
  return found;
}

function fileReferenced(block: CorpusBlock, tc: ToolCall): boolean {
  if (!block.file_path) return false;
  const target = basename(block.file_path).toLowerCase();
  const full = block.file_path.replace(/\\/g, "/").toLowerCase();
  for (const raw of pathsInToolCall(tc)) {
    const hay = raw.replace(/\\/g, "/").toLowerCase();
    if (hay === full || hay.includes(full) || hay.includes(target)) return true;
  }
  return false;
}

/** Returns mechanical (deterministic, positive-only) labels for one turn. */
export function mechanicalLabels(turn: CorpusTurn): BlockLabel[] {
  const labels: BlockLabel[] = [];
  const decided = new Set<string>();

  // Signal 1: a file_read block whose path appears in a tool call.
  for (const tc of turn.tool_calls) {
    for (const b of turn.blocks_in_prompt) {
      if (decided.has(b.id)) continue;
      if (b.kind === "file_read" && fileReferenced(b, tc)) {
        labels.push({
          turn_number: turn.turn_number,
          block_id: b.id,
          referenced: true,
          source: "mechanical:tool_call",
          reason: `tool=${tc.name} path=${b.file_path}`,
        });
        decided.add(b.id);
      }
    }
  }

  // Signal 2: a block's injected id_token appears verbatim in the response text.
  for (const b of turn.blocks_in_prompt) {
    if (decided.has(b.id)) continue;
    if (b.id_token && turn.assistant_text.includes(b.id_token)) {
      labels.push({
        turn_number: turn.turn_number,
        block_id: b.id,
        referenced: true,
        source: "mechanical:id_mention",
        reason: `id_token=${b.id_token}`,
      });
      decided.add(b.id);
    }
  }

  return labels;
}

/** Blocks in this turn that mechanical labeling could NOT decide → judge/human. */
export function residualBlocks(turn: CorpusTurn, decided: Set<string>): CorpusBlock[] {
  return turn.blocks_in_prompt.filter((b) => !decided.has(b.id));
}
