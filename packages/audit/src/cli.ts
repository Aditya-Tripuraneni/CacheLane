import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadState, saveState } from "./guard.js";
import { defaultDeps, promptHook, stopHook } from "./hooks.js";
import { parseSession } from "./parse.js";
import { buildReport, findTranscripts, renderText } from "./report.js";

const HELP = `cachelane-audit: where your Claude Code input tokens went, and why the prompt cache rebuilt

Usage:
  cachelane-audit [--days N] [--project PATH] [--json] [--no-paths]
  cachelane-audit guard on|off|status|threshold <tokens>
  cachelane-audit hook prompt|stop        (used by the Claude Code plugin)`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function baseUrlSet(home: string): boolean {
  if (process.env.ANTHROPIC_BASE_URL) return true;
  try {
    const s = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")) as { env?: Record<string, string> };
    return Boolean(s.env?.ANTHROPIC_BASE_URL);
  } catch {
    return false;
  }
}

function audit(args: string[]): void {
  const home = homedir();
  const days = Number(flag(args, "--days") ?? 30);
  const project = flag(args, "--project");
  const root = join(process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "projects");
  // Claude Code names project dirs after the path with non-alphanumerics replaced by "-".
  const files = findTranscripts(root, Date.now() - days * 86_400_000, project && resolve(project).replace(/[^A-Za-z0-9]/g, "-"));
  const report = buildReport(files.map((f) => parseSession(f)), baseUrlSet(home), args.includes("--no-paths"));
  console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : renderText(report, days));
}

function guard(args: string[]): void {
  const d = defaultDeps();
  const state = loadState(d.statePath);
  const [sub, value] = args;
  if (sub === "on" || sub === "off") state.enabled = sub === "on";
  else if (sub === "threshold" && Number(value) > 0) state.threshold = Number(value);
  else if (sub !== "status") {
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  saveState(d.statePath, state, d.now);
  console.log(`guard ${state.enabled ? "on" : "off"} · threshold ${state.threshold} tokens · state ${d.statePath}`);
}

async function hook(kind: string | undefined): Promise<void> {
  // Fail open: anything slower than 5 s exits with no output, which allows the prompt.
  setTimeout(() => process.exit(0), 5_000).unref();
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input: Record<string, string> = {};
  try {
    input = JSON.parse(raw) as Record<string, string>;
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

const args = process.argv.slice(2);
if (args[0] === "guard") guard(args.slice(1));
else if (args[0] === "hook") await hook(args[1]);
else if (args[0] === "--help" || args[0] === "-h") console.log(HELP);
else audit(args[0] === "audit" ? args.slice(1) : args);
