import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifyRebuilds, hitRatio, written } from "./classify.js";
import { toDollars, units, writeUnits } from "./cost.js";
import type { Cause, Session } from "./types.js";

export interface CauseRow { cause: Cause; count: number; units: number; dollars: number }
export interface WorstRow { project: string; sessionId: string; tokens: number; gapMin: number; cause: Cause }
export interface AuditReport {
  sessions: number;
  projects: number;
  calls: number;
  hitRatio: number;
  units: number;
  rebuildUnits: number;
  dollars: number;
  rebuildDollars: number;
  allPriced: boolean;
  causes: CauseRow[];
  worst: WorstRow[];
  recommendation: string;
}

const RECOMMEND: Record<Cause, string> = {
  idle_expired: "Turn on the cold-cache guard (cachelane plugin, or `cachelane-audit guard on`), or /clear before long breaks.",
  model_switch: "Stay on one model per session; each model has its own cache.",
  compaction: "Compaction rewrites the cache; compact before a break rather than after it.",
  proxy_stripped: "A proxy (ANTHROPIC_BASE_URL) may be stripping cache markers. Check it, or upgrade cachelane to 1.2.0 or later.",
  prefix_changed: "Avoid editing CLAUDE.md, MCP servers or settings mid-session; each edit rebuilds the cache.",
};

export function findTranscripts(projectsDir: string, sinceMs: number, project?: string): string[] {
  const out: string[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(projectsDir);
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (project && !d.includes(project)) continue;
    let files: string[];
    try {
      files = readdirSync(join(projectsDir, d));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(projectsDir, d, f);
      try {
        if (statSync(p).mtimeMs >= sinceMs) out.push(p);
      } catch {
        // file vanished between readdir and stat
      }
    }
  }
  return out;
}

export function buildReport(sessions: Session[], baseUrlSet: boolean, hidePaths = false): AuditReport {
  const name = (p: string) => (hidePaths ? createHash("sha256").update(p).digest("hex").slice(0, 8) : p);
  const allCalls = sessions.flatMap((s) => [...s.calls, ...s.sidechainCalls]);
  let total = 0;
  let dollars = 0;
  let allPriced = true;
  for (const c of allCalls) {
    const u = units(c);
    total += u;
    const d = toDollars(u, c.model);
    if (d === undefined) allPriced = false;
    else dollars += d;
  }

  const causes = new Map<Cause, CauseRow>();
  const worst: WorstRow[] = [];
  let rebuildUnits = 0;
  let rebuildDollars = 0;
  for (const s of sessions) {
    for (const r of classifyRebuilds(s, baseUrlSet)) {
      const u = writeUnits(r.call);
      const d = toDollars(u, r.call.model) ?? 0;
      rebuildUnits += u;
      rebuildDollars += d;
      const row = causes.get(r.cause) ?? { cause: r.cause, count: 0, units: 0, dollars: 0 };
      row.count++;
      row.units += u;
      row.dollars += d;
      causes.set(r.cause, row);
      worst.push({
        project: name(s.project),
        sessionId: s.sessionId.slice(0, 8),
        tokens: written(r.call),
        gapMin: Math.round(r.gapMs / 60_000),
        cause: r.cause,
      });
    }
  }

  const ranked = [...causes.values()].sort((a, b) => b.units - a.units);
  return {
    sessions: sessions.length,
    projects: new Set(sessions.map((s) => s.project)).size,
    calls: allCalls.length,
    hitRatio: hitRatio(allCalls),
    units: total,
    rebuildUnits,
    dollars,
    rebuildDollars,
    allPriced,
    causes: ranked,
    worst: worst.sort((a, b) => b.tokens - a.tokens).slice(0, 3),
    recommendation: ranked[0] ? RECOMMEND[ranked[0].cause] : "No cache rebuilds found. Nothing to fix.",
  };
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const usd = (n: number) => `$${n.toFixed(2)}`;

export function renderText(r: AuditReport, days: number): string {
  const share = r.units === 0 ? 0 : r.rebuildUnits / r.units;
  const priced = r.allPriced ? "" : ", priced models only";
  const lines = [
    `cachelane audit · last ${days} days · ${r.projects} projects · ${r.sessions} sessions · ${r.calls} API calls`,
    "",
    `Cache hit ratio          ${(r.hitRatio * 100).toFixed(1)}%`,
    `Input spend              ${fmt(r.units)} units (~${usd(r.dollars)} at API price${priced})`,
    `Spent on cache rebuilds  ${(share * 100).toFixed(0)}%, ${fmt(r.rebuildUnits)} units (~${usd(r.rebuildDollars)})`,
  ];
  if (r.causes.length > 0) {
    lines.push("", "Rebuild causes, by cost");
    for (const c of r.causes) {
      lines.push(`  ${c.cause.padEnd(16)} ${String(c.count).padStart(4)}x  ${fmt(c.units).padStart(7)} units  ~${usd(c.dollars)}`);
    }
    lines.push("", "Largest rebuilds");
    for (const w of r.worst) {
      lines.push(`  ${w.project}  ${w.sessionId}  ${fmt(w.tokens)} tokens after ${w.gapMin} min idle  (${w.cause})`);
    }
  }
  lines.push(
    "",
    `Next step: ${r.recommendation}`,
    "",
    "Units are input tokens weighted by price: cache reads 0.1x or less, cache writes 1.25x (5m) or 2x (1h).",
  );
  return lines.join("\n");
}
