// scripts/corpus/judge.ts
//
// Layer 2: the LLM judge labels the residual (turn, block) pairs that mechanical
// labeling left undecided — the "did the assistant conceptually use this without
// quoting an id or calling a tool" cases. Runs unattended.
//
// The judge is a ONE-TIME labeling tool. Its output gets frozen into the corpus
// fixture; it never runs in CI. CI runs the deterministic detector against the
// frozen labels.
//
// Requires either ANTHROPIC_API_KEY or GLM_API_KEY/ZAI_API_KEY in env. Model is
// configurable; a strong model is worth it here since these are the hard cases.
// Drop to a cheaper model only if the calibration report (build-corpus
// --calibrate) shows it still agrees with your human anchor set at >90%.

import Anthropic from "@anthropic-ai/sdk";
import type { BlockLabel, CorpusBlock, CorpusTurn } from "./types.js";

type JudgeProvider = "anthropic" | "glm";

const PROVIDER: JudgeProvider =
  (process.env.CORPUS_JUDGE_PROVIDER as JudgeProvider | undefined) ??
  (process.env.GLM_API_KEY || process.env.ZAI_API_KEY ? "glm" : "anthropic");
const ANTHROPIC_MODEL = process.env.CORPUS_JUDGE_MODEL ?? "claude-opus-4-7";
const GLM_MODEL = process.env.CORPUS_GLM_MODEL ?? process.env.CORPUS_JUDGE_MODEL ?? "glm-5.1";
const GLM_BASE_URL =
  process.env.GLM_BASE_URL ?? process.env.ZAI_BASE_URL ?? "https://api.z.ai/api/paas/v4";
const MAX_BLOCK_CHARS = 1500; // truncate long blocks to bound judge token cost

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

const SYSTEM = [
  "You label whether a coding assistant's response USED a given context block.",
  "USED means: the response read from, reasoned about, quoted, edited, or relied",
  "on the block's content to produce its answer — including deciding NOT to change",
  "it after considering it. NOT USED means the block was merely present in context",
  "but irrelevant to this particular response. Be strict: mere presence is not use.",
  "Output ONLY valid JSON, no prose, no markdown fences.",
].join(" ");

function truncate(s: string): string {
  return s.length > MAX_BLOCK_CHARS ? s.slice(0, MAX_BLOCK_CHARS) + "…[truncated]" : s;
}

function buildPrompt(turn: CorpusTurn, residual: CorpusBlock[]): string {
  const toolSummary = turn.tool_calls
    .map((t) => `- ${t.name}(${JSON.stringify(t.input).slice(0, 200)})`)
    .join("\n");

  const blockList = residual
    .map(
      (b) =>
        `--- block ${b.id} (kind=${b.kind}${b.file_path ? `, path=${b.file_path}` : ""}) ---\n${truncate(
          b.content,
        )}`,
    )
    .join("\n\n");

  return [
    "ASSISTANT RESPONSE (text):",
    turn.assistant_text || "(no text)",
    "",
    "ASSISTANT TOOL CALLS:",
    toolSummary || "(none)",
    "",
    "CANDIDATE BLOCKS (decide referenced true/false for each):",
    blockList,
    "",
    'Return JSON of the exact shape: {"<block_id>": {"referenced": boolean, "reason": "<=12 words"}}',
    "Include every candidate block id as a key. JSON only.",
  ].join("\n");
}

function parseJudge(text: string): Record<string, { referenced: boolean; reason: string }> {
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

function glmChatCompletionsUrl(): string {
  const trimmed = GLM_BASE_URL.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions")
    ? trimmed
    : `${trimmed}/chat/completions`;
}

async function callAnthropicJudge(prompt: string): Promise<string> {
  const resp = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  return resp.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");
}

async function callGlmJudge(prompt: string): Promise<string> {
  const apiKey = process.env.GLM_API_KEY ?? process.env.ZAI_API_KEY;
  if (!apiKey) {
    throw new Error("GLM judge selected but GLM_API_KEY or ZAI_API_KEY is not set");
  }

  const resp = await fetch(glmChatCompletionsUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GLM_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
      stream: false,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GLM judge request failed (${resp.status}): ${body.slice(0, 500)}`);
  }

  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

async function callJudge(prompt: string): Promise<string> {
  return PROVIDER === "glm" ? callGlmJudge(prompt) : callAnthropicJudge(prompt);
}

/** Label one turn's residual blocks. Returns judge labels for that turn. */
export async function judgeTurn(turn: CorpusTurn, residual: CorpusBlock[]): Promise<BlockLabel[]> {
  if (residual.length === 0) return [];

  const text = await callJudge(buildPrompt(turn, residual));

  let verdicts: Record<string, { referenced: boolean; reason: string }>;
  try {
    verdicts = parseJudge(text);
  } catch {
    // Conservative fallback: if the judge output is unparseable, mark residual
    // as NOT referenced and flag the reason, rather than crashing the run.
    return residual.map((b) => ({
      turn_number: turn.turn_number,
      block_id: b.id,
      referenced: false,
      source: "judge" as const,
      reason: "judge-output-unparseable",
    }));
  }

  return residual.map((b) => {
    const v = verdicts[b.id];
    return {
      turn_number: turn.turn_number,
      block_id: b.id,
      referenced: v?.referenced ?? false,
      source: "judge" as const,
      reason: v?.reason ?? "missing-from-judge-output",
    };
  });
}
