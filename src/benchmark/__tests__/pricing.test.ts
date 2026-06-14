import { describe, expect, it } from "vitest";
import { priceUsd, SONNET_PRICING } from "../pricing.js";

describe("priceUsd", () => {
  it("prices plain input tokens at $3 / Mtok", () => {
    expect(priceUsd({ input_tokens: 1_000_000, cache_read_tokens: 0, cache_creation_tokens: 0 }))
      .toBeCloseTo(3.0, 6);
  });

  it("prices cache reads at $0.30 / Mtok", () => {
    expect(priceUsd({ input_tokens: 0, cache_read_tokens: 1_000_000, cache_creation_tokens: 0 }))
      .toBeCloseTo(0.3, 6);
  });

  it("prices cache writes at $3.75 / Mtok", () => {
    expect(priceUsd({ input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 1_000_000 }))
      .toBeCloseTo(3.75, 6);
  });

  it("exposes raw per-token constants", () => {
    expect(SONNET_PRICING.input).toBeCloseTo(3 / 1_000_000, 12);
  });
});
