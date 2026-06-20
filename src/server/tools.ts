import { z } from "zod";
import type {
  CachelaneDb,
  CachelaneStats,
  StatsScope,
  TurnExplanationRecord,
} from "../storage/index.js";
import { expandCachedStub } from "../hooks/expand.js";
import type { ExpandStubResult } from "../hooks/expand.js";

export const statsInputSchema = z.object({
  scope: z.enum(["session", "workspace", "all"]).optional().default("workspace"),
  since: z.string().optional(),
});

export const explainInputSchema = z.object({
  turn: z.number().int().positive().optional(),
});

export const expandInputSchema = z.object({
  block_id: z.string().min(1),
});

export const retrieveToolOutputInputSchema = z.object({
  handle: z.string().min(1),
});

export type StatsToolInput = z.input<typeof statsInputSchema>;
export type ExplainToolInput = z.input<typeof explainInputSchema>;
export type ExpandToolInput = z.input<typeof expandInputSchema>;
export type RetrieveToolOutputInput = z.input<typeof retrieveToolOutputInputSchema>;

export interface CachelaneMcpContext {
  db: CachelaneDb;
  workspace_id: string;
  session_id: string;
  now_ms?: number;
}

export interface McpJsonTextPayload {
  [key: string]: unknown;
  content: [{ type: "text"; text: string }];
}

export function jsonTextPayload(value: unknown): McpJsonTextPayload {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

export function parseSince(since: string | undefined, nowMs = Date.now()): number | undefined {
  if (since === undefined) return undefined;

  const absolute = Date.parse(since);
  if (!Number.isNaN(absolute)) return absolute;

  const duration = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(
    since,
  );
  if (duration === null) {
    throw new Error(`Invalid since value: ${since}`);
  }

  const weeks = Number(duration[1] ?? 0);
  const days = Number(duration[2] ?? 0);
  const hours = Number(duration[3] ?? 0);
  const minutes = Number(duration[4] ?? 0);
  const seconds = Number(duration[5] ?? 0);
  const durationMs =
    (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 * 1000 +
    seconds * 1000;
  return nowMs - durationMs;
}

export function handleStatsTool(
  context: CachelaneMcpContext,
  rawInput: StatsToolInput,
): CachelaneStats {
  const input = statsInputSchema.parse(rawInput);
  const scope = input.scope as StatsScope;
  const targetSessionId =
    scope === "session" ? resolveSessionId(context) : context.session_id;

  return context.db.getStats({
    scope,
    workspace_id: scope === "all" ? undefined : context.workspace_id,
    session_id: scope === "session" ? targetSessionId : undefined,
    since_ms: parseSince(input.since, context.now_ms),
  });
}

function resolveSessionId(context: CachelaneMcpContext): string {
  if (context.session_id !== "default") return context.session_id;

  const recent = context.db.getRecentTurn({ workspace_id: context.workspace_id });
  return recent?.session_id ?? context.session_id;
}

export function handleExplainTool(
  context: CachelaneMcpContext,
  rawInput: ExplainToolInput,
): { found: false } | { found: true; explanation: TurnExplanationRecord } {
  const input = explainInputSchema.parse(rawInput);
  const targetSessionId = resolveSessionId(context);
  const explanation = context.db.getTurnExplanation({
    workspace_id: context.workspace_id,
    session_id: targetSessionId,
    turn_number: input.turn,
  });

  if (explanation === null) {
    return { found: false };
  }

  return { found: true, explanation };
}

export function handleExpandTool(
  context: CachelaneMcpContext,
  rawInput: ExpandToolInput,
): ExpandStubResult {
  const input = expandInputSchema.parse(rawInput);
  const recent = context.db.getRecentTurn({
    workspace_id: context.workspace_id,
  });

  return expandCachedStub(context.db, {
    workspace_id: context.workspace_id,
    session_id: recent?.session_id ?? context.session_id,
    block_id: input.block_id,
    turn_number: (recent?.turn_number ?? 0) + 1,
    updated_at: context.now_ms,
  });
}

export function handleRetrieveToolOutputTool(
  context: CachelaneMcpContext,
  rawInput: RetrieveToolOutputInput,
): { found: false } | {
  found: true;
  tool_use_id: string;
  original_text: string;
  original_tokens: number;
} {
  const input = retrieveToolOutputInputSchema.parse(rawInput);
  const targetSessionId = resolveSessionId(context);
  const original = context.db.getCompressionOriginal({
    handle: input.handle,
    workspace_id: context.workspace_id,
    session_id: targetSessionId,
    now_ms: context.now_ms,
  });

  if (original === null) {
    return { found: false };
  }

  return {
    found: true,
    tool_use_id: original.tool_use_id,
    original_text: original.original_text,
    original_tokens: original.original_tokens,
  };
}
