import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { written } from "./classify.js";
import { guardDecision, loadState, resolveTtlMs, saveState } from "./guard.js";
import { parseSession } from "./parse.js";

export interface HookDeps {
  statePath: string;
  now: number;
  env: Record<string, string | undefined>;
  home: string;
}

export function defaultDeps(): HookDeps {
  const home = homedir();
  return { statePath: join(home, ".cachelane", "guard.json"), now: Date.now(), env: process.env, home };
}

type HookInput = { session_id?: string; transcript_path?: string; prompt?: string; cwd?: string };

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Only prompts a person typed are guarded. Claude Code also routes task notifications
 * and loop wakeups ("<..."), slash commands ("/...") and shell commands ("!...") through
 * UserPromptSubmit; blocking those would drop background results or block /clear itself.
 */
const isTypedPrompt = (prompt: string | undefined): boolean => !/^\s*[<\/!]/.test(prompt ?? "");

/** UserPromptSubmit. Returns stdout to print ("" = allow). Never throws. */
export function promptHook(input: HookInput, d: HookDeps): string {
  try {
    if (!isTypedPrompt(input.prompt)) return "";
    if (!input.session_id || !input.transcript_path || !existsSync(input.transcript_path)) return "";
    const state = loadState(d.statePath);
    if (!state.enabled) return "";
    const session = parseSession(input.transcript_path);
    const lastCall = session.calls.at(-1);
    const lastWrite = [...session.calls].reverse().find((c) => written(c) > 0);
    const cwd = input.cwd ?? process.cwd();
    const settings = [
      readJson(join(cwd, ".claude", "settings.local.json")),
      readJson(join(cwd, ".claude", "settings.json")),
      readJson(join(d.home, ".claude", "settings.json")),
    ];
    const result = guardDecision({
      sessionId: input.session_id,
      now: d.now,
      lastResponseAt: state.sessions[input.session_id] ?? lastCall?.ts,
      lastCall,
      ttlMs: resolveTtlMs(d.env, settings, lastWrite),
      state,
    });
    saveState(d.statePath, state, d.now);
    return result.action === "block" ? JSON.stringify({ decision: "block", reason: result.reason }) : "";
  } catch {
    return "";
  }
}

/** Stop. Records when the session last got a response. Never throws. */
export function stopHook(input: HookInput, d: HookDeps): void {
  try {
    if (!input.session_id) return;
    const state = loadState(d.statePath);
    state.sessions[input.session_id] = d.now;
    delete state.warned[input.session_id]; // a response ends the idle period
    saveState(d.statePath, state, d.now);
  } catch {
    // fail open
  }
}
