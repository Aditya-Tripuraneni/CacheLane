import { homedir } from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDatabase, type CachelaneDb } from "../storage/index.js";
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

export const CACHELANE_VERSION = "0.0.1";

export interface CreateCachelaneMcpServerOptions {
  db: CachelaneDb;
  workspace_id: string;
  session_id: string;
  now_ms?: number;
}

export interface StartCachelaneStdioServerOptions {
  db_path?: string;
  workspace_id?: string;
  session_id?: string;
}

export function defaultCachelaneDbPath(): string {
  return path.join(homedir(), ".cachelane", "cachelane.db");
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

export async function startCachelaneStdioServer(
  options: StartCachelaneStdioServerOptions = {},
): Promise<void> {
  const db = openDatabase(options.db_path ?? defaultCachelaneDbPath());
  const server = createCachelaneMcpServer({
    db,
    workspace_id: options.workspace_id ?? process.env.CACHELANE_WORKSPACE_ID ?? "default",
    session_id: options.session_id ?? process.env.CACHELANE_SESSION_ID ?? "default",
  });
  const transport = new StdioServerTransport();

  process.once("exit", () => {
    try {
      db.close();
    } catch {
      /* ignore shutdown errors */
    }
  });

  await server.connect(transport);
}
