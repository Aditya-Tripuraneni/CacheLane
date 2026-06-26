/**
 * Task 9 — end-to-end: an OpenAI /v1/chat/completions request through the proxy
 * gets the cache-optimizing treatment (prompt_cache_key injected, NO Anthropic
 * cache_control), and a repeated stable prefix routes to the same key and yields
 * reported cached tokens.
 *
 * Mirrors the integration harness in openai-pipeline.test.ts (real proxy via
 * startProxy + a fake upstream + real SQLite DB), but the fake upstream models
 * OpenAI IMPLICIT PREFIX CACHING (read-only, `usage.prompt_tokens_details.
 * cached_tokens`) rather than Anthropic `cache_control` breakpoints.
 *
 * The four end-to-end assertions:
 *   1. The body the proxy FORWARDS contains `prompt_cache_key` and NO
 *      `cache_control` (OpenAI safety — cache_control 400s on OpenAI).
 *   2. Two requests sharing an identical static prefix carry the SAME
 *      `prompt_cache_key` (stable prefix → stable key → cache routing).
 *   3. The fake upstream, applying its own OpenAI-style exact-prefix rule to the
 *      forwarded bodies, reports `cached_tokens > 0` on the second request — the
 *      proxy's prefix-stabilization actually enables a cache hit; a salted
 *      (front-busted) prefix is a guaranteed miss for contrast.
 *   4. Fail-open: a malformed OpenAI body (invalid JSON) is forwarded unchanged
 *      and the proxy does not crash.
 */

import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startProxy } from "../server.js";

// ---------------------------------------------------------------------------
// Fake OpenAI upstream — models OpenAI implicit (read-only) prefix caching.
//
// OpenAI matches the longest EXACT byte prefix of a previously seen request and
// bills those tokens as `cached_tokens`. We approximate the "static prefix" as
// the serialized front of the request up to (but excluding) the first user
// message: model + tools + any system message. If the same prefix is seen again
// the second request reports cached_tokens > 0; the first reports 0.
//
// This instrument is NEUTRAL: it knows nothing about CacheLane and applies the
// same exact-prefix rule to every body it receives. A cache hit can therefore
// only come from the forwarded requests genuinely sharing a byte-identical
// static prefix — which is exactly what the proxy's prefix-stabilization buys.
// ---------------------------------------------------------------------------

interface OpenAIChatBody {
  model?: unknown;
  tools?: unknown;
  messages?: { role?: unknown; content?: unknown }[];
}

/** Deterministic token estimate — same estimator for every body, so the
 *  absolute number does not matter, only that it is identical per content. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** The exact static-prefix string OpenAI would match on: everything ahead of
 *  the first user message. We serialize {model, tools, system-messages} in
 *  request order. `prompt_cache_key` is excluded so the simulator scores raw
 *  content identity, independent of CacheLane's routing key. */
function staticPrefixOf(body: OpenAIChatBody): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const prefixMessages: unknown[] = [];
  for (const m of messages) {
    if (m && m.role === "user") break; // first user message ends the static prefix
    prefixMessages.push(m);
  }
  return JSON.stringify({ model: body.model ?? null, tools: body.tools ?? null, prefixMessages });
}

interface FakeOpenAIUpstream {
  server: http.Server;
  /** Raw bodies of every request the proxy forwarded, in order. */
  capturedBodies: string[];
  /** Reported cached_tokens for each forwarded request, in order. */
  cachedTokensSeen: number[];
  reset(): void;
}

function createFakeOpenAIUpstream(): FakeOpenAIUpstream {
  const seenPrefixHashes = new Set<string>();
  const capturedBodies: string[] = [];
  const cachedTokensSeen: number[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      capturedBodies.push(body);

      let cachedTokens = 0;
      let promptTokens = 0;
      try {
        const parsed = JSON.parse(body) as OpenAIChatBody;
        const prefix = staticPrefixOf(parsed);
        const prefixTokens = estimateTokens(prefix);
        promptTokens = estimateTokens(body);
        const hash = crypto.createHash("sha256").update(prefix).digest("hex");
        // Exact-prefix match against a previously seen request → cache read.
        if (seenPrefixHashes.has(hash)) cachedTokens = prefixTokens;
        seenPrefixHashes.add(hash);
      } catch {
        // Malformed body: no caching, fail-open accounting.
        cachedTokens = 0;
        promptTokens = 0;
      }
      cachedTokensSeen.push(cachedTokens);

      const responseBody = JSON.stringify({
        id: "chatcmpl_sim",
        object: "chat.completion",
        model: "gpt-4o",
        choices: [
          { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: 1,
          total_tokens: promptTokens + 1,
          prompt_tokens_details: { cached_tokens: cachedTokens },
        },
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(responseBody);
    });
  });

  return {
    server,
    capturedBodies,
    cachedTokensSeen,
    reset() {
      seenPrefixHashes.clear();
      capturedBodies.length = 0;
      cachedTokensSeen.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Request builders.
// ---------------------------------------------------------------------------

/** A large static prefix (system + tools) so it dwarfs the trailing user turn —
 *  models the long-context repo prompt where cache savings actually matter. */
const BIG_SYSTEM = "You are a coding assistant. ".repeat(64);

function buildOpenAIRequest(userText: string, systemSalt = ""): Record<string, unknown> {
  return {
    model: "gpt-4o",
    messages: [
      { role: "system", content: `${systemSalt}${BIG_SYSTEM}` },
      { role: "user", content: userText },
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

// ---------------------------------------------------------------------------
// HTTP plumbing (mirrors openai-pipeline.test.ts).
// ---------------------------------------------------------------------------

function postChat(proxyPort: number, body: string): Promise<{ status: number; body: string }> {
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

// ---------------------------------------------------------------------------
// Harness wiring.
// ---------------------------------------------------------------------------

let fakeUpstream: FakeOpenAIUpstream;
let fakeUpstreamPort: number;

beforeAll(async () => {
  fakeUpstream = createFakeOpenAIUpstream();
  fakeUpstream.server.listen(0, "127.0.0.1");
  fakeUpstreamPort = await waitForServer(fakeUpstream.server);
});

afterAll(async () => {
  await closeServer(fakeUpstream.server);
});

let tmpDir: string;
let dbPath: string;
let proxy: http.Server;
let proxyPort: number;
let originalEnvCachelaneHome: string | undefined;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-openai-h2h-"));
  dbPath = path.join(tmpDir, "test.db");
  originalEnvCachelaneHome = process.env.CACHELANE_HOME;
  process.env.CACHELANE_HOME = tmpDir;
  fakeUpstream.reset();

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

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

interface ForwardedBody {
  prompt_cache_key?: unknown;
  messages?: { role?: unknown; content?: unknown }[];
}

function parseForwarded(body: string): ForwardedBody {
  return JSON.parse(body) as ForwardedBody;
}

describe("openai savings — head to head", () => {
  it("forwards prompt_cache_key and NEVER cache_control (OpenAI safety)", async () => {
    const res = await postChat(proxyPort, JSON.stringify(buildOpenAIRequest("first question")));

    expect(res.status).toBe(200);
    expect(fakeUpstream.capturedBodies).toHaveLength(1);
    const forwarded = parseForwarded(fakeUpstream.capturedBodies[0]!);
    expect(typeof forwarded.prompt_cache_key).toBe("string");
    expect(fakeUpstream.capturedBodies[0]!).not.toContain("cache_control");
  });

  it("stable prefix → identical prompt_cache_key across two requests", async () => {
    await postChat(proxyPort, JSON.stringify(buildOpenAIRequest("question one")));
    await postChat(proxyPort, JSON.stringify(buildOpenAIRequest("a different question two")));

    expect(fakeUpstream.capturedBodies).toHaveLength(2);
    const first = parseForwarded(fakeUpstream.capturedBodies[0]!);
    const second = parseForwarded(fakeUpstream.capturedBodies[1]!);

    expect(typeof first.prompt_cache_key).toBe("string");
    // Trailing user turn differs, but the static prefix (system + tools) is
    // identical → CacheLane must route both to the SAME key.
    expect(second.prompt_cache_key).toBe(first.prompt_cache_key);
  });

  it("second identical-prefix request reports cached_tokens > 0 (real hit); salted prefix misses", async () => {
    // Stable-prefix arm: same system + tools, different user turn.
    await postChat(proxyPort, JSON.stringify(buildOpenAIRequest("question one")));
    await postChat(proxyPort, JSON.stringify(buildOpenAIRequest("question two")));

    expect(fakeUpstream.cachedTokensSeen).toHaveLength(2);
    // First request primes the cache → miss.
    expect(fakeUpstream.cachedTokensSeen[0]).toBe(0);
    // Second request shares the byte-identical static prefix → cache HIT.
    expect(fakeUpstream.cachedTokensSeen[1]!).toBeGreaterThan(0);

    // The proxy reports the upstream's cached_tokens back to the client.
    const res = await postChat(proxyPort, JSON.stringify(buildOpenAIRequest("question three")));
    const clientUsage = JSON.parse(res.body) as {
      usage?: { prompt_tokens_details?: { cached_tokens?: number } };
    };
    expect(clientUsage.usage?.prompt_tokens_details?.cached_tokens ?? 0).toBeGreaterThan(0);
  });

  it("salted (front-busted) prefix is a guaranteed cache MISS for contrast", async () => {
    // Each request salts the FRONT of the system block with a unique nonce, which
    // breaks OpenAI's exact-prefix match — the baseline/always-miss arm.
    await postChat(proxyPort, JSON.stringify(buildOpenAIRequest("q1", "[bust:1]")));
    await postChat(proxyPort, JSON.stringify(buildOpenAIRequest("q2", "[bust:2]")));

    expect(fakeUpstream.cachedTokensSeen).toEqual([0, 0]);
  });

  it("fail-open: malformed OpenAI body is forwarded unchanged and proxy does not crash", async () => {
    const garbled = "not-json{{{";
    const res = await postChat(proxyPort, garbled);

    expect(res.status).toBe(200);
    expect(fakeUpstream.capturedBodies).toHaveLength(1);
    // The proxy must forward the original bytes verbatim — no prompt_cache_key
    // injection, no cache_control, no crash.
    expect(fakeUpstream.capturedBodies[0]).toBe(garbled);
    expect(fakeUpstream.capturedBodies[0]!).not.toContain("prompt_cache_key");
    expect(fakeUpstream.capturedBodies[0]!).not.toContain("cache_control");
  });
});
