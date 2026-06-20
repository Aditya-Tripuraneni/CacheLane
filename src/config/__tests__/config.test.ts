import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, CURRENT_CONFIG_VERSION, defaultWorkspaceId } from "../index.js";
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
    expect(config.proxy.upstream_host).toBe("api.anthropic.com");
    expect(config.proxy.upstream_path_prefix).toBe("");
    expect(config.logging.level).toBe("info");
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it("loads valid existing config unchanged", () => {
    const configPath = path.join(tmpDir, "config.json");
    const custom: Partial<CachelaneConfig> = {
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
      logging: { level: "debug", max_file_bytes: 10_485_760, max_files: 5 },
    };
    fs.writeFileSync(configPath, JSON.stringify(custom));

    const config = loadConfig(configPath);
    expect(config.pruner.k).toBe(5);
    expect(config.pruner.mode).toBe("conservative");
    expect(config.classification.pin).toEqual(["src/**/*.ts"]);
    expect(config.classification.exclude).toEqual(["**/node_modules/**"]);
    expect(config.logging.level).toBe("debug");
  });

  it("loads old configs without compression by applying compression defaults", () => {
    const configPath = path.join(tmpDir, "config.json");
    const oldConfig: Partial<CachelaneConfig> = {
      version: 1,
      pruner: { enabled: true, k: 5, mode: "conservative" },
      keepalive: {
        policy: "static",
        interval_seconds: 120,
        idle_threshold_seconds: 300,
        large_prefix_threshold_tokens: 60000,
      },
      classification: { pin: [], exclude: [], sliding_window_turns: 6 },
      telemetry: { opt_in: false, endpoint: "" },
      proxy: {
        port: 8123,
        host: "127.0.0.1",
        drain_timeout_ms: 250,
        upstream_host: "localhost",
        upstream_port: 8787,
        upstream_ssl: false,
        upstream_path_prefix: "/anthropic",
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(oldConfig));

    const config = loadConfig(configPath);
    expect(config.pruner.k).toBe(5);
    expect(config.proxy.upstream_host).toBe("localhost");
    expect(config.proxy.upstream_path_prefix).toBe("/anthropic");
    expect(config.compression.enabled).toBe(true);
    expect(config.compression.mode).toBe("lossless");
    expect(config.compression.compressors).toEqual({ json: true, log: true });
    expect(config.compression.retention.enabled).toBe(false);
  });

  it("fills partial compression config without discarding user settings", () => {
    const configPath = path.join(tmpDir, "config.json");
    const partialConfig: Record<string, unknown> = {
      version: 1,
      pruner: { enabled: true, k: 4, mode: "default" },
      keepalive: {
        policy: "auto",
        interval_seconds: 150,
        idle_threshold_seconds: 240,
        large_prefix_threshold_tokens: 50000,
      },
      classification: { pin: ["src/**"], exclude: [], sliding_window_turns: 4 },
      telemetry: { opt_in: false, endpoint: "" },
      proxy: {
        port: 7332,
        host: "127.0.0.1",
        drain_timeout_ms: 200,
        upstream_host: "proxy.internal",
        upstream_port: 9000,
        upstream_ssl: false,
        upstream_path_prefix: "",
      },
      compression: { enabled: false },
    };
    fs.writeFileSync(configPath, JSON.stringify(partialConfig));

    const config = loadConfig(configPath);
    expect(config.compression.enabled).toBe(false);
    expect(config.compression.mode).toBe("lossless");
    expect(config.compression.exclude).toEqual([]);
    expect(config.compression.json_max_array_items).toBe(20);
    expect(config.compression.compressors).toEqual({ json: true, log: true });
    expect(config.compression.retention).toEqual({
      enabled: false,
      min_original_tokens: 1000,
      ttl_days: 7,
    });
    expect(config.proxy.upstream_host).toBe("proxy.internal");
    expect(config.classification.pin).toEqual(["src/**"]);
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

  it("falls back to defaults when config fails Zod validation (version=0)", () => {
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
      })
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = loadConfig(configPath);
    expect(config.pruner.k).toBe(3);
    expect(config.version).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed validation"),
      expect.any(String)
    );
    warnSpy.mockRestore();
  });

  it("falls back to defaults when config JSON is malformed", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, "{ not valid json }");

    const config = loadConfig(configPath);
    expect(config.version).toBe(CURRENT_CONFIG_VERSION);
    expect(config.pruner.k).toBe(3);
  });

  it("falls back to defaults when pruner.k is out of range", () => {
    const configPath = path.join(tmpDir, "config.json");
    const invalid: Partial<CachelaneConfig> = {
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
    };
    fs.writeFileSync(configPath, JSON.stringify(invalid));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = loadConfig(configPath);
    expect(config.pruner.k).toBe(3);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed validation"),
      expect.any(String)
    );
    warnSpy.mockRestore();
  });
});

describe("defaultWorkspaceId", () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
  });

  // The proxy (auto-started inside the MCP server Claude Code spawns) and a
  // manually-run `cachelane report` execute with different working directories.
  // The default workspace id must be cwd-independent so both resolve the same
  // workspace; otherwise turns are written to one ws_* and read from another,
  // producing an empty/partial report.
  it("returns the same id regardless of process.cwd()", () => {
    const a = defaultWorkspaceId();
    process.chdir(os.tmpdir());
    const b = defaultWorkspaceId();
    expect(b).toBe(a);
  });
});
