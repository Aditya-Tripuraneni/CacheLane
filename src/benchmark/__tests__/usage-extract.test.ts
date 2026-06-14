import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractBilledUsage } from "../usage-extract.js";

const ASSISTANT_A = JSON.stringify({
  type: "assistant",
  message: { role: "assistant", usage: {
    input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 5,
  } },
});
const ASSISTANT_B = JSON.stringify({
  type: "assistant",
  message: { role: "assistant", usage: {
    input_tokens: 4, cache_read_input_tokens: 200, cache_creation_input_tokens: 0, output_tokens: 7,
  } },
});
const USER_LINE = JSON.stringify({ type: "user", message: { role: "user", content: "hi" } });

describe("extractBilledUsage", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cachelane-usage-"));
    path = join(dir, "transcript.jsonl");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("sums usage across assistant messages and ignores user lines", () => {
    writeFileSync(path, [USER_LINE, ASSISTANT_A, ASSISTANT_B, ""].join("\n"));
    const usage = extractBilledUsage(path);
    expect(usage).toEqual({
      input_tokens: 14,
      cache_read_tokens: 300,
      cache_creation_tokens: 50,
    });
  });

  it("returns zeros for a transcript with no usage", () => {
    writeFileSync(path, [USER_LINE, ""].join("\n"));
    expect(extractBilledUsage(path)).toEqual({
      input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0,
    });
  });

  it("skips malformed lines without throwing", () => {
    writeFileSync(path, ["not json", ASSISTANT_A, "{bad", ""].join("\n"));
    expect(extractBilledUsage(path).cache_read_tokens).toBe(100);
  });
});
