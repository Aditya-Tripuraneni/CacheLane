import { PRICES } from "./prices.js";
import type { ApiCall } from "./types.js";

export const WRITE_5M = 1.25;
export const WRITE_1H = 2;

/** Longest price-table key the model id starts with (handles Bedrock prefixes and [1m] suffixes). */
export function priceFor(model: string): { input: number; read?: number } | undefined {
  const at = model.indexOf("claude-");
  const id = at >= 0 ? model.slice(at) : model;
  let best: string | undefined;
  for (const key of Object.keys(PRICES)) {
    if (id.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? PRICES[best] : undefined;
}

export function readMultiplier(model: string): number {
  const p = priceFor(model);
  return p?.read !== undefined ? p.read / p.input : 0.1;
}

/** Input cost in units: tokens weighted by price multiplier relative to base input. */
export function units(c: ApiCall): number {
  return c.input + c.read * readMultiplier(c.model) + writeUnits(c);
}

export function writeUnits(c: ApiCall): number {
  return c.write5m * WRITE_5M + c.write1h * WRITE_1H;
}

/** Dollars at API list price, or undefined for an unpriced model. */
export function toDollars(unitCount: number, model: string): number | undefined {
  const p = priceFor(model);
  return p ? (unitCount * p.input) / 1_000_000 : undefined;
}
