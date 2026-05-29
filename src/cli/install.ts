import fs from "node:fs";
import path from "node:path";

import {
  cachelaneConfigPath,
  cachelaneDbPath,
  cachelaneHome,
  claudeHome,
  claudeHookPath,
  claudeMcpPath,
} from "./paths.js";
import { loadConfig } from "../config/index.js";
import type { CachelaneConfig } from "../types/index.js";

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

// Guard against a malformed `env` field in settings.json. Throws if `env`
// exists but is not a plain object; returns silently otherwise. Both
// validateInstall and mergeBaseUrlIntoSettings call this so neither silently
// clobbers a malformed user config.
function assertEnvIsObjectOrAbsent(settings: JsonObject, settingsPath: string): void {
  if (!("env" in settings) || settings.env === undefined) return;
  if (isObject(settings.env)) return;
  const actualType = Array.isArray(settings.env) ? "array" : typeof settings.env;
  throw new Error(
    `Cannot install: ${settingsPath} has an "env" key that is not an object (got ${actualType}). ` +
      `Fix or remove the malformed "env" field before installing.`,
  );
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

function claudeSettingsPath(env: NodeJS.ProcessEnv): string {
  return path.join(claudeHome(env), "settings.json");
}

function baseUrlFor(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function isLocalProxyUrl(value: string, port: number): boolean {
  try {
    const url = new URL(value);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      Number(url.port || (url.protocol === "https:" ? 443 : 80)) === port
    );
  } catch {
    return false;
  }
}

function upstreamFromBaseUrl(value: unknown, port: number): Partial<CachelaneConfig["proxy"]> | null {
  if (typeof value !== "string") return null;
  if (isLocalProxyUrl(value, port)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return {
      upstream_host: url.hostname,
      upstream_port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      upstream_ssl: url.protocol === "https:",
      upstream_path_prefix: url.pathname && url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "",
    };
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function validateInstall(settingsPath: string, intendedPort: number): void {
  // We still parse to ensure it's valid JSON and structurally sound.
  const settings = readJsonObject(settingsPath);
  assertEnvIsObjectOrAbsent(settings, settingsPath);
  
  // Allow overriding ANTHROPIC_BASE_URL for custom upstreams (e.g. GLM).
  // We will preserve the path during merge instead of throwing here.
}

// Idempotent merge — returns true iff the file was modified.
export function mergeBaseUrlIntoSettings(settingsPath: string, port: number): boolean {
  const settings = readJsonObject(settingsPath);
  assertEnvIsObjectOrAbsent(settings, settingsPath);
  const env: JsonObject = isObject(settings.env) ? { ...(settings.env as JsonObject) } : {};
  const intended = baseUrlFor(port);

  if (env.ANTHROPIC_BASE_URL === intended) return false;
  env.ANTHROPIC_BASE_URL = intended;
  settings.env = env;
  writeJsonObject(settingsPath, settings);
  return true;
}

function mergeUpstreamFromSettingsIntoConfig(
  settingsPath: string,
  configPath: string,
  config: CachelaneConfig,
): boolean {
  const settings = readJsonObject(settingsPath);
  assertEnvIsObjectOrAbsent(settings, settingsPath);
  const env = isObject(settings.env) ? settings.env : {};
  const upstream = upstreamFromBaseUrl(env.ANTHROPIC_BASE_URL, config.proxy.port);
  if (upstream === null) return false;

  const rawConfig = readJsonObject(configPath);
  const nextConfig: JsonObject = { ...rawConfig };
  const existingProxy = isObject(nextConfig.proxy) ? nextConfig.proxy : {};
  const nextProxy: JsonObject = { ...config.proxy, ...existingProxy, ...upstream };
  nextConfig.proxy = nextProxy;

  if (stable(rawConfig) === stable(nextConfig)) return false;
  writeJsonObject(configPath, nextConfig);
  return true;
}

// Removes our ANTHROPIC_BASE_URL entry; deletes the env block if it becomes
// empty. Returns true iff the file was modified.
export function removeBaseUrlFromSettings(settingsPath: string): boolean {
  if (!fs.existsSync(settingsPath)) return false;
  const settings = readJsonObject(settingsPath);
  if (!isObject(settings.env)) return false;
  const env: JsonObject = { ...(settings.env as JsonObject) };
  if (!("ANTHROPIC_BASE_URL" in env)) return false;
  delete env.ANTHROPIC_BASE_URL;
  if (Object.keys(env).length === 0) {
    delete settings.env;
  } else {
    settings.env = env;
  }
  writeJsonObject(settingsPath, settings);
  return true;
}

// Merge CacheLane hooks into ~/.claude/settings.json.
// Claude Code reads hooks from settings.json, not from ~/.claude/hooks/*.json.
function mergeHooksIntoSettings(
  settingsPath: string,
  hookCmd: (name: string) => string,
): boolean {
  const settings = readJsonObject(settingsPath);
  const hooks: JsonObject = isObject(settings.hooks) ? { ...(settings.hooks as JsonObject) } : {};

  const entries = [
    { event: "UserPromptSubmit", name: "user-prompt-submit" },
    { event: "Stop", name: "stop" },
  ] as const;

  let changed = false;

  for (const { event, name } of entries) {
    const cmd = hookCmd(name);
    const existing: unknown[] = Array.isArray(hooks[event]) ? [...(hooks[event] as unknown[])] : [];

    // Remove stale cachelane entries (command path may have changed after rebuild).
    // Detect by suffix: our commands always end with `hook <name>`.
    const filtered = existing.filter((g: unknown) => {
      if (!isObject(g) || !Array.isArray((g as JsonObject).hooks)) return true;
      return !((g as JsonObject).hooks as unknown[]).some(
        (h) => isObject(h) && typeof (h as JsonObject).command === "string" &&
          ((h as JsonObject).command as string).endsWith(` hook ${name}`),
      );
    });

    filtered.push({ hooks: [{ type: "command", command: cmd }] });

    if (stable(filtered) !== stable(existing)) {
      hooks[event] = filtered;
      changed = true;
    }
  }

  if (changed) {
    settings.hooks = hooks;
    writeJsonObject(settingsPath, settings);
  }

  return changed;
}

function removeHooksFromSettings(settingsPath: string): boolean {
  if (!fs.existsSync(settingsPath)) return false;

  const settings = readJsonObject(settingsPath);
  if (!isObject(settings.hooks)) return false;

  const hooks: JsonObject = { ...(settings.hooks as JsonObject) };
  const OUR_HOOK_NAMES = ["user-prompt-submit", "stop"];
  let changed = false;

  for (const event of ["UserPromptSubmit", "Stop"]) {
    if (!Array.isArray(hooks[event])) continue;

    const filtered = (hooks[event] as unknown[]).filter((g: unknown) => {
      if (!isObject(g) || !Array.isArray((g as JsonObject).hooks)) return true;
      return !((g as JsonObject).hooks as unknown[]).some(
        (h) => isObject(h) && typeof (h as JsonObject).command === "string" &&
          OUR_HOOK_NAMES.some((n) => ((h as JsonObject).command as string).endsWith(` hook ${n}`)),
      );
    });

    if (filtered.length !== (hooks[event] as unknown[]).length) {
      if (filtered.length === 0) {
        delete hooks[event];
      } else {
        hooks[event] = filtered;
      }
      changed = true;
    }
  }

  if (changed) {
    settings.hooks = hooks;
    writeJsonObject(settingsPath, settings);
  }

  return changed;
}

export function installCachelane(env: NodeJS.ProcessEnv = process.env): InstallResult {
  const configPath = cachelaneConfigPath(env);
  const config = loadConfig(configPath);

  const mcpPath = claudeMcpPath(env);
  const hookPath = claudeHookPath(env);
  const settingsPath = claudeSettingsPath(env);

  // ── Validate BEFORE any mutation — fail-open guarantees no partial writes.
  validateInstall(settingsPath, config.proxy.port);

  const nodeExec = (() => { try { return fs.realpathSync(process.execPath); } catch { return process.execPath; } })();
  const cliScript = (() => {
    const argv1 = process.argv[1];
    if (argv1 && (argv1.endsWith("index.js") || argv1.endsWith("index.cjs") || argv1.endsWith("cachelane"))) {
      try {
        return fs.realpathSync(argv1);
      } catch {
        return argv1;
      }
    }
    const candidates = [
      path.join(__dirname, "index.js"),
      path.join(__dirname, "cli", "index.js"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return candidates[0]!;
  })();

  const mcpConfig = readJsonObject(mcpPath);
  const servers = isObject(mcpConfig.mcpServers) ? mcpConfig.mcpServers : {};
  const nextServer = {
    command: nodeExec,
    args: [cliScript, "mcp"],
    env: { CACHELANE_HOME: cachelaneHome(env) },
  };
  const beforeMcp = stable(mcpConfig);
  servers.cachelane = nextServer;
  mcpConfig.mcpServers = servers;
  const afterMcp = stable(mcpConfig);
  if (beforeMcp !== afterMcp) {
    writeJsonObject(mcpPath, mcpConfig);
  }

  // ── Hooks ────────────────────────────────────────────────────────────────────
  // Claude Code hooks only fire from ~/.claude/settings.json, not from
  // ~/.claude/hooks/*.json. We merge our entries into settings.json and also
  // write a marker file at hookPath so `cachelane doctor` can detect them.
  //
  // Use absolute paths for node + script because hook subprocesses don't inherit
  // the user's shell PATH (e.g. fnm multishell paths are session-specific).
  const hookCmd = (name: string) => `"${nodeExec}" "${cliScript}" hook ${name}`;

  const settingsChanged = mergeHooksIntoSettings(settingsPath, hookCmd);
  const upstreamChanged = mergeUpstreamFromSettingsIntoConfig(settingsPath, configPath, config);
  const urlChanged = mergeBaseUrlIntoSettings(settingsPath, config.proxy.port);

  // Marker file — used by `cachelane doctor` to confirm hooks are registered
  const markerContent = JSON.stringify(
    { hooks: { UserPromptSubmit: ["user-prompt-submit"], Stop: ["stop"] } },
    null,
    2,
  ) + "\n";
  const beforeMarker = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, "utf-8") : "";
  if (beforeMarker !== markerContent) {
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, markerContent);
  }

  return {
    mcp_path: mcpPath,
    hook_path: hookPath,
    changed:
      beforeMcp !== afterMcp ||
      settingsChanged ||
      upstreamChanged ||
      urlChanged ||
      beforeMarker !== markerContent,
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

  // Remove from settings.json (where hooks actually fire)
  const settingsPath = claudeSettingsPath(env);
  if (removeHooksFromSettings(settingsPath)) {
    changed = true;
  }
  if (removeBaseUrlFromSettings(settingsPath)) {
    changed = true;
  }

  // Remove marker file
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

  return { mcp_path: mcpPath, hook_path: hookPath, purge, changed };
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
