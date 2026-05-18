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
    throw new Error(
      `Config validation failed at ${configPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
