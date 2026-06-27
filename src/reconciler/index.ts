import type {
  TurnExplanationUsage,
  TurnExplanationBlockMetadata,
  RegionCostBreakdown,
  TokenTier
} from "../storage/types.js";

export interface BreakpointState {
  prefix_breakpoint_hash: string | null;
  middle_breakpoint_hash: string | null;
}

export function reconcileTurnCost(
  usage: TurnExplanationUsage,
  blockMetadata: TurnExplanationBlockMetadata[],
  currentBreakpoints: BreakpointState,
  previousBreakpoints: BreakpointState | null
): RegionCostBreakdown {
  // Determine theoretical tiers for each region based on breakpoints
  let stableTier: TokenTier = "cache_creation";
  if (
    currentBreakpoints.prefix_breakpoint_hash &&
    previousBreakpoints?.prefix_breakpoint_hash &&
    currentBreakpoints.prefix_breakpoint_hash === previousBreakpoints.prefix_breakpoint_hash
  ) {
    stableTier = "cache_read";
  } else if (usage.cache_creation_1h_tokens > 0) {
    stableTier = "cache_creation_1h";
  } else if (usage.cache_creation_5m_tokens > 0) {
    stableTier = "cache_creation_5m";
  }

  let semiTier: TokenTier = "input";
  if (!currentBreakpoints.middle_breakpoint_hash) {
    semiTier = "input";
  } else if (
    previousBreakpoints?.middle_breakpoint_hash &&
    currentBreakpoints.middle_breakpoint_hash === previousBreakpoints.middle_breakpoint_hash
  ) {
    semiTier = "cache_read";
  } else {
    semiTier = "cache_creation_5m";
  }



  // Distribute exact API tokens based on the identified tiers
  // 1. Distribute cache_read tokens
  let remainingRead = usage.cache_read_tokens;
  let stableRead = 0;
  let semiRead = 0;
  
  if (stableTier === "cache_read" && semiTier === "cache_read") {
    // Both hit. We don't have block-level weighting for user messages, but we can just
    // split proportionally based on metadata token counts if we wanted. But an easier
    // exact heuristic is: STABLE gets cache_read up to its theoretical size, SEMI gets the rest.
    // Actually, just using API tokens is better. Let's compute weights.
    let stableWeight = blockMetadata.filter(b => b.volatility === "STABLE").reduce((sum, b) => sum + b.token_count, 0);
    let semiWeight = blockMetadata.filter(b => b.volatility === "SEMI").reduce((sum, b) => sum + b.token_count, 0);
    if (stableWeight + semiWeight === 0) { stableWeight = 1; }
    stableRead = Math.round(remainingRead * (stableWeight / (stableWeight + semiWeight)));
    semiRead = remainingRead - stableRead;
  } else if (stableTier === "cache_read") {
    stableRead = remainingRead;
  } else if (semiTier === "cache_read") {
    semiRead = remainingRead;
  }

  // 2. Distribute cache_creation tokens
  let remainingCreate5m = usage.cache_creation_5m_tokens;
  let remainingCreate1h = usage.cache_creation_1h_tokens;
  let stableCreate5m = 0, stableCreate1h = 0;
  let semiCreate5m = 0;

  if (stableTier.startsWith("cache_creation")) {
    stableCreate1h = remainingCreate1h;
    remainingCreate1h = 0;
    // If stable still needs more, it might dip into 5m
    if (semiTier !== "cache_creation_5m") {
      stableCreate5m = remainingCreate5m;
      remainingCreate5m = 0;
    } else {
      // Both need creation 5m? Unlikely but possible.
      // Give stable the 1h, semi the 5m.
      if (stableTier === "cache_creation_5m") {
         let stableWeight = blockMetadata.filter(b => b.volatility === "STABLE").reduce((sum, b) => sum + b.token_count, 0);
         let semiWeight = blockMetadata.filter(b => b.volatility === "SEMI").reduce((sum, b) => sum + b.token_count, 0);
         if (stableWeight + semiWeight === 0) { stableWeight = 1; }
         stableCreate5m = Math.round(remainingCreate5m * (stableWeight / (stableWeight + semiWeight)));
      }
    }
  }

  if (semiTier === "cache_creation_5m") {
    semiCreate5m = remainingCreate5m;
    remainingCreate5m = 0;
  }

  // 3. Distribute input tokens
  let remainingInput = usage.input_tokens;
  let semiInput = 0;
  let volatileInput = 0;

  if (semiTier === "input") {
    // SEMI and VOLATILE both share input tokens
    let semiWeight = blockMetadata.filter(b => b.volatility === "SEMI").reduce((sum, b) => sum + b.token_count, 0);
    // Volatile includes user messages which aren't in blockMetadata. So we just give SEMI its exact block weight
    // and VOLATILE gets the rest.
    semiInput = Math.min(remainingInput, semiWeight);
    volatileInput = remainingInput - semiInput;
  } else {
    volatileInput = remainingInput;
  }

  // Compile final breakdown
  const stableTokens = stableRead + stableCreate5m + stableCreate1h;
  const stableFinalTier = stableRead > 0 ? "cache_read" : (stableCreate1h > 0 ? "cache_creation_1h" : "cache_creation_5m");
  const stableCost = (stableRead * 0.1) + (stableCreate5m * 1.25) + (stableCreate1h * 2.0);

  const semiTokens = semiRead + semiCreate5m + semiInput;
  const semiFinalTier = semiRead > 0 ? "cache_read" : (semiCreate5m > 0 ? "cache_creation_5m" : "input");
  const semiCost = (semiRead * 0.1) + (semiCreate5m * 1.25) + (semiInput * 1.0);

  const volatileCost = volatileInput * 1.0;

  return {
    stable: { tokens: stableTokens, tier: stableFinalTier, cost_units: stableCost },
    semi: { tokens: semiTokens, tier: semiFinalTier, cost_units: semiCost },
    volatile: { tokens: volatileInput, tier: "input", cost_units: volatileCost }
  };
}
