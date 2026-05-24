import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CURRENT_CONFIG_VERSION, DEFAULT_CONFIG } from "./defaults.js";
import type { CachelaneConfig } from "../types/index.js";

export { CURRENT_CONFIG_VERSION } from "./defaults.js";

const configSchema = z.object({
  version: z.literal(1),
  pruner: z.object({
    enabled: z.boolean(),
    k: z.number().int().min(1).max(10),
    mode: z.enum(["default", "conservative", "aggressive"]),
  }),
  keepalive: z.object({
    policy: z.enum(["off", "static", "adaptive", "auto"]),
    interval_seconds: z.number().int().positive(),
    idle_threshold_seconds: z.number().int().positive(),
    large_prefix_threshold_tokens: z.number().int().positive(),
  }),
  classification: z.object({
    pin: z.array(z.string()).default([]),
    exclude: z.array(z.string()).default([]),
    sliding_window_turns: z.number().int().positive(),
  }),
  telemetry: z.object({
    opt_in: z.boolean(),
    endpoint: z.string().default(""),
  }),
  log_level: z.enum(["trace", "debug", "info", "warn", "error"]),
  proxy: z
    .object({
      port: z.number().int().positive(),
      host: z.string(),
      drain_timeout_ms: z.number().int().nonnegative(),
      upstream_host: z.string(),
      upstream_port: z.number().int().positive(),
      upstream_ssl: z.boolean(),
    })
    .default(DEFAULT_CONFIG.proxy),
  features: z
    .object({
      auto_proxy: z.boolean(),
      k_pruner: z.boolean(),
      keepalive: z.boolean(),
    })
    .default(DEFAULT_CONFIG.features),
  health: z
    .object({
      fallback_warning_threshold_pct: z.number().nonnegative(),
      fallback_window_turns: z.number().int().positive(),
    })
    .default(DEFAULT_CONFIG.health),
  logging: z
    .object({
      level: z.enum(["error", "warn", "info", "debug"]),
      max_file_bytes: z.number().int().positive(),
      max_files: z.number().int().positive(),
    })
    .default(DEFAULT_CONFIG.logging),
});

export function loadConfig(configPath: string): CachelaneConfig {
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    console.warn(`[cachelane] config at ${configPath} is malformed — falling back to defaults`);
    return { ...DEFAULT_CONFIG };
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    "version" in raw &&
    typeof (raw as { version: unknown }).version === "number" &&
    (raw as { version: number }).version > CURRENT_CONFIG_VERSION
  ) {
    throw new Error(
      `config schema version ${(raw as { version: number }).version} is newer than supported (${CURRENT_CONFIG_VERSION})`
    );
  }

  try {
    return configSchema.parse(raw) as CachelaneConfig;
  } catch (err) {
    if (!(err instanceof z.ZodError)) throw err;
    console.warn(
      `[cachelane] config at ${configPath} failed validation — falling back to defaults`,
      err.message,
    );
    return { ...DEFAULT_CONFIG };
  }
}
