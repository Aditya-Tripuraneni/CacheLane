import type { BlockKind } from "../types/index.js";
import type { ClassifierConfig, UnclassifiedBlock } from "./types.js";
import { globMatch } from "./glob.js";

export type RuleResult = { kind: BlockKind; signals: string[] };

type Rule = (
  input: UnclassifiedBlock,
  config: ClassifierConfig,
) => RuleResult | null;

const PROJECT_RULES_PATTERNS = [
  "**/.cursorrules",
  "**/.rules.md",
  "**/AGENTS.md",
];

const RETRIEVAL_TOOLS = new Set(["Grep", "Glob", "WebSearch", "WebFetch"]);

const stubRule: Rule = (i) =>
  i.kindHint === "stub"
    ? { kind: "stub", signals: ["stub:passthrough"] }
    : null;

const claudeMdRule: Rule = (i) =>
  i.filePath && globMatch("**/CLAUDE.md", i.filePath)
    ? { kind: "claude_md", signals: ["claude_md"] }
    : null;

const projectRulesRule: Rule = (i) =>
  i.filePath && PROJECT_RULES_PATTERNS.some((p) => globMatch(p, i.filePath!))
    ? { kind: "project_rules", signals: ["project_rules"] }
    : null;

const systemPromptRule: Rule = (i) =>
  i.role === "system" && !i.filePath && i.turnNumber === 0
    ? { kind: "system_prompt", signals: ["system_prompt"] }
    : null;

const toolSchemaRule: Rule = (i) =>
  i.kindHint === "tool_schema"
    ? { kind: "tool_schema", signals: ["tool_schema"] }
    : null;

const fileReadRule: Rule = (i) =>
  i.toolName === "Read" && i.filePath && typeof i.mtimeMs === "number"
    ? { kind: "file_read", signals: ["file_read"] }
    : null;

const toolUseResultPairRule: Rule = (i) =>
  i.isToolUseResultPair === true
    ? {
        kind: "tool_use_result_pair",
        signals: ["tool_use_result_pair"],
      }
    : null;

const priorTurnRule: Rule = (i, c) => {
  const isTurnRole = i.role === "user" || i.role === "assistant";
  const distance = i.currentTurn - i.turnNumber;
  if (isTurnRole && distance > 0 && distance < c.sliding_window_turns) {
    return { kind: "prior_turn", signals: ["prior_turn"] };
  }
  return null;
};

const retrievalResultRule: Rule = (i) =>
  i.toolName && RETRIEVAL_TOOLS.has(i.toolName)
    ? { kind: "retrieval_result", signals: ["retrieval_result"] }
    : null;

const toolOutputRule: Rule = (i) =>
  i.role === "tool"
    ? { kind: "tool_output", signals: ["tool_output"] }
    : null;

const userMessageRule: Rule = (i) =>
  i.role === "user" && i.turnNumber === i.currentTurn
    ? { kind: "user_message", signals: ["user_message"] }
    : null;

const RULES: Rule[] = [
  stubRule,
  claudeMdRule,
  projectRulesRule,
  systemPromptRule,
  toolSchemaRule,
  fileReadRule,
  toolUseResultPairRule,
  priorTurnRule,
  retrievalResultRule,
  toolOutputRule,
  userMessageRule,
];

export function runRules(
  input: UnclassifiedBlock,
  config: ClassifierConfig,
): RuleResult | null {
  for (const rule of RULES) {
    const result = rule(input, config);
    if (result) return result;
  }
  return null;
}

export const DEFAULT_FALLBACK: RuleResult = {
  kind: "user_message",
  signals: ["fallback:default"],
};
