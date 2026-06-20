import { describe, expect, it } from "vitest";
import { compressLog } from "../log-compress.js";

describe("compressLog", () => {
  it("keeps ERROR lines", () => {
    const input = "INFO: starting\nERROR: something failed\nINFO: done";
    const result = compressLog(input);
    expect(result).toContain("ERROR: something failed");
  });

  it("keeps WARN lines", () => {
    const input = "DEBUG: connecting\nWARN: retrying\nDEBUG: ok";
    const result = compressLog(input);
    expect(result).toContain("WARN: retrying");
  });

  it("keeps FATAL lines", () => {
    const input = "INFO: boot\nFATAL: out of memory\nINFO: crashed";
    const result = compressLog(input);
    expect(result).toContain("FATAL: out of memory");
  });

  it("keeps stack frame lines (at ...)", () => {
    const input = "Error: boom\n    at Object.<anonymous> (index.js:5:10)\nINFO: done";
    const result = compressLog(input);
    expect(result).toContain("at Object.<anonymous>");
  });

  it("keeps FAIL lines (test runner output)", () => {
    const input = "PASS src/foo.ts\nFAIL src/bar.ts\nINFO: done";
    const result = compressLog(input);
    expect(result).toContain("FAIL src/bar.ts");
  });

  it("keeps lines containing 'expected' or 'received'", () => {
    const input = "running tests\nexpected: 1\nreceived: 2\nall done";
    const result = compressLog(input);
    expect(result).toContain("expected: 1");
    expect(result).toContain("received: 2");
  });

  it("keeps first and last line always", () => {
    const input = "FIRST LINE\nINFO: ignored\nINFO: also ignored\nLAST LINE";
    const result = compressLog(input);
    expect(result).toContain("FIRST LINE");
    expect(result).toContain("LAST LINE");
  });

  it("drops pure INFO/DEBUG lines that match no pattern", () => {
    const input = "FIRST\nINFO: verbose stuff\nDEBUG: more verbose\nLAST";
    const result = compressLog(input);
    expect(result).not.toContain("INFO: verbose stuff");
    expect(result).not.toContain("DEBUG: more verbose");
  });

  it("never returns an empty string even if all lines are filtered", () => {
    const input = "INFO: a\nINFO: b\nINFO: c";
    const result = compressLog(input);
    expect(result.length).toBeGreaterThan(0);
  });

  it("deduplicates repeated kept lines", () => {
    const input = "FIRST\nERROR: boom\nERROR: boom\nLAST";
    const result = compressLog(input);
    const lines = result.split("\n");
    const errorLines = lines.filter((l) => l === "ERROR: boom");
    expect(errorLines.length).toBe(1);
  });

  it("handles single-line input", () => {
    const result = compressLog("only line");
    expect(result).toBe("only line");
  });

  it("handles empty string input", () => {
    const result = compressLog("");
    expect(result).toBe("");
  });
});
