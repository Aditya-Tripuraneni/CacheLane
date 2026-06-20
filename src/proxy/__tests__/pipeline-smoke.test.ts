import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startProxy } from "../server.js";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import { openDatabase } from "../../storage/index.js";
import type { AnthropicMessagesRequest } from "../../orchestrator/types.js";

// Helpers
function sseResponseBody(inputUsage: Record<string, number>, outputTokens = 42): string {
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
    if (typeof (server as unknown as { closeAllConnections?: () => void }).closeAllConnections === "function") {
      (server as unknown as { closeAllConnections: () => void }).closeAllConnections();
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
let originalEnvCachelaneHome: string | undefined;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-proxy-smoke-"));
  dbPath = path.join(tmpDir, "test.db");
  originalEnvCachelaneHome = process.env.CACHELANE_HOME;
  process.env.CACHELANE_HOME = tmpDir;
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
  if (originalEnvCachelaneHome !== undefined) {
    process.env.CACHELANE_HOME = originalEnvCachelaneHome;
  } else {
    delete process.env.CACHELANE_HOME;
  }
});

describe("Pipeline smoke test — 1h TTL cost tier (§cost-formula)", () => {
  it("computes effective_cost_units = 400 for input(200)*1.0 + cache_creation_1h(100)*2.0", async () => {
    const req: AnthropicMessagesRequest = {
      model: "claude-opus-4-7",
      system: [{ type: "text", text: "system prompt" }],
      messages: [
        { role: "user", content: [{ type: "text", text: "msg1" }] },
      ],
      max_tokens: 1024,
    };

    resetFakeUpstream(sseResponseBody({
      input_tokens: 200,
      cache_creation_1h_tokens: 100,
      cache_creation_5m_tokens: 0,
      cache_read_input_tokens: 0,
    }));
    await postMessages(proxyPort, JSON.stringify(req));
    await waitForTurn(dbPath, "test-session", 1);

    const db = openDatabase(dbPath);
    try {
      const turn = db.getTurnByNumber("test-ws", "test-session", 1)!;
      // 200*1.0 + 0*1.25 + 100*2.0 + 0*0.1 = 400
      expect(turn.cache_creation_1h_tokens).toBe(100);
      expect(turn.effective_cost_units).toBe(400);
    } finally {
      db.close();
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
        forwardedReq2.system?.some((s) => (s as unknown as { cache_control?: unknown }).cache_control !== undefined);
      expect(hasCacheControl).toBe(true);

    } finally {
      db.close();
    }
  });

  it("keeps the compression stage wired into the full pipeline", async () => {
    const configPath = path.join(tmpDir, "compression-aggressive.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ...DEFAULT_CONFIG,
        compression: { ...DEFAULT_CONFIG.compression, mode: "aggressive" },
      }, null, 2),
    );
    await closeServer(proxy);
    proxy = startProxy({
      port: 0,
      db_path: dbPath,
      config_path: configPath,
      workspace_id: "test-ws",
      session_id: "test-session",
      upstream: { host: "127.0.0.1", port: fakeUpstreamPort, ssl: false },
    });
    proxyPort = await waitForServer(proxy);

    const verboseJson = JSON.stringify({
      meta: { a: null, b: null, keep: "yes" },
      rows: Array.from({ length: 48 }, (_, i) => ({ id: i, label: i % 3 === 0 ? null : `row-${i}` })),
    });
    const req: AnthropicMessagesRequest = {
      model: "claude-opus-4-7",
      system: [{ type: "text", text: "system prompt" }],
      tools: [{ name: "Read", input_schema: { type: "object" } }],
      messages: [
        { role: "user", content: [{ type: "text", text: "compress this" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_compress", name: "Read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_compress", content: verboseJson }] },
      ],
      max_tokens: 1024,
    };

    resetFakeUpstream(sseResponseBody({
      input_tokens: 150,
      cache_read_input_tokens: 0,
      cache_creation_5m_tokens: 60,
    }));
    await postMessages(proxyPort, JSON.stringify(req));
    await waitForTurn(dbPath, "test-session", 1);

    expect(lastCaptured).not.toBeNull();
    const forwarded = JSON.parse(lastCaptured!.body) as AnthropicMessagesRequest;
    const forwardedToolResult = forwarded.messages[2]!.content.find(
      (block) => block.type === "tool_result",
    ) as { type: "tool_result"; content: string };

    expect(forwardedToolResult.content.length).toBeLessThan(verboseJson.length);

    const db = openDatabase(dbPath);
    try {
      const stats = db.getStats({ scope: "session", workspace_id: "test-ws", session_id: "test-session" });
      expect(stats.compression_counts.tokens_saved).toBeGreaterThan(0);
      expect(stats.compression_counts.compressed_blocks).toBe(1);
    } finally {
      db.close();
    }
  });
});
