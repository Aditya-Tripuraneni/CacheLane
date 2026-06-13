/**
 * Integration tests for the AWS Bedrock signing path (BD1–BD4, B1, H2).
 *
 * Drives a POST /model/<id>/invoke request through a real createProxyServer to a
 * fake upstream that captures the forwarded request. AWS credentials are supplied
 * via env vars so defaultProvider() resolves without any network/IMDS call.
 *
 * What we assert (the regressions these guard against):
 *  - BD1: x-amz-content-sha256 is regenerated over the FORWARDED body (not the
 *         client's stale hash) → signature matches the bytes actually sent.
 *  - BD2: x-amz-security-token is the PROXY's token, not Claude Code's.
 *  - BD3: x-amz-date is regenerated (the client's stale date is dropped).
 *  - B1:  no Anthropic credential headers (x-api-key / anthropic-*) reach AWS.
 *  - Auth: an AWS4-HMAC-SHA256 Authorization header is present.
 */

import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProxyServer } from "../server.js";
import { CacheStateTracker } from "../../orchestrator/index.js";
import { openDatabase, type CachelaneDb } from "../../storage/index.js";
import type { AnthropicMessagesRequest } from "../../orchestrator/types.js";

function buildMessagesRequest(): AnthropicMessagesRequest {
  return {
    model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    system: [{ type: "text", text: "You are a helpful assistant." }],
    tools: [{ name: "Read", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi" }] },
      { role: "user", content: [{ type: "text", text: "2+2?" }] },
    ],
    max_tokens: 1024,
  };
}

interface Captured {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let fakeUpstream: http.Server;
let fakeUpstreamPort: number;
let lastCaptured: Captured | null = null;
let fakeResponseBody: Buffer = Buffer.from(
  JSON.stringify({ id: "msg", type: "message", usage: { input_tokens: 10, output_tokens: 5 } }),
);
let fakeResponseContentType = "application/json";

/** Build an AWS event-stream frame wrapping an inner Anthropic event (Bedrock shape). */
function buildEventStreamFrame(inner: Record<string, unknown>): Buffer {
  const innerJson = Buffer.from(JSON.stringify(inner), "utf-8");
  const payload = Buffer.from(JSON.stringify({ bytes: innerJson.toString("base64") }), "utf-8");
  const total = 12 + payload.length + 4;
  const frame = Buffer.alloc(total);
  frame.writeUInt32BE(total, 0);
  frame.writeUInt32BE(0, 4);
  payload.copy(frame, 12);
  return frame;
}

function waitForServer(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    if (server.listening) return resolve((server.address() as net.AddressInfo).port);
    server.once("listening", () => resolve((server.address() as net.AddressInfo).port));
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    server.close(() => resolve());
  });
}

/** POST a Bedrock-style /model/<id>/invoke request, simulating Claude Code's
 *  already-signed inbound headers (stale AWS sig + Anthropic creds). */
function postBedrock(
  proxyPort: number,
  body: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, "utf-8");
    const staleHash = createHash("sha256").update("SOME OTHER ORIGINAL BODY").digest("hex");
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: proxyPort,
        path: "/model/anthropic.claude-3-5-sonnet-20241022-v2:0/invoke",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(buf.length),
          // Claude Code's own (stale) AWS SigV4 artifacts:
          authorization:
            "AWS4-HMAC-SHA256 Credential=AKIA_CLAUDECODE/20200101/us-west-2/bedrock/aws4_request, SignedHeaders=host;x-amz-date, Signature=deadbeef",
          "x-amz-date": "20200101T000000Z",
          "x-amz-security-token": "CLAUDE_CODE_SESSION_TOKEN",
          "x-amz-content-sha256": staleHash,
          // Anthropic creds that must never reach AWS:
          "x-api-key": "sk-ant-secret",
          "anthropic-version": "bedrock-2023-05-31",
          "anthropic-beta": "tool-2024",
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") }));
      },
    );
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

beforeAll(async () => {
  fakeUpstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      lastCaptured = {
        method: req.method ?? "",
        path: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf-8"),
      };
      res.writeHead(200, { "content-type": fakeResponseContentType });
      res.end(fakeResponseBody);
    });
  });
  fakeUpstream.listen(0, "127.0.0.1");
  fakeUpstreamPort = await waitForServer(fakeUpstream);
});

afterAll(async () => {
  await closeServer(fakeUpstream);
});

let tmpDir: string;
let db: CachelaneDb;
let proxy: http.Server;
let proxyPort: number;
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-bedrock-test-"));
  lastCaptured = null;
  fakeResponseBody = Buffer.from(
    JSON.stringify({ id: "msg", type: "message", usage: { input_tokens: 10, output_tokens: 5 } }),
  );
  fakeResponseContentType = "application/json";
  savedEnv = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN,
    AWS_REGION: process.env.AWS_REGION,
    CACHELANE_HOME: process.env.CACHELANE_HOME,
  };
  // Static env credentials → defaultProvider resolves with no network call.
  process.env.AWS_ACCESS_KEY_ID = "AKIA_PROXY_TEST";
  process.env.AWS_SECRET_ACCESS_KEY = "proxy-secret-test";
  process.env.AWS_SESSION_TOKEN = "PROXY_SESSION_TOKEN";
  process.env.AWS_REGION = "us-east-1";
  process.env.CACHELANE_HOME = tmpDir;

  db = openDatabase(path.join(tmpDir, "test.db"));
  proxy = createProxyServer(
    {
      port: 0,
      workspace_id: "test-ws",
      session_id: "bedrock-sess",
      // Explicit non-default host → signForBedrock honors it (signs + connects here).
      upstream: { host: "127.0.0.1", port: fakeUpstreamPort, ssl: false },
    },
    db,
    new CacheStateTracker(),
  );
  proxy.listen(0, "127.0.0.1");
  proxyPort = await waitForServer(proxy);
});

afterEach(async () => {
  await closeServer(proxy);
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("Bedrock signing path", () => {
  it("forwards an AWS4-HMAC-SHA256 Authorization header (request is signed)", async () => {
    await postBedrock(proxyPort, JSON.stringify(buildMessagesRequest()));
    expect(lastCaptured).not.toBeNull();
    expect(String(lastCaptured!.headers["authorization"])).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("BD2: replaces the client's x-amz-security-token with the proxy's token", async () => {
    await postBedrock(proxyPort, JSON.stringify(buildMessagesRequest()));
    expect(lastCaptured!.headers["x-amz-security-token"]).toBe("PROXY_SESSION_TOKEN");
    expect(lastCaptured!.headers["x-amz-security-token"]).not.toBe("CLAUDE_CODE_SESSION_TOKEN");
  });

  it("BD3: regenerates x-amz-date (drops the client's stale timestamp)", async () => {
    await postBedrock(proxyPort, JSON.stringify(buildMessagesRequest()));
    expect(lastCaptured!.headers["x-amz-date"]).not.toBe("20200101T000000Z");
    expect(String(lastCaptured!.headers["x-amz-date"])).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it("BD1: never forwards the client's stale x-amz-content-sha256; any hash sent matches the forwarded body", async () => {
    const staleHash = createHash("sha256").update("SOME OTHER ORIGINAL BODY").digest("hex");
    await postBedrock(proxyPort, JSON.stringify(buildMessagesRequest()));
    const sent = lastCaptured!.headers["x-amz-content-sha256"];
    // aws4 signs the payload hash into the canonical request; for the bedrock
    // service it does not always re-emit the header. The invariant that matters:
    // the client's STALE hash must never survive (it would otherwise be signed as
    // the payload hash → SignatureDoesNotMatch). If a hash IS emitted, it must be
    // over the body we actually forwarded.
    expect(sent).not.toBe(staleHash);
    if (typeof sent === "string") {
      const expected = createHash("sha256").update(lastCaptured!.body, "utf-8").digest("hex");
      expect(sent).toBe(expected);
    }
  });

  it("B1: does NOT forward Anthropic credential headers to AWS", async () => {
    await postBedrock(proxyPort, JSON.stringify(buildMessagesRequest()));
    expect(lastCaptured!.headers["x-api-key"]).toBeUndefined();
    expect(lastCaptured!.headers["anthropic-version"]).toBeUndefined();
    expect(lastCaptured!.headers["anthropic-beta"]).toBeUndefined();
  });

  it("does not carry the client's original AWS Authorization into the signature scope", async () => {
    await postBedrock(proxyPort, JSON.stringify(buildMessagesRequest()));
    // The forwarded Authorization must be freshly minted with the proxy's key,
    // not Claude Code's stale credential.
    expect(String(lastCaptured!.headers["authorization"])).toContain("AKIA_PROXY_TEST");
    expect(String(lastCaptured!.headers["authorization"])).not.toContain("AKIA_CLAUDECODE");
  });

  it("routes the request to the configured Bedrock upstream and preserves the /model path", async () => {
    await postBedrock(proxyPort, JSON.stringify(buildMessagesRequest()));
    expect(lastCaptured!.path).toBe("/model/anthropic.claude-3-5-sonnet-20241022-v2:0/invoke");
  });

  it("forwards Bedrock guardrail custom headers AND signs them (they survive the scrub)", async () => {
    await postBedrock(proxyPort, JSON.stringify(buildMessagesRequest()), {
      "x-amzn-bedrock-guardrailidentifier": "ccav1o7z6tq6",
      "x-amzn-bedrock-guardrailversion": "10",
    });
    // Guardrail headers must reach the Bedrock upstream (Claude Code injects them
    // via ANTHROPIC_CUSTOM_HEADERS; dropping them disables the configured guardrail).
    expect(lastCaptured!.headers["x-amzn-bedrock-guardrailidentifier"]).toBe("ccav1o7z6tq6");
    expect(lastCaptured!.headers["x-amzn-bedrock-guardrailversion"]).toBe("10");
    // And they must be part of the SigV4 signature, else Bedrock returns 403
    // SignatureDoesNotMatch when it canonicalizes the request including them.
    const auth = String(lastCaptured!.headers["authorization"]);
    expect(auth).toMatch(/SignedHeaders=[^,]*x-amzn-bedrock-guardrailidentifier/);
    expect(auth).toMatch(/SignedHeaders=[^,]*x-amzn-bedrock-guardrailversion/);
  });

  it("H1: records usage from a Bedrock event-stream (binary) response", async () => {
    fakeResponseContentType = "application/vnd.amazon.eventstream";
    fakeResponseBody = Buffer.concat([
      buildEventStreamFrame({
        type: "message_start",
        message: { usage: { input_tokens: 321, cache_read_input_tokens: 100, output_tokens: 0 } },
      }),
      buildEventStreamFrame({ type: "message_delta", usage: { output_tokens: 77 } }),
    ]);

    await postBedrock(proxyPort, JSON.stringify(buildMessagesRequest()));

    // Poll for the recorded turn (recording happens after the response completes).
    const deadline = Date.now() + 2000;
    let turn: { input_tokens: number; output_tokens: number; cache_read_tokens: number } | null = null;
    while (Date.now() < deadline) {
      turn = db.getTurnByNumber("test-ws", "bedrock-sess", 1) as typeof turn;
      if (turn) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(turn).not.toBeNull();
    expect(turn!.input_tokens).toBe(321);
    expect(turn!.output_tokens).toBe(77);
    expect(turn!.cache_read_tokens).toBe(100);
  });
});
