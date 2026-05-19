import type { BlockKind } from "../types/index.js";
import type {
  ClassifierConfig,
  Signal,
  UnclassifiedBlock,
} from "./types.js";
import { globMatch } from "./glob.js";

export type RuleResult = { kind: BlockKind; signals: Signal[] };

type Rule = (
  block: UnclassifiedBlock,
  config: ClassifierConfig,
) => RuleResult | null;

const PROJECT_RULES_PATTERNS = [
  "**/.cursorrules",
  "**/.rules.md",
  "**/AGENTS.md",
];

const RETRIEVAL_TOOLS = new Set(["Grep", "Glob", "WebSearch", "WebFetch"]);

const INITIAL_TURN = 0;

const stubRule: Rule = (block) =>
  block.kindHint === "stub"
    ? { kind: "stub", signals: ["stub:passthrough"] }
    : null;

const claudeMdRule: Rule = (block) => {
  const fp = block.filePath;
  return fp && globMatch("**/CLAUDE.md", fp)
    ? { kind: "claude_md", signals: ["claude_md"] }
    : null;
};

const projectRulesRule: Rule = (block) => {
  const fp = block.filePath;
  return fp && PROJECT_RULES_PATTERNS.some((p) => globMatch(p, fp))
    ? { kind: "project_rules", signals: ["project_rules"] }
    : null;
};

const systemPromptRule: Rule = (block) =>
  block.role === "system" &&
  !block.filePath &&
  block.turnNumber === INITIAL_TURN
    ? { kind: "system_prompt", signals: ["system_prompt"] }
    : null;

const toolSchemaRule: Rule = (block) =>
  block.kindHint === "tool_schema"
    ? { kind: "tool_schema", signals: ["tool_schema"] }
    : null;

const fileReadRule: Rule = (block) =>
  block.toolName === "Read" &&
  block.filePath &&
  typeof block.mtimeMs === "number"
    ? { kind: "file_read", signals: ["file_read"] }
    : null;

const toolUseResultPairRule: Rule = (block) =>
  block.isToolUseResultPair === true
    ? {
        kind: "tool_use_result_pair",
        signals: ["tool_use_result_pair"],
      }
    : null;

const priorTurnRule: Rule = (block, config) => {
  const isTurnRole = block.role === "user" || block.role === "assistant";
  const distance = block.currentTurn - block.turnNumber;
  if (
    isTurnRole &&
    distance > 0 &&
    distance < config.sliding_window_turns
  ) {
    return { kind: "prior_turn", signals: ["prior_turn"] };
  }
  return null;
};

const retrievalResultRule: Rule = (block) =>
  block.toolName && RETRIEVAL_TOOLS.has(block.toolName)
    ? { kind: "retrieval_result", signals: ["retrieval_result"] }
    : null;

const toolOutputRule: Rule = (block) =>
  block.role === "tool"
    ? { kind: "tool_output", signals: ["tool_output"] }
    : null;

const userMessageRule: Rule = (block) =>
  block.role === "user" && block.turnNumber === block.currentTurn
    ? { kind: "user_message", signals: ["user_message"] }
    : null;

// Rule priority: first match wins. Order is intentional — do not reorder
// without updating tests AND the design docs that anchor each rule.
//
//  1. stubRule              — stub identity is set externally; no content
//                             rule may override it.
//  2. claudeMdRule          — MUST precede fileReadRule: a CLAUDE.md read
//                             via toolName=Read must stay STABLE (not
//                             SEMI). Swapping these two silently breaks
//                             the cache prefix.
//  3. projectRulesRule      — path-based, STABLE; before structural rules
//                             for the same reason as #2.
//  4. systemPromptRule      — role=system is unambiguous; early exit
//                             before generic role checks.
//  5. toolSchemaRule        — kindHint fast-path (no content sniffing);
//                             before file/tool rules so a Read result
//                             whose content happens to be a JSON schema
//                             is NOT misclassified as STABLE.
//  6. fileReadRule          — Read + filePath + mtimeMs = stable file
//                             context (SEMI). Conservative degradation:
//                             missing mtime falls through to tool_output.
//  7. toolUseResultPairRule — atomic pair; before the generic role=tool
//                             catch-all so the pair is moved as one unit
//                             (ADR-006).
//  8. priorTurnRule         — sliding-window prior turns (SEMI); before
//                             the current-turn user check.
//  9. retrievalResultRule   — named retrieval tools (VOLATILE).
// 10. toolOutputRule        — catch-all for role=tool not caught above.
// 11. userMessageRule       — current user turn only; earlier user turns
//                             are caught by priorTurnRule.
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

// Frozen so a caller that takes a reference and mutates `.signals` cannot
// corrupt every subsequent classification. The signals array itself is
// also frozen — callers must spread to mutate.
export const DEFAULT_FALLBACK: RuleResult = Object.freeze({
  kind: "user_message" as BlockKind,
  signals: Object.freeze(["fallback:default"]) as unknown as Signal[],
}) as RuleResult;
