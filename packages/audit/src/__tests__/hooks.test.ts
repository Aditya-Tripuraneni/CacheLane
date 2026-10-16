import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState } from "../guard.js";
import { promptHook, stopHook, type HookDeps } from "../hooks.js";
import { fixture } from "./fixture.js";

const LAST = Date.parse("2026-10-01T12:01:00.000Z"); // m3 in idle.jsonl, 102k context, 1h tier

function setup(now: number): HookDeps {
  const dir = mkdtempSync(join(tmpdir(), "cl-hooks-"));
  const deps = { statePath: join(dir, "guard.json"), now, env: {}, home: dir };
  saveState(deps.statePath, { ...loadState(deps.statePath), threshold: 50_000 }, now);
  return deps;
}
const input = (prompt = "next step") => ({ session_id: "sess-idle", transcript_path: fixture("idle"), prompt, cwd: tmpdir() });

describe("promptHook", () => {
  it("blocks with Claude Code's decision JSON after the cache went cold", () => {
    const out = JSON.parse(promptHook(input(), setup(LAST + 2 * 3_600_000)));
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("went cold 2h 0m ago");
  });

  it("allows the next prompt after a warning, whatever it says and however late", () => {
    const deps = setup(LAST + 2 * 3_600_000);
    promptHook(input(), deps);
    expect(promptHook(input("something else"), { ...deps, now: deps.now + 10 * 60_000 })).toBe("");
  });

  it("keeps the one-warning rule when the last response is over a week old", () => {
    const deps = setup(LAST + 14 * 24 * 3_600_000);
    promptHook(input(), deps);
    expect(promptHook(input("something else"), { ...deps, now: deps.now + 60_000 })).toBe("");
  });

  // Claude Code also sends task notifications, loop wakeups, slash commands and shell
  // commands through UserPromptSubmit. Blocking them loses background results.
  it.each([
    ["a background-task notification", "<task-notification>\n<task-id>b1</task-id>\n</task-notification>"],
    ["a slash command", "/compact"],
    ["a shell command", "! ls"],
  ])("never blocks %s", (_label, prompt) => {
    expect(promptHook(input(prompt), setup(LAST + 2 * 3_600_000))).toBe("");
  });

  it("uses the Stop timestamp as last activity", () => {
    const deps = setup(LAST + 2 * 3_600_000);
    stopHook(input(), { ...deps, now: deps.now - 60_000 });
    expect(promptHook(input(), deps)).toBe("");
  });

  it("allows when the transcript is missing", () => {
    expect(promptHook({ ...input(), transcript_path: "/nope.jsonl" }, setup(LAST))).toBe("");
  });
});
