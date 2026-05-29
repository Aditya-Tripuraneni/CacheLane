#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, "../dist/cli/index.js");

// Spawn the compiled CLI dashboard subcommand, passing along any arguments
const child = spawn(
  process.execPath,
  [cliPath, "benchmark", "dashboard", ...process.argv.slice(2)],
  { stdio: "inherit" }
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
