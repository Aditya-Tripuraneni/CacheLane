import { describe, expect, it } from "vitest";
import { compressJson } from "../json-compress.js";

describe("compressJson modes", () => {
  it("lossless mode minifies without changing parsed JSON", () => {
    const input = JSON.stringify(
      {
        a: null,
        b: [],
        c: {},
        d: [1, null, 3],
        e: { nested: null, keep: true },
      },
      null,
      2,
    );

    const result = compressJson(input, 20, "lossless");

    expect(JSON.parse(result)).toEqual(JSON.parse(input));
    expect(result).not.toContain("\n");
  });

  it("lossless mode preserves long arrays", () => {
    const input = JSON.stringify({ items: Array.from({ length: 25 }, (_, i) => i) });
    const result = compressJson(input, 20, "lossless");
    expect((JSON.parse(result) as { items: unknown[] }).items).toHaveLength(25);
  });

  it("aggressive mode keeps current null pruning behavior", () => {
    const input = JSON.stringify({ a: null, b: [], c: {}, d: 1 });
    const result = compressJson(input, 20, "aggressive");
    expect(JSON.parse(result)).toEqual({ d: 1 });
  });

  it("balanced mode prunes nulls and empties but preserves long arrays", () => {
    const input = JSON.stringify({
      items: Array.from({ length: 25 }, (_, i) => ({ id: i, empty: null })),
      empty: {},
    });
    const result = compressJson(input, 20, "balanced");
    const parsed = JSON.parse(result) as { items: Array<{ id: number }> };

    expect(parsed.items).toHaveLength(25);
    expect(parsed.items[0]).toEqual({ id: 0 });
    expect(parsed).not.toHaveProperty("empty");
  });
});
