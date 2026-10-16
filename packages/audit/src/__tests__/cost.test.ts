import { describe, expect, it } from "vitest";
import { priceFor, readMultiplier, toDollars, units } from "../cost.js";

describe("priceFor", () => {
  it.each([
    ["claude-opus-5-5", 4],
    ["claude-sonnet-5-5", 2],
    ["claude-sonnet-5", 2],
    ["claude-opus-5-5[1m]", 4],
    ["us.anthropic.claude-sonnet-4-6", 3],
  ])("%s -> $%s/MTok input", (model, input) => {
    expect(priceFor(model)?.input).toBe(input);
  });

  it("is undefined for unknown models", () => {
    expect(priceFor("gpt-x")).toBeUndefined();
  });
});

describe("readMultiplier", () => {
  it.each([
    ["claude-opus-5-5", 0.05],
    ["claude-fable-5-1", 0.025],
    ["claude-sonnet-5-5", 0.1],
    ["claude-sonnet-4-6", 0.1],
    ["unknown", 0.1],
  ])("%s -> %s", (model, mult) => {
    expect(readMultiplier(model)).toBeCloseTo(mult, 10);
  });
});

describe("units", () => {
  it("weights input 1x, reads by model, 5m writes 1.25x, 1h writes 2x", () => {
    const c = { id: "x", model: "claude-opus-5-5", ts: 0, input: 10, read: 1000, write5m: 100, write1h: 100 };
    expect(units(c)).toBeCloseTo(10 + 50 + 125 + 200, 10);
  });
});

describe("toDollars", () => {
  it("prices units at the model's base input rate", () => {
    expect(toDollars(1_000_000, "claude-opus-5-5")).toBeCloseTo(4, 10);
  });

  it("is undefined for unpriced models", () => {
    expect(toDollars(1, "gpt-x")).toBeUndefined();
  });
});
