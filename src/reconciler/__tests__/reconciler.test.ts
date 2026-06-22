import { describe, it, expect } from "vitest";
import { reconcileTurnCost } from "../index.js";
import type { TurnExplanationUsage, TurnExplanationBlockMetadata } from "../../storage/types.js";

describe("reconcileTurnCost", () => {
  it("attributes fully to cache_creation on first turn", () => {
    const usage: TurnExplanationUsage = {
      input_tokens: 100,
      cache_read_tokens: 0,
      cache_creation_1h_tokens: 1000,
      cache_creation_5m_tokens: 500,
      output_tokens: 50,
      effective_cost_units: 100 + (1000 * 2.0) + (500 * 1.25)
    };
    
    const blockMetadata: TurnExplanationBlockMetadata[] = [
      { block_id: "1", volatility: "STABLE", token_count: 1000, message_index: 0, content_index: 0, kind: "text", is_pinned: false, has_refetch_handle: false },
      { block_id: "2", volatility: "SEMI", token_count: 500, message_index: 0, content_index: 0, kind: "text", is_pinned: false, has_refetch_handle: false },
    ];

    const current = { prefix_breakpoint_hash: "hash1", middle_breakpoint_hash: "hash2" };
    
    const result = reconcileTurnCost(usage, blockMetadata, current, null);

    expect(result.stable.tier).toBe("cache_creation_1h");
    expect(result.stable.tokens).toBe(1000);
    expect(result.semi.tier).toBe("cache_creation_5m");
    expect(result.semi.tokens).toBe(500);
    expect(result.volatile.tier).toBe("input");
    expect(result.volatile.tokens).toBe(100);
  });

  it("attributes fully to cache_read when both breakpoints match", () => {
    const usage: TurnExplanationUsage = {
      input_tokens: 100,
      cache_read_tokens: 1500,
      cache_creation_1h_tokens: 0,
      cache_creation_5m_tokens: 0,
      output_tokens: 50,
      effective_cost_units: 100 + (1500 * 0.1)
    };
    
    const blockMetadata: TurnExplanationBlockMetadata[] = [
      { block_id: "1", volatility: "STABLE", token_count: 1000, message_index: 0, content_index: 0, kind: "text", is_pinned: false, has_refetch_handle: false },
      { block_id: "2", volatility: "SEMI", token_count: 500, message_index: 0, content_index: 0, kind: "text", is_pinned: false, has_refetch_handle: false },
    ];

    const current = { prefix_breakpoint_hash: "hash1", middle_breakpoint_hash: "hash2" };
    const prev = { prefix_breakpoint_hash: "hash1", middle_breakpoint_hash: "hash2" };
    
    const result = reconcileTurnCost(usage, blockMetadata, current, prev);

    expect(result.stable.tier).toBe("cache_read");
    expect(result.stable.tokens).toBe(1000);
    expect(result.semi.tier).toBe("cache_read");
    expect(result.semi.tokens).toBe(500);
    expect(result.volatile.tier).toBe("input");
    expect(result.volatile.tokens).toBe(100);
  });

  it("attributes STABLE to cache_read and SEMI to cache_creation_5m when middle breakpoint changes", () => {
    const usage: TurnExplanationUsage = {
      input_tokens: 100,
      cache_read_tokens: 1000,
      cache_creation_1h_tokens: 0,
      cache_creation_5m_tokens: 500,
      output_tokens: 50,
      effective_cost_units: 100 + (1000 * 0.1) + (500 * 1.25)
    };
    
    const blockMetadata: TurnExplanationBlockMetadata[] = [
      { block_id: "1", volatility: "STABLE", token_count: 1000, message_index: 0, content_index: 0, kind: "text", is_pinned: false, has_refetch_handle: false },
    ];

    const current = { prefix_breakpoint_hash: "hash1", middle_breakpoint_hash: "hash3" };
    const prev = { prefix_breakpoint_hash: "hash1", middle_breakpoint_hash: "hash2" };
    
    const result = reconcileTurnCost(usage, blockMetadata, current, prev);

    expect(result.stable.tier).toBe("cache_read");
    expect(result.stable.tokens).toBe(1000);
    expect(result.semi.tier).toBe("cache_creation_5m");
    expect(result.semi.tokens).toBe(500);
    expect(result.volatile.tier).toBe("input");
    expect(result.volatile.tokens).toBe(100);
  });

  it("attributes SEMI to input when middle breakpoint is null", () => {
    const usage: TurnExplanationUsage = {
      input_tokens: 600, // 500 semi + 100 volatile
      cache_read_tokens: 1000,
      cache_creation_1h_tokens: 0,
      cache_creation_5m_tokens: 0,
      output_tokens: 50,
      effective_cost_units: 600 + (1000 * 0.1)
    };
    
    const blockMetadata: TurnExplanationBlockMetadata[] = [
      { block_id: "1", volatility: "STABLE", token_count: 1000, message_index: 0, content_index: 0, kind: "text", is_pinned: false, has_refetch_handle: false },
      { block_id: "2", volatility: "SEMI", token_count: 500, message_index: 0, content_index: 0, kind: "text", is_pinned: false, has_refetch_handle: false },
    ];

    const current = { prefix_breakpoint_hash: "hash1", middle_breakpoint_hash: null };
    const prev = { prefix_breakpoint_hash: "hash1", middle_breakpoint_hash: "hash2" };
    
    const result = reconcileTurnCost(usage, blockMetadata, current, prev);

    expect(result.stable.tier).toBe("cache_read");
    expect(result.stable.tokens).toBe(1000);
    expect(result.semi.tier).toBe("input");
    expect(result.semi.tokens).toBe(500);
    expect(result.volatile.tier).toBe("input");
    expect(result.volatile.tokens).toBe(100);
  });
});
