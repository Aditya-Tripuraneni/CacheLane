import { createHash } from "node:crypto";
import { openDatabase } from "../storage/index.js";
import { handlePreRequest } from "../hooks/pre-request.js";
import { CacheStateTracker } from "../orchestrator/index.js";
import type { AnthropicMessagesRequest } from "../orchestrator/index.js";
import type { Classification } from "../classifier/index.js";
import { expandStub } from "../pruner/index.js";

export interface VerifyCheck { name: string; ok: boolean; detail: string }
export interface VerifyReport { ok: boolean; checks: VerifyCheck[] }

const WS = "verify-ws";
const SESSION = "verify-session";

function syntheticRequest(): AnthropicMessagesRequest {
  return {
    model: "claude-opus-4-7",
    system: [{ type: "text", text: "You are a helpful assistant." }],
    tools: [{ name: "Read", description: "read a file", input_schema: { type: "object" } }],
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    max_tokens: 1024,
  };
}

function userClassification(): Classification {
  return { kind: "user_message", volatility: "VOLATILE", isPinned: false, signals: ["user_message"] };
}

export function runVerify(): VerifyReport {
  const checks: VerifyCheck[] = [];
  const db = openDatabase(":memory:");
  const tracker = new CacheStateTracker();
  try {
    // 1) mutate: a request with a system prompt + tools should place breakpoints.
    const result = handlePreRequest({
      db, tracker, workspace_id: WS, session_id: SESSION, current_turn: 1,
      original_request: syntheticRequest(),
      message_classifications: [userClassification()],
      block_placements: [],
      pruner: { enabled: true, k: 3, mode: "default" },
    });
    checks.push({ name: "mutates", ok: result.mutated, detail: result.mutated ? "breakpoints placed" : "no mutation" });

    // 2) stub: insert a tool_output block at turn 1, prune at turn 5 (age >= K=3).
    const blockId = "verifyaa";
    db.insertBlock({
      id: blockId, workspace_id: WS, session_id: SESSION, content_hash: createHash("sha256").update("data").digest("hex"),
      kind: "tool_output", volatility: "VOLATILE", is_pinned: false, token_count: 10,
      added_at_turn: 1, last_referenced_at_turn: 1, unused_turns: 0, is_stub: false,
      stub_summary: null, refetch_handle: JSON.stringify({ type: "tool_use", id: blockId }),
      restored_at_turn: null, created_at: 1, updated_at: 1,
    });
    const stubRequest: AnthropicMessagesRequest = {
      ...syntheticRequest(),
      messages: [{ role: "user", content: [{ type: "text", text: "next" }] }],
    };
    const stubResult = handlePreRequest({
      db, tracker, workspace_id: WS, session_id: SESSION, current_turn: 5,
      original_request: stubRequest,
      message_classifications: [userClassification()],
      block_placements: [{
        block_id: blockId, message_index: 0, content_index: 0, kind: "tool_output",
        volatility: "VOLATILE", is_pinned: false, refetch_handle: JSON.stringify({ type: "tool_use", id: blockId }),
      }],
      pruner: { enabled: true, k: 3, mode: "default" },
    });
    const stubbed = stubResult.pruned_blocks_count >= 1;
    checks.push({ name: "stubs", ok: stubbed, detail: stubbed ? "idle block stubbed at K=3" : "no stub produced" });

    // 3) rehydrate: expandStub returns ok with a refetch handle.
    const expand = expandStub(db, { workspace_id: WS, session_id: SESSION, block_id: blockId, turn_number: 6, updated_at: 6 });
    checks.push({
      name: "rehydrates",
      ok: expand.ok,
      detail: expand.ok ? "stub rehydrated via cachelane_expand" : `expand failed: ${expand.ok === false ? expand.error.code : ""}`,
    });

    // 4) fail-open: a classification/message length mismatch must return unmutated.
    const failOpen = handlePreRequest({
      db, tracker, workspace_id: WS, session_id: SESSION, current_turn: 7,
      original_request: syntheticRequest(),
      message_classifications: [], // length mismatch => fail open
      block_placements: [],
      pruner: { enabled: true, k: 3, mode: "default" },
    });
    const failedOpen = failOpen.mutated === false && failOpen.signals.includes("error:fallback");
    checks.push({ name: "fail_open", ok: failedOpen, detail: failedOpen ? "returns unmutated request on error" : "did not fail open" });

    return { ok: checks.every((c) => c.ok), checks };
  } finally {
    db.close();
  }
}

export function formatVerify(report: VerifyReport): string {
  const lines = report.checks.map((c) => `  ${c.ok ? "ok " : "FAIL"} ${c.name}: ${c.detail}`);
  lines.push(report.ok
    ? "→ CacheLane core is working."
    : "→ Some checks failed. Run `cachelane doctor` for installation health.");
  return lines.join("\n");
}
