import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { handleHookMutate } from "../hook-mutate.js";

// Use a real temp-dir CACHELANE_HOME so config + storage are exercised for real
// (no in-process module mocks — they would let the real fail-open path drift).
let tmpDir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-hookmutate-"));
  env = { ...process.env, CACHELANE_HOME: tmpDir };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("hook-mutate (deprecated — no-op)", () => {
  it("returns undefined when the payload has no prompt", async () => {
    const result = await handleHookMutate(env, { session_id: "test" });
    expect(result).toBeUndefined();
  });

  it("does NOT mutate the prompt (deprecated path; proxy does the real work)", async () => {
    const result = await handleHookMutate(env, { prompt: "Hello world" });
    // No demo text injected, no prompt rewrite — the hook is a pure no-op now.
    expect(result).toBeUndefined();
  });

  it("fails open (returns undefined) even if storage/config are unavailable", async () => {
    const badEnv = { ...process.env, CACHELANE_HOME: path.join(tmpDir, "nonexistent", "nested") };
    const result = await handleHookMutate(badEnv, { prompt: "Hello" });
    expect(result).toBeUndefined();
  });
});
