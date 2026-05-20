// scripts/corpus/ingest.ts
//
// Reads real Claude Code session transcripts (JSONL under ~/.claude/projects/)
// and turns each into a list of CorpusTurns: for every assistant response, the
// blocks that were in the prompt that produced it.
//
// Claude Code JSONL shape (one object per line). Confirmed fields used here:
//   { type: "user" | "assistant" | "system" | "summary",
//     uuid, parentUuid, cwd, timestamp,
//     message: { role, content: (TextBlock | ToolUseBlock | ToolResultBlock)[] , usage? } }
//
// NOTE: transcript schemas evolve. Everything format-specific is isolated in
// parseLine() and toContentBlocks(). If your lines differ, fix those two spots
// only — paste me one real line and I'll match it exactly.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { CorpusBlock, CorpusTurn, ToolCall } from "./types.js";
import { decomposeIntoBlocks } from "./decompose.js";

interface RawEvent {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  cwd?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

interface AnyContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result
  content?: unknown;
  tool_use_id?: string;
}

function parseLine(line: string): RawEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as RawEvent;
  } catch {
    return null; // skip malformed lines rather than abort the whole session
  }
}

function toContentBlocks(content: unknown): AnyContentBlock[] {
  // Content can be a string (older/simple turns) or an array of blocks.
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content as AnyContentBlock[];
  return [];
}

function textOf(blocks: AnyContentBlock[]): string {
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

function toolCallsOf(blocks: AnyContentBlock[]): ToolCall[] {
  return blocks
    .filter((b) => b.type === "tool_use" && typeof b.name === "string")
    .map((b) => ({ name: b.name as string, input: (b.input ?? {}) as Record<string, unknown> }));
}

/**
 * Reconstruct, for each assistant event, the message history that preceded it.
 * That prefix is what we hand to decomposeIntoBlocks() to get the prompt blocks.
 */
export function ingestSession(path: string): CorpusTurn[] {
  const lines = readFileSync(path, "utf8").split("\n");
  const events = lines.map(parseLine).filter((e): e is RawEvent => e !== null);

  const priorMessages: { role: string; content: AnyContentBlock[] }[] = [];
  const turns: CorpusTurn[] = [];
  let turnNumber = 0;

  for (const ev of events) {
    if (ev.type !== "user" && ev.type !== "assistant") continue; // skip system/summary
    const role = ev.message?.role ?? ev.type;
    const blocks = toContentBlocks(ev.message?.content);

    if (role === "assistant") {
      // The prompt for THIS assistant turn = everything observed so far.
      const promptBlocks: CorpusBlock[] = decomposeIntoBlocks(priorMessages);
      turns.push({
        turn_number: turnNumber++,
        assistant_text: textOf(blocks),
        tool_calls: toolCallsOf(blocks),
        blocks_in_prompt: promptBlocks,
      });
    }

    priorMessages.push({ role, content: blocks });
  }

  return turns;
}

/** 8-char id token used for Signal 2; stable across runs for a given content. */
export function idTokenFor(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}
