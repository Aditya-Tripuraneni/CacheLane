#!/usr/bin/env tsx
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  openDatabase,
  type CachelaneStats,
  type StatsScope,
} from "../src/storage/index.js";

// ── CLI flags ────────────────────────────────────────────────────────────────
const { values } = parseArgs({
  options: {
    interval: { type: "string", default: "3" },
    db:       { type: "string" },
    scope:    { type: "string", default: "session" },
  },
  strict: false,
});

const INTERVAL_MS = Math.max(1000, (Number(values.interval) || 3) * 1000);
const SCOPE: StatsScope =
  values.scope === "workspace" || values.scope === "all" ? values.scope : "session";
const DB_PATH =
  (values.db as string | undefined) ??
  path.join(
    process.env.CACHELANE_HOME ?? path.join(homedir(), ".cachelane"),
    "cachelane.db",
  );
const WORKSPACE_ID = process.env.CACHELANE_WORKSPACE_ID ?? "default";

// If an explicit session ID was given, use it; otherwise detect per-tick.
const EXPLICIT_SESSION_ID = process.env.CACHELANE_SESSION_ID ?? null;
let SESSION_ID = EXPLICIT_SESSION_ID ?? "default";

// Re-detect the most recently active session on each tick (only when no explicit ID).
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
    // DB may not exist yet; keep current SESSION_ID
  }
}

// ── Data types ───────────────────────────────────────────────────────────────
interface TurnRow {
  turn_number: number;
  input_tokens: number;
  cache_read_tokens: number;
  effective_cost_units: number;
  pruned_blocks_count: number;
  keepalive_pings_since_last_turn: number;
}

type TickResult =
  | { ok: true;  stats: CachelaneStats; recentTurns: TurnRow[] }
  | { ok: false; error: string };

// ── DB reads (open/close per tick to avoid WAL contention) ───────────────────
function buildRecentTurnsQuery(): { sql: string; params: string[] } {
  if (SCOPE === "all") {
    return {
      sql: `SELECT turn_number, input_tokens, cache_read_tokens,
                   effective_cost_units, pruned_blocks_count,
                   keepalive_pings_since_last_turn
            FROM turns ORDER BY created_at DESC LIMIT 10`,
      params: [],
    };
  }
  if (SCOPE === "workspace") {
    return {
      sql: `SELECT turn_number, input_tokens, cache_read_tokens,
                   effective_cost_units, pruned_blocks_count,
                   keepalive_pings_since_last_turn
            FROM turns WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 10`,
      params: [WORKSPACE_ID],
    };
  }
  return {
    sql: `SELECT turn_number, input_tokens, cache_read_tokens,
                 effective_cost_units, pruned_blocks_count,
                 keepalive_pings_since_last_turn
          FROM turns WHERE workspace_id = ? AND session_id = ?
          ORDER BY created_at DESC LIMIT 10`,
    params: [WORKSPACE_ID, SESSION_ID],
  };
}

function readTick(): TickResult {
  refreshSessionId();
  let cacheDb;
  try {
    cacheDb = openDatabase(DB_PATH);
  } catch {
    return {
      ok: false,
      error: `Database not found: ${DB_PATH}\nRun: node dist/cli/index.js install`,
    };
  }

  try {
    const stats = cacheDb.getStats({
      scope:        SCOPE,
      workspace_id: SCOPE === "all" ? undefined : WORKSPACE_ID,
      session_id:   SCOPE === "session" ? SESSION_ID : undefined,
    });

    const { sql, params } = buildRecentTurnsQuery();
    const raw = new Database(DB_PATH, { readonly: true });
    let recentTurns: TurnRow[];
    try {
      recentTurns = raw.prepare(sql).all(...params) as TurnRow[];
    } finally {
      raw.close();
    }

    return { ok: true, stats, recentTurns };
  } finally {
    cacheDb.close();
  }
}

// ── Formatting helpers ───────────────────────────────────────────────────────
const SEP  = "═".repeat(62);
const LINE = "─".repeat(62);

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function pad(s: string | number, width: number, right = false): string {
  const str = String(s);
  return right
    ? str.padStart(width)
    : str.padEnd(width);
}

function renderPanel(result: TickResult): string {
  const now = new Date().toLocaleTimeString("en-US", { hour12: false });
  const intervalSec = INTERVAL_MS / 1000;

  const scopeLine = SCOPE === "session"
    ? `  session: ${EXPLICIT_SESSION_ID ? SESSION_ID : `${SESSION_ID} (auto)`}`
    : `  scope: ${SCOPE}`;
  const header = [
    SEP,
    `  CacheLane Live Benchmark${pad(`[${intervalSec}s poll]`, 36, true)}`,
    scopeLine,
    SEP,
  ].join("\n");

  const footer = `${LINE}\n  Updated: ${now}   DB: ${DB_PATH}\n  Ctrl+C to exit\n${SEP}`;

  if (!result.ok) {
    return `${header}\n\n  ${result.error.replace(/\n/g, "\n  ")}\n\n${footer}`;
  }

  const { stats, recentTurns } = result;

  if (stats.turns === 0) {
    return (
      `${header}\n\n` +
      `  No session data yet — waiting for CacheLane to process a turn...\n\n` +
      footer
    );
  }

  const tokensSaved = Math.round(stats.baseline_cost_units - stats.effective_cost_units);

  const totals = [
    `  TOTALS`,
    `  ${pad("Turns processed",      22)}: ${fmt(stats.turns)}`,
    `  ${pad("Cache hit ratio",      22)}: ${pct(stats.cache_hit_ratio)}`,
    `  ${pad("Savings ratio",        22)}: ${pct(stats.savings_ratio)}`,
    `  ${pad("Cost units saved",     22)}: ${fmt(tokensSaved)}`,
    `  ${pad("Baseline cost units",  22)}: ${fmt(stats.baseline_cost_units)}`,
    `  ${pad("Effective cost units", 22)}: ${fmt(stats.effective_cost_units)}`,
    `  ${pad("Pruned blocks",        22)}: ${fmt(stats.pruner_counts.pruned_blocks)}`,
    `  ${pad("Keepalive pings",      22)}: ${fmt(stats.keepalive_counts.pings)}`,
  ].join("\n");

  const tableHeader = [
    SEP,
    `  LAST ${recentTurns.length} TURNS`,
    `  ${pad("Turn", 6)}${pad("Input", 9, true)}  ${pad("CacheRead", 10, true)}  ${pad("Pruned", 7, true)}  ${pad("KAPings", 8, true)}`,
    `  ${LINE.slice(0, 44)}`,
  ].join("\n");

  const tableRows = recentTurns
    .map(
      (t) =>
        `  ${pad(t.turn_number, 6, true)}` +
        `${pad(fmt(t.input_tokens), 9, true)}  ` +
        `${pad(fmt(t.cache_read_tokens), 10, true)}  ` +
        `${pad(t.pruned_blocks_count, 7, true)}  ` +
        `${pad(t.keepalive_pings_since_last_turn, 8, true)}`,
    )
    .join("\n");

  return [header, totals, tableHeader, tableRows, footer].join("\n");
}

// ── Watcher ──────────────────────────────────────────────────────────────────
function startWatcher(): void {
  // Hide cursor for clean redraws
  process.stdout.write("\x1b[?25l");

  function tick(): void {
    const result = readTick();
    process.stdout.write("\x1b[2J\x1b[H"); // clear screen + move to top-left
    process.stdout.write(renderPanel(result) + "\n");
  }

  tick(); // draw immediately on start, don't wait for first interval
  const timer = setInterval(tick, INTERVAL_MS);

  function exit(): void {
    clearInterval(timer);
    process.stdout.write("\x1b[?25h\n"); // restore cursor
    process.stdout.write("Exiting.\n");
    process.exit(0);
  }

  process.on("SIGINT", exit);
  process.on("SIGTERM", exit);
}

// ── Entry point ──────────────────────────────────────────────────────────────
startWatcher();
