import type { CachelaneConfig } from "../types/index.js";

export const CURRENT_CONFIG_VERSION = 1;

export const DEFAULT_CONFIG: CachelaneConfig = {
  version: CURRENT_CONFIG_VERSION,
  pruner: {
    enabled: true,
    k: 3,
    mode: "default",
  },
  keepalive: {
    policy: "auto",
    interval_seconds: 150,          // 2.5 min — ping before 5m TTL expires
    idle_threshold_seconds: 240,     // 4 min idle before we consider pinging
    large_prefix_threshold_tokens: 50_000, // above this, assign 1h TTL class
  },
  classification: {
    pin: [],
    exclude: [],
    sliding_window_turns: 4,
  },
  telemetry: {
    opt_in: false,
    endpoint: "",
  },
  log_level: "info",
};
