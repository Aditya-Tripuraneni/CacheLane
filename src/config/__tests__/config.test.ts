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
    expect(config.classification.pin).toEqual([]);
    expect(config.classification.exclude).toEqual([]);
    expect(config.telemetry.opt_in).toBe(false);
    expect(config.telemetry.endpoint).toBe("");
    expect(config.log_level).toBe("info");
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it("loads valid existing config unchanged", () => {
    const configPath = path.join(tmpDir, "config.json");
    const custom: CachelaneConfig = {
      version: 1,
      pruner: { enabled: true, k: 5, mode: "conservative" },
      keepalive: {
        policy: "static",
        interval_seconds: 120,
        idle_threshold_seconds: 300,
        large_prefix_threshold_tokens: 60000,
      },
      classification: {
        pin: ["src/**/*.ts"],
        exclude: ["**/node_modules/**"],
        sliding_window_turns: 6,
      },
      telemetry: { opt_in: false, endpoint: "" },
      log_level: "debug",
    };
    fs.writeFileSync(configPath, JSON.stringify(custom));

    const config = loadConfig(configPath);
    expect(config.pruner.k).toBe(5);
    expect(config.pruner.mode).toBe("conservative");
    expect(config.classification.pin).toEqual(["src/**/*.ts"]);
    expect(config.classification.exclude).toEqual(["**/node_modules/**"]);
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

  it("rejects version != 1 via Zod literal", () => {
    // Older or non-numeric versions are caught by the Zod literal check;
    // a newer version is caught by the explicit pre-check above. This test
    // exercises the Zod path (version=0, still numeric, but not literal 1).
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 0,
        pruner: { enabled: true, k: 3, mode: "default" },
        keepalive: {
          policy: "auto",
          interval_seconds: 150,
          idle_threshold_seconds: 240,
          large_prefix_threshold_tokens: 50000,
        },
        classification: { pin: [], exclude: [], sliding_window_turns: 4 },
        telemetry: { opt_in: false, endpoint: "" },
        log_level: "info",
      })
    );
    expect(() => loadConfig(configPath)).toThrow(/config validation failed/i);
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
      version: 1,
      pruner: { enabled: true, k: 99, mode: "default" },
      keepalive: {
        policy: "auto",
        interval_seconds: 150,
        idle_threshold_seconds: 240,
        large_prefix_threshold_tokens: 50000,
      },
      classification: { pin: [], exclude: [], sliding_window_turns: 4 },
      telemetry: { opt_in: false, endpoint: "" },
      log_level: "info",
    };
    fs.writeFileSync(configPath, JSON.stringify(invalid));

    expect(() => loadConfig(configPath)).toThrow(/config validation failed/i);
  });
});
