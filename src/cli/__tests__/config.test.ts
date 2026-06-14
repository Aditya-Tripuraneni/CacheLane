import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setMutationEnabled } from "../config.js";

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
