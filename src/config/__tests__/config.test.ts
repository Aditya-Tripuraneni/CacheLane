import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, CURRENT_CONFIG_VERSION } from "../index.js";
import type { CachelaneConfig } from "../../types/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-test-cfg-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("creates config with defaults when file does not exist", () => {
    const configPath = path.join(tmpDir, "config.json");
    const config = loadConfig(configPath);

    expect(config.version).toBe(CURRENT_CONFIG_VERSION);
    expect(config.pruner.k).toBe(3);
    expect(config.pruner.mode).toBe("default");
    expect(config.pruner.enabled).toBe(true);
    expect(config.keepalive.policy).toBe("auto");
    expect(config.keepalive.interval_seconds).toBe(150);
    expect(config.keepalive.idle_threshold_seconds).toBe(240);
    expect(config.keepalive.large_prefix_threshold_tokens).toBe(50000);
    expect(config.classification.sliding_window_turns).toBe(4);
    expect(config.telemetry.opt_in).toBe(false);
    expect(config.log_level).toBe("info");
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it("loads valid existing config unchanged", () => {
    const configPath = path.join(tmpDir, "config.json");
    const custom: CachelaneConfig = {
      version: CURRENT_CONFIG_VERSION,
      pruner: { enabled: true, k: 5, mode: "conservative" },
      keepalive: {
        policy: "static",
        interval_seconds: 120,
        idle_threshold_seconds: 300,
        large_prefix_threshold_tokens: 60000,
      },
      classification: { sliding_window_turns: 6 },
      telemetry: { opt_in: false },
      log_level: "debug",
    };
    fs.writeFileSync(configPath, JSON.stringify(custom));

    const config = loadConfig(configPath);
    expect(config.pruner.k).toBe(5);
    expect(config.pruner.mode).toBe("conservative");
    expect(config.log_level).toBe("debug");
  });

  it("throws when config schema version is newer than supported", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ version: CURRENT_CONFIG_VERSION + 1 })
    );

    expect(() => loadConfig(configPath)).toThrow(
      /config schema version.*newer than supported/i
    );
  });

  it("falls back to defaults when config JSON is malformed", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, "{ not valid json }");

    const config = loadConfig(configPath);
    expect(config.version).toBe(CURRENT_CONFIG_VERSION);
    expect(config.pruner.k).toBe(3);
  });

  it("rejects pruner.k outside range 1–10", () => {
    const configPath = path.join(tmpDir, "config.json");
    const invalid: CachelaneConfig = {
      version: CURRENT_CONFIG_VERSION,
      pruner: { enabled: true, k: 99, mode: "default" },
      keepalive: {
        policy: "auto",
        interval_seconds: 150,
        idle_threshold_seconds: 240,
        large_prefix_threshold_tokens: 50000,
      },
      classification: { sliding_window_turns: 4 },
      telemetry: { opt_in: false },
      log_level: "info",
    };
    fs.writeFileSync(configPath, JSON.stringify(invalid));

    expect(() => loadConfig(configPath)).toThrow(/config validation failed/i);
  });
});
