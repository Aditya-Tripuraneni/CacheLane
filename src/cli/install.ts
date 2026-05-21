import fs from "node:fs";
import path from "node:path";
import {
  cachelaneConfigPath,
  cachelaneDbPath,
  cachelaneHome,
  claudeHookPath,
  claudeMcpPath,
} from "./paths.js";
import { loadConfig } from "../config/index.js";

type JsonObject = Record<string, unknown>;

export interface InstallResult {
  mcp_path: string;
  hook_path: string;
  changed: boolean;
}

export interface UninstallResult {
  mcp_path: string;
  hook_path: string;
  purge: boolean;
  changed: boolean;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(filePath: string): JsonObject {
  if (!fs.existsSync(filePath)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  } catch (err) {
    throw new Error(
      `Invalid JSON at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return isObject(parsed) ? parsed : {};
}

function writeJsonObject(filePath: string, value: JsonObject): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

export function installCachelane(env: NodeJS.ProcessEnv = process.env): InstallResult {
  const configPath = cachelaneConfigPath(env);
  loadConfig(configPath);

  const mcpPath = claudeMcpPath(env);
  const hookPath = claudeHookPath(env);
  const mcpConfig = readJsonObject(mcpPath);
  const servers = isObject(mcpConfig.mcpServers)
    ? mcpConfig.mcpServers
    : {};
  const nextServer = {
    command: "cachelane",
    args: ["mcp"],
    env: {
      CACHELANE_HOME: cachelaneHome(env),
    },
  };
  const beforeMcp = stable(mcpConfig);
  servers.cachelane = nextServer;
  mcpConfig.mcpServers = servers;
  const afterMcp = stable(mcpConfig);
  if (beforeMcp !== afterMcp) {
    writeJsonObject(mcpPath, mcpConfig);
  }

  const hookConfig = {
    name: "cachelane",
    hooks: {
      PreRequest: [{ command: "cachelane hook pre-request" }],
      PostResponse: [{ command: "cachelane hook post-response" }],
    },
  };
  const beforeHook = fs.existsSync(hookPath)
    ? fs.readFileSync(hookPath, "utf-8")
    : "";
  const afterHook = `${JSON.stringify(hookConfig, null, 2)}\n`;
  if (beforeHook !== afterHook) {
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, afterHook);
  }

  return {
    mcp_path: mcpPath,
    hook_path: hookPath,
    changed: beforeMcp !== afterMcp || beforeHook !== afterHook,
  };
}

export function uninstallCachelane(
  env: NodeJS.ProcessEnv = process.env,
  purge = false,
): UninstallResult {
  const mcpPath = claudeMcpPath(env);
  const hookPath = claudeHookPath(env);
  let changed = false;

  if (fs.existsSync(mcpPath)) {
    const mcpConfig = readJsonObject(mcpPath);
    if (isObject(mcpConfig.mcpServers) && "cachelane" in mcpConfig.mcpServers) {
      delete mcpConfig.mcpServers.cachelane;
      writeJsonObject(mcpPath, mcpConfig);
      changed = true;
    }
  }

  if (fs.existsSync(hookPath)) {
    fs.rmSync(hookPath, { force: true });
    changed = true;
  }

  if (purge) {
    const home = cachelaneHome(env);
    if (fs.existsSync(home)) {
      fs.rmSync(home, { recursive: true, force: true });
      changed = true;
    }
  }

  return {
    mcp_path: mcpPath,
    hook_path: hookPath,
    purge,
    changed,
  };
}

export function installSurfaceStatus(env: NodeJS.ProcessEnv = process.env): {
  mcp_registered: boolean;
  hook_registered: boolean;
  config_path: string;
  db_path: string;
} {
  const mcpConfig = readJsonObject(claudeMcpPath(env));
  return {
    mcp_registered:
      isObject(mcpConfig.mcpServers) && isObject(mcpConfig.mcpServers.cachelane),
    hook_registered: fs.existsSync(claudeHookPath(env)),
    config_path: cachelaneConfigPath(env),
    db_path: cachelaneDbPath(env),
  };
}
