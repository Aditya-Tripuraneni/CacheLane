import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_THRESHOLD, guardDecision, loadState, resolveTtlMs, saveState, type GuardState } from "../guard.js";
import type { ApiCall } from "../types.js";

const HOUR = 3_600_000;
const call = (read: number, write1h = 10_000): ApiCall => ({ id: "x", model: "claude-opus-5-5", ts: 0, input: 0, read, write5m: 0, write1h });
const fresh = (): GuardState => ({ enabled: true, threshold: DEFAULT_THRESHOLD, sessions: {}, blocked: {} });
const input = (over: Partial<Parameters<typeof guardDecision>[0]> = {}) => ({
  sessionId: "s", prompt: "refactor auth", now: 2 * HOUR, lastResponseAt: 0, lastCall: call(190_000), ttlMs: HOUR, state: fresh(), ...over,
});

describe("guardDecision", () => {
  it("blocks the first prompt after a cold, large cache", () => {
    const r = guardDecision(input());
    expect(r.action).toBe("block");
    expect(r.action === "block" && r.reason).toContain("went cold 2h 0m ago");
    expect(r.action === "block" && r.reason).toContain("/compact");
  });

  it("lets the same prompt through when re-sent within 2 minutes", () => {
    const state = fresh();
    guardDecision(input({ state }));
    expect(guardDecision(input({ state, now: 2 * HOUR + 60_000 })).action).toBe("allow");
  });

  it.each([
    ["warm cache", { now: 30 * 60_000 }],
    ["small context", { lastCall: call(50_000) }],
    ["disabled", { state: { ...fresh(), enabled: false } }],
    ["no last response", { lastResponseAt: undefined }],
  ])("allows with %s", (_label, over) => {
    expect(guardDecision(input(over)).action).toBe("allow");
  });
});

describe("resolveTtlMs", () => {
  it.each([
    ["FORCE_PROMPT_CACHING_5M wins", { FORCE_PROMPT_CACHING_5M: "1", CLAUDE_CODE_PROMPT_CACHE_TTL: "1h" }, [], undefined, 300_000],
    ["env var beats settings", { CLAUDE_CODE_PROMPT_CACHE_TTL: "1h" }, [{ promptCacheTtl: "5m" }], undefined, HOUR],
    ["first setting with a value", {}, [null, { promptCacheTtl: "5m" }], call(0), 300_000],
    ["falls back to last write tier", {}, [], call(0, 5), HOUR],
    ["defaults to 5m", {}, [], undefined, 300_000],
  ] as const)("%s", (_label, env, settings, lastWrite, expected) => {
    expect(resolveTtlMs(env, [...settings], lastWrite)).toBe(expected);
  });
});

describe("state file", () => {
  it("returns defaults for a corrupt file", () => {
    const p = join(mkdtempSync(join(tmpdir(), "cl-guard-")), "guard.json");
    writeFileSync(p, "not json");
    expect(loadState(p)).toEqual(fresh());
  });

  it("prunes entries older than 7 days on save", () => {
    const p = join(mkdtempSync(join(tmpdir(), "cl-guard-")), "nested", "guard.json");
    const now = 30 * 24 * HOUR;
    saveState(p, { ...fresh(), sessions: { old: 0, recent: now - HOUR } }, now);
    expect(JSON.parse(readFileSync(p, "utf8")).sessions).toEqual({ recent: now - HOUR });
  });
});
