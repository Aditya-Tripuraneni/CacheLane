/**
 * Task 7 — proxy SAFELY handles OpenAI /v1/chat/completions requests.
 *
 * OpenAI requests MUST NOT pass through the Anthropic breakpoint pipeline (which
 * injects `cache_control` blocks OpenAI rejects with HTTP 400). Instead they get
 * OpenAI cache hints (`prompt_cache_key`) and keepalive/Bedrock signing are skipped.
 *
 * Mirrors the integration harness in server.test.ts: real proxy + fake upstream +
 * real SQLite DB.
 */

import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startProxy } from "../server.js";
import { selectAdapter } from "../../providers/registry.js";

// ---------------------------------------------------------------------------
// Unit: adapter policy
// ---------------------------------------------------------------------------

describe("openai pipeline — adapter policy", () => {
  it("openai adapter disables keepalive", () => {
    const a = selectAdapter("POST", "/v1/chat/completions");
    expect(a?.cachePolicy.supportsKeepalive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: OpenAI request through the proxy
// ---------------------------------------------------------------------------

/** An OpenAI chat request with tools + messages → exercises the OpenAI branch. */
function buildOpenAIRequest(): Record<string, unknown> {
  return {
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "What is 2+2?" },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "read_file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      },
    ],
    max_tokens: 256,
  };
}

function openAIResponseBody(): string {
  return JSON.stringify({
    id: "chatcmpl_test",
    object: "chat.completion",
    model: "gpt-4o",
    choices: [{ index: 0, message: { role: "assistant", content: "4" }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 80 },
    },
  });
}

function postChat(
  proxyPort: number,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(body, "utf-8");
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: proxyPort,
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(bodyBuf.length),
          authorization: "Bearer sk-test-key",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") }),
        );
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
    const s = server as { closeAllConnections?: () => void };
    if (typeof s.closeAllConnections === "function") s.closeAllConnections();
    server.close(() => resolve());
  });
}

interface CapturedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let fakeUpstream: http.Server;
let fakeUpstreamPort: number;
let lastCaptured: CapturedRequest | null = null;

beforeAll(async () => {
  fakeUpstream = http.createServer((req, upstreamRes) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      lastCaptured = {
        method: req.method ?? "",
        path: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf-8"),
      };
      upstreamRes.writeHead(200, { "content-type": "application/json" });
      upstreamRes.end(openAIResponseBody());
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-openai-test-"));
  dbPath = path.join(tmpDir, "test.db");
  originalEnvCachelaneHome = process.env.CACHELANE_HOME;
  process.env.CACHELANE_HOME = tmpDir;
  lastCaptured = null;

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

describe("openai pipeline — forwarded request", () => {
  it("injects prompt_cache_key into the forwarded OpenAI body", async () => {
    const res = await postChat(proxyPort, JSON.stringify(buildOpenAIRequest()));

    expect(res.status).toBe(200);
    expect(lastCaptured).not.toBeNull();
    const forwarded = JSON.parse(lastCaptured!.body) as { prompt_cache_key?: string };
    expect(typeof forwarded.prompt_cache_key).toBe("string");
    expect(forwarded.prompt_cache_key).toMatch(/^cachelane-/);
  });

  it("never injects Anthropic cache_control anywhere in the forwarded body", async () => {
    await postChat(proxyPort, JSON.stringify(buildOpenAIRequest()));

    expect(lastCaptured).not.toBeNull();
    expect(lastCaptured!.body).not.toContain("cache_control");
  });

  it("preserves the messages array order (chat order is semantic)", async () => {
    await postChat(proxyPort, JSON.stringify(buildOpenAIRequest()));

    expect(lastCaptured).not.toBeNull();
    const forwarded = JSON.parse(lastCaptured!.body) as {
      messages: { role: string; content: string }[];
    };
    expect(forwarded.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(forwarded.messages.map((m) => m.content)).toEqual([
      "You are a helpful assistant.",
      "Hello",
      "Hi there",
      "What is 2+2?",
    ]);
  });

  it("forwards the inbound Authorization header (no SigV4, no x-api-key strip)", async () => {
    await postChat(proxyPort, JSON.stringify(buildOpenAIRequest()));

    expect(lastCaptured?.headers["authorization"]).toBe("Bearer sk-test-key");
  });
});
