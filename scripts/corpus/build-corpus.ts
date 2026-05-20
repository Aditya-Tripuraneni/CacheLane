// scripts/corpus/build-corpus.ts
//
// Orchestrates the labeling pipeline and freezes a static corpus fixture.
//
//   tsx scripts/corpus/build-corpus.ts build   --in ~/.claude/projects --out corpus
//   tsx scripts/corpus/build-corpus.ts anchor  --in ~/.claude/projects --out corpus/anchor.residual.json --sessions 15
//   tsx scripts/corpus/build-corpus.ts build-human --in ~/.claude/projects --human corpus/anchor.human.json --out corpus
//   tsx scripts/corpus/build-corpus.ts calibrate --human corpus/anchor.human.json --out corpus
//
// build:     full automated pass (mechanical + judge) -> corpus/sessions/*.json
// anchor:    emit residual rows for ~N sessions so a human can label them once
//            (the ONLY human task; ~1 hour). Human fills in `referenced`.
// build-human: freeze corpus from mechanical labels + human residual labels
//            without making any model/API calls.
// calibrate: compare the human anchor file against what the judge said, print
//            agreement / precision / recall of judge-vs-human. >90% => trust the
//            judge on the rest. <90% => the task is ambiguous; tighten the rubric.
//
// The judge is scaffolding. CI never runs this file.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { ingestSession } from "./ingest.js";
import { mechanicalLabels, residualBlocks } from "./mechanical-labels.js";
import { judgeTurn } from "./judge.js";
import type { BlockLabel, LabeledSession, ResidualRow } from "./types.js";

function expand(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function findSessions(root: string, limit = Infinity): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".jsonl")) out.push(full);
      if (out.length >= limit) return;
    }
  };
  walk(root);
  return out.slice(0, limit === Infinity ? out.length : limit);
}

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function labelKey(sessionId: string, turnNumber: number, blockId: string): string {
  return `${sessionId}:${turnNumber}:${blockId}`;
}

function sessionIdFromPath(path: string): string {
  return basename(path, ".jsonl");
}

async function labelSession(path: string): Promise<LabeledSession> {
  const turns = ingestSession(path);
  const labels: BlockLabel[] = [];

  for (const turn of turns) {
    const mech = mechanicalLabels(turn);
    labels.push(...mech);
    const decided = new Set(mech.map((l) => l.block_id));
    const residual = residualBlocks(turn, decided);
    const judged = await judgeTurn(turn, residual);
    labels.push(...judged);
  }

  return { session_id: sessionIdFromPath(path), source_path: path, turns, labels };
}

async function cmdBuild() {
  const inDir = expand(arg("--in", "~/.claude/projects")!);
  const outDir = expand(arg("--out", "corpus")!);
  const limit = Number(arg("--sessions", "Infinity"));
  mkdirSync(join(outDir, "sessions"), { recursive: true });

  const sessions = findSessions(inDir, isFinite(limit) ? limit : Infinity);
  console.error(`Found ${sessions.length} session(s) under ${inDir}`);

  let mechCount = 0;
  let judgeCount = 0;
  for (const [i, path] of sessions.entries()) {
    const labeled = await labelSession(path);
    writeFileSync(join(outDir, "sessions", `${labeled.session_id}.json`), JSON.stringify(labeled, null, 2));
    mechCount += labeled.labels.filter((l) => l.source.startsWith("mechanical")).length;
    judgeCount += labeled.labels.filter((l) => l.source === "judge").length;
    console.error(`[${i + 1}/${sessions.length}] ${labeled.session_id}: ${labeled.labels.length} labels`);
  }
  console.error(`\nDone. ${mechCount} mechanical (deterministic) + ${judgeCount} judge labels.`);
  console.error(`Mechanical share: ${((mechCount / (mechCount + judgeCount)) * 100).toFixed(0)}% — these cost zero human/LLM judgment.`);
}

function cmdAnchor() {
  const inDir = expand(arg("--in", "~/.claude/projects")!);
  const out = expand(arg("--out", "corpus/anchor.residual.json")!);
  const n = Number(arg("--sessions", "15"));
  const sessions = findSessions(inDir, n);
  mkdirSync(dirname(out), { recursive: true });

  const rows: (ResidualRow & { referenced: null; hint_assistant_text: string; hint_block: string })[] = [];
  for (const path of sessions) {
    const turns = ingestSession(path);
    const sid = sessionIdFromPath(path);
    for (const turn of turns) {
      const decided = new Set(mechanicalLabels(turn).map((l) => l.block_id));
      for (const b of residualBlocks(turn, decided)) {
        rows.push({
          session_id: sid,
          turn_number: turn.turn_number,
          block_id: b.id,
          referenced: null, // human fills this: true / false
          hint_assistant_text: turn.assistant_text.slice(0, 400),
          hint_block: `${b.kind}${b.file_path ? ` ${b.file_path}` : ""}: ${b.content.slice(0, 200)}`,
        });
      }
    }
  }
  writeFileSync(out, JSON.stringify(rows, null, 2));
  console.error(`Wrote ${rows.length} residual rows from ${sessions.length} sessions to ${out}.`);
  console.error(`Human task: set "referenced" true/false on each. This is the only manual step.`);
}

function loadHumanLabels(humanPath: string): Map<string, BlockLabel> {
  const rows: Array<{
    session_id: string;
    turn_number: number;
    block_id: string;
    referenced: boolean | null;
    reason?: string;
  }> = JSON.parse(readFileSync(humanPath, "utf8"));
  const out = new Map<string, BlockLabel>();
  for (const row of rows) {
    if (typeof row.referenced !== "boolean") continue;
    out.set(labelKey(row.session_id, row.turn_number, row.block_id), {
      turn_number: row.turn_number,
      block_id: row.block_id,
      referenced: row.referenced,
      source: "human",
      reason: row.reason ?? "human-labeled-residual",
    });
  }
  return out;
}

function cmdBuildHuman() {
  const inDir = expand(arg("--in", "~/.claude/projects")!);
  const outDir = expand(arg("--out", "corpus")!);
  const humanPath = expand(arg("--human", "corpus/anchor.human.json")!);
  const limit = Number(arg("--sessions", "Infinity"));
  const humanLabels = loadHumanLabels(humanPath);

  mkdirSync(join(outDir, "sessions"), { recursive: true });

  const sessions = findSessions(inDir, isFinite(limit) ? limit : Infinity);
  console.error(`Found ${sessions.length} session(s) under ${inDir}`);
  console.error(`Loaded ${humanLabels.size} human residual label(s) from ${humanPath}`);

  let mechCount = 0;
  let humanCount = 0;
  let missingHumanCount = 0;

  for (const [i, path] of sessions.entries()) {
    const sid = sessionIdFromPath(path);
    const turns = ingestSession(path);
    const labels: BlockLabel[] = [];

    for (const turn of turns) {
      const mech = mechanicalLabels(turn);
      labels.push(...mech);
      mechCount += mech.length;

      const decided = new Set(mech.map((l) => l.block_id));
      for (const block of residualBlocks(turn, decided)) {
        const human = humanLabels.get(labelKey(sid, turn.turn_number, block.id));
        if (human) {
          labels.push(human);
          humanCount += 1;
        } else {
          missingHumanCount += 1;
        }
      }
    }

    const labeled: LabeledSession = {
      session_id: sid,
      source_path: path,
      turns,
      labels,
    };
    writeFileSync(join(outDir, "sessions", `${sid}.json`), JSON.stringify(labeled, null, 2));
    console.error(`[${i + 1}/${sessions.length}] ${sid}: ${labels.length} labels`);
  }

  console.error(`\nDone. ${mechCount} mechanical + ${humanCount} human residual labels.`);
  if (missingHumanCount > 0) {
    console.error(
      `WARNING: ${missingHumanCount} residual block(s) had no human label and are skipped by eval.ts.`,
    );
    console.error("For a real gate, label every residual row from the same --sessions set.");
  }
}

function cmdCalibrate() {
  const humanPath = expand(arg("--human", "corpus/anchor.human.json")!);
  const outDir = expand(arg("--out", "corpus")!);
  const human: { session_id: string; turn_number: number; block_id: string; referenced: boolean }[] =
    JSON.parse(readFileSync(humanPath, "utf8"));

  // Load judge verdicts from the frozen corpus for the same rows.
  const judgeMap = new Map<string, boolean>();
  for (const sid of new Set(human.map((h) => h.session_id))) {
    const p = join(outDir, "sessions", `${sid}.json`);
    const ls: LabeledSession = JSON.parse(readFileSync(p, "utf8"));
    for (const l of ls.labels) judgeMap.set(`${sid}:${l.turn_number}:${l.block_id}`, l.referenced);
  }

  let tp = 0, fp = 0, fn = 0, tn = 0, agree = 0;
  for (const h of human) {
    if (h.referenced == null) continue;
    const j = judgeMap.get(`${h.session_id}:${h.turn_number}:${h.block_id}`);
    if (j === undefined) continue;
    if (j === h.referenced) agree++;
    if (j && h.referenced) tp++;
    else if (j && !h.referenced) fp++;
    else if (!j && h.referenced) fn++;
    else tn++;
  }
  const total = tp + fp + fn + tn;
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  console.error(`Judge vs human on ${total} residual rows:`);
  console.error(`  agreement: ${((agree / total) * 100).toFixed(1)}%`);
  console.error(`  judge precision: ${(precision * 100).toFixed(1)}%  recall: ${(recall * 100).toFixed(1)}%`);
  console.error(agree / total >= 0.9 ? "  >=90% — judge is trustworthy for the rest of the corpus." : "  <90% — task is ambiguous; tighten the judge rubric before trusting it.");
}

const cmd = process.argv[2];
(async () => {
  if (cmd === "build") await cmdBuild();
  else if (cmd === "build-human") cmdBuildHuman();
  else if (cmd === "anchor") cmdAnchor();
  else if (cmd === "calibrate") cmdCalibrate();
  else {
    console.error("usage: build-corpus.ts <build|build-human|anchor|calibrate> [--in DIR] [--out PATH] [--sessions N] [--human PATH]");
    process.exit(1);
  }
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
