#!/usr/bin/env tsx
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(path.join(tmpdir(), "cachelane-doctor-ci-"));
const env = {
  ...process.env,
  CACHELANE_HOME: path.join(root, "cachelane"),
  CLAUDE_HOME: path.join(root, "claude"),
};

function runCli(args: string[]): string {
  const result = spawnSync(process.execPath, ["dist/cli/index.js", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `cachelane ${args.join(" ")} failed`);
  }

  return result.stdout;
}

try {
  runCli(["install"]);
  const report = JSON.parse(runCli(["doctor", "--json"])) as { ok: boolean };
  if (!report.ok) {
    throw new Error(`doctor --json returned ok=false: ${JSON.stringify(report, null, 2)}`);
  }
  console.log(JSON.stringify({ ok: true }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
