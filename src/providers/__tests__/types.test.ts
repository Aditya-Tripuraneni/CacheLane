import { describe, it, expect } from "vitest";
import type { ProviderAdapter, NeutralUsage } from "../types.js";

describe("ProviderAdapter contract", () => {
  it("a minimal conforming adapter type-checks and routes", () => {
    const stub: ProviderAdapter = {
      name: "stub",
      matchRoute: (m, p) => m === "POST" && p === "/v1/x",
      normalizeRequest: (b) => ({ system: [], tools: [], messages: [], model: "m", raw: b }),
      denormalize: (n) => n.raw,
      applyCacheHints: (req) => req,
      cachePolicy: { tiers: [], supportsKeepalive: false, discountFactor: 0.5 },
      parseUsage: (): NeutralUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0 }),
      tokenizer: { count: () => 0, name: "stub" },
      costModel: { effectiveUnits: () => 0 },
    };
    expect(stub.matchRoute("POST", "/v1/x")).toBe(true);
    expect(stub.matchRoute("GET", "/v1/x")).toBe(false);
  });
});
