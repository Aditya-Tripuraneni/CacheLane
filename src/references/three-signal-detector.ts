import { createHash } from "node:crypto";
import type {
  DetectedReference,
  ReferenceBlock,
  ReferenceToolCall,
  ReferenceTurn,
} from "./types.js";

const SHINGLE_SIZE = 40;
const PATH_KEYS = [
  "file_path",
  "path",
  "filePath",
  "notebook_path",
  "target_file",
  "command",
];

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function basename(p: string): string {
  const normalized = normalizePath(p);
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStrings(item, out);
    }
  }
  return out;
}

function toolCallPathHaystacks(toolCall: ReferenceToolCall): string[] {
  const direct = PATH_KEYS.flatMap((key) => {
    const value = toolCall.input[key];
    return typeof value === "string" ? [value] : [];
  });
  return [...direct, ...collectStrings(toolCall.input)].map(normalizePath);
}

function filePathMatch(block: ReferenceBlock, toolCall: ReferenceToolCall): string | null {
  if (!block.file_path) return null;
  const full = normalizePath(block.file_path);
  const base = basename(block.file_path);
  for (const haystack of toolCallPathHaystacks(toolCall)) {
    if (haystack === full || haystack.includes(full) || haystack.includes(base)) {
      return `tool=${toolCall.name} path=${base}`;
    }
  }
  return null;
}

function sha256Short(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function buildAssistantShingles(text: string): Set<string> {
  const shingles = new Set<string>();
  for (let i = 0; i <= text.length - SHINGLE_SIZE; i++) {
    shingles.add(text.slice(i, i + SHINGLE_SIZE));
  }
  return shingles;
}

function findShingle(blockContent: string, assistantShingles: Set<string>): string | null {
  if (blockContent.length < SHINGLE_SIZE || assistantShingles.size === 0) {
    return null;
  }
  for (let i = 0; i <= blockContent.length - SHINGLE_SIZE; i++) {
    const shingle = blockContent.slice(i, i + SHINGLE_SIZE);
    if (assistantShingles.has(shingle)) {
      return shingle;
    }
  }
  return null;
}

export function detectDetailedReferences(turn: ReferenceTurn): DetectedReference[] {
  const detected = new Map<string, DetectedReference>();

  for (const toolCall of turn.tool_calls) {
    for (const block of turn.blocks_in_prompt) {
      if (detected.has(block.id)) continue;
      const evidence = filePathMatch(block, toolCall);
      if (evidence) {
        detected.set(block.id, {
          block_id: block.id,
          reference_type: "tool_call",
          evidence,
        });
      }
    }
  }

  for (const block of turn.blocks_in_prompt) {
    if (detected.has(block.id) || !block.id_token) continue;
    if (turn.assistant_text.includes(block.id_token)) {
      detected.set(block.id, {
        block_id: block.id,
        reference_type: "id_mention",
        evidence: `id_token=${block.id_token}`,
      });
    }
  }

  const needsShingles = turn.blocks_in_prompt.some(
    (block) => !detected.has(block.id) && block.content.length >= SHINGLE_SIZE,
  );
  const assistantShingles =
    needsShingles && turn.assistant_text.length >= SHINGLE_SIZE
      ? buildAssistantShingles(turn.assistant_text)
      : new Set<string>();

  for (const block of turn.blocks_in_prompt) {
    if (detected.has(block.id)) continue;
    const shingle = findShingle(block.content, assistantShingles);
    if (shingle) {
      detected.set(block.id, {
        block_id: block.id,
        reference_type: "text_quote",
        evidence: `shingle_sha256=${sha256Short(shingle)}`,
      });
    }
  }

  const refs = [...detected.values()];

  if (refs.length > 0) {
    const byType = { tool_call: 0, id_mention: 0, text_quote: 0 };
    for (const ref of refs) byType[ref.reference_type] += 1;
    console.error("[cachelane] reference detector", {
      detected: refs.length,
      of: turn.blocks_in_prompt.length,
      by_type: byType,
    });
  }

  return refs;
}

export function detectReferences(turn: ReferenceTurn): Set<string> {
  return new Set(detectDetailedReferences(turn).map((ref) => ref.block_id));
}
