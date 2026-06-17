import { createHash } from "node:crypto";
import { openDatabase } from "../storage/index.js";
import { pruneExpiredBlocks, expandStub } from "../pruner/index.js";
import type { NormalizedTraceSession, TraceCorpusBlock } from "../agent-traces/types.js";
import type { CorrectnessReport, CorrectnessScenarioRow } from "./types.js";

const WORKSPACE = "bench-correctness";

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function ratio(num: number, denom: number, emptyValue: number): number {
  return denom === 0 ? emptyValue : num / denom;
}

interface BlockState {
  id: string;
  firstTurn: number;
  originalHash: string;
}

export function computeCorrectnessForSession(
  session: NormalizedTraceSession,
  k: number,
): CorrectnessScenarioRow {
  const db = openDatabase(":memory:");
  try {
    const sessionId = session.session_id;
    const firstSeen = new Map<string, BlockState>();
    const referenceTurns = new Map<string, number[]>(); // block id -> turns referenced after first

    let stubbedBlocks = 0;
    let stubbedThenReferenced = 0;
    let restoredCorrectly = 0;
    let neededBlocks = 0;
    let neededButUnavailable = 0;

    const sortedTurns = [...session.turns].sort((a, b) => a.turn_number - b.turn_number);

    for (const turn of sortedTurns) {
      // Insert blocks first seen this turn; record reference for blocks seen before.
      for (const block of turn.blocks_in_prompt) {
        if (!firstSeen.has(block.id)) {
          firstSeen.set(block.id, {
            id: block.id,
            firstTurn: turn.turn_number,
            originalHash: hash(block.content),
          });
          insertTraceBlock(db, sessionId, block, turn.turn_number);
        } else {
          // Block re-appears at a later turn => referenced.
          const list = referenceTurns.get(block.id) ?? [];
          list.push(turn.turn_number);
          referenceTurns.set(block.id, list);
        }
      }

      // Replay pruning at this turn using the REAL production path.
      const pruneResult = pruneExpiredBlocks(db, {
        workspace_id: WORKSPACE,
        session_id: sessionId,
        k,
        current_turn: turn.turn_number,
        enabled: true,
      });
      stubbedBlocks += pruneResult.pruned_blocks_count;
    }

    // For each block that was stubbed AND later referenced, test rehydration.
    for (const [id, state] of firstSeen.entries()) {
      const refs = referenceTurns.get(id) ?? [];
      if (refs.length === 0) continue;

      const row = db.getBlock(id);
      if (!row || row.is_stub !== 1) continue; // only count blocks actually stubbed
      stubbedThenReferenced += 1;
      neededBlocks += 1;

      const refetchTurn = refs[0]!;
      const result = expandStub(db, {
        workspace_id: WORKSPACE,
        session_id: sessionId,
        block_id: id,
        turn_number: refetchTurn,
        updated_at: refetchTurn,
      });

      if (!result.ok) {
        neededButUnavailable += 1;
        continue;
      }

      // Compare trace content at the refetch turn against the original hash.
      const refetchBlock = blockContentAtTurn(session, id, refetchTurn);
      const currentHash = refetchBlock === null ? null : hash(refetchBlock.content);
      if (currentHash !== null && currentHash === state.originalHash) {
        restoredCorrectly += 1;
      } else {
        neededButUnavailable += 1; // content drifted under the stub => stale
      }
    }

    return {
      scenario_id: session.scenario_id,
      session_id: sessionId,
      k,
      stubbed_blocks: stubbedBlocks,
      stubbed_then_referenced: stubbedThenReferenced,
      restored_correctly: restoredCorrectly,
      needed_blocks: neededBlocks,
      needed_but_unavailable: neededButUnavailable,
      rehydration_recall: ratio(restoredCorrectly, stubbedThenReferenced, 1),
      stale_answer_rate: ratio(neededButUnavailable, neededBlocks, 0),
    };
  } finally {
    db.close();
  }
}

function blockContentAtTurn(
  session: NormalizedTraceSession,
  blockId: string,
  turnNumber: number,
): TraceCorpusBlock | null {
  const turn = session.turns.find((t) => t.turn_number === turnNumber);
  if (!turn) return null;
  return turn.blocks_in_prompt.find((b) => b.id === blockId) ?? null;
}

function insertTraceBlock(
  db: ReturnType<typeof openDatabase>,
  sessionId: string,
  block: TraceCorpusBlock,
  addedAtTurn: number,
): void {
  db.insertBlock({
    id: block.id,
    workspace_id: WORKSPACE,
    session_id: sessionId,
    content_hash: hash(block.content),
    kind: block.kind,
    volatility: "VOLATILE",
    is_pinned: false,
    token_count: Math.ceil(block.content.length / 4),
    added_at_turn: addedAtTurn,
    last_referenced_at_turn: addedAtTurn,
    unused_turns: 0,
    is_stub: false,
    stub_summary: null,
    refetch_handle: JSON.stringify({ type: "tool_use", id: block.id }),
    restored_at_turn: null,
    created_at: addedAtTurn,
    updated_at: addedAtTurn,
  });
}

export interface GenerateCorrectnessOptions {
  run_id: string;
  generated_at: string;
  sessions: NormalizedTraceSession[];
  k: number;
  normalized_dir?: string | null;
}

export function generateCorrectnessReport(
  options: GenerateCorrectnessOptions,
): CorrectnessReport {
  const scenarios = options.sessions.map((s) => computeCorrectnessForSession(s, options.k));
  const totals = scenarios.reduce(
    (acc, row) => ({
      stubbed_blocks: acc.stubbed_blocks + row.stubbed_blocks,
      stubbed_then_referenced: acc.stubbed_then_referenced + row.stubbed_then_referenced,
      restored_correctly: acc.restored_correctly + row.restored_correctly,
      needed_blocks: acc.needed_blocks + row.needed_blocks,
      needed_but_unavailable: acc.needed_but_unavailable + row.needed_but_unavailable,
    }),
    {
      stubbed_blocks: 0,
      stubbed_then_referenced: 0,
      restored_correctly: 0,
      needed_blocks: 0,
      needed_but_unavailable: 0,
    },
  );

  return {
    run_id: options.run_id,
    generated_at: options.generated_at,
    k: options.k,
    source: {
      kind: "normalized_trace",
      provider: options.sessions[0]?.provider ?? null,
      normalized_dir: options.normalized_dir ?? null,
    },
    totals: {
      ...totals,
      rehydration_recall: ratio(totals.restored_correctly, totals.stubbed_then_referenced, 1),
      stale_answer_rate: ratio(totals.needed_but_unavailable, totals.needed_blocks, 0),
    },
    scenarios,
    privacy: { content_persisted: false },
  };
}

export function formatCorrectnessMarkdown(report: CorrectnessReport): string {
  return [
    `# CacheLane Cache-Correctness ${report.run_id}`,
    "",
    `Generated: ${report.generated_at}`,
    `K: ${report.k}`,
    "",
    "## Totals",
    "",
    `- Rehydration recall: ${(report.totals.rehydration_recall * 100).toFixed(1)}%`,
    `- Stale answer rate: ${(report.totals.stale_answer_rate * 100).toFixed(1)}%`,
    `- Stubbed blocks: ${report.totals.stubbed_blocks}`,
    `- Stubbed then referenced: ${report.totals.stubbed_then_referenced}`,
    `- Restored correctly: ${report.totals.restored_correctly}`,
    "",
    "## Scenarios",
    "",
    "| Scenario | K | Stubbed | Needed | Recall | Stale |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.scenarios.map(
      (r) =>
        `| ${r.scenario_id} | ${r.k} | ${r.stubbed_blocks} | ${r.needed_blocks} | ${(r.rehydration_recall * 100).toFixed(1)}% | ${(r.stale_answer_rate * 100).toFixed(1)}% |`,
    ),
    "",
    "No prompt text, file contents, or tool output are persisted in this report.",
    "",
  ].join("\n");
}
