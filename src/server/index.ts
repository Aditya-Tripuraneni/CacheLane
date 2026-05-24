import { homedir } from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDatabase, type CachelaneDb } from "../storage/index.js";
import { loadConfig } from "../config/index.js";
import { CacheStateTracker } from "../orchestrator/index.js";
import { tryBindProxy, type ProxyLifecycle } from "../proxy/lifecycle.js";
import {
  expandInputSchema,
  explainInputSchema,
  handleExpandTool,
  handleExplainTool,
  handleStatsTool,
  jsonTextPayload,
  statsInputSchema,
  type CachelaneMcpContext,
} from "./tools.js";

export type {
  CachelaneMcpContext,
  ExpandToolInput,
  ExplainToolInput,
  StatsToolInput,
} from "./tools.js";

export const CACHELANE_VERSION = "1.0.0";

export interface CreateCachelaneMcpServerOptions {
  db: CachelaneDb;
  workspace_id: string;
  session_id: string;
  now_ms?: number;
}

export interface StartCachelaneStdioServerOptions {
  db_path?: string;
  config_path?: string;
  workspace_id?: string;
  session_id?: string;
}

export function defaultCachelaneDbPath(): string {
  return path.join(homedir(), ".cachelane", "cachelane.db");
}

export function defaultCachelaneConfigPath(): string {
  return path.join(homedir(), ".cachelane", "config.json");
}

export function createCachelaneMcpServer(
  options: CreateCachelaneMcpServerOptions,
): McpServer {
  const context: CachelaneMcpContext = options;
  const server = new McpServer({
    name: "cachelane",
    version: CACHELANE_VERSION,
  });

  server.registerTool(
    "cachelane:stats",
    {
      title: "CacheLane Stats",
      description: "Return cache, pruning, keepalive, and cost-unit aggregates.",
      inputSchema: statsInputSchema,
    },
    async (input) => jsonTextPayload(handleStatsTool(context, input)),
  );

  server.registerTool(
    "cachelane:explain",
    {
      title: "CacheLane Explain",
      description: "Return metadata-only explanation for the latest or requested turn.",
      inputSchema: explainInputSchema,
    },
    async (input) => jsonTextPayload(handleExplainTool(context, input)),
  );

  server.registerTool(
    "cachelane:expand",
    {
      title: "CacheLane Expand",
      description: "Return trusted refetch metadata for a stubbed block.",
      inputSchema: expandInputSchema,
    },
    async (input) => jsonTextPayload(handleExpandTool(context, input)),
  );

  return server;
}

/**
 * Heuristic: `process.env.VITEST` is set to "true" by Vitest itself. We avoid
 * installing global signal/exception handlers under test so Vitest's own
 * lifecycle stays intact. The unified-process behaviour is still exercised by
 * the lifecycle.test.ts suite which drives tryBindProxy() directly.
 */
function inTestEnvironment(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

export async function startCachelaneStdioServer(
  options: StartCachelaneStdioServerOptions = {},
): Promise<void> {
  const dbPath = options.db_path ?? defaultCachelaneDbPath();
  const configPath = options.config_path ?? defaultCachelaneConfigPath();
  const workspaceId =
    options.workspace_id ?? process.env.CACHELANE_WORKSPACE_ID ?? "default";
  const sessionId =
    options.session_id ?? process.env.CACHELANE_SESSION_ID ?? "default";

  // Single DB handle and single tracker shared between MCP server and proxy.
  // WAL mode allows concurrent reads/writes across the in-process consumers.
  const db = openDatabase(dbPath);
  const tracker = new CacheStateTracker();
  const config = loadConfig(configPath);

  let lifecycle: ProxyLifecycle | null = null;
  if (config.features.auto_proxy) {
    lifecycle = await tryBindProxy(
      {
        port: config.proxy.port,
        db_path: dbPath,
        config_path: configPath,
        workspace_id: workspaceId,
        session_id: sessionId,
        upstream: {
          host: config.proxy.upstream_host,
          port: config.proxy.upstream_port,
          ssl: config.proxy.upstream_ssl,
        },
        drain_timeout_ms: config.proxy.drain_timeout_ms,
      },
      db,
      tracker,
    );
    if (lifecycle === null) {
      console.warn(
        "[cachelane] continuing in MCP-only mode (proxy bind failed)",
      );
    } else {
      console.info(
        `[cachelane] proxy listening on http://127.0.0.1:${lifecycle.port}`,
      );
    }
  }

  const server = createCachelaneMcpServer({
    db,
    workspace_id: workspaceId,
    session_id: sessionId,
  });
  const transport = new StdioServerTransport();

  // Shutdown choreography: stop the keepalive worker (M8-G5 wires it in),
  // drain the proxy, then close the DB. Idempotent — multiple signals or
  // crashes converge on a single shutdown.
  let shuttingDown = false;
  const runShutdown = async (exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      // TODO(m8-g5): stop keepalive worker
      if (lifecycle !== null) {
        await lifecycle.shutdown();
      }
    } catch (err) {
      console.error("[cachelane] error during shutdown", err);
    } finally {
      try { db.close(); } catch { /* ignore */ }
      process.exit(exitCode);
    }
  };

  // Skip installing global handlers under Vitest — they would call
  // process.exit() and kill the test runner.
  if (!inTestEnvironment()) {
    process.on("SIGTERM", () => { void runShutdown(0); });
    process.on("SIGINT", () => { void runShutdown(0); });
    process.on("uncaughtException", (err) => {
      console.error("[cachelane] uncaughtException — exiting cleanly", err);
      void runShutdown(1);
    });
    process.on("unhandledRejection", (reason) => {
      console.error("[cachelane] unhandledRejection — exiting cleanly", reason);
      void runShutdown(1);
    });
  }

  // Backstop for non-signal exits (e.g., transport end-of-stream).
  process.once("exit", () => {
    try { db.close(); } catch { /* ignore shutdown errors */ }
  });

  await server.connect(transport);
}
