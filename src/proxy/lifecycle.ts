/**
 * Lifecycle wrapper around createProxyServer().
 *
 * tryBindProxy() attempts to bind the HTTP proxy on the requested port. If the
 * port is already in use (EADDRINUSE) — which happens when a second cachelane
 * instance launches under the same Claude Code session, or any unrelated
 * process owns 7332 — we resolve to null so the caller can run MCP-only.
 *
 * shutdown() drains in-flight requests for up to drain_timeout_ms, then force-
 * closes remaining sockets via server.closeAllConnections() (Node ≥18.2).
 */

import type http from "node:http";
import type { CachelaneDb } from "../storage/index.js";
import type { CacheStateTracker } from "../orchestrator/index.js";
import { createProxyServer, type ProxyOptions } from "./server.js";

export interface ProxyLifecycle {
  server: http.Server;
  port: number;
  shutdown(): Promise<void>;
}

export interface TryBindProxyOptions extends ProxyOptions {
  drain_timeout_ms: number;
}

const DEFAULT_PORT = 7332;
const DEFAULT_HOST = "127.0.0.1";

export async function tryBindProxy(
  opts: TryBindProxyOptions,
  db: CachelaneDb,
  tracker: CacheStateTracker,
): Promise<ProxyLifecycle | null> {
  const server = createProxyServer(opts, db, tracker);
  const requestedPort = opts.port ?? DEFAULT_PORT;
  const host = DEFAULT_HOST;

  return new Promise<ProxyLifecycle | null>((resolve) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code === "EADDRINUSE") {
        console.warn(
          `[cachelane] port ${requestedPort} already in use — running without proxy`,
        );
      } else {
        console.warn(
          `[cachelane] proxy bind error (${err.code ?? "?"}): ${err.message} — running without proxy`,
        );
      }
      resolve(null);
    };

    server.once("error", onError);
    server.listen(requestedPort, host, () => {
      server.off("error", onError);
      const addr = server.address();
      const boundPort =
        typeof addr === "object" && addr !== null ? addr.port : requestedPort;
      resolve({
        server,
        port: boundPort,
        shutdown: () => gracefulShutdown(server, opts.drain_timeout_ms),
      });
    });
  });
}

function gracefulShutdown(
  server: http.Server,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let closed = false;
    const done = (): void => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      resolve();
    };

    // close() stops accepting new connections and resolves once all in-flight
    // requests finish naturally.
    server.close(() => done());

    const timer = setTimeout(() => {
      if (closed) return;
      console.warn(
        `[cachelane] drain timeout (${timeoutMs}ms) — force-closing connections`,
      );
      // Available in Node ≥18.2 — destroys remaining keep-alive sockets so
      // server.close() can fire its callback.
      const s = server as http.Server & {
        closeAllConnections?: () => void;
      };
      s.closeAllConnections?.();
      done();
    }, timeoutMs);
  });
}
