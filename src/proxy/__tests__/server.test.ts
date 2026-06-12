/**
 * Integration tests for the CacheLane proxy server.
 *
 * Real components used end-to-end:
 *  - HTTP proxy server (auto-assigned port)
 *  - Fake upstream HTTP server (auto-assigned port, captures forwarded requests)
 *  - Real SQLite DB in a temp directory
 *  - Real classifier + handlePreRequest + CacheStateTracker
 *  - Real config (defaults)
 *
 * Only substituted: the upstream host/port (local HTTP server, not api.anthropic.com)
 */

import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startProxy, createProxyServer } from "../server.js";
import { CacheStateTracker } from "../../orchestrator/index.js";
import { openDatabase } from "../../storage/index.js";
import type { AnthropicMessagesRequest } from "../../orchestrator/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A POST /v1/messages request body that has system + tools → triggers cache_control mutation */
function buildMessagesRequest(overrides: Partial<AnthropicMessagesRequest> = {}): AnthropicMessagesRequest {
  return {
    model: "claude-opus-4-7",
    system: [{ type: "text", text: "You are a helpful assistant." }],
    tools: [{ name: "Read", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
      { role: "user", content: [{ type: "text", text: "What is 2+2?" }] },
    ],
    max_tokens: 1024,
    ...overrides,
  };
}

function nonStreamingResponseBody(usage = {
  input_tokens: 100, output_tokens: 50,
  cache_read_input_tokens: 80, cache_creation_input_tokens: 20,
}): string {
  return JSON.stringify({
    id: "msg_test", type: "message", role: "assistant",
    content: [{ type: "text", text: "4" }],
    model: "claude-opus-4-7", stop_reason: "end_turn", usage,
  });
}

function sseResponseBody(inputUsage = {
  input_tokens: 200, cache_read_input_tokens: 150, cache_creation_5m_tokens: 50,
}, outputTokens = 42): string {
  return [
    `data: ${JSON.stringify({ type: "message_start", message: { id: "msg_sse", role: "assistant", usage: { ...inputUsage, output_tokens: 0 } } })}`,
    `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Four" } })}`,
    `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: outputTokens } })}`,
    `data: ${JSON.stringify({ type: "message_stop" })}`,
  ].join("\n") + "\n";
}

/** Send a POST /v1/messages to the given proxy port and return the result. */
function postMessages(
  proxyPort: number,
  body: string,
  extraHeaders: Record<string, string> = {},
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
          "x-api-key": "test-key",
          "anthropic-version": "2023-06-01",
          ...extraHeaders,
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

function getRequest(proxyPort: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: proxyPort, path: urlPath, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Wait for a server that already called listen() internally; return the bound port. */
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
    // closeAllConnections available in Node 18.2+ — gracefully destroys keep-alive sockets
    if (typeof (server as { closeAllConnections?: () => void }).closeAllConnections === "function") {
      (server as { closeAllConnections: () => void }).closeAllConnections();
    }
    server.close(() => resolve());
  });
}

/** Wait until a turn row exists in the DB (polling, max 2s). */
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

// ---------------------------------------------------------------------------
// Fake upstream server
// ---------------------------------------------------------------------------

interface CapturedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let fakeUpstream: http.Server;
let fakeUpstreamPort: number;
let lastCaptured: CapturedRequest | null = null;
let capturedRequests: CapturedRequest[] = [];
let fakeResponseBody: string = nonStreamingResponseBody();
let fakeResponseContentType = "application/json";
let fakeResponseStatus = 200;
let fakeResponseDelayMs = 0;

function resetFakeUpstream(
  body = nonStreamingResponseBody(),
  contentType = "application/json",
  status = 200,
  delayMs = 0,
): void {
  lastCaptured = null;
  capturedRequests = [];
  fakeResponseBody = body;
  fakeResponseContentType = contentType;
  fakeResponseStatus = status;
  fakeResponseDelayMs = delayMs;
}

beforeAll(async () => {
  fakeUpstream = http.createServer((req, upstreamRes) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const captured = {
        method: req.method ?? "",
        path: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf-8"),
      };
      lastCaptured = captured;
      capturedRequests.push(captured);
      const respond = () => {
        upstreamRes.writeHead(fakeResponseStatus, { "content-type": fakeResponseContentType });
        upstreamRes.end(fakeResponseBody);
      };
      if (fakeResponseDelayMs > 0) {
        setTimeout(respond, fakeResponseDelayMs);
      } else {
        respond();
      }
    });
  });
  // fake upstream must call listen() explicitly; waitForServer resolves once bound
  fakeUpstream.listen(0, "127.0.0.1");
  fakeUpstreamPort = await waitForServer(fakeUpstream);
});

afterAll(async () => {
  await closeServer(fakeUpstream);
});

// ---------------------------------------------------------------------------
// Per-test: fresh DB + fresh proxy
// ---------------------------------------------------------------------------

let tmpDir: string;
let dbPath: string;
let proxy: http.Server;
let proxyPort: number;

let originalEnvCachelaneHome: string | undefined;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-proxy-test-"));
  dbPath = path.join(tmpDir, "test.db");
  originalEnvCachelaneHome = process.env.CACHELANE_HOME;
  process.env.CACHELANE_HOME = tmpDir;
  resetFakeUpstream();

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
  vi.restoreAllMocks();
  await closeServer(proxy);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (originalEnvCachelaneHome !== undefined) {
    process.env.CACHELANE_HOME = originalEnvCachelaneHome;
  } else {
    delete process.env.CACHELANE_HOME;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("proxy pipeline integration", () => {
  describe("request mutation — cache_control injection", () => {
    it("adds cache_control to system or tools when forwarding a messages request", async () => {
      const res = await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()));

      expect(res.status).toBe(200);
      expect(lastCaptured).not.toBeNull();

      const forwarded = JSON.parse(lastCaptured!.body) as AnthropicMessagesRequest;
      const hasCacheControl =
        forwarded.tools?.some((t) => t.cache_control !== undefined) ||
        forwarded.system?.some((s) => s.cache_control !== undefined);

      expect(hasCacheControl).toBe(true);
    });

    it("does not strip the x-api-key header from the forwarded request", async () => {
      await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()), { "x-api-key": "my-secret-key" });

      expect(lastCaptured?.headers["x-api-key"]).toBe("my-secret-key");
    });

    it("updates content-length to match the mutated body byte length", async () => {
      await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()));

      expect(lastCaptured).not.toBeNull();
      const clHeader = Number(lastCaptured!.headers["content-length"]);
      expect(clHeader).toBe(Buffer.byteLength(lastCaptured!.body, "utf-8"));
    });

    it("does not mutate a request that has no system blocks and no tools", async () => {
      const bare = buildMessagesRequest({ system: undefined, tools: undefined });
      const original = JSON.stringify(bare);
      await postMessages(proxyPort, original);

      // body should still be valid JSON but without cache_control anywhere
      const forwarded = JSON.parse(lastCaptured!.body) as AnthropicMessagesRequest;
      expect(forwarded.tools).toBeUndefined();
      expect(forwarded.system).toBeUndefined();
    });
  });

  describe("turn recording — non-streaming response", () => {
    it("records one turn in the DB after a successful non-streaming response", async () => {
      await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()));
      await waitForTurn(dbPath, "test-session");

      const db = openDatabase(dbPath);
      try {
        const stats = db.getStats({ scope: "session", workspace_id: "test-ws", session_id: "test-session" });
        expect(stats.turns).toBe(1);
      } finally {
        db.close();
      }
    });

    it("records the correct input and cache-read token counts", async () => {
      resetFakeUpstream(
        nonStreamingResponseBody({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 80, cache_creation_input_tokens: 20 }),
      );

      await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()));
      await waitForTurn(dbPath, "test-session");

      const db = openDatabase(dbPath);
      try {
        const turn = db.getTurnByNumber("test-ws", "test-session", 1);
        expect(turn).not.toBeNull();
        expect(turn!.input_tokens).toBe(100);
        expect(turn!.output_tokens).toBe(50);
        expect(turn!.cache_read_tokens).toBe(80);
        expect(turn!.cache_creation_5m_tokens).toBe(20);
      } finally {
        db.close();
      }
    });

    it("records prefix_breakpoint_hash after orchestration runs", async () => {
      await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()));
      await waitForTurn(dbPath, "test-session");

      const db = openDatabase(dbPath);
      try {
        const turn = db.getTurnByNumber("test-ws", "test-session", 1);
        expect(turn?.prefix_breakpoint_hash).toMatch(/^[0-9a-f]{64}$/);
      } finally {
        db.close();
      }
    });

    it("records keepalive pings count in keepalive_pings_since_last_turn", async () => {
      const customDbPath = path.join(tmpDir, "keepalive-custom.db");
      const customDb = openDatabase(customDbPath);
      const customTracker = new CacheStateTracker();

      customTracker.update("test-ws", "keepalive-sess", {
        workspace_id: "test-ws",
        prefix_hash: "dummy-hash",
        middle_hash: null,
        prefix_token_count: 50,
        ttl_class: "5m",
        cached_at_ms: Date.now(),
        last_read_at_ms: Date.now(),
        expected_expiry_ms: Date.now() + 300_000,
        keepalive_pings_since_last_turn: 3,
      });

      const customProxy = createProxyServer(
        {
          port: 0,
          workspace_id: "test-ws",
          session_id: "keepalive-sess",
          upstream: { host: "127.0.0.1", port: fakeUpstreamPort, ssl: false },
        },
        customDb,
        customTracker,
      );

      customProxy.listen(0, "127.0.0.1");
      const customPort = await waitForServer(customProxy);

      try {
        await postMessages(customPort, JSON.stringify(buildMessagesRequest()));
        await waitForTurn(customDbPath, "keepalive-sess");

        const turn = customDb.getTurnByNumber("test-ws", "keepalive-sess", 1);
        expect(turn).not.toBeNull();
        expect(turn!.keepalive_pings_since_last_turn).toBe(3);

        const trackerState = customTracker.get("test-ws", "keepalive-sess");
        expect(trackerState?.keepalive_pings_since_last_turn).toBe(0);
      } finally {
        await closeServer(customProxy);
        customDb.close();
      }
    });
  });

  describe("turn recording — SSE streaming response", () => {
    it("records a turn after a streaming response", async () => {
      resetFakeUpstream(sseResponseBody(), "text/event-stream");

      await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()));
      await waitForTurn(dbPath, "test-session");

      const db = openDatabase(dbPath);
      try {
        const stats = db.getStats({ scope: "session", workspace_id: "test-ws", session_id: "test-session" });
        expect(stats.turns).toBe(1);
      } finally {
        db.close();
      }
    });

    it("records output_tokens from the message_delta SSE event (not just message_start)", async () => {
      resetFakeUpstream(sseResponseBody({ input_tokens: 200, cache_read_input_tokens: 150, cache_creation_5m_tokens: 50 }, 99), "text/event-stream");

      await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()));
      await waitForTurn(dbPath, "test-session");

      const db = openDatabase(dbPath);
      try {
        const turn = db.getTurnByNumber("test-ws", "test-session", 1);
        expect(turn).not.toBeNull();
        // message_delta carries output_tokens=99; message_start had output_tokens=0
        expect(turn!.output_tokens).toBe(99);
      } finally {
        db.close();
      }
    });

    it("records input and cache tokens from the message_start SSE event", async () => {
      resetFakeUpstream(
        sseResponseBody({ input_tokens: 200, cache_read_input_tokens: 150, cache_creation_5m_tokens: 50 }, 42),
        "text/event-stream",
      );

      await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()));
      await waitForTurn(dbPath, "test-session");

      const db = openDatabase(dbPath);
      try {
        const turn = db.getTurnByNumber("test-ws", "test-session", 1);
        expect(turn!.input_tokens).toBe(200);
        expect(turn!.cache_read_tokens).toBe(150);
        expect(turn!.cache_creation_5m_tokens).toBe(50);
      } finally {
        db.close();
      }
    });
  });

  describe("passthrough — non-messages paths", () => {
    it("prepends an upstream path prefix while still intercepting bare /v1/messages locally", async () => {
      const prefixedProxy = startProxy({
        port: 0,
        db_path: path.join(tmpDir, "prefixed.db"),
        workspace_id: "test-ws",
        session_id: "prefixed-session",
        upstream: {
          host: "127.0.0.1",
          port: fakeUpstreamPort,
          ssl: false,
          path_prefix: "/api/anthropic",
        },
      });
      const prefixedPort = await waitForServer(prefixedProxy);

      try {
        await postMessages(prefixedPort, JSON.stringify(buildMessagesRequest()));

        expect(lastCaptured?.path).toBe("/api/anthropic/v1/messages");
      } finally {
        await closeServer(prefixedProxy);
      }
    });

    it("forwards GET requests to the upstream without DB recording", async () => {
      resetFakeUpstream(JSON.stringify({ type: "list", data: [] }));

      const res = await getRequest(proxyPort, "/v1/models");

      expect(res.status).toBe(200);
      expect(lastCaptured?.method).toBe("GET");
      expect(lastCaptured?.path).toBe("/v1/models");

      // No turns recorded — passthrough path bypasses pipeline
      const db = openDatabase(dbPath);
      try {
        const stats = db.getStats({ scope: "session", workspace_id: "test-ws", session_id: "test-session" });
        expect(stats.turns).toBe(0);
      } finally {
        db.close();
      }
    });

    it("forwards POST to a non-messages path without DB recording", async () => {
      resetFakeUpstream(JSON.stringify({ ok: true }));

      const bodyStr = JSON.stringify({ prompt: "hello" });
      const bodyBuf = Buffer.from(bodyStr);
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          { hostname: "127.0.0.1", port: proxyPort, path: "/v1/complete", method: "POST",
            headers: { "content-type": "application/json", "content-length": String(bodyBuf.length) } },
          (r) => { r.resume(); r.on("end", resolve); },
        );
        req.on("error", reject);
        req.write(bodyBuf);
        req.end();
      });

      expect(lastCaptured?.path).toBe("/v1/complete");
    });
  });

  describe("fail-open behaviour", () => {
    it("forwards the original unmodified body when request JSON is malformed", async () => {
      const garbled = "not-json{{{";
      const res = await postMessages(proxyPort, garbled);

      expect(res.status).toBe(200);
      expect(lastCaptured?.body).toBe(garbled);

      // No turn recorded
      const db = openDatabase(dbPath);
      try {
        expect(db.getStats({ scope: "session", workspace_id: "test-ws", session_id: "test-session" }).turns).toBe(0);
      } finally {
        db.close();
      }
    });

    it("forwards the original body when the messages field is absent", async () => {
      const noMsgs = JSON.stringify({ model: "claude-opus-4-7", max_tokens: 100 });
      const res = await postMessages(proxyPort, noMsgs);

      expect(res.status).toBe(200);
      expect(lastCaptured?.body).toBe(noMsgs);
    });

    it("throws synchronously when the DB cannot be opened at startup", () => {
      // M8-G2: DB lifetime is now owned by startProxy (opened once at startup,
      // not per-request). A bad db_path should fail fast at boot. Fail-open at
      // the bind layer is the lifecycle's responsibility (tryBindProxy), not the
      // per-request handler's.
      expect(() =>
        startProxy({
          port: 0,
          db_path: tmpDir, // a directory — openDatabase will throw
          workspace_id: "test-ws",
          session_id: "bad-session",
          upstream: { host: "127.0.0.1", port: fakeUpstreamPort, ssl: false },
        }),
      ).toThrow();
    });

    it("returns 502 when the upstream connection is refused", async () => {
      // Use a port with nothing listening — should get ECONNREFUSED quickly
      const closedPort = await new Promise<number>((resolve) => {
        const s = net.createServer();
        s.listen(0, "127.0.0.1", () => {
          const addr = s.address() as net.AddressInfo;
          s.close(() => resolve(addr.port));
        });
      });

      const brokenProxy = startProxy({
        port: 0,
        db_path: dbPath,
        workspace_id: "test-ws",
        session_id: "broken-session",
        upstream: { host: "127.0.0.1", port: closedPort, ssl: false },
      });
      const brokenPort = await waitForServer(brokenProxy);

      try {
        const res = await postMessages(brokenPort, JSON.stringify(buildMessagesRequest()));
        expect(res.status).toBe(502);
      } finally {
        await closeServer(brokenProxy);
      }
    }, 10_000);

    it("records a fallback explanation when the pipeline fails after turn allocation", async () => {
      const badConfigPath = path.join(tmpDir, "bad-config.json");
      fs.writeFileSync(badConfigPath, JSON.stringify({ version: 2 }));
      resetFakeUpstream();

      const fallbackProxy = startProxy({
        port: 0,
        db_path: dbPath,
        config_path: badConfigPath,
        workspace_id: "test-ws",
        session_id: "fallback-session",
        upstream: { host: "127.0.0.1", port: fakeUpstreamPort, ssl: false },
      });
      const fallbackPort = await waitForServer(fallbackProxy);

      try {
        const original = JSON.stringify(buildMessagesRequest());
        const res = await postMessages(fallbackPort, original);
        expect(res.status).toBe(200);
        expect(lastCaptured?.body).toBe(original);
        await waitForTurn(dbPath, "fallback-session");

        const db = openDatabase(dbPath);
        try {
          const turn = db.getTurnByNumber("test-ws", "fallback-session", 1);
          expect(turn?.request_mutated).toBe(0);
          expect(turn?.signals).toContain("error:fallback");

          const explanation = db.getTurnExplanation({
            workspace_id: "test-ws",
            session_id: "fallback-session",
            turn_number: 1,
          });
          expect(explanation).toMatchObject({
            mutated: false,
            signals: ["error:fallback"],
            region_metadata: { message_count: 0 },
          });
        } finally {
          db.close();
        }
      } finally {
        await closeServer(fallbackProxy);
      }
    });
  });

  describe("turn counting — sequential requests", () => {
    it("increments turn_number on each successive request in the same session", async () => {
      for (let i = 0; i < 3; i++) {
        await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()));
        await waitForTurn(dbPath, "test-session", i + 1);
      }

      const db = openDatabase(dbPath);
      try {
        const stats = db.getStats({ scope: "session", workspace_id: "test-ws", session_id: "test-session" });
        expect(stats.turns).toBe(3);

        // Turn numbers should be 1, 2, 3
        for (let n = 1; n <= 3; n++) {
          const turn = db.getTurnByNumber("test-ws", "test-session", n);
          expect(turn).not.toBeNull();
          expect(turn!.turn_number).toBe(n);
        }
      } finally {
        db.close();
      }
    });

    it("allocates distinct turn numbers for overlapping requests in the same session", async () => {
      resetFakeUpstream(nonStreamingResponseBody(), "application/json", 200, 100);
      const body = JSON.stringify(buildMessagesRequest());

      const [first, second] = await Promise.all([
        postMessages(proxyPort, body),
        postMessages(proxyPort, body),
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(capturedRequests).toHaveLength(2);
      await waitForTurn(dbPath, "test-session", 2);

      const db = openDatabase(dbPath);
      try {
        const stats = db.getStats({ scope: "session", workspace_id: "test-ws", session_id: "test-session" });
        expect(stats.turns).toBe(2);
        expect(db.getTurnByNumber("test-ws", "test-session", 1)).not.toBeNull();
        expect(db.getTurnByNumber("test-ws", "test-session", 2)).not.toBeNull();
      } finally {
        db.close();
      }
    });

    it("both requests carry cache_control on the second turn (prefix stable)", async () => {
      const bodies: AnthropicMessagesRequest[] = [];

      for (let i = 0; i < 2; i++) {
        resetFakeUpstream();
        await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()));
        if (lastCaptured) bodies.push(JSON.parse(lastCaptured.body) as AnthropicMessagesRequest);
        await waitForTurn(dbPath, "test-session", i + 1);
      }

      expect(bodies).toHaveLength(2);
      for (const req of bodies) {
        const hasCacheControl =
          req.tools?.some((t) => t.cache_control !== undefined) ||
          req.system?.some((s) => s.cache_control !== undefined);
        expect(hasCacheControl).toBe(true);
      }
    });

    it("isolates sequential requests into separate sessions using x-claude-code-session-id header", async () => {
      // Turn 1 for session A
      await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()), { "x-claude-code-session-id": "session-A" });
      await waitForTurn(dbPath, "session-A", 1);

      // Turn 1 for session B
      await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()), { "x-claude-code-session-id": "session-B" });
      await waitForTurn(dbPath, "session-B", 1);

      // Turn 2 for session A
      await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()), { "x-claude-code-session-id": "session-A" });
      await waitForTurn(dbPath, "session-A", 2);

      const db = openDatabase(dbPath);
      try {
        const statsA = db.getStats({ scope: "session", workspace_id: "test-ws", session_id: "session-A" });
        expect(statsA.turns).toBe(2);

        const statsB = db.getStats({ scope: "session", workspace_id: "test-ws", session_id: "session-B" });
        expect(statsB.turns).toBe(1);

        // Fallback session shouldn't have any turns
        const statsFallback = db.getStats({ scope: "session", workspace_id: "test-ws", session_id: "test-session" });
        expect(statsFallback.turns).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  describe("effective cost computation", () => {
    it("computes effective_cost_units correctly for a cache-read-heavy turn", async () => {
      // input=0, cache_read=1000 → effective = 0*1 + 1000*0.1 = 100
      resetFakeUpstream(
        nonStreamingResponseBody({ input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }),
      );

      await postMessages(proxyPort, JSON.stringify(buildMessagesRequest()));
      await waitForTurn(dbPath, "test-session");

      const db = openDatabase(dbPath);
      try {
        const turn = db.getTurnByNumber("test-ws", "test-session", 1);
        // effective_cost_units = 0*1 + 0*1.25 + 0*2 + 1000*0.1 = 100
        expect(turn!.effective_cost_units).toBeCloseTo(100, 1);
      } finally {
        db.close();
      }
    });
  });
});
