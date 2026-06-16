import { z } from "zod";
import type { CachelaneMcpContext } from "./tools.js";
import { computeFallbackRate } from "../cli/doctor.js";

export const healthInputSchema = z.object({});

export type HealthToolInput = z.input<typeof healthInputSchema>;

export interface HealthStatus {
  status: "ok" | "degraded";
  explanation: string;
}

export function handleHealthTool(
  context: CachelaneMcpContext,
  rawInput: HealthToolInput,
): HealthStatus {
  healthInputSchema.parse(rawInput);
  
  const recentExplanations = context.db.getRecentTurnExplanations({
    workspace_id: context.workspace_id,
    limit: 20,
  });

  const { fallback_count, total, fraction } = computeFallbackRate(recentExplanations);
  if (total === 0) {
    return {
      status: "ok",
      explanation: "0 of the last 0 turns in the current session used fallback mode.",
    };
  }

  const status = fraction > 0.05 ? "degraded" : "ok";
  const explanation = `${fallback_count} of the last ${total} workspace turns used fallback mode.`;

  return {
    status,
    explanation,
  };
}
