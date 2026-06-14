import { readFileSync } from "node:fs";
import type { BilledTokens } from "./pricing.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function extractBilledUsage(transcriptPath: string): BilledTokens {
  const totals: BilledTokens = {
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };

  const lines = readFileSync(transcriptPath, "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || parsed.type !== "assistant") continue;
    const message = isRecord(parsed.message) ? parsed.message : undefined;
    const usage = message && isRecord(message.usage) ? message.usage : undefined;
    if (!usage) continue;
    totals.input_tokens += num(usage.input_tokens);
    totals.cache_read_tokens += num(usage.cache_read_input_tokens);
    totals.cache_creation_tokens += num(usage.cache_creation_input_tokens);
  }

  return totals;
}
