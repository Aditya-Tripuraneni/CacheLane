import type { Volatility } from "../types/index.js";
import type {
  Classification,
  ClassifierConfig,
  UnclassifiedBlock,
} from "./types.js";
import { DEFAULT_FALLBACK, runRules } from "./rules.js";
import { KIND_TO_VOLATILITY, promoteForPin } from "./volatility-map.js";
import { globMatch } from "./glob.js";

export type {
  Classification,
  ClassifierConfig,
  UnclassifiedBlock,
} from "./types.js";

const ERROR_FALLBACK: Classification = {
  kind: "user_message",
  volatility: "VOLATILE",
  is_pinned: false,
  signals: ["error:fallback"],
};

export function classifyBlock(
  input: UnclassifiedBlock,
  config: ClassifierConfig,
): Classification | null {
  try {
    if (
      input.filePath &&
      config.exclude.some((p) => globMatch(p, input.filePath!))
    ) {
      return null;
    }

    const ruled = runRules(input, config) ?? DEFAULT_FALLBACK;

    let volatility: Volatility =
      ruled.kind === "stub"
        ? (input.incomingVolatility ?? "STABLE")
        : KIND_TO_VOLATILITY[ruled.kind];

    const signals = [...ruled.signals];
    let is_pinned = false;

    if (
      input.filePath &&
      config.pin.some((p) => globMatch(p, input.filePath!))
    ) {
      is_pinned = true;
      volatility = promoteForPin();
      signals.push("pin:match");
    }

    return {
      kind: ruled.kind,
      volatility,
      is_pinned,
      signals,
    };
  } catch {
    return ERROR_FALLBACK;
  }
}

export function classifyBlocks(
  inputs: UnclassifiedBlock[],
  config: ClassifierConfig,
): Classification[] {
  return inputs
    .map((input) => classifyBlock(input, config))
    .filter((c): c is Classification => c !== null);
}
