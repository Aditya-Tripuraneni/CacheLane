#!/usr/bin/env node

// packages/audit/src/cli.ts
import { readFileSync as readFileSync4 } from "fs";
import { homedir as homedir2 } from "os";
import { join as join3, resolve } from "path";

// packages/audit/src/guard.ts
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

// packages/audit/src/classify.ts
var REBUILD_MIN_WRITE = 2e4;
var HOUR = 36e5;
var FIVE_MIN = 3e5;
var written = (c) => c.write5m + c.write1h;
var contextOf = (c) => c.input + c.read + written(c);
function hitRatio(calls) {
  let read = 0;
  let all = 0;
  for (const c of calls) {
    read += c.read;
    all += contextOf(c);
  }
  return all === 0 ? 0 : read / all;
}
function classifyRebuilds(s, baseUrlSet2) {
  const out = [];
  const proxySuspect = baseUrlSet2 && hitRatio(s.calls) < 0.5;
  let ttl = FIVE_MIN;
  for (let i = 1; i < s.calls.length; i++) {
    const prev = s.calls[i - 1];
    const call = s.calls[i];
    if (written(prev) > 0) ttl = prev.write1h > 0 ? HOUR : FIVE_MIN;
    if (written(call) <= REBUILD_MIN_WRITE || call.read >= 0.5 * (prev.read + written(prev))) continue;
    const gapMs = call.ts - prev.ts;
    const cause = gapMs > ttl ? "idle_expired" : call.model !== prev.model ? "model_switch" : s.compactAt.some((t) => t > prev.ts && t <= call.ts) ? "compaction" : proxySuspect ? "proxy_stripped" : "prefix_changed";
    out.push({ call, prev, gapMs, cause });
  }
  return out;
}

// packages/audit/src/prices.ts
var PRICES = {
  "claude-fable-5-1": { input: 10, read: 0.25 },
  "claude-fable-5": { input: 10 },
  "claude-opus-5-5": { input: 4, read: 0.2 },
  "claude-opus-5": { input: 5 },
  "claude-opus-4-8": { input: 5 },
  "claude-opus-4-7": { input: 5 },
  "claude-opus-4-6": { input: 5 },
  "claude-sonnet-5-5": { input: 2, read: 0.2 },
  "claude-sonnet-5": { input: 2 },
  "claude-sonnet-4-6": { input: 3 },
  "claude-haiku-5-5": { input: 0.1 },
  "claude-haiku-4-5": { input: 1 }
};

// packages/audit/src/cost.ts
var WRITE_5M = 1.25;
var WRITE_1H = 2;
function priceFor(model) {
  const at = model.indexOf("claude-");
  const id = at >= 0 ? model.slice(at) : model;
  let best;
  for (const key of Object.keys(PRICES)) {
    if (id.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? PRICES[best] : void 0;
}
function readMultiplier(model) {
  const p = priceFor(model);
  return p?.read !== void 0 ? p.read / p.input : 0.1;
}
function units(c) {
  return c.input + c.read * readMultiplier(c.model) + writeUnits(c);
}
function writeUnits(c) {
  return c.write5m * WRITE_5M + c.write1h * WRITE_1H;
}
function toDollars(unitCount, model) {
  const p = priceFor(model);
  return p ? unitCount * p.input / 1e6 : void 0;
}

// packages/audit/src/guard.ts
var DEFAULT_THRESHOLD = 15e4;
var POST_COMPACT_TOKENS = 89e3;
var SUMMARY_OUTPUT_TOKENS = 2e4;
var OUTPUT_MULT = 5;
var HOUR2 = 36e5;
var FIVE_MIN2 = 3e5;
var WEEK = 7 * 24 * HOUR2;
var isRecord = (v) => typeof v === "object" && v !== null;
function loadState(path) {
  try {
    const s = JSON.parse(readFileSync(path, "utf8"));
    return {
      enabled: s.enabled !== false,
      threshold: typeof s.threshold === "number" ? s.threshold : DEFAULT_THRESHOLD,
      sessions: isRecord(s.sessions) ? s.sessions : {},
      warned: isRecord(s.warned) ? s.warned : {}
    };
  } catch {
    return { enabled: true, threshold: DEFAULT_THRESHOLD, sessions: {}, warned: {} };
  }
}
function saveState(path, s, now) {
  for (const [k, t] of Object.entries(s.sessions)) if (now - t > WEEK) delete s.sessions[k];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(s));
}
var asTtl = (v) => v === "1h" ? HOUR2 : v === "5m" ? FIVE_MIN2 : void 0;
function resolveTtlMs(env, settings, lastWrite) {
  if (env.FORCE_PROMPT_CACHING_5M === "1") return FIVE_MIN2;
  const fromEnv = asTtl(env.CLAUDE_CODE_PROMPT_CACHE_TTL);
  if (fromEnv) return fromEnv;
  for (const s of settings) {
    const t = asTtl(s?.promptCacheTtl);
    if (t) return t;
  }
  return lastWrite && lastWrite.write1h > 0 ? HOUR2 : FIVE_MIN2;
}
function guardDecision(i) {
  const { state, lastCall } = i;
  if (!state.enabled || !lastCall || i.lastResponseAt === void 0) return { action: "allow" };
  const idle = i.now - i.lastResponseAt;
  const context = contextOf(lastCall);
  if (idle <= i.ttlMs || context < state.threshold) return { action: "allow" };
  if (state.warned[i.sessionId] === i.lastResponseAt) return { action: "allow" };
  state.warned[i.sessionId] = i.lastResponseAt;
  return { action: "block", reason: blockReason(context, idle, i.ttlMs, lastCall.model) };
}
function blockReason(context, idleMs, ttlMs, model) {
  const mult = ttlMs >= HOUR2 ? WRITE_1H : WRITE_5M;
  const cont = context * mult;
  const compact = context + SUMMARY_OUTPUT_TOKENS * OUTPUT_MULT + POST_COMPACT_TOKENS * mult;
  const money = (u) => {
    const d = toDollars(u, model);
    return d === void 0 ? "" : ` (~$${d.toFixed(2)} at API price)`;
  };
  const k = (n) => `${Math.round(n / 1e3)}k`;
  const h = Math.floor(idleMs / HOUR2);
  const m = Math.round(idleMs % HOUR2 / 6e4);
  const compactLine = compact < cont ? `  /compact   ~${k(context)} read + summary + ~${k(POST_COMPACT_TOKENS)} rewrite = ~${k(compact)} units${money(compact)}, estimate` : `  /compact   costs more than continuing at this size (~${k(compact)} units), but makes later turns cheaper`;
  return [
    `cachelane: your prompt cache went cold ${h > 0 ? `${h}h ${m}m` : `${m}m`} ago (${ttlMs >= HOUR2 ? "1h" : "5m"} TTL). Context: ${k(context)} tokens.`,
    `  continue   rewrites ${k(context)} tokens at ${mult}x = ${k(cont)} units${money(cont)}`,
    compactLine,
    "  /clear     ~0 units, but drops the conversation",
    "Send your message again to continue; you are only warned once per break. Turn off with: cachelane-audit guard off"
  ].join("\n");
}

// packages/audit/src/hooks.ts
import { existsSync, readFileSync as readFileSync3 } from "fs";
import { homedir } from "os";
import { join } from "path";

// packages/audit/src/parse.ts
import { readFileSync as readFileSync2 } from "fs";
import { basename, dirname as dirname2 } from "path";
function parseSession(file, text = readFileSync2(file, "utf8")) {
  const main = /* @__PURE__ */ new Map();
  const side = /* @__PURE__ */ new Map();
  const compactAt = [];
  let sessionId = basename(file, ".jsonl");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.sessionId) sessionId = e.sessionId;
    const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (e.type === "system" && e.subtype === "compact_boundary" && !Number.isNaN(ts)) {
      compactAt.push(ts);
      continue;
    }
    const m = e.message;
    if (e.type !== "assistant" || !m?.usage || !m.id || m.model === "<synthetic>" || Number.isNaN(ts)) continue;
    const u = m.usage;
    const split = u.cache_creation;
    const call = {
      id: m.id,
      model: m.model ?? "unknown",
      ts,
      input: u.input_tokens ?? 0,
      read: u.cache_read_input_tokens ?? 0,
      // The 5m/1h split is nested; the flat total is a 5m fallback when it is absent.
      write5m: split ? split.ephemeral_5m_input_tokens ?? 0 : u.cache_creation_input_tokens ?? 0,
      write1h: split?.ephemeral_1h_input_tokens ?? 0
    };
    (e.isSidechain ? side : main).set(call.id, call);
  }
  const byTs = (a, b) => a.ts - b.ts;
  return {
    sessionId,
    project: basename(dirname2(file)),
    calls: [...main.values()].sort(byTs),
    sidechainCalls: [...side.values()].sort(byTs),
    compactAt: compactAt.sort((a, b) => a - b)
  };
}

// packages/audit/src/hooks.ts
function defaultDeps() {
  const home = homedir();
  return { statePath: join(home, ".cachelane", "guard.json"), now: Date.now(), env: process.env, home };
}
function readJson(path) {
  try {
    return JSON.parse(readFileSync3(path, "utf8"));
  } catch {
    return null;
  }
}
function promptHook(input, d) {
  try {
    if (!input.session_id || !input.transcript_path || !existsSync(input.transcript_path)) return "";
    const state = loadState(d.statePath);
    if (!state.enabled) return "";
    const session = parseSession(input.transcript_path);
    const lastCall = session.calls.at(-1);
    const lastWrite = [...session.calls].reverse().find((c) => written(c) > 0);
    const cwd = input.cwd ?? process.cwd();
    const settings = [
      readJson(join(cwd, ".claude", "settings.local.json")),
      readJson(join(cwd, ".claude", "settings.json")),
      readJson(join(d.home, ".claude", "settings.json"))
    ];
    const result = guardDecision({
      sessionId: input.session_id,
      now: d.now,
      lastResponseAt: state.sessions[input.session_id] ?? lastCall?.ts,
      lastCall,
      ttlMs: resolveTtlMs(d.env, settings, lastWrite),
      state
    });
    saveState(d.statePath, state, d.now);
    return result.action === "block" ? JSON.stringify({ decision: "block", reason: result.reason }) : "";
  } catch {
    return "";
  }
}
function stopHook(input, d) {
  try {
    if (!input.session_id) return;
    const state = loadState(d.statePath);
    state.sessions[input.session_id] = d.now;
    delete state.warned[input.session_id];
    saveState(d.statePath, state, d.now);
  } catch {
  }
}

// packages/audit/src/report.ts
import { createHash } from "crypto";
import { readdirSync, statSync } from "fs";
import { join as join2 } from "path";
var RECOMMEND = {
  idle_expired: "Turn on the cold-cache guard (cachelane plugin, or `cachelane-audit guard on`), or /clear before long breaks.",
  model_switch: "Stay on one model per session; each model has its own cache.",
  compaction: "Compaction rewrites the cache; compact before a break rather than after it.",
  proxy_stripped: "A proxy (ANTHROPIC_BASE_URL) may be stripping cache markers. Check it, or upgrade cachelane to 1.2.0 or later.",
  prefix_changed: "Avoid editing CLAUDE.md, MCP servers or settings mid-session; each edit rebuilds the cache."
};
function findTranscripts(projectsDir, sinceMs, project) {
  const out = [];
  let dirs;
  try {
    dirs = readdirSync(projectsDir);
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (project && !d.includes(project)) continue;
    let files;
    try {
      files = readdirSync(join2(projectsDir, d));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join2(projectsDir, d, f);
      try {
        if (statSync(p).mtimeMs >= sinceMs) out.push(p);
      } catch {
      }
    }
  }
  return out;
}
function buildReport(sessions, baseUrlSet2, hidePaths = false) {
  const name = (p) => hidePaths ? createHash("sha256").update(p).digest("hex").slice(0, 8) : p;
  const allCalls = sessions.flatMap((s) => [...s.calls, ...s.sidechainCalls]);
  let total = 0;
  let dollars = 0;
  let allPriced = true;
  for (const c of allCalls) {
    const u = units(c);
    total += u;
    const d = toDollars(u, c.model);
    if (d === void 0) allPriced = false;
    else dollars += d;
  }
  const causes = /* @__PURE__ */ new Map();
  const worst = [];
  let rebuildUnits = 0;
  let rebuildDollars = 0;
  for (const s of sessions) {
    for (const r of classifyRebuilds(s, baseUrlSet2)) {
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
        gapMin: Math.round(r.gapMs / 6e4),
        cause: r.cause
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
    recommendation: ranked[0] ? RECOMMEND[ranked[0].cause] : "No cache rebuilds found. Nothing to fix."
  };
}
var fmt = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n));
var usd = (n) => `$${n.toFixed(2)}`;
function renderText(r, days) {
  const share = r.units === 0 ? 0 : r.rebuildUnits / r.units;
  const priced = r.allPriced ? "" : ", priced models only";
  const lines = [
    `cachelane audit \xB7 last ${days} days \xB7 ${r.projects} projects \xB7 ${r.sessions} sessions \xB7 ${r.calls} API calls`,
    "",
    `Cache hit ratio          ${(r.hitRatio * 100).toFixed(1)}%`,
    `Input spend              ${fmt(r.units)} units (~${usd(r.dollars)} at API price${priced})`,
    `Spent on cache rebuilds  ${(share * 100).toFixed(0)}%, ${fmt(r.rebuildUnits)} units (~${usd(r.rebuildDollars)})`
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
    "Units are input tokens weighted by price: cache reads 0.1x or less, cache writes 1.25x (5m) or 2x (1h)."
  );
  return lines.join("\n");
}

// packages/audit/src/cli.ts
var HELP = `cachelane-audit: where your Claude Code input tokens went, and why the prompt cache rebuilt

Usage:
  cachelane-audit [--days N] [--project PATH] [--json] [--no-paths]
  cachelane-audit guard on|off|status|threshold <tokens>
  cachelane-audit hook prompt|stop        (used by the Claude Code plugin)`;
function flag(args2, name) {
  const i = args2.indexOf(name);
  return i >= 0 ? args2[i + 1] : void 0;
}
function baseUrlSet(home) {
  if (process.env.ANTHROPIC_BASE_URL) return true;
  try {
    const s = JSON.parse(readFileSync4(join3(home, ".claude", "settings.json"), "utf8"));
    return Boolean(s.env?.ANTHROPIC_BASE_URL);
  } catch {
    return false;
  }
}
function audit(args2) {
  const home = homedir2();
  const days = Number(flag(args2, "--days") ?? 30);
  const project = flag(args2, "--project");
  const root = join3(process.env.CLAUDE_CONFIG_DIR ?? join3(home, ".claude"), "projects");
  const files = findTranscripts(root, Date.now() - days * 864e5, project && resolve(project).replace(/[^A-Za-z0-9]/g, "-"));
  const report = buildReport(files.map((f) => parseSession(f)), baseUrlSet(home), args2.includes("--no-paths"));
  console.log(args2.includes("--json") ? JSON.stringify(report, null, 2) : renderText(report, days));
}
function guard(args2) {
  const d = defaultDeps();
  const state = loadState(d.statePath);
  const [sub, value] = args2;
  if (sub === "on" || sub === "off") state.enabled = sub === "on";
  else if (sub === "threshold" && Number(value) > 0) state.threshold = Number(value);
  else if (sub !== "status") {
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  saveState(d.statePath, state, d.now);
  console.log(`guard ${state.enabled ? "on" : "off"} \xB7 threshold ${state.threshold} tokens \xB7 state ${d.statePath}`);
}
async function hook(kind) {
  setTimeout(() => process.exit(0), 5e3).unref();
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  if (kind === "prompt") {
    const out = promptHook(input, defaultDeps());
    if (out) process.stdout.write(out);
  } else if (kind === "stop") {
    stopHook(input, defaultDeps());
  }
}
var args = process.argv.slice(2);
if (args[0] === "guard") guard(args.slice(1));
else if (args[0] === "hook") await hook(args[1]);
else if (args[0] === "--help" || args[0] === "-h") console.log(HELP);
else audit(args[0] === "audit" ? args.slice(1) : args);
