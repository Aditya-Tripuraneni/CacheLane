import type { BlockKind, Volatility } from "../types/index.js";

export type UnclassifiedBlock = {
  content: string;
  role?: "system" | "user" | "assistant" | "tool";
  kindHint?: BlockKind;
  incomingVolatility?: Volatility;
  filePath?: string;
  mtimeMs?: number;
  toolName?: string;
  isToolUseResultPair?: boolean;
  turnNumber: number;
  currentTurn: number;
};

export type Classification = {
  kind: BlockKind;
  volatility: Volatility;
  is_pinned: boolean;
  signals: string[];
};

export type ClassifierConfig = {
  pin: string[];
  exclude: string[];
  sliding_window_turns: number;
};
