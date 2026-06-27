import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { loadConfig } from "../config/index.js";
import type { CachelaneConfig } from "../types/index.js";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneDefaultConfig(): CachelaneConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as CachelaneConfig;
}

function readRawConfig(configPath: string): JsonObject {
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const defaults = cloneDefaultConfig();
    fs.writeFileSync(configPath, `${JSON.stringify(defaults, null, 2)}\n`);
    return defaults as unknown as JsonObject;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
  } catch (err) {
    throw new Error(
      `Invalid JSON at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isObject(raw)) {
    throw new Error(`Config at ${configPath} must be a JSON object`);
  }
  return raw;
}

function ensureSection<T extends keyof CachelaneConfig>(
  raw: JsonObject,
  section: T,
): JsonObject {
  const current = raw[section];
  if (isObject(current)) return current;

  const defaults = cloneDefaultConfig();
  const value = defaults[section] as unknown;
  raw[section] = isObject(value) ? { ...value } : value;
  return raw[section] as JsonObject;
}

export function writeRawConfig(configPath: string, raw: JsonObject): CachelaneConfig {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`);
  return loadConfig(configPath);
}

export function updateConfig(
  configPath: string,
  mutator: (raw: JsonObject) => void,
): CachelaneConfig {
  const raw = readRawConfig(configPath);
  raw.version = DEFAULT_CONFIG.version;
  mutator(raw);
  return writeRawConfig(configPath, raw);
}

export function setPrunerEnabled(configPath: string, enabled: boolean): CachelaneConfig {
  return updateConfig(configPath, (raw) => {
    ensureSection(raw, "pruner").enabled = enabled;
  });
}

export function setMutationEnabled(configPath: string, enabled: boolean): CachelaneConfig {
  return updateConfig(configPath, (raw) => {
    ensureSection(raw, "features").mutation_enabled = enabled;
  });
}

export function setCompressionEnabled(configPath: string, enabled: boolean): CachelaneConfig {
  return updateConfig(configPath, (raw) => {
    ensureSection(raw, "compression").enabled = enabled;
  });
}

export function setCompressionMode(
  configPath: string,
  mode: CachelaneConfig["compression"]["mode"],
): CachelaneConfig {
  return updateConfig(configPath, (raw) => {
    ensureSection(raw, "compression").mode = mode;
  });
}

export function setCompressionRetentionEnabled(
  configPath: string,
  enabled: boolean,
): CachelaneConfig {
  return updateConfig(configPath, (raw) => {
    const compression = ensureSection(raw, "compression");
    const current = isObject(compression.retention)
      ? compression.retention
      : { ...DEFAULT_CONFIG.compression.retention };
    current.enabled = enabled;
    compression.retention = current;
  });
}

export function setCompressionCompressorEnabled(
  configPath: string,
  compressor: "json" | "log" | "shell",
  enabled: boolean,
): CachelaneConfig {
  return updateConfig(configPath, (raw) => {
    const compression = ensureSection(raw, "compression");
    const current = isObject(compression.compressors)
      ? compression.compressors
      : { ...DEFAULT_CONFIG.compression.compressors };
    current[compressor] = enabled;
    compression.compressors = current;
  });
}

export function setPrunerMode(
  configPath: string,
  mode: CachelaneConfig["pruner"]["mode"],
): CachelaneConfig {
  const kByMode: Record<CachelaneConfig["pruner"]["mode"], number> = {
    aggressive: 2,
    default: 3,
    conservative: 5,
  };

  return updateConfig(configPath, (raw) => {
    const pruner = ensureSection(raw, "pruner");
    pruner.enabled = true;
    pruner.mode = mode;
    pruner.k = kByMode[mode];
  });
}

export function setKeepalivePolicy(
  configPath: string,
  policy: CachelaneConfig["keepalive"]["policy"],
): CachelaneConfig {
  return updateConfig(configPath, (raw) => {
    ensureSection(raw, "keepalive").policy = policy;
  });
}

function addUniquePattern(
  configPath: string,
  key: "pin" | "exclude",
  pattern: string,
): CachelaneConfig {
  return updateConfig(configPath, (raw) => {
    const classification = ensureSection(raw, "classification");
    const existing = Array.isArray(classification[key])
      ? classification[key].filter((value): value is string => typeof value === "string")
      : [];
    if (!existing.includes(pattern)) existing.push(pattern);
    classification[key] = existing;
  });
}

export function addPinPattern(configPath: string, pattern: string): CachelaneConfig {
  return addUniquePattern(configPath, "pin", pattern);
}

export function addExcludePattern(configPath: string, pattern: string): CachelaneConfig {
  return addUniquePattern(configPath, "exclude", pattern);
}

export function addCompressionExcludePattern(configPath: string, pattern: string): CachelaneConfig {
  return updateConfig(configPath, (raw) => {
    const compression = ensureSection(raw, "compression");
    const existing = Array.isArray(compression.exclude)
      ? compression.exclude.filter((value): value is string => typeof value === "string")
      : [];
    if (!existing.includes(pattern)) existing.push(pattern);
    compression.exclude = existing;
  });
}

export function setTelemetryOptIn(configPath: string, optIn: boolean): CachelaneConfig {
  return updateConfig(configPath, (raw) => {
    ensureSection(raw, "telemetry").opt_in = optIn;
  });
}
