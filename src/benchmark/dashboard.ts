import { homedir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  openDatabase,
  type CachelaneStats,
  type StatsScope,
} from "../storage/index.js";

// ── Anthropic Pricing (Sonnet 4) ─────────────────────────────────────────────
const PRICE_INPUT_PER_MTOK = 3.00;
const PRICE_CACHE_READ_PER_MTOK = 0.30;
const PRICE_CACHE_WRITE_5M_PER_MTOK = 3.75;
const PRICE_CACHE_WRITE_1H_PER_MTOK = 3.75;

// ── ANSI colors ──────────────────────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  cyan:    "\x1b[36m",
  magenta: "\x1b[35m",
  white:   "\x1b[37m",
  bgGreen: "\x1b[42m\x1b[30m",
  bgRed:   "\x1b[41m\x1b[37m",
};

function colorForSavings(ratio: number): string {
  if (ratio >= 0.60) return C.green;
  if (ratio >= 0.30) return C.yellow;
  return C.red;
}

// ── Data types ───────────────────────────────────────────────────────────────
interface TurnRow {
  turn_number: number;
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  effective_cost_units: number;
  pruned_blocks_count: number;
  keepalive_pings_since_last_turn: number;
}

interface ScopeTotals {
  input_tokens: number;
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  cache_read_tokens: number;
}

type TickResult =
  | { ok: true; stats: CachelaneStats; recentTurns: TurnRow[]; totals: ScopeTotals }
  | { ok: false; error: string };

// ── Watcher & Loop ───────────────────────────────────────────────────────────
export function runDashboard(options: {
  interval?: number;
  db?: string;
  scope?: string;
}): void {
  const env = process.env;
  const intervalMs = Math.max(1000, (options.interval || 3) * 1000);
  const scope: StatsScope =
    options.scope === "workspace" || options.scope === "all" ? options.scope : "session";

  const dbPath =
    options.db ??
    path.join(
      env.CACHELANE_HOME ?? path.join(homedir(), ".cachelane"),
      "cachelane.db",
    );

  const workspaceId = env.CACHELANE_WORKSPACE_ID ?? "default";
  const explicitSessionId = env.CACHELANE_SESSION_ID ?? null;
  let sessionId = explicitSessionId ?? "default";

  function refreshSessionId(): void {
    if (explicitSessionId || scope !== "session") return;
    try {
      const raw = new Database(dbPath, { readonly: true });
      const row = raw
        .prepare<[string]>(
          "SELECT session_id FROM turns WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(workspaceId) as { session_id: string } | undefined;
      raw.close();
      if (row?.session_id) sessionId = row.session_id;
    } catch {
      // Keep current sessionId
    }
  }

  function buildRecentTurnsQuery(): { sql: string; params: string[] } {
    if (scope === "all") {
      return {
        sql: `SELECT turn_number, input_tokens, cache_read_tokens,
                     cache_creation_5m_tokens, cache_creation_1h_tokens,
                     effective_cost_units, pruned_blocks_count,
                     keepalive_pings_since_last_turn
              FROM turns ORDER BY created_at DESC LIMIT 10`,
        params: [],
      };
    }
    if (scope === "workspace") {
      return {
        sql: `SELECT turn_number, input_tokens, cache_read_tokens,
                     cache_creation_5m_tokens, cache_creation_1h_tokens,
                     effective_cost_units, pruned_blocks_count,
                     keepalive_pings_since_last_turn
              FROM turns WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 10`,
        params: [workspaceId],
      };
    }
    return {
      sql: `SELECT turn_number, input_tokens, cache_read_tokens,
                   cache_creation_5m_tokens, cache_creation_1h_tokens,
                   effective_cost_units, pruned_blocks_count,
                   keepalive_pings_since_last_turn
            FROM turns WHERE workspace_id = ? AND session_id = ?
            ORDER BY created_at DESC LIMIT 10`,
      params: [workspaceId, sessionId],
    };
  }

  function getScopeTotals(raw: Database.Database): ScopeTotals {
    let sql: string;
    let params: string[];
    if (scope === "all") {
      sql = `SELECT COALESCE(SUM(input_tokens), 0) as input_tokens,
                    COALESCE(SUM(cache_creation_5m_tokens), 0) as cache_creation_5m_tokens,
                    COALESCE(SUM(cache_creation_1h_tokens), 0) as cache_creation_1h_tokens,
                    COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
             FROM turns`;
      params = [];
    } else if (scope === "workspace") {
      sql = `SELECT COALESCE(SUM(input_tokens), 0) as input_tokens,
                    COALESCE(SUM(cache_creation_5m_tokens), 0) as cache_creation_5m_tokens,
                    COALESCE(SUM(cache_creation_1h_tokens), 0) as cache_creation_1h_tokens,
                    COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
             FROM turns WHERE workspace_id = ?`;
      params = [workspaceId];
    } else {
      sql = `SELECT COALESCE(SUM(input_tokens), 0) as input_tokens,
                    COALESCE(SUM(cache_creation_5m_tokens), 0) as cache_creation_5m_tokens,
                    COALESCE(SUM(cache_creation_1h_tokens), 0) as cache_creation_1h_tokens,
                    COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
             FROM turns WHERE workspace_id = ? AND session_id = ?`;
      params = [workspaceId, sessionId];
    }
    return raw.prepare(sql).get(...params) as ScopeTotals;
  }

  function readTick(): TickResult {
    refreshSessionId();
    let cacheDb;
    try {
      cacheDb = openDatabase(dbPath);
    } catch {
      return {
        ok: false,
        error: `Database not found: ${dbPath}\nRun: cachelane install`,
      };
    }

    try {
      const stats = cacheDb.getStats({
        scope:        scope,
        workspace_id: scope === "all" ? undefined : workspaceId,
        session_id:   scope === "session" ? sessionId : undefined,
      });

      const { sql, params } = buildRecentTurnsQuery();
      const raw = new Database(dbPath, { readonly: true });
      let recentTurns: TurnRow[];
      let totals: ScopeTotals;
      try {
        recentTurns = raw.prepare(sql).all(...params) as TurnRow[];
        totals = getScopeTotals(raw);
      } finally {
        raw.close();
      }

      return { ok: true, stats, recentTurns, totals };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      cacheDb.close();
    }
  }

  const SEP  = "═".repeat(72);
  const LINE = "─".repeat(72);

  function fmt(n: number): string {
    return Math.round(n).toLocaleString("en-US");
  }

  function dollars(n: number): string {
    return `$${n.toFixed(4)}`;
  }

  // Use local pct/pad/asciiBar functions
  function pct(ratio: number): string {
    return `${(ratio * 100).toFixed(1)}%`;
  }

  function pad(s: string | number, width: number, right = false): string {
    const str = String(s);
    return right ? str.padStart(width) : str.padEnd(width);
  }

  function asciiBar(ratio: number, width: number = 10): string {
    const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
    const empty = width - filled;
    return "█".repeat(filled) + "░".repeat(empty);
  }

  function renderPanel(result: TickResult): string {
    const now = new Date().toLocaleTimeString("en-US", { hour12: false });
    const intervalSec = intervalMs / 1000;

    const scopeLine = scope === "session"
      ? `  session: ${explicitSessionId ? sessionId : `${sessionId} (auto)`}`
      : `  scope: ${scope}`;
    const header = [
      C.bold + SEP + C.reset,
      `  ${C.bold}CacheLane Live Benchmark${C.reset}${pad(`[${intervalSec}s poll]`, 44, true)}`,
      C.dim + scopeLine + C.reset,
      C.bold + SEP + C.reset,
    ].join("\n");

    const footer = `${C.bold}${LINE}${C.reset}\n  Updated: ${C.cyan}${now}${C.reset}   DB: ${C.dim}${dbPath}${C.reset}\n  Ctrl+C to exit\n${C.bold}${SEP}${C.reset}`;

    if (!result.ok) {
      return `${header}\n\n  ${C.red}Error: ${result.error.replace(/\n/g, "\n  ")}${C.reset}\n\n${footer}`;
    }

    const { stats, recentTurns, totals } = result;

    if (stats.turns === 0) {
      return (
        `${header}\n\n` +
        `  No session data yet — waiting for CacheLane to process a turn...\n\n` +
        footer
      );
    }

    const baselineTokens = totals.input_tokens + totals.cache_creation_5m_tokens +
                           totals.cache_creation_1h_tokens + totals.cache_read_tokens;

    const baselineCostDollars = (baselineTokens / 1_000_000) * PRICE_INPUT_PER_MTOK;
    const effectiveCostDollars =
      (totals.input_tokens / 1_000_000) * PRICE_INPUT_PER_MTOK +
      (totals.cache_creation_5m_tokens / 1_000_000) * PRICE_CACHE_WRITE_5M_PER_MTOK +
      (totals.cache_creation_1h_tokens / 1_000_000) * PRICE_CACHE_WRITE_1H_PER_MTOK +
      (totals.cache_read_tokens / 1_000_000) * PRICE_CACHE_READ_PER_MTOK;
    const savedDollars = Math.max(0, baselineCostDollars - effectiveCostDollars);

    const savingsColor = colorForSavings(stats.savings_ratio);
    const hitRatioBar = asciiBar(stats.cache_hit_ratio, 15);

    const totalsBlock = [
      `  ${C.bold}TOTALS${C.reset}`,
      `  ${pad("Turns processed",      22)}: ${fmt(stats.turns)}`,
      `  ${pad("Cache hit ratio",      22)}: ${savingsColor}${pct(stats.cache_hit_ratio)}${C.reset}  [${savingsColor}${hitRatioBar}${C.reset}]`,
      `  ${pad("Savings ratio",        22)}: ${savingsColor}${C.bold}${pct(stats.savings_ratio)}${C.reset}`,
      `  ${pad("Cost (USD)",           22)}: ${C.bold}${savingsColor}${dollars(effectiveCostDollars)}${C.reset} vs ${dollars(baselineCostDollars)} baseline (${C.bold}${savingsColor}${dollars(savedDollars)}${C.reset} saved)`,
      ``,
      `  ${pad("Cost units saved",     22)}: ${C.green}${fmt(stats.baseline_cost_units - stats.effective_cost_units)}${C.reset}`,
      `  ${pad("Baseline cost units",  22)}: ${fmt(stats.baseline_cost_units)}`,
      `  ${pad("Effective cost units", 22)}: ${fmt(stats.effective_cost_units)}`,
      `  ${pad("Pruned blocks",        22)}: ${fmt(stats.pruner_counts.pruned_blocks)}`,
      `  ${pad("Keepalive pings",      22)}: ${fmt(stats.keepalive_counts.pings)}`,
    ].join("\n");

    const tableHeader = [
      C.bold + LINE + C.reset,
      `  ${C.bold}LAST ${recentTurns.length} TURNS${C.reset}`,
      `  ${pad("Turn", 6)}${pad("Input", 9, true)}  ${pad("CacheRead", 10, true)}  ${pad("Saved%", 8, true)}  ${pad("Pruned", 7, true)}  ${pad("Pings", 6, true)}  HIT TREND`,
      `  ${C.dim}${LINE.slice(0, 70)}${C.reset}`,
    ].join("\n");

    const tableRows = recentTurns
      .map((t) => {
        const turnTotal = t.input_tokens + t.cache_creation_5m_tokens + t.cache_creation_1h_tokens + t.cache_read_tokens;
        const turnHitRatio = turnTotal > 0 ? t.cache_read_tokens / turnTotal : 0;
        const turnSavingsRatio = turnTotal > 0 ? 1 - (t.effective_cost_units / turnTotal) : 0;
        const turnColor = colorForSavings(turnSavingsRatio);
        const turnBar = asciiBar(turnHitRatio, 10);

        return (
          `  ${pad(t.turn_number, 6, true)}` +
          `${pad(fmt(t.input_tokens), 9, true)}  ` +
          `${turnColor}${pad(fmt(t.cache_read_tokens), 10, true)}${C.reset}  ` +
          `${turnColor}${pad(pct(turnSavingsRatio), 8, true)}${C.reset}  ` +
          `${pad(t.pruned_blocks_count, 7, true)}  ` +
          `${pad(t.keepalive_pings_since_last_turn, 6, true)}  ` +
          `${turnColor}${turnBar}${C.reset}`
        );
      })
      .join("\n");

    return [header, totalsBlock, tableHeader, tableRows, footer].join("\n");
  }

  process.stdout.write("\x1b[?25l"); // Hide cursor

  function tick(): void {
    const result = readTick();
    process.stdout.write("\x1b[2J\x1b[H"); // clear screen + move to top-left
    process.stdout.write(renderPanel(result) + "\n");
  }

  tick();
  const timer = setInterval(tick, intervalMs);

  function exit(): void {
    clearInterval(timer);
    process.stdout.write("\x1b[?25h\n"); // restore cursor
    process.stdout.write("Exiting.\n");
    process.exit(0);
  }

  process.on("SIGINT", exit);
  process.on("SIGTERM", exit);
}
