import type { Volatility } from "../types/index.js";
import type {
  Classification,
  ClassifierConfig,
  Signal,
  UnclassifiedBlock,
} from "./types.js";
import { DEFAULT_FALLBACK, runRules } from "./rules.js";
import { KIND_TO_VOLATILITY, PIN_VOLATILITY } from "./volatility-map.js";
import { globMatch } from "./glob.js";

export type {
  Classification,
  ClassifierConfig,
  Signal,
  UnclassifiedBlock,
} from "./types.js";

function makeErrorFallback(): Classification {
  return {
    kind: "user_message",
    volatility: "VOLATILE",
    isPinned: false,
    signals: ["error:fallback"],
  };
}

export function classifyBlock(
  input: UnclassifiedBlock,
  config: ClassifierConfig,
): Classification | null {
  try {
    const fp = input.filePath;

    if (fp && config.exclude.some((p) => globMatch(p, fp))) {
      return null;
    }

    const ruled = runRules(input, config) ?? DEFAULT_FALLBACK;

    // Stubs inherit the volatility of the block they replaced so cache-
    // breakpoint positions stay stable across the M5 prune-and-restore
    // cycle. The KIND_TO_VOLATILITY map intentionally does NOT include
    // a stub entry — the type narrows it away.
    let volatility: Volatility =
      ruled.kind === "stub"
        ? (input.incomingVolatility ?? "STABLE")
        : KIND_TO_VOLATILITY[ruled.kind];

    const signals: Signal[] = [...ruled.signals];
    let isPinned = false;

    if (fp && config.pin.some((p) => globMatch(p, fp))) {
      isPinned = true;
      volatility = PIN_VOLATILITY;
      signals.push("pin:match");
    }

    return {
      kind: ruled.kind,
      volatility,
      isPinned,
      signals,
    };
  } catch (err) {
    // classifyBlock must never throw; log and fail-open. M7 will swap
    // console for the project's structured logger so ops can alert on
    // `error:fallback` signal rate.
    console.error("[cachelane] classifyBlock error", err);
    return makeErrorFallback();
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
