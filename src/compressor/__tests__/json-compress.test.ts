import { describe, expect, it } from "vitest";
import { compressJson } from "../json-compress.js";

describe("compressJson", () => {
  it("removes null-valued keys", () => {
    const input = JSON.stringify({ a: 1, b: null, c: "hello" });
    const result = compressJson(input, 20);
    expect(JSON.parse(result)).toEqual({ a: 1, c: "hello" });
  });

  it("removes empty arrays", () => {
    const input = JSON.stringify({ a: 1, b: [] });
    const result = compressJson(input, 20);
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it("removes empty objects", () => {
    const input = JSON.stringify({ a: 1, b: {} });
    const result = compressJson(input, 20);
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it("removes undefined values at all depths", () => {
    const input = JSON.stringify({ a: { b: null, c: 2 } });
    const result = compressJson(input, 20);
    expect(JSON.parse(result)).toEqual({ a: { c: 2 } });
  });

  it("truncates arrays longer than maxArrayItems", () => {
    const arr = Array.from({ length: 25 }, (_, i) => i);
    const input = JSON.stringify({ items: arr });
    const result = compressJson(input, 20);
    const parsed = JSON.parse(result) as { items: unknown[] };
    expect(parsed.items).toHaveLength(21); // 20 items + truncation marker
    expect(parsed.items[20]).toMatch(/more items/);
  });

  it("does not truncate arrays at or below maxArrayItems", () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const input = JSON.stringify({ items: arr });
    const result = compressJson(input, 20);
    const parsed = JSON.parse(result) as { items: number[] };
    expect(parsed.items).toHaveLength(20);
  });

  it("produces valid JSON output", () => {
    const input = JSON.stringify({ a: null, b: [1, 2, 3], c: { d: null } });
    const result = compressJson(input, 20);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("preserves strings, numbers, and booleans", () => {
    const input = JSON.stringify({ s: "hello", n: 42, b: true, f: false });
    const result = compressJson(input, 20);
    expect(JSON.parse(result)).toEqual({ s: "hello", n: 42, b: true, f: false });
  });

  it("minifies whitespace (no spaces in output)", () => {
    const input = JSON.stringify({ a: 1 }, null, 2); // pretty-printed
    const result = compressJson(input, 20);
    expect(result).not.toContain("  ");
  });

  it("returns object with all-null keys as empty object marker", () => {
    const input = JSON.stringify({ a: null, b: null });
    const result = compressJson(input, 20);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({});
  });

  it("preserves top-level arrays", () => {
    const input = JSON.stringify([1, null, 3]);
    const result = compressJson(input, 20);
    expect(JSON.parse(result)).toEqual([1, 3]);
  });

  it("preserves top-level null", () => {
    const result = compressJson("null", 20);
    expect(result).toBe("null");
  });

  it("throws on invalid JSON input", () => {
    expect(() => compressJson("not json", 20)).toThrow();
  });
});
