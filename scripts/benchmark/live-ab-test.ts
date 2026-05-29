#!/usr/bin/env tsx
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import path from "node:path";
import Database from "better-sqlite3";
import {
  openDatabase,
  type CachelaneStats,
  type StatsScope,
} from "../../src/storage/index.js";

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const c = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  cyan:    "\x1b[36m",
  magenta: "\x1b[35m",
  bgGreen: "\x1b[42m\x1b[30m",
  bgRed:   "\x1b[41m\x1b[37m",
  bgCyan:  "\x1b[46m\x1b[30m",
};

// ── CLI flags ────────────────────────────────────────────────────────────────
const { values } = parseArgs({
  options: {
    "turns-per-phase": { type: "string", default: "5" },
    db:                { type: "string" },
    scope:             { type: "string", default: "session" },
  },
  strict: false,
});

const TURNS_PER_PHASE = Math.max(1, Number(values["turns-per-phase"]) || 5);
const SCOPE: StatsScope =
  values.scope === "workspace" || values.scope === "all" ? values.scope : "session";
const DB_PATH =
  (values.db as string | undefined) ??
  path.join(
    process.env.CACHELANE_HOME ?? path.join(homedir(), ".cachelane"),
    "cachelane.db",
  );
const WORKSPACE_ID = process.env.CACHELANE_WORKSPACE_ID ?? "default";
const EXPLICIT_SESSION_ID = process.env.CACHELANE_SESSION_ID ?? null;
let SESSION_ID = EXPLICIT_SESSION_ID ?? "default";

const POLL_MS = 2000;

// ── Sonnet 4 pricing (per token) ────────────────────────────────────────────
const PRICE_INPUT      = 3.00 / 1_000_000;
const PRICE_CACHE_READ = 0.30 / 1_000_000;
const PRICE_CACHE_WRITE = 3.75 / 1_000_000;

// ── Session detection (mirrors live-benchmark.ts) ────────────────────────────
function refreshSessionId(): void {
  if (EXPLICIT_SESSION_ID || SCOPE !== "session") return;
  try {
    const raw = new Database(DB_PATH, { readonly: true });
    const row = raw
      .prepare<[string]>(
        "SELECT session_id FROM turns WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(WORKSPACE_ID) as { session_id: string } | undefined;
    raw.close();
    if (row?.session_id) SESSION_ID = row.session_id;
  } catch {
    // DB may not exist yet
  }
}

// ── Data types ───────────────────────────────────────────────────────────────
interface TurnSnapshot {
  turn_number: number;
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_5m_tokens: number;
  effective_cost_units: number;
}

interface PhaseResult {
  name: string;
  turns: TurnSnapshot[];
  avgInputTokens: number;
  avgCacheReadTokens: number;
  avgCacheWrite5mTokens: number;
  avgEffectiveCost: number;
  cacheHitRatio: number;
  savingsRatio: number;
  estCostPerTurn: number;
}

// ── DB reads ─────────────────────────────────────────────────────────────────
function getTurnCount(): number {
  refreshSessionId();
  try {
    const raw = new Database(DB_PATH, { readonly: true });
    let sql: string;
    let params: string[];
    if (SCOPE === "all") {
      sql = "SELECT COUNT(*) as cnt FROM turns";
      params = [];
    } else if (SCOPE === "workspace") {
      sql = "SELECT COUNT(*) as cnt FROM turns WHERE workspace_id = ?";
      params = [WORKSPACE_ID];
    } else {
      sql = "SELECT COUNT(*) as cnt FROM turns WHERE workspace_id = ? AND session_id = ?";
      params = [WORKSPACE_ID, SESSION_ID];
    }
    const row = raw.prepare(sql).get(...params) as { cnt: number };
    raw.close();
    return row.cnt;
  } catch {
    return 0;
  }
}

function getLatestTurn(): TurnSnapshot | null {
  refreshSessionId();
  try {
    const raw = new Database(DB_PATH, { readonly: true });
    let sql: string;
    let params: string[];
    if (SCOPE === "all") {
      sql = `SELECT turn_number, input_tokens, cache_read_tokens,
                    cache_creation_5m_tokens, effective_cost_units
             FROM turns ORDER BY created_at DESC LIMIT 1`;
      params = [];
    } else if (SCOPE === "workspace") {
      sql = `SELECT turn_number, input_tokens, cache_read_tokens,
                    cache_creation_5m_tokens, effective_cost_units
             FROM turns WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1`;
      params = [WORKSPACE_ID];
    } else {
      sql = `SELECT turn_number, input_tokens, cache_read_tokens,
                    cache_creation_5m_tokens, effective_cost_units
             FROM turns WHERE workspace_id = ? AND session_id = ?
             ORDER BY created_at DESC LIMIT 1`;
      params = [WORKSPACE_ID, SESSION_ID];
    }
    const row = raw.prepare(sql).get(...params) as TurnSnapshot | undefined;
    raw.close();
    return row ?? null;
  } catch {
    return null;
  }
}

// ── Formatting helpers ───────────────────────────────────────────────────────
const SEP      = "═".repeat(68);
const LINE     = "─".repeat(68);
const THIN_SEP = "─".repeat(68);

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function pad(s: string | number, width: number, right = false): string {
  const str = String(s);
  return right ? str.padStart(width) : str.padEnd(width);
}

function dollar(n: number): string {
  return `$${n.toFixed(4)}`;
}

// ── Terminal I/O ─────────────────────────────────────────────────────────────
function write(text: string): void {
  process.stdout.write(text);
}

function writeln(text = ""): void {
  process.stdout.write(text + "\n");
}

function clearScreen(): void {
  write("\x1b[2J\x1b[H");
}

async function waitForEnter(prompt: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<void>((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Phase runner ─────────────────────────────────────────────────────────────
async function collectPhase(
  phaseName: string,
  phaseLabel: string,
  phaseColor: string,
): Promise<TurnSnapshot[]> {
  const collected: TurnSnapshot[] = [];
  let lastTurnCount = getTurnCount();

  writeln();
  writeln(`  ${phaseColor} ${phaseLabel} ${c.reset}  Collecting ${TURNS_PER_PHASE} turns...`);
  writeln(`  ${c.dim}Use Claude Code normally in another terminal.${c.reset}`);
  writeln();

  while (collected.length < TURNS_PER_PHASE) {
    await sleep(POLL_MS);

    const currentCount = getTurnCount();
    if (currentCount > lastTurnCount) {
      // New turn(s) detected
      const newTurns = currentCount - lastTurnCount;
      lastTurnCount = currentCount;

      const turn = getLatestTurn();
      if (turn) {
        collected.push(turn);
        const cacheRatio =
          turn.input_tokens + turn.cache_read_tokens > 0
            ? turn.cache_read_tokens / (turn.input_tokens + turn.cache_read_tokens)
            : 0;

        const ratioColor = cacheRatio > 0.5 ? c.green : cacheRatio > 0.1 ? c.yellow : c.red;
        writeln(
          `  ${c.cyan}[${collected.length}/${TURNS_PER_PHASE}]${c.reset} ` +
          `Turn #${turn.turn_number}  ` +
          `input=${c.bold}${fmt(turn.input_tokens)}${c.reset}  ` +
          `cache_read=${c.bold}${fmt(turn.cache_read_tokens)}${c.reset}  ` +
          `cache_hit=${ratioColor}${pct(cacheRatio)}${c.reset}  ` +
          `eff_cost=${fmt(turn.effective_cost_units)}`,
        );
      }
    }
  }

  writeln(`  ${c.green}✓ Phase complete${c.reset}`);
  return collected;
}

// ── Compute phase results ────────────────────────────────────────────────────
function computePhaseResult(name: string, turns: TurnSnapshot[]): PhaseResult {
  const n = turns.length || 1;

  const avgInput     = turns.reduce((s, t) => s + t.input_tokens, 0) / n;
  const avgCacheRead = turns.reduce((s, t) => s + t.cache_read_tokens, 0) / n;
  const avgCacheW5m  = turns.reduce((s, t) => s + t.cache_creation_5m_tokens, 0) / n;
  const avgEffCost   = turns.reduce((s, t) => s + t.effective_cost_units, 0) / n;

  const totalInput     = turns.reduce((s, t) => s + t.input_tokens, 0);
  const totalCacheRead = turns.reduce((s, t) => s + t.cache_read_tokens, 0);

  const cacheHitRatio =
    totalInput + totalCacheRead > 0
      ? totalCacheRead / (totalInput + totalCacheRead)
      : 0;

  // Baseline = what it would cost if everything were plain input tokens
  const avgBaseline = avgInput + avgCacheRead + avgCacheW5m;
  const savingsRatio = avgBaseline > 0 ? 1 - avgEffCost / avgBaseline : 0;

  // Estimated dollar cost per turn (Sonnet 4 pricing)
  const estCostPerTurn =
    avgInput * PRICE_INPUT +
    avgCacheRead * PRICE_CACHE_READ +
    avgCacheW5m * PRICE_CACHE_WRITE;

  return {
    name,
    turns,
    avgInputTokens: avgInput,
    avgCacheReadTokens: avgCacheRead,
    avgCacheWrite5mTokens: avgCacheW5m,
    avgEffectiveCost: avgEffCost,
    cacheHitRatio,
    savingsRatio,
    estCostPerTurn,
  };
}

// ── Final report ─────────────────────────────────────────────────────────────
function renderReport(p1: PhaseResult, p2: PhaseResult, p3: PhaseResult): string {
  const col = 16;
  const labelW = 26;

  function row(label: string, v1: string, v2: string, v3: string): string {
    return `  ${pad(label, labelW)}${pad(v1, col, true)}${pad(v2, col, true)}${pad(v3, col, true)}`;
  }

  const lines = [
    "",
    `${c.bold}${SEP}${c.reset}`,
    `${c.bold}  CacheLane A/B Test Results${c.reset}`,
    `${c.bold}${SEP}${c.reset}`,
    row("", "Phase 1 (ON)", "Phase 2 (OFF)", "Phase 3 (ON)"),
    `  ${THIN_SEP.slice(0, labelW + col * 3)}`,
    row("Turns", String(p1.turns.length), String(p2.turns.length), String(p3.turns.length)),
    row("Avg input tokens", fmt(p1.avgInputTokens), fmt(p2.avgInputTokens), fmt(p3.avgInputTokens)),
    row("Avg cache_read tokens", fmt(p1.avgCacheReadTokens), fmt(p2.avgCacheReadTokens), fmt(p3.avgCacheReadTokens)),
    row("Avg cache_write_5m", fmt(p1.avgCacheWrite5mTokens), fmt(p2.avgCacheWrite5mTokens), fmt(p3.avgCacheWrite5mTokens)),
    row("Avg effective cost", fmt(p1.avgEffectiveCost), fmt(p2.avgEffectiveCost), fmt(p3.avgEffectiveCost)),
    row("Cache hit ratio", pct(p1.cacheHitRatio), pct(p2.cacheHitRatio), pct(p3.cacheHitRatio)),
    row("Savings ratio", pct(p1.savingsRatio), pct(p2.savingsRatio), pct(p3.savingsRatio)),
    row("Est. cost per turn", dollar(p1.estCostPerTurn), dollar(p2.estCostPerTurn), dollar(p3.estCostPerTurn)),
    `  ${THIN_SEP.slice(0, labelW + col * 3)}`,
  ];

  // Verdict
  const onAvgCost  = (p1.estCostPerTurn + p3.estCostPerTurn) / 2;
  const offAvgCost = p2.estCostPerTurn;
  const savingsPct = offAvgCost > 0 ? ((offAvgCost - onAvgCost) / offAvgCost) * 100 : 0;

  if (savingsPct > 0) {
    lines.push(
      `${c.bold}${c.green}  VERDICT: CacheLane saved ~${Math.round(savingsPct)}% on input token costs${c.reset}`,
    );
  } else {
    lines.push(
      `${c.bold}${c.yellow}  VERDICT: No significant savings detected (${savingsPct.toFixed(1)}%)${c.reset}`,
    );
  }

  lines.push(`${c.bold}${SEP}${c.reset}`, "");

  // Per-turn detail for each phase
  lines.push(`${c.bold}  Per-Turn Detail${c.reset}`);
  lines.push(`  ${THIN_SEP.slice(0, 64)}`);

  for (const phase of [p1, p2, p3]) {
    lines.push(`  ${c.cyan}${phase.name}${c.reset}`);
    lines.push(
      `  ${pad("Turn#", 8)}${pad("Input", 12, true)}${pad("CacheRead", 12, true)}${pad("CacheW5m", 12, true)}${pad("EffCost", 12, true)}`,
    );
    for (const t of phase.turns) {
      const hitRatio =
        t.input_tokens + t.cache_read_tokens > 0
          ? t.cache_read_tokens / (t.input_tokens + t.cache_read_tokens)
          : 0;
      const color = hitRatio > 0.5 ? c.green : hitRatio > 0.1 ? c.yellow : c.red;
      lines.push(
        `  ${pad(t.turn_number, 8, true)}` +
        `${pad(fmt(t.input_tokens), 12, true)}` +
        `${color}${pad(fmt(t.cache_read_tokens), 12, true)}${c.reset}` +
        `${pad(fmt(t.cache_creation_5m_tokens), 12, true)}` +
        `${pad(fmt(t.effective_cost_units), 12, true)}`,
      );
    }
    lines.push("");
  }

  lines.push(`${c.bold}${SEP}${c.reset}`);
  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  clearScreen();
  writeln(`${c.bold}${SEP}${c.reset}`);
  writeln(`${c.bold}  CacheLane A/B Toggle Test${c.reset}`);
  writeln(`${c.bold}${SEP}${c.reset}`);
  writeln();
  writeln(`  ${c.dim}DB:    ${DB_PATH}${c.reset}`);
  writeln(`  ${c.dim}Scope: ${SCOPE}${c.reset}`);
  writeln(`  ${c.dim}Turns per phase: ${TURNS_PER_PHASE}${c.reset}`);
  writeln();
  writeln(`  This test runs 3 phases to measure CacheLane's impact:`);
  writeln(`    ${c.green}Phase 1${c.reset}: CacheLane ON  (baseline)      — ${TURNS_PER_PHASE} turns`);
  writeln(`    ${c.red}Phase 2${c.reset}: CacheLane OFF (control)       — ${TURNS_PER_PHASE} turns`);
  writeln(`    ${c.green}Phase 3${c.reset}: CacheLane ON  (recovery)      — ${TURNS_PER_PHASE} turns`);
  writeln();
  writeln(`  ${c.yellow}Prerequisites:${c.reset}`);
  writeln(`    • CacheLane is currently ${c.green}enabled${c.reset}`);
  writeln(`    • You have a Claude Code session open in another terminal`);
  writeln();

  // ── Phase 1: CacheLane ON ──────────────────────────────────────────────────
  await waitForEnter(
    `  ${c.bold}Press Enter to begin Phase 1 (CacheLane ON)...${c.reset} `,
  );

  const phase1Turns = await collectPhase(
    "Phase 1 — CacheLane ON",
    " PHASE 1: CacheLane ON ",
    c.bgGreen,
  );

  writeln();
  writeln(`  ${THIN_SEP.slice(0, 50)}`);

  // ── Phase 2: CacheLane OFF ─────────────────────────────────────────────────
  writeln();
  writeln(
    `  ${c.bgRed} ACTION REQUIRED ${c.reset}  Run ${c.bold}cachelane disable${c.reset} in another terminal.`,
  );
  await waitForEnter(
    `  ${c.bold}Press Enter once CacheLane is disabled to begin Phase 2...${c.reset} `,
  );

  const phase2Turns = await collectPhase(
    "Phase 2 — CacheLane OFF",
    " PHASE 2: CacheLane OFF ",
    c.bgRed,
  );

  writeln();
  writeln(`  ${THIN_SEP.slice(0, 50)}`);

  // ── Phase 3: CacheLane ON (recovery) ──────────────────────────────────────
  writeln();
  writeln(
    `  ${c.bgGreen} ACTION REQUIRED ${c.reset}  Run ${c.bold}cachelane enable${c.reset} in another terminal.`,
  );
  await waitForEnter(
    `  ${c.bold}Press Enter once CacheLane is re-enabled to begin Phase 3...${c.reset} `,
  );

  const phase3Turns = await collectPhase(
    "Phase 3 — CacheLane ON (recovery)",
    " PHASE 3: CacheLane ON ",
    c.bgGreen,
  );

  // ── Compute & render results ───────────────────────────────────────────────
  const p1 = computePhaseResult("Phase 1 — CacheLane ON", phase1Turns);
  const p2 = computePhaseResult("Phase 2 — CacheLane OFF", phase2Turns);
  const p3 = computePhaseResult("Phase 3 — CacheLane ON (recovery)", phase3Turns);

  clearScreen();
  writeln(renderReport(p1, p2, p3));
}

// ── Entry point ──────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
