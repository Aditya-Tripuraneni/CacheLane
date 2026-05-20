// scripts/corpus/decompose.ts
//
// SEAM. The corpus is only meaningful if the blocks it labels are the SAME
// blocks the production detector will see. After M3, the real decomposition
// lives in src/orchestrator. Wire that in here:
//
//   import { decomposeIntoBlocks as realDecompose } from "../../src/orchestrator/index.js";
//
// and delete the fallback below. Until then, this fallback produces a
// reasonable approximation so the pipeline runs end-to-end. It is deliberately
// conservative: one block per prior message, file_read blocks keyed by the path
// in the originating tool_use.
//
// Keeping the fallback in lockstep with the spec's BlockKind table (§3.2) keeps
// the corpus honest; but the production decomposer is the source of truth.

import { createHash } from "node:crypto";
import type { CorpusBlock, BlockKind } from "./types.js";

interface AnyContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  tool_use_id?: string;
}

interface Msg {
  role: string;
  content: AnyContentBlock[];
}

const PATH_KEYS = ["file_path", "path", "filePath", "notebook_path", "target_file"];

function extractPath(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  for (const k of PATH_KEYS) {
    const v = input[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function blockId(content: string, salt: string): string {
  return createHash("sha256").update(salt + "\u0000" + content).digest("hex");
}

function idToken(id: string): string {
  return id.slice(0, 8);
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/**
 * Fallback block decomposition. Replace with src/orchestrator's real one.
 */
export function decomposeIntoBlocks(priorMessages: Msg[]): CorpusBlock[] {
  const out: CorpusBlock[] = [];
  // Map tool_use_id -> file path so tool_result blocks inherit the path.
  const toolUsePath = new Map<string, string>();

  let idx = 0;
  for (const msg of priorMessages) {
    for (const b of msg.content) {
      idx += 1;
      if (b.type === "tool_use") {
        const p = extractPath(b.input);
        if (p && typeof (b as { id?: string }).id === "string") {
          toolUsePath.set((b as { id?: string }).id as string, p);
        }
        continue; // tool_use itself is part of a pair, not a standalone block here
      }

      let kind: BlockKind;
      let filePath: string | undefined;
      let content: string;

      if (b.type === "tool_result") {
        content = stringifyContent(b.content);
        filePath = b.tool_use_id ? toolUsePath.get(b.tool_use_id) : undefined;
        kind = filePath ? "file_read" : "tool_output";
      } else if (b.type === "text") {
        content = b.text ?? "";
        kind = msg.role === "user" ? "user_message" : "prior_turn";
      } else {
        content = stringifyContent(b);
        kind = "tool_output";
      }

      if (!content.trim()) continue;
      const id = blockId(content, `${idx}`);
      out.push({ id, id_token: idToken(id), kind, file_path: filePath, content });
    }
  }

  return out;
}
