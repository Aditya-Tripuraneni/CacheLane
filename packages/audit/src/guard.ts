import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { contextOf } from "./classify.js";
import { toDollars, WRITE_1H, WRITE_5M } from "./cost.js";
import type { ApiCall } from "./types.js";

export const DEFAULT_THRESHOLD = 150_000;
// Median context right after /compact, from 12 real compactions (62k to 97k, any pre-size).
const POST_COMPACT_TOKENS = 89_000;
// ponytail: summary size is not in transcripts, so 20k is an estimate; output costs 5x input.
const SUMMARY_OUTPUT_TOKENS = 20_000;
const OUTPUT_MULT = 5;
const HOUR = 3_600_000;
const FIVE_MIN = 300_000;
const WEEK = 7 * 24 * HOUR;

export interface GuardState {
  enabled: boolean;
  threshold: number;
  sessions: Record<string, number>;
  /** session id -> lastResponseAt of the idle period already warned about */
  warned: Record<string, number>;
}

export interface GuardInput {
  sessionId: string;
  now: number;
  lastResponseAt?: number;
  lastCall?: ApiCall;
  ttlMs: number;
  state: GuardState;
}

export type GuardResult = { action: "allow" } | { action: "block"; reason: string };

const isRecord = (v: unknown): v is Record<string, number> => typeof v === "object" && v !== null;

export function loadState(path: string): GuardState {
  try {
    const s = JSON.parse(readFileSync(path, "utf8")) as Partial<GuardState>;
    return {
      enabled: s.enabled !== false,
      threshold: typeof s.threshold === "number" ? s.threshold : DEFAULT_THRESHOLD,
      sessions: isRecord(s.sessions) ? s.sessions : {},
      warned: isRecord(s.warned) ? s.warned : {},
    };
  } catch {
    return { enabled: true, threshold: DEFAULT_THRESHOLD, sessions: {}, warned: {} };
  }
}

export function saveState(path: string, s: GuardState, now: number): void {
  // warned is not aged out: its values are old response times by design. stopHook clears it.
  for (const [k, t] of Object.entries(s.sessions)) if (now - t > WEEK) delete s.sessions[k];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(s));
}

const asTtl = (v: unknown) => (v === "1h" ? HOUR : v === "5m" ? FIVE_MIN : undefined);

/** Claude Code's main-conversation TTL precedence, falling back to the tier of the last cache write. */
export function resolveTtlMs(env: Record<string, string | undefined>, settings: unknown[], lastWrite?: ApiCall): number {
  if (env.FORCE_PROMPT_CACHING_5M === "1") return FIVE_MIN;
  const fromEnv = asTtl(env.CLAUDE_CODE_PROMPT_CACHE_TTL);
  if (fromEnv) return fromEnv;
  for (const s of settings) {
    const t = asTtl((s as { promptCacheTtl?: unknown } | null)?.promptCacheTtl);
    if (t) return t;
  }
  return lastWrite && lastWrite.write1h > 0 ? HOUR : FIVE_MIN;
}

export function guardDecision(i: GuardInput): GuardResult {
  const { state, lastCall } = i;
  if (!state.enabled || !lastCall || i.lastResponseAt === undefined) return { action: "allow" };
  const idle = i.now - i.lastResponseAt;
  const context = contextOf(lastCall);
  if (idle <= i.ttlMs || context < state.threshold) return { action: "allow" };

  // One warning per idle period: once warned, the next prompt goes through. A new
  // response moves lastResponseAt, which starts a new period.
  if (state.warned[i.sessionId] === i.lastResponseAt) return { action: "allow" };
  state.warned[i.sessionId] = i.lastResponseAt;
  return { action: "block", reason: blockReason(context, idle, i.ttlMs, lastCall.model) };
}

function blockReason(context: number, idleMs: number, ttlMs: number, model: string): string {
  const mult = ttlMs >= HOUR ? WRITE_1H : WRITE_5M;
  const cont = context * mult;
  // After a break the compaction call reads the full context uncached, writes a summary as
  // output, and the next turn re-caches the smaller post-compact context.
  const compact = context + SUMMARY_OUTPUT_TOKENS * OUTPUT_MULT + POST_COMPACT_TOKENS * mult;
  const money = (u: number) => {
    const d = toDollars(u, model);
    return d === undefined ? "" : ` (~$${d.toFixed(2)} at API price)`;
  };
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  const h = Math.floor(idleMs / HOUR);
  const m = Math.round((idleMs % HOUR) / 60_000);
  const compactLine =
    compact < cont
      ? `  /compact   ~${k(context)} read + summary + ~${k(POST_COMPACT_TOKENS)} rewrite = ~${k(compact)} units${money(compact)}, estimate`
      : `  /compact   costs more than continuing at this size (~${k(compact)} units), but makes later turns cheaper`;
  return [
    `cachelane: your prompt cache went cold ${h > 0 ? `${h}h ${m}m` : `${m}m`} ago (${ttlMs >= HOUR ? "1h" : "5m"} TTL). Context: ${k(context)} tokens.`,
    `  continue   rewrites ${k(context)} tokens at ${mult}x = ${k(cont)} units${money(cont)}`,
    compactLine,
    "  /clear     ~0 units, but drops the conversation",
    "Send your message again to continue; you are only warned once per break. Turn off with: cachelane-audit guard off",
  ].join("\n");
}
