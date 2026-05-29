import { homedir } from "node:os";
import path from "node:path";

export function cachelaneHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CACHELANE_HOME ?? path.join(homedir(), ".cachelane");
}

export function claudeHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_HOME ?? path.join(homedir(), ".claude");
}

export function cachelaneConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(cachelaneHome(env), "config.json");
}

export function cachelaneDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(cachelaneHome(env), "cachelane.db");
}

export function claudeMcpPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CLAUDE_HOME) return path.join(env.CLAUDE_HOME, "mcp.json");
  return path.join(homedir(), ".claude.json");
}

export function claudeHookPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(claudeHome(env), "hooks", "cachelane.json");
}
