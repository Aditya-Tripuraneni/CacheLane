import { describe, expect, it } from "vitest";
import { makeStubSummary } from "../stubs.js";
import type { BlockRow } from "../../storage/index.js";

// The proxy re-records each forwarded block, overwriting token_count with the stub's
// own size, and the block is re-stubbed next turn. Stub text must not depend on that
// count, or it changes between turns and invalidates the prompt cache at that block.
describe("makeStubSummary", () => {
  it("is identical regardless of the block's current token_count", () => {
    const row = {
      kind: "tool_output",
      refetch_handle: '{"type":"tool_use","id":"toolu_1"}',
      token_count: 5123,
    } as BlockRow;
    expect(makeStubSummary({ ...row, token_count: 45 })).toBe(makeStubSummary(row));
  });
});
