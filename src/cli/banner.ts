import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

function pkgVersion(): string {
  try {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../");
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf-8")) as { version?: string };
    return pkg.version ?? "1.0.0";
  } catch {
    return "1.0.0";
  }
}

const USE_COLOR = process.stdout.isTTY && process.env["NO_COLOR"] == null;

const C = USE_COLOR
  ? {
      brown: "\x1b[38;5;130m",
      gold: "\x1b[38;5;214m",
      cyan: "\x1b[36m",
      green: "\x1b[32m",
      gray: "\x1b[90m",
      white: "\x1b[37m",
      bold: "\x1b[1m",
      dim: "\x1b[2m",
      reset: "\x1b[0m",
    }
  : {
      brown: "", gold: "", cyan: "", green: "", gray: "",
      white: "", bold: "", dim: "", reset: "",
    };

function padRight(s: string, len: number): string {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  return s + " ".repeat(Math.max(0, len - stripped.length));
}

// Each row is CACHELANE rendered in figlet "block" style — 8 chars per letter, 9 chars for N.
// Letters: C A C H E L A N E
const LOGO = [
  " ██████╗  █████╗  ██████╗██╗  ██╗███████╗██╗      █████╗ ███╗  ██╗███████╗",
  "██╔════╝ ██╔══██╗██╔════╝██║  ██║██╔════╝██║     ██╔══██╗████╗ ██║██╔════╝",
  "██║      ███████║██║     ███████║█████╗  ██║     ███████║██╔██╗██║█████╗  ",
  "██║      ██╔══██║██║     ██╔══██║██╔══╝  ██║     ██╔══██║██║╚████║██╔══╝  ",
  "╚██████╗ ██║  ██║╚██████╗██║  ██║███████╗███████╗██║  ██║██║ ╚███║███████╗",
  " ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚══╝╚══════╝",
];

const MUG = [
  "    (  )   (   )  )  ",
  "     ) (   )  (  (   ",
  "     ( )  (    ) )   ",
  "     _____________   ",
  "    <_____________> ___",
  "    |             |/ _ \\",
  "    |               | | |",
  "    |               |_| |",
  " ___|             |\\___/ ",
  "/    \\___________/    \\ ",
  "\\_____________________/ ",
];

// Logo starts at mug line 2; version line sits at mug line 9.
const LOGO_START = 2;
const VERSION_LINE = 9;
const MUG_PAD = 30;

function banner(version: string): string {
  const versionText =
    `${C.gray}v${version}${C.reset}  ${C.dim}·${C.reset}  ` +
    `${C.white}Cache-aware prompt orchestration for Claude Code${C.reset}`;

  const lines: string[] = [""];
  for (let i = 0; i < MUG.length; i++) {
    const logoIdx = i - LOGO_START;
    const hasLogo = logoIdx >= 0 && logoIdx < LOGO.length;

    if (hasLogo) {
      lines.push(
        C.brown + (MUG[i] ?? "").padEnd(MUG_PAD) + C.reset +
        C.gold + (LOGO[logoIdx] ?? "") + C.reset,
      );
    } else if (i === VERSION_LINE) {
      lines.push(C.brown + (MUG[i] ?? "").padEnd(MUG_PAD) + C.reset + versionText);
    } else {
      lines.push(C.brown + (MUG[i] ?? "") + C.reset);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function helpText(version: string): string {
  const lines: string[] = [];
  lines.push(banner(version));

  lines.push(`${C.bold}QUICK START${C.reset}`);
  lines.push("");
  lines.push(`  ${C.cyan}cachelane install${C.reset}           ${C.gray}Register MCP server and hooks with Claude Code${C.reset}`);
  lines.push(`  ${C.cyan}cachelane proxy${C.reset}             ${C.gray}Start the HTTP interception proxy (port 7332)${C.reset}`);
  lines.push(`  ${C.cyan}cachelane stats${C.reset}             ${C.gray}View cache hit rate and savings for this session${C.reset}`);
  lines.push("");

  lines.push(`${C.bold}COMMANDS${C.reset}`);
  lines.push("");

  const cmds: [string, string][] = [
    ["install", "Register MCP server and hooks"],
    ["uninstall", "Remove MCP server and hooks"],
    ["proxy", "Start HTTP proxy interceptor"],
    ["mcp", "Start MCP server over stdio"],
    ["stats", "Cache and pruning statistics"],
    ["explain", "Explain a specific turn"],
    ["sessions", "List all recorded sessions"],
    ["prune", "Set K-pruner threshold (aggressive/conservative/default)"],
    ["keepalive", "Configure prompt cache keepalive policy"],
    ["pin", "Pin a file glob to the STABLE region"],
    ["exclude", "Exclude a file glob from classification"],
    ["enable / disable", "Toggle K-pruning"],
    ["enable-compression / disable-compression", "Toggle tool-output compression"],
    ["compression-mode", "Set compression mode"],
    ["compression-compressor", "Toggle JSON or log compression"],
    ["compression-retention", "Toggle retrievable original retention"],
    ["exclude-compression", "Exclude tool outputs from compression"],
    ["doctor", "Check installation health"],
    ["config", "Print active configuration"],
    ["benchmark", "Benchmark and live reporting tools"],
  ];

  for (const [cmd, desc] of cmds) {
    const cmdPadded = padRight(`  ${C.cyan}cachelane ${cmd}${C.reset}`, 42);
    lines.push(`${cmdPadded}${C.gray}${desc}${C.reset}`);
  }

  lines.push("");
  lines.push(`${C.bold}DOCS${C.reset}`);
  lines.push("");
  lines.push(`  ${C.gray}Architecture and K-pruning lifecycle walkthrough:${C.reset}`);
  lines.push(`  ${C.green}https://cache-lane.vercel.app/${C.reset}`);
  lines.push("");

  return lines.join("\n");
}

export function printBanner(): void {
  process.stdout.write(banner(pkgVersion()) + "\n");
}

export function printHelp(): void {
  process.stdout.write(helpText(pkgVersion()) + "\n");
}

export function getBannerText(): string {
  return banner(pkgVersion());
}
