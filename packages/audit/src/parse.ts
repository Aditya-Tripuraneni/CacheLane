import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { ApiCall, Session } from "./types.js";

type Usage = {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};

type Entry = {
  type?: string;
  subtype?: string;
  sessionId?: string;
  timestamp?: string;
  isSidechain?: boolean;
  message?: { id?: string; model?: string; usage?: Usage };
};

export function parseSession(file: string, text: string = readFileSync(file, "utf8")): Session {
  const main = new Map<string, ApiCall>();
  const side = new Map<string, ApiCall>();
  const compactAt: number[] = [];
  let sessionId = basename(file, ".jsonl");

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e: Entry;
    try {
      e = JSON.parse(line) as Entry;
    } catch {
      continue;
    }
    if (e.sessionId) sessionId = e.sessionId;
    const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (e.type === "system" && e.subtype === "compact_boundary" && !Number.isNaN(ts)) {
      compactAt.push(ts);
      continue;
    }
    const m = e.message;
    if (e.type !== "assistant" || !m?.usage || !m.id || m.model === "<synthetic>" || Number.isNaN(ts)) continue;
    const u = m.usage;
    const split = u.cache_creation;
    const call: ApiCall = {
      id: m.id,
      model: m.model ?? "unknown",
      ts,
      input: u.input_tokens ?? 0,
      read: u.cache_read_input_tokens ?? 0,
      // The 5m/1h split is nested; the flat total is a 5m fallback when it is absent.
      write5m: split ? (split.ephemeral_5m_input_tokens ?? 0) : (u.cache_creation_input_tokens ?? 0),
      write1h: split?.ephemeral_1h_input_tokens ?? 0,
    };
    // Streamed responses repeat the same message id; keep the last entry.
    (e.isSidechain ? side : main).set(call.id, call);
  }

  const byTs = (a: ApiCall, b: ApiCall) => a.ts - b.ts;
  return {
    sessionId,
    project: basename(dirname(file)),
    calls: [...main.values()].sort(byTs),
    sidechainCalls: [...side.values()].sort(byTs),
    compactAt: compactAt.sort((a, b) => a - b),
  };
}
