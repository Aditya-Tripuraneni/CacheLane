#!/usr/bin/env node
// Runs after `npm install cachelane`. Shows the welcome banner.
// Must work without the compiled dist/ (uses raw ANSI, no imports).

if (process.env["CI"] || process.env["CACHELANE_NO_BANNER"]) process.exit(0);
if (!process.stdout.isTTY) process.exit(0);

const C = {
  brown: "\x1b[38;5;130m",
  gold:  "\x1b[38;5;214m",
  green: "\x1b[32m",
  cyan:  "\x1b[36m",
  gray:  "\x1b[90m",
  bold:  "\x1b[1m",
  reset: "\x1b[0m",
};

let version = "1.0.0";
try {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  version = require("../package.json").version ?? version;
} catch { /* ignore */ }

const w = 54;
const pipe = C.brown + "│" + C.reset;

const row = (content) => {
  const stripped = content.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = " ".repeat(Math.max(0, w - stripped.length));
  return `${pipe} ${content}${pad}${pipe}`;
};

const blank = row(" ".repeat(w - 1));

const lines = [
  "",
  C.brown + "╭" + "─".repeat(w) + "╮" + C.reset,
  blank,
  row(`   ${C.bold}${C.brown}cachelane${C.reset}${" ".repeat(13)}${C.gold}v${version}${C.reset}`),
  row(`   ${C.reset}Cache-aware prompt orchestration`),
  row(`   ${C.reset}for Claude Code`),
  blank,
  row(`   ${C.gray}by Aditya Tripuraneni & Rajan Chavada${C.reset}`),
  blank,
  C.brown + "╰" + "─".repeat(w) + "╯" + C.reset,
  "",
  `  ${C.bold}GET STARTED${C.reset}`,
  "",
  `  ${C.cyan}cachelane install${C.reset}    ${C.gray}Register MCP server and hooks${C.reset}`,
  `  ${C.cyan}cachelane proxy${C.reset}      ${C.gray}Start the interception proxy${C.reset}`,
  `  ${C.cyan}cachelane help${C.reset}       ${C.gray}Full command reference${C.reset}`,
  "",
  `  ${C.green}https://cachelane.dev/lifecycle${C.reset}  ${C.gray}Interactive walkthrough${C.reset}`,
  "",
];

process.stdout.write(lines.join("\n") + "\n");
