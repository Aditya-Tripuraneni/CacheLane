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
    interval_seconds: 150,
    idle_threshold_seconds: 240,
    large_prefix_threshold_tokens: 50000,
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
