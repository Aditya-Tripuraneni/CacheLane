import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startProxy } from "../server.js";
import { openDatabase } from "../../storage/index.js";
import type { AnthropicMessagesRequest } from "../../orchestrator/types.js";

// Helpers
function sseResponseBody(inputUsage: any, outputTokens = 42): string {
  return [
    `data: ${JSON.stringify({ type: "message_start", message: { id: "msg_sse", role: "assistant", usage: { ...inputUsage, output_tokens: 0 } } })}`,
    `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Four" } })}`,
    `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: outputTokens } })}`,
    `data: ${JSON.stringify({ type: "message_stop" })}`,
  ].join("\n") + "\n";
}

function postMessages(
  proxyPort: number,
  body: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(body, "utf-8");
    const req = http.request(
      {
        hostname: "127.0.0.1", port: proxyPort,
        path: "/v1/messages", method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(bodyBuf.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8"), headers: res.headers }));
      },
    );
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

function waitForServer(server: http.Server): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.on("error", reject);
    if (server.listening) {
      resolve((server.address() as net.AddressInfo).port);
      return;
    }
    server.once("listening", () => resolve((server.address() as net.AddressInfo).port));
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof (server as any).closeAllConnections === "function") {
      (server as any).closeAllConnections();
    }
    server.close(() => resolve());
  });
}

async function waitForTurn(dbPath: string, sessionId: string, expectedTurns = 1): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const db = openDatabase(dbPath);
    try {
      const stats = db.getStats({ scope: "session", workspace_id: "test-ws", session_id: sessionId });
      if (stats.turns >= expectedTurns) return;
    } finally {
      db.close();
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Timed out waiting for ${expectedTurns} turn(s) in session ${sessionId}`);
}

// Fake upstream server
interface CapturedRequest {
  body: string;
}

let fakeUpstream: http.Server;
let fakeUpstreamPort: number;
let lastCaptured: CapturedRequest | null = null;
let fakeResponseBody: string = "";

function resetFakeUpstream(body: string): void {
  lastCaptured = null;
  fakeResponseBody = body;
}

beforeAll(async () => {
  fakeUpstream = http.createServer((req, upstreamRes) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      lastCaptured = {
        body: Buffer.concat(chunks).toString("utf-8"),
      };
      upstreamRes.writeHead(200, { "content-type": "text/event-stream" });
      upstreamRes.end(fakeResponseBody);
    });
  });
  fakeUpstream.listen(0, "127.0.0.1");
  fakeUpstreamPort = await waitForServer(fakeUpstream);
});

afterAll(async () => {
  await closeServer(fakeUpstream);
});

let tmpDir: string;
let dbPath: string;
let proxy: http.Server;
let proxyPort: number;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-proxy-smoke-"));
  dbPath = path.join(tmpDir, "test.db");
  resetFakeUpstream("");

  proxy = startProxy({
    port: 0,
    db_path: dbPath,
    workspace_id: "test-ws",
    session_id: "test-session",
    upstream: { host: "127.0.0.1", port: fakeUpstreamPort, ssl: false },
  });
  proxyPort = await waitForServer(proxy);
});

afterEach(async () => {
  await closeServer(proxy);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("K-pruner end-to-end (refetch_handle + updateBlockCounters)", () => {
  it("inserts tool_result blocks with non-null refetch_handle", async () => {
    // Turn 1: request includes a tool_result block.
    const TOOL_USE_ID = "toolu_rh_test_01";
    const req1: AnthropicMessagesRequest = {
      model: "claude-opus-4-7",
      messages: [
        { role: "user",      content: [{ type: "text", text: "use a tool" }] },
        { role: "assistant", content: [{ type: "tool_use", id: TOOL_USE_ID, name: "Read", input: { path: "/foo" } }] as any },
        { role: "user",      content: [{ type: "tool_result", tool_use_id: TOOL_USE_ID, content: "file content here" } as any] },
      ],
      max_tokens: 1024,
    };
    resetFakeUpstream(sseResponseBody({ input_tokens: 50, cache_creation_5m_tokens: 30 }));
    await postMessages(proxyPort, JSON.stringify(req1));
    await waitForTurn(dbPath, "test-session", 1);

    const db = openDatabase(dbPath);
    try {
      const block = db.getBlock(TOOL_USE_ID);
      expect(block).not.toBeNull();
      // Bug fix: refetch_handle must be non-null for the K-pruner SQL filter.
      expect(block!.refetch_handle).toBe(TOOL_USE_ID);
      expect(block!.unused_turns).toBe(0);
    } finally {
      db.close();
    }
  });

  it("prunes a tool_result block that has reached unused_turns >= k and has a placement", async () => {
    // Use a config with k=1 so one missed turn is enough to prune.
    // All required sections must be present — partial configs fall back to defaults (k=3).
    const configPath = path.join(tmpDir, "config-k1.json");
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      pruner: { enabled: true, k: 1, mode: "default" },
      keepalive: { policy: "auto", interval_seconds: 150, idle_threshold_seconds: 240, large_prefix_threshold_tokens: 50000 },
      classification: { pin: [], exclude: [], sliding_window_turns: 10 },
      telemetry: { opt_in: false, endpoint: "" },
    }));
    await closeServer(proxy);
    const k1Proxy = startProxy({
      port: 0,
      db_path: dbPath,
      config_path: configPath,
      workspace_id: "test-ws",
      session_id: "prune-session",
      upstream: { host: "127.0.0.1", port: fakeUpstreamPort, ssl: false },
    });
    const k1Port = await waitForServer(k1Proxy);

    const TOOL_USE_ID = "toolu_prunetest_01";

    try {
      // Pre-populate the DB with a block whose unused_turns already equals k=1.
      // This simulates a block that was carried in conversation history for one
      // turn without the model actively using its content.
      const preDb = openDatabase(dbPath);
      preDb.insertBlock({
        id: TOOL_USE_ID,
        workspace_id: "test-ws",
        session_id: "prune-session",
        content_hash: "deadbeef",
        kind: "tool_output",
        volatility: "VOLATILE",
        is_pinned: false,
        token_count: 200,
        added_at_turn: 1,
        last_referenced_at_turn: 1,
        unused_turns: 1,           // equals k=1 → immediately pruneable
        is_stub: false,
        stub_summary: null,
        refetch_handle: TOOL_USE_ID,  // non-null so SQL filter passes
        restored_at_turn: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
      preDb.close();

      // Send a turn that INCLUDES the block as a tool_result (it's in the
      // conversation history). The pruner fires at pre-request time because
      // unused_turns(1) >= k(1) and the block has a placement.
      const req: AnthropicMessagesRequest = {
        model: "claude-opus-4-7",
        messages: [
          { role: "user",      content: [{ type: "text", text: "earlier msg" }] },
          { role: "assistant", content: [{ type: "tool_use", id: TOOL_USE_ID, name: "Read", input: { path: "/foo" } }] as any },
          { role: "user",      content: [{ type: "tool_result", tool_use_id: TOOL_USE_ID, content: "file content" } as any] },
          { role: "assistant", content: [{ type: "text", text: "I saw the file" }] },
          { role: "user",      content: [{ type: "text", text: "continue the work" }] },
        ],
        max_tokens: 1024,
      };
      resetFakeUpstream(sseResponseBody({ input_tokens: 200 }));
      await postMessages(k1Port, JSON.stringify(req));
      await waitForTurn(dbPath, "prune-session", 1);

      const db = openDatabase(dbPath);
      try {
        // Block is now a stub in the DB.
        const block = db.getBlock(TOOL_USE_ID);
        expect(block).not.toBeNull();
        expect(block!.is_stub).toBe(1);

        // Turn 1 must record pruned_blocks_count = 1.
        const turn1 = db.getTurnByNumber("test-ws", "prune-session", 1);
        expect(turn1).not.toBeNull();
        expect(turn1!.pruned_blocks_count).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      await closeServer(k1Proxy);
    }
  });
});

describe("Pipeline smoke test (§7.2.1)", () => {
  it("validates the entire pipeline in one shot", async () => {
    const req1: AnthropicMessagesRequest = {
      model: "claude-opus-4-7",
      system: [{ type: "text", text: "system prompt" }],
      tools: [{ name: "Read", input_schema: { type: "object" } }],
      messages: [
        { role: "user", content: [{ type: "text", text: "msg1" }] },
      ],
      max_tokens: 1024,
    };

    resetFakeUpstream(sseResponseBody({
      input_tokens: 100,
      cache_read_input_tokens: 0,
      cache_creation_5m_tokens: 80,
    }));
    await postMessages(proxyPort, JSON.stringify(req1));
    await waitForTurn(dbPath, "test-session", 1);
    const body1 = lastCaptured!.body;

    const req2: AnthropicMessagesRequest = {
      ...req1,
      messages: [
        ...req1.messages,
        { role: "assistant", content: [{ type: "text", text: "reply1" }] },
        { role: "user", content: [{ type: "text", text: "msg2" }] },
      ],
    };

    resetFakeUpstream(sseResponseBody({
      input_tokens: 120,
      cache_read_input_tokens: 80,
      cache_creation_5m_tokens: 0,
    }));
    await postMessages(proxyPort, JSON.stringify(req2));
    await waitForTurn(dbPath, "test-session", 2);
    const body2 = lastCaptured!.body;
    const forwardedReq2 = JSON.parse(body2) as AnthropicMessagesRequest;

    const db = openDatabase(dbPath);
    try {
      // (a) DB recorded 2 turns
      const stats = db.getStats({ scope: "session", workspace_id: "test-ws", session_id: "test-session" });
      expect(stats.turns).toBe(2);

      const turn1 = db.getTurnByNumber("test-ws", "test-session", 1)!;
      const turn2 = db.getTurnByNumber("test-ws", "test-session", 2)!;

      // (b) turn 2 cache_read_tokens > 0
      expect(turn2.cache_read_tokens).toBeGreaterThan(0);
      expect(turn2.cache_read_tokens).toBe(80);

      // (c) effective_cost_units correctly computed
      // input_tokens(120) * 1.0 + cache_read(80) * 0.1 = 128
      expect(turn2.effective_cost_units).toBe(128);
      // turn1: input(100) + cache_creation_5m(80) * 1.25 = 200
      expect(turn1.effective_cost_units).toBe(200);

      // (d) prefix_breakpoint_hash matches across turns
      expect(turn1.prefix_breakpoint_hash).not.toBeNull();
      expect(turn2.prefix_breakpoint_hash).toBe(turn1.prefix_breakpoint_hash);

      // (e) request mutated successfully (cache_control present in upstream body)
      const hasCacheControl =
        forwardedReq2.tools?.some((t) => t.cache_control !== undefined) ||
        forwardedReq2.system?.some((s) => (s as any).cache_control !== undefined);
      expect(hasCacheControl).toBe(true);

    } finally {
      db.close();
    }
  });
});
