import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addCompressionExcludePattern,
  setCompressionCompressorEnabled,
  setCompressionEnabled,
  setCompressionMode,
  setCompressionRetentionEnabled,
  setMutationEnabled,
} from "../config.js";

describe("setMutationEnabled", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cachelane-cfg-"));
    configPath = join(dir, "config.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes features.mutation_enabled = false", () => {
    const config = setMutationEnabled(configPath, false);
    expect(config.features.mutation_enabled).toBe(false);
    const onDisk = JSON.parse(readFileSync(configPath, "utf8"));
    expect(onDisk.features.mutation_enabled).toBe(false);
  });

  it("writes features.mutation_enabled = true", () => {
    setMutationEnabled(configPath, false);
    const config = setMutationEnabled(configPath, true);
    expect(config.features.mutation_enabled).toBe(true);
  });
});

describe("compression config helpers", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cachelane-cfg-"));
    configPath = join(dir, "config.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes compression.enabled = false and true", () => {
    const disabled = setCompressionEnabled(configPath, false);
    expect(disabled.compression.enabled).toBe(false);
    const enabled = setCompressionEnabled(configPath, true);
    expect(enabled.compression.enabled).toBe(true);
  });

  it("appends unique compression exclude globs", () => {
    addCompressionExcludePattern(configPath, "*.json");
    const updated = addCompressionExcludePattern(configPath, "*.json");
    expect(updated.compression.exclude).toEqual(["*.json"]);
  });

  it("writes compression.mode", () => {
    const updated = setCompressionMode(configPath, "lossless");
    expect(updated.compression.mode).toBe("lossless");
  });

  it("writes compression.retention.enabled", () => {
    const enabled = setCompressionRetentionEnabled(configPath, true);
    expect(enabled.compression.retention.enabled).toBe(true);
    const disabled = setCompressionRetentionEnabled(configPath, false);
    expect(disabled.compression.retention.enabled).toBe(false);
  });

  it("writes per-compressor enabled flags", () => {
    const jsonDisabled = setCompressionCompressorEnabled(configPath, "json", false);
    expect(jsonDisabled.compression.compressors.json).toBe(false);
    expect(jsonDisabled.compression.compressors.log).toBe(true);

    const logDisabled = setCompressionCompressorEnabled(configPath, "log", false);
    expect(logDisabled.compression.compressors.json).toBe(false);
    expect(logDisabled.compression.compressors.log).toBe(false);
  });
});
