import { homedir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// ── Anthropic Pricing (Sonnet 4) ─────────────────────────────────────────────
const PRICE_INPUT_PER_MTOK = 3.00;        // $3.00 per million input tokens
const PRICE_CACHE_READ_PER_MTOK = 0.30;   // $0.30 per million cache read tokens
const PRICE_CACHE_WRITE_5M_PER_MTOK = 3.75; // $3.75 per million cache write tokens
const PRICE_CACHE_WRITE_1H_PER_MTOK = 3.75; // $3.75 per million cache write tokens (1h tier)

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
  bgGreen: "\x1b[42m",
  bgRed:   "\x1b[41m",
};

function colorForSavings(ratio: number): string {
  if (ratio >= 0.60) return C.green;
  if (ratio >= 0.30) return C.yellow;
  return C.red;
}

// ── Data Types ───────────────────────────────────────────────────────────────
interface SessionRow {
  workspace_id: string;
  session_id: string;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  cache_read_tokens: number;
  effective_cost_units: number;
  pruned_blocks: number;
  turns_with_pruning: number;
  keepalive_pings: number;
  mutated_turns: number;
  fallback_turns: number;
  first_turn_ms: number;
  last_turn_ms: number;
}

interface TurnRow {
  turn_number: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  cache_read_tokens: number;
  effective_cost_units: number;
  pruned_blocks_count: number;
  request_mutated: number;
  created_at: number;
}

interface SessionReport {
  session_id: string;
  workspace_id: string;
  turns: number;
  duration_minutes: number;
  // Token totals
  total_input_tokens: number;
  total_cache_read_tokens: number;
  total_cache_write_5m_tokens: number;
  total_cache_write_1h_tokens: number;
  total_output_tokens: number;
  // Cost analysis
  baseline_tokens: number;
  effective_cost_units: number;
  cache_hit_ratio: number;
  savings_ratio: number;
  // Dollar estimates
  baseline_dollars: number;
  effective_dollars: number;
  savings_dollars: number;
  // Pipeline health
  mutated_turns: number;
  fallback_turns: number;
  turns_with_pruning: number;
  pruned_blocks: number;
  keepalive_pings: number;
  // Anomalies
  anomalies: string[];
  // Per-turn data (for timeline)
  turns_data: TurnRow[];
}

interface FullReport {
  generated_at: string;
  db_path: string;
  total_sessions: number;
  total_turns: number;
  aggregate_baseline_dollars: number;
  aggregate_effective_dollars: number;
  aggregate_savings_dollars: number;
  aggregate_savings_ratio: number;
  sessions: SessionReport[];
}

// ── Dollar calculations ──────────────────────────────────────────────────────
function baselineDollars(tokens: number): number {
  return (tokens / 1_000_000) * PRICE_INPUT_PER_MTOK;
}

function effectiveDollars(row: {
  input_tokens: number;
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  cache_read_tokens: number;
}): number {
  return (
    (row.input_tokens / 1_000_000) * PRICE_INPUT_PER_MTOK +
    (row.cache_creation_5m_tokens / 1_000_000) * PRICE_CACHE_WRITE_5M_PER_MTOK +
    (row.cache_creation_1h_tokens / 1_000_000) * PRICE_CACHE_WRITE_1H_PER_MTOK +
    (row.cache_read_tokens / 1_000_000) * PRICE_CACHE_READ_PER_MTOK
  );
}

// ── Anomaly detection ────────────────────────────────────────────────────────
function detectAnomalies(session: SessionRow, turns: TurnRow[]): string[] {
  const anomalies: string[] = [];

  // 1. Zero usage recording
  const zeroUsageTurns = turns.filter(t => t.input_tokens === 0 && t.cache_read_tokens === 0);
  if (zeroUsageTurns.length > 0) {
    anomalies.push(
      `${zeroUsageTurns.length}/${turns.length} turns have zero token usage — ` +
      `response parser may have failed to extract SSE usage data`
    );
  }

  // 2. All fallback (no mutations)
  if (session.mutated_turns === 0 && session.turns > 0) {
    anomalies.push(
      `No requests were mutated — CacheLane pipeline may not be intercepting traffic`
    );
  }

  // 3. High fallback ratio
  const fallbackRatio = session.turns > 0 ? session.fallback_turns / session.turns : 0;
  if (fallbackRatio > 0.1 && session.fallback_turns > 1) {
    anomalies.push(
      `${session.fallback_turns}/${session.turns} turns (${(fallbackRatio * 100).toFixed(0)}%) used fallback mode — pipeline errors may be occurring`
    );
  }

  // 4. Zero cache reads on a long session
  if (session.turns >= 5 && session.cache_read_tokens === 0 && session.mutated_turns > 0) {
    anomalies.push(
      `${session.turns} turns with zero cache reads despite mutations — Anthropic cache may not be hitting`
    );
  }

  // 5. Sudden savings drops (per-turn analysis)
  const turnsWithUsage = turns.filter(t => t.input_tokens + t.cache_read_tokens > 0);
  for (let i = 1; i < turnsWithUsage.length; i++) {
    const prev = turnsWithUsage[i - 1]!;
    const curr = turnsWithUsage[i]!;
    const prevTotal = prev.input_tokens + prev.cache_read_tokens;
    const currTotal = curr.input_tokens + curr.cache_read_tokens;
    const prevHitRate = prevTotal > 0 ? prev.cache_read_tokens / prevTotal : 0;
    const currHitRate = currTotal > 0 ? curr.cache_read_tokens / currTotal : 0;
    if (prevHitRate > 0.7 && currHitRate < 0.2 && currTotal > 1000) {
      anomalies.push(
        `Cache hit dropped from ${(prevHitRate * 100).toFixed(0)}% to ${(currHitRate * 100).toFixed(0)}% ` +
        `between turns ${prev.turn_number}→${curr.turn_number} — possible cache eviction or /compact`
      );
      break; // Only report the first big drop
    }
  }

  return anomalies;
}

// ── ASCII bar chart ──────────────────────────────────────────────────────────
function asciiBar(ratio: number, width: number = 30): string {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

// ── Formatting ───────────────────────────────────────────────────────────────
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function dollars(n: number): string {
  return `$${n.toFixed(2)}`;
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function pad(s: string | number, w: number, right = false): string {
  const str = String(s);
  return right ? str.padStart(w) : str.padEnd(w);
}

function truncateId(id: string, len: number = 12): string {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

// ── Main logic ───────────────────────────────────────────────────────────────
export function runLiveReport(options: {
  db?: string;
  session?: string;
  json?: boolean;
}): void {
  const env = process.env;
  const dbPath =
    options.db ??
    path.join(
      env.CACHELANE_HOME ?? path.join(homedir(), ".cachelane"),
      "cachelane.db",
    );

  let rawDb: Database.Database;
  try {
    rawDb = new Database(dbPath, { readonly: true });
  } catch (err) {
    console.error(`Error: Could not open database at ${dbPath}:`, err);
    console.error(`Run: cachelane install`);
    process.exit(1);
  }

  try {
    const sessionFilter = options.session ? `WHERE session_id = ?` : ``;
    const sessionParams = options.session ? [options.session] : [];

    const sessions = rawDb.prepare(`
      SELECT
        workspace_id,
        session_id,
        COUNT(*) AS turns,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cache_creation_5m_tokens), 0) AS cache_creation_5m_tokens,
        COALESCE(SUM(cache_creation_1h_tokens), 0) AS cache_creation_1h_tokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
        COALESCE(SUM(effective_cost_units), 0) AS effective_cost_units,
        COALESCE(SUM(pruned_blocks_count), 0) AS pruned_blocks,
        COALESCE(SUM(CASE WHEN pruned_blocks_count > 0 THEN 1 ELSE 0 END), 0) AS turns_with_pruning,
        COALESCE(SUM(keepalive_pings_since_last_turn), 0) AS keepalive_pings,
        COALESCE(SUM(CASE WHEN request_mutated = 1 THEN 1 ELSE 0 END), 0) AS mutated_turns,
        COALESCE(SUM(CASE WHEN request_mutated = 0 THEN 1 ELSE 0 END), 0) AS fallback_turns,
        MIN(created_at) AS first_turn_ms,
        MAX(created_at) AS last_turn_ms
      FROM turns
      ${sessionFilter}
      GROUP BY workspace_id, session_id
      ORDER BY last_turn_ms DESC
    `).all(...sessionParams) as SessionRow[];

    const sessionReports: SessionReport[] = [];

    for (const s of sessions) {
      const turns = rawDb.prepare(`
        SELECT turn_number, input_tokens, output_tokens,
               cache_creation_5m_tokens, cache_creation_1h_tokens,
               cache_read_tokens, effective_cost_units,
               pruned_blocks_count, request_mutated, created_at
        FROM turns
        WHERE workspace_id = ? AND session_id = ?
        ORDER BY turn_number ASC
      `).all(s.workspace_id, s.session_id) as TurnRow[];

      const baselineTokens = s.input_tokens + s.cache_creation_5m_tokens +
                              s.cache_creation_1h_tokens + s.cache_read_tokens;
      const cacheHitRatio = baselineTokens > 0 ? s.cache_read_tokens / baselineTokens : 0;
      const savingsRatio = baselineTokens > 0
        ? (baselineTokens - s.effective_cost_units) / baselineTokens
        : 0;

      const bDollars = baselineDollars(baselineTokens);
      const eDollars = effectiveDollars({
        input_tokens: s.input_tokens,
        cache_creation_5m_tokens: s.cache_creation_5m_tokens,
        cache_creation_1h_tokens: s.cache_creation_1h_tokens,
        cache_read_tokens: s.cache_read_tokens,
      });

      const durationMs = s.last_turn_ms - s.first_turn_ms;
      const durationMinutes = Math.max(1, Math.round(durationMs / 60000));

      sessionReports.push({
        session_id: s.session_id,
        workspace_id: s.workspace_id,
        turns: s.turns,
        duration_minutes: durationMinutes,
        total_input_tokens: s.input_tokens,
        total_cache_read_tokens: s.cache_read_tokens,
        total_cache_write_5m_tokens: s.cache_creation_5m_tokens,
        total_cache_write_1h_tokens: s.cache_creation_1h_tokens,
        total_output_tokens: s.output_tokens,
        baseline_tokens: baselineTokens,
        effective_cost_units: s.effective_cost_units,
        cache_hit_ratio: cacheHitRatio,
        savings_ratio: savingsRatio,
        baseline_dollars: bDollars,
        effective_dollars: eDollars,
        savings_dollars: bDollars - eDollars,
        mutated_turns: s.mutated_turns,
        fallback_turns: s.fallback_turns,
        turns_with_pruning: s.turns_with_pruning,
        pruned_blocks: s.pruned_blocks,
        keepalive_pings: s.keepalive_pings,
        anomalies: detectAnomalies(s, turns),
        turns_data: turns,
      });
    }

    const aggBaseline = sessionReports.reduce((a, s) => a + s.baseline_dollars, 0);
    const aggEffective = sessionReports.reduce((a, s) => a + s.effective_dollars, 0);
    const aggSavings = aggBaseline - aggEffective;
    const aggSavingsRatio = aggBaseline > 0 ? aggSavings / aggBaseline : 0;

    const report: FullReport = {
      generated_at: new Date().toISOString(),
      db_path: dbPath,
      total_sessions: sessionReports.length,
      total_turns: sessionReports.reduce((a, s) => a + s.turns, 0),
      aggregate_baseline_dollars: aggBaseline,
      aggregate_effective_dollars: aggEffective,
      aggregate_savings_dollars: aggSavings,
      aggregate_savings_ratio: aggSavingsRatio,
      sessions: sessionReports,
    };

    if (options.json) {
      const jsonReport = {
        ...report,
        sessions: report.sessions.map((s) => {
          const rest = { ...s };
          delete (rest as Partial<typeof s>).turns_data;
          return rest;
        }),
      };
      process.stdout.write(JSON.stringify(jsonReport, null, 2) + "\n");
    } else {
      process.stdout.write(renderReport(report));
    }
  } finally {
    rawDb.close();
  }
}

function renderReport(report: FullReport): string {
  const SEP = "═".repeat(80);
  const LINE = "─".repeat(80);
  const lines: string[] = [];

  lines.push("");
  lines.push(`${C.bold}${SEP}${C.reset}`);
  lines.push(`${C.bold}  CacheLane Session Report${C.reset}`);
  lines.push(`${C.dim}  Generated: ${report.generated_at}${C.reset}`);
  lines.push(`${C.dim}  Database:  ${report.db_path}${C.reset}`);
  lines.push(`${C.bold}${SEP}${C.reset}`);
  lines.push("");

  const aggColor = colorForSavings(report.aggregate_savings_ratio);
  lines.push(`${C.bold}  AGGREGATE SUMMARY${C.reset}`);
  lines.push(`  ${pad("Total sessions", 28)}: ${report.total_sessions}`);
  lines.push(`  ${pad("Total turns", 28)}: ${fmt(report.total_turns)}`);
  lines.push(`  ${pad("Total savings ratio", 28)}: ${aggColor}${pct(report.aggregate_savings_ratio)}${C.reset}`);
  lines.push(`  ${pad("Baseline cost (no caching)", 28)}: ${dollars(report.aggregate_baseline_dollars)}`);
  lines.push(`  ${pad("Effective cost (with cache)", 28)}: ${dollars(report.aggregate_effective_dollars)}`);
  lines.push(`  ${pad("Total saved", 28)}: ${C.bold}${aggColor}${dollars(report.aggregate_savings_dollars)}${C.reset}`);
  lines.push("");

  lines.push(`${C.bold}${LINE}${C.reset}`);
  lines.push(`${C.bold}  SESSION BREAKDOWN${C.reset}`);
  lines.push("");
  lines.push(
    `  ${pad("SESSION", 14)} ${pad("WS", 12)} ${pad("TURNS", 6, true)} ${pad("DURATION", 9, true)} ` +
    `${pad("HIT%", 6, true)} ${pad("SAVED%", 7, true)} ` +
    `${pad("BASELINE", 9, true)} ${pad("EFFECTIVE", 10, true)} ${pad("SAVED $", 8, true)}  ` +
    `CACHE HIT BAR`
  );
  lines.push(`  ${LINE.slice(0, 78)}`);

  for (const s of report.sessions) {
    const color = colorForSavings(s.savings_ratio);
    const bar = asciiBar(s.cache_hit_ratio, 15);
    const wsShort = s.workspace_id.replace(/^ws_/, "").slice(0, 10);

    lines.push(
      `  ${pad(truncateId(s.session_id), 14)} ` +
      `${pad(wsShort, 12)} ` +
      `${pad(s.turns, 6, true)} ` +
      `${pad(formatDuration(s.duration_minutes), 9, true)} ` +
      `${color}${pad(pct(s.cache_hit_ratio), 6, true)}${C.reset} ` +
      `${color}${pad(pct(s.savings_ratio), 7, true)}${C.reset} ` +
      `${pad(dollars(s.baseline_dollars), 9, true)} ` +
      `${pad(dollars(s.effective_dollars), 10, true)} ` +
      `${C.bold}${color}${pad(dollars(s.savings_dollars), 8, true)}${C.reset}  ` +
      `${color}${bar}${C.reset}`
    );
  }
  lines.push("");

  // Per-session detail (for a specific one, or top sessions)
  const detailSessions = report.sessions.filter(s => s.turns >= 5).slice(0, 3);

  for (const s of detailSessions) {
    lines.push(`${C.bold}${LINE}${C.reset}`);
    lines.push(`${C.bold}  SESSION: ${s.session_id}${C.reset}`);
    lines.push(`  ${C.dim}Workspace: ${s.workspace_id} | Duration: ${formatDuration(s.duration_minutes)} | Turns: ${s.turns}${C.reset}`);
    lines.push("");

    lines.push(`  ${C.bold}Token Breakdown:${C.reset}`);
    lines.push(`    Input tokens:         ${pad(fmt(s.total_input_tokens), 12, true)}`);
    lines.push(`    Cache read tokens:    ${pad(fmt(s.total_cache_read_tokens), 12, true)}  ${C.dim}(0.1x cost)${C.reset}`);
    lines.push(`    Cache write (5m):     ${pad(fmt(s.total_cache_write_5m_tokens), 12, true)}  ${C.dim}(1.25x cost)${C.reset}`);
    lines.push(`    Cache write (1h):     ${pad(fmt(s.total_cache_write_1h_tokens), 12, true)}  ${C.dim}(2.0x cost)${C.reset}`);
    lines.push(`    Output tokens:        ${pad(fmt(s.total_output_tokens), 12, true)}`);
    lines.push("");

    const color = colorForSavings(s.savings_ratio);
    lines.push(`  ${C.bold}Cost Analysis:${C.reset}`);
    lines.push(`    Baseline (no caching):  ${pad(dollars(s.baseline_dollars), 10, true)}`);
    lines.push(`    Effective (with cache): ${pad(dollars(s.effective_dollars), 10, true)}`);
    lines.push(`    ${C.bold}Saved:                  ${color}${pad(dollars(s.savings_dollars), 10, true)}${C.reset} ${color}(${pct(s.savings_ratio)})${C.reset}`);
    lines.push("");

    lines.push(`  ${C.bold}Pipeline Health:${C.reset}`);
    lines.push(`    Mutated turns:   ${s.mutated_turns}/${s.turns}  ${s.mutated_turns === s.turns ? `${C.green}✓ all turns processed${C.reset}` : `${C.yellow}⚠ ${s.fallback_turns} fallbacks${C.reset}`}`);
    lines.push(`    Pruned blocks:   ${s.pruned_blocks} across ${s.turns_with_pruning} turns`);
    lines.push(`    Keepalive pings: ${s.keepalive_pings}`);
    lines.push("");

    const recentTurns = s.turns_data.slice(-20);
    if (recentTurns.length > 0) {
      lines.push(`  ${C.bold}Per-Turn Timeline (last ${recentTurns.length} turns):${C.reset}`);
      lines.push(
        `    ${pad("TURN", 5)} ${pad("INPUT", 8, true)} ${pad("CACHE_RD", 9, true)} ` +
        `${pad("EFFECTIVE", 10, true)} ${pad("HIT%", 6, true)} ${pad("SAVED%", 7, true)} ` +
        `${pad("PRUNED", 7, true)}  TIMELINE`
      );
      lines.push(`    ${"─".repeat(72)}`);

      for (const t of recentTurns) {
        const total = t.input_tokens + t.cache_read_tokens;
        const hitRate = total > 0 ? t.cache_read_tokens / total : 0;
        const savedRate = total > 0 ? 1 - (t.effective_cost_units / total) : 0;
        const tColor = colorForSavings(savedRate);
        const bar = asciiBar(hitRate, 12);

        lines.push(
          `    ${pad(t.turn_number, 5, true)} ` +
          `${pad(fmt(t.input_tokens), 8, true)} ` +
          `${pad(fmt(t.cache_read_tokens), 9, true)} ` +
          `${pad(fmt(Math.round(t.effective_cost_units)), 10, true)} ` +
          `${tColor}${pad(pct(hitRate), 6, true)}${C.reset} ` +
          `${tColor}${pad(pct(savedRate), 7, true)}${C.reset} ` +
          `${pad(t.pruned_blocks_count, 7, true)}  ` +
          `${tColor}${bar}${C.reset}`
        );
      }
      lines.push("");
    }

    if (s.anomalies.length > 0) {
      lines.push(`  ${C.bold}${C.yellow}⚠ Anomalies:${C.reset}`);
      for (const a of s.anomalies) {
        lines.push(`    ${C.yellow}• ${a}${C.reset}`);
      }
      lines.push("");
    }
  }

  lines.push(`${C.bold}${SEP}${C.reset}`);
  const workingSessions = report.sessions.filter(s => s.savings_ratio > 0.3);
  const degradedSessions = report.sessions.filter(s => s.savings_ratio > 0 && s.savings_ratio <= 0.3);
  const brokenSessions = report.sessions.filter(s => s.savings_ratio <= 0 && s.turns > 0);

  if (workingSessions.length > 0) {
    const bestSession = workingSessions.reduce((a, b) => a.savings_ratio > b.savings_ratio ? a : b);
    lines.push(`  ${C.bold}${C.green}✓ VERDICT: CacheLane is working${C.reset}`);
    lines.push(`  ${C.green}  ${workingSessions.length} sessions with >30% savings${C.reset}`);
    lines.push(`  ${C.green}  Best session: ${pct(bestSession.savings_ratio)} savings over ${bestSession.turns} turns${C.reset}`);
    lines.push(`  ${C.green}  Total saved: ${dollars(report.aggregate_savings_dollars)}${C.reset}`);
  } else {
    lines.push(`  ${C.bold}${C.red}✗ VERDICT: CacheLane may not be working correctly${C.reset}`);
    lines.push(`  ${C.red}  No sessions with >30% savings found${C.reset}`);
  }

  if (degradedSessions.length > 0) {
    lines.push(`  ${C.yellow}  ${degradedSessions.length} session(s) with low savings (< 30%) — possibly short sessions${C.reset}`);
  }
  if (brokenSessions.length > 0) {
    lines.push(`  ${C.red}  ${brokenSessions.length} session(s) with 0% savings — investigate anomalies above${C.reset}`);
  }

  lines.push(`${C.bold}${SEP}${C.reset}`);
  lines.push("");

  return lines.join("\n");
}
