import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseSession } from "./parse.js";
import { buildReport, findTranscripts, renderText } from "./report.js";

const HELP = `cachelane-audit: where your Claude Code input tokens went, and why the prompt cache rebuilt

Usage:
  cachelane-audit [--days N] [--project PATH] [--json] [--no-paths]`;

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

const args = process.argv.slice(2);
if (args[0] === "--help" || args[0] === "-h") console.log(HELP);
else audit(args[0] === "audit" ? args.slice(1) : args);
