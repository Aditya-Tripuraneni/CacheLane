/**
 * Tests for tryBindProxy() lifecycle — the unified MCP+Proxy entrypoint.
 *
 * Real components: real http.Server, real SQLite (temp dir), real
 * CacheStateTracker. Fail-open semantics on EADDRINUSE and graceful shutdown
 * with drain_timeout_ms are the load-bearing behaviours under test.
 */

import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tryBindProxy, type ProxyLifecycle } from "../lifecycle.js";
import { openDatabase, type CachelaneDb } from "../../storage/index.js";
import { CacheStateTracker } from "../../orchestrator/index.js";

let tmpDir: string;
let dbPath: string;
let db: CachelaneDb;
let tracker: CacheStateTracker;
let lifecycle: ProxyLifecycle | null;
let blocker: http.Server | null;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-lifecycle-test-"));
  dbPath = path.join(tmpDir, "test.db");
  db = openDatabase(dbPath);
  tracker = new CacheStateTracker();
  lifecycle = null;
  blocker = null;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (lifecycle !== null) {
    await lifecycle.shutdown();
    lifecycle = null;
  }
  if (blocker !== null) {
    await new Promise<void>((resolve) => blocker!.close(() => resolve()));
    blocker = null;
  }
  try { db.close(); } catch { /* may already be closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("tryBindProxy", () => {
  it("returns a lifecycle object when the port is free", async () => {
    lifecycle = await tryBindProxy(
      {
        port: 0, // let OS assign a free port
        drain_timeout_ms: 5000,
        upstream: { host: "127.0.0.1", port: 1, ssl: false }, // not used for this test
      },
      db,
      tracker,
    );

    expect(lifecycle).not.toBeNull();
    expect(lifecycle!.server.listening).toBe(true);
    expect(typeof lifecycle!.shutdown).toBe("function");
    expect(typeof lifecycle!.port).toBe("number");
    expect(lifecycle!.port).toBeGreaterThan(0);
  });

  it("returns null when the port is already bound (EADDRINUSE)", async () => {
    // Bind a blocker server on an OS-assigned port, then try to take it.
    blocker = http.createServer((_req, res) => res.end("blocker"));
    const blockerPort = await new Promise<number>((resolve, reject) => {
      blocker!.once("error", reject);
      blocker!.listen(0, "127.0.0.1", () => {
        const addr = blocker!.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });

    const result = await tryBindProxy(
      {
        port: blockerPort,
        drain_timeout_ms: 5000,
        upstream: { host: "127.0.0.1", port: 1, ssl: false },
      },
      db,
      tracker,
    );

    expect(result).toBeNull();
  });

  it("shutdown() resolves and stops accepting new connections", async () => {
    lifecycle = await tryBindProxy(
      {
        port: 0,
        drain_timeout_ms: 5000,
        upstream: { host: "127.0.0.1", port: 1, ssl: false },
      },
      db,
      tracker,
    );
    expect(lifecycle).not.toBeNull();
    const boundPort = lifecycle!.port;

    await lifecycle!.shutdown();
    expect(lifecycle!.server.listening).toBe(false);

    // Subsequent connect attempt should fail (ECONNREFUSED).
    const connectErr = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port: boundPort });
      socket.once("error", (err: NodeJS.ErrnoException) => resolve(err));
      socket.once("connect", () => {
        socket.destroy();
        resolve(null);
      });
    });

    expect(connectErr).not.toBeNull();
    expect(connectErr!.code).toBe("ECONNREFUSED");

    lifecycle = null; // already shut down — skip afterEach cleanup
  });

  it("shutdown() force-closes long-running connections after drain_timeout_ms", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    lifecycle = await tryBindProxy(
      {
        port: 0,
        drain_timeout_ms: 200,
        // Upstream that NEVER responds — the proxy request handler will hang.
        // We don't actually need to upstream; we just need an open TCP connection
        // to the proxy that the proxy will not finish on its own. Easier: open
        // a raw socket and never send a complete HTTP request.
        upstream: { host: "127.0.0.1", port: 1, ssl: false },
      },
      db,
      tracker,
    );
    expect(lifecycle).not.toBeNull();

    // Open a TCP connection but never send a complete request body.
    // server.close() will wait for it, then force-close at drain_timeout_ms.
    const socket = net.createConnection({ host: "127.0.0.1", port: lifecycle!.port });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    // Send a partial request — keeps the connection alive in the server.
    socket.write("POST /v1/messages HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\n");
    // Give Node's event loop a moment to register the socket on the server side
    // so server.close() considers it an in-flight connection.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const start = Date.now();
    await lifecycle!.shutdown();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(2000);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("drain timeout"),
    );

    socket.destroy();
    lifecycle = null; // already shut down
  });
});
