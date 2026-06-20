import type { CompressionMode } from "./types.js";

function pruneValue(value: unknown, maxArrayItems: number): unknown {
  if (value === null || value === undefined) return undefined;

  if (Array.isArray(value)) {
    const filtered = value
      .map((item) => pruneValue(item, maxArrayItems))
      .filter((v) => v !== undefined);
    if (filtered.length === 0) return undefined;
    if (filtered.length > maxArrayItems) {
      const remaining = filtered.length - maxArrayItems;
      return [...filtered.slice(0, maxArrayItems), `[... ${remaining} more items]`];
    }
    return filtered;
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const pruned = pruneValue(v, maxArrayItems);
      if (pruned !== undefined) result[k] = pruned;
    }
    if (Object.keys(result).length === 0) return undefined;
    return result;
  }

  return value;
}

/**
 * Minify and prune a JSON string.
 * Removes null values, empty arrays, and empty objects at all depths.
 * Truncates arrays longer than maxArrayItems.
 * Throws if input is not valid JSON.
 */
export function compressJson(
  text: string,
  maxArrayItems: number,
  mode: CompressionMode = "aggressive",
): string {
  const parsed: unknown = JSON.parse(text); // throws on invalid input
  if (mode === "lossless") {
    return JSON.stringify(parsed);
  }

  const effectiveMaxArrayItems =
    mode === "balanced" ? Number.MAX_SAFE_INTEGER : maxArrayItems;
  const pruned = pruneValue(parsed, effectiveMaxArrayItems);
  if (pruned === undefined) {
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      return JSON.stringify(parsed);
    }
    return JSON.stringify({});
  }
  return JSON.stringify(pruned);
}
