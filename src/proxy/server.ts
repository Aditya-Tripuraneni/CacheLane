import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/index.js";
import { openDatabase, calculateEffectiveCostUnits } from "../storage/index.js";
import { handlePreRequest } from "../hooks/pre-request.js";
import { classifyBlock } from "../classifier/index.js";
import { CacheStateTracker } from "../orchestrator/index.js";
import type { AnthropicMessagesRequest, AnthropicMessage } from "../orchestrator/index.js";
import type { UnclassifiedBlock } from "../classifier/index.js";
import type { Classification } from "../classifier/index.js";

const DEFAULT_UPSTREAM_HOST = "api.anthropic.com";
const DEFAULT_UPSTREAM_PORT = 443;
const DEFAULT_PORT = 7332;

/**
 * Derive a per-message turn number by counting user messages.
 * Each user message starts a new turn (0-indexed); assistant messages
 * share the turn number of their preceding user message.
 * This matches the classifier's expectation: lower turnNumber = more stable.
 */
function messagesToUnclassifiedBlocks(
  messages: AnthropicMessage[],
  currentTurn: number,
): UnclassifiedBlock[] {
  let turnNumber = 0;
  return messages.map((msg, i) => {
    // Each user message after the first increments the turn counter
    if (i > 0 && msg.role === "user") turnNumber++;

    const content = typeof msg.content === "string"
      ? msg.content
      : msg.content.map((c) => {
          if ("text" in c) return c.text;
          if ("name" in c) return c.name;
          if ("tool_use_id" in c) {
            const inner = c.content;
            if (typeof inner === "string") return inner;
            if (Array.isArray(inner)) return inner.map((x) => ("text" in x ? x.text : "")).join("\n");
            return "";
          }
          return "";
        }).join("\n");

    const isToolResultMsg =
      msg.role === "user" &&
      Array.isArray(msg.content) &&
      msg.content.some((c) => c.type === "tool_result");

    const isToolUseMsg =
      msg.role === "assistant" &&
      Array.isArray(msg.content) &&
      msg.content.some((c) => c.type === "tool_use");

    return {
      content,
      role: msg.role,
      turnNumber,
      currentTurn,
      isToolUseResultPair: isToolResultMsg || isToolUseMsg,
    } satisfies UnclassifiedBlock;
  });
}

function classifyAllMessages(
  messages: AnthropicMessage[],
  currentTurn: number,
  config: ReturnType<typeof loadConfig>,
): Classification[] {
  const blocks = messagesToUnclassifiedBlocks(messages, currentTurn);
  return blocks.map((block) => {
    const result = classifyBlock(block, config.classification);
    if (result !== null) return result;
    // Excluded block — VOLATILE fallback preserves index alignment with messages[]
    return {
      kind: "user_message" as const,
      volatility: "VOLATILE" as const,
      isPinned: false,
      signals: ["error:fallback" as const],
    };
  });
}

export interface UpstreamTarget {
  host: string;
  port: number;
  ssl: boolean;
}

function makeRequest(
  upstream: UpstreamTarget,
  options: http.RequestOptions,
  cb: (res: http.IncomingMessage) => void,
): http.ClientRequest {
  const opts = { ...options, hostname: upstream.host, port: upstream.port };
  return upstream.ssl ? https.request(opts, cb) : http.request(opts, cb);
}

function forwardUpstream(
  upstream: UpstreamTarget,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer,
  res: http.ServerResponse,
): void {
  const upstreamReq = makeRequest(
    upstream,
    { path, method, headers: { ...headers, host: upstream.host } },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers as http.OutgoingHttpHeaders);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", (err) => {
    console.error("[cachelane proxy] upstream error", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "upstream_error", message: err.message }));
    } else {
      res.destroy();
    }
  });

  upstreamReq.write(body);
  upstreamReq.end();
}

/** Strip headers that would cause upstream to respond in an encoding we can't parse. */
function sanitiseForwardHeaders(headers: Record<string, string>): Record<string, string> {
  const out = { ...headers };
  // accept-encoding: gzip/br would give us compressed bytes we can't parse for usage extraction
  delete out["accept-encoding"];
  // transfer-encoding must not coexist with content-length (RFC 7230 §3.3.3)
  delete out["transfer-encoding"];
  return out;
}

export interface ProxyOptions {
  port?: number;
  db_path?: string;
  config_path?: string;
  workspace_id?: string;
  session_id?: string;
  /** Override the upstream target (default: https://api.anthropic.com:443). Used by tests. */
  upstream?: Partial<UpstreamTarget>;
}

export function startProxy(opts: ProxyOptions = {}): http.Server {
  const port = opts.port ?? DEFAULT_PORT;
  const workspaceId = opts.workspace_id ?? process.env.CACHELANE_WORKSPACE_ID ?? "default";
  const sessionId = opts.session_id ?? process.env.CACHELANE_SESSION_ID ?? randomUUID();
  const upstream: UpstreamTarget = {
    host: opts.upstream?.host ?? DEFAULT_UPSTREAM_HOST,
    port: opts.upstream?.port ?? DEFAULT_UPSTREAM_PORT,
    ssl: opts.upstream?.ssl ?? true,
  };

  const tracker = new CacheStateTracker();

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const method = req.method ?? "GET";
      const reqPath = req.url ?? "/";

      console.info("[cachelane proxy] incoming", { method, path: reqPath });

      // Only intercept POST /v1/messages — strip query string before matching
      // Claude Code appends ?beta=true and similar query params
      const pathOnly = reqPath.split("?")[0];
      if (method !== "POST" || pathOnly !== "/v1/messages") {
        forwardUpstream(upstream, method, reqPath, headersFromIncoming(req), body, res);
        return;
      }

      let parsed: AnthropicMessagesRequest;
      try {
        parsed = JSON.parse(body.toString("utf-8")) as AnthropicMessagesRequest;
      } catch {
        forwardUpstream(upstream, method, reqPath, headersFromIncoming(req), body, res);
        return;
      }

      if (!parsed.messages || !Array.isArray(parsed.messages)) {
        forwardUpstream(upstream, method, reqPath, headersFromIncoming(req), body, res);
        return;
      }

      // Run the CacheLane pipeline synchronously; DB ownership then transfers to proxyAndRecord.
      // Use a nullable local so we can close on any error path before the transfer.
      let db: ReturnType<typeof openDatabase> | null = null;
      try {
        const config = loadConfig(opts.config_path ?? defaultConfigPath());
        db = openDatabase(opts.db_path ?? defaultDbPath());

        const stats = db.getStats({ scope: "session", workspace_id: workspaceId, session_id: sessionId });
        const currentTurn = stats.turns + 1;

        const messageClassifications = classifyAllMessages(
          parsed.messages,
          currentTurn,
          config,
        );

        const turnId = randomUUID();
        const result = handlePreRequest({
          db,
          tracker,
          workspace_id: workspaceId,
          session_id: sessionId,
          turn_id: turnId,
          current_turn: currentTurn,
          original_request: parsed,
          message_classifications: messageClassifications,
          block_placements: [],
          pruner: config.pruner,
        });

        const forwardBody = result.mutated
          ? Buffer.from(JSON.stringify(result.request), "utf-8")
          : body;

        if (result.mutated) {
          console.info("[cachelane proxy] mutated request", {
            session: sessionId,
            turn: currentTurn,
            signals: result.signals,
            pruned: result.pruned_blocks_count,
          });
        }

        const upstreamHeaders = sanitiseForwardHeaders(headersFromIncoming(req));
        upstreamHeaders["content-length"] = String(forwardBody.length);

        const ownedDb = db;
        db = null; // ownership transfers — proxyAndRecord is responsible for close()
        proxyAndRecord(upstream, method, reqPath, upstreamHeaders, forwardBody, res, {
          db: ownedDb,
          workspaceId,
          sessionId,
          currentTurn,
          turnId,
          model: parsed.model,
          prefixHash: result.prefix_hash,
          middleHash: result.middle_hash,
          prunedCount: result.pruned_blocks_count,
        });
      } catch (err) {
        if (db !== null) { db.close(); }
        // Fail-open: pipeline error → forward original request unchanged
        console.error("[cachelane proxy] pipeline error — failing open", err instanceof Error ? err.message : String(err));
        forwardUpstream(upstream, method, reqPath, headersFromIncoming(req), body, res);
      }
    });

    req.on("error", (err) => {
      console.error("[cachelane proxy] request error", err.message);
      if (!res.headersSent) { res.writeHead(500); }
      res.end();
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.info(`[cachelane proxy] listening on http://127.0.0.1:${port}`);
    console.info(`[cachelane proxy] session=${sessionId} workspace=${workspaceId}`);
    console.info(`[cachelane proxy] set ANTHROPIC_BASE_URL=http://127.0.0.1:${port}`);
  });

  return server;
}

interface RecordOptions {
  db: ReturnType<typeof openDatabase>;
  workspaceId: string;
  sessionId: string;
  currentTurn: number;
  turnId: string;
  model: string;
  prefixHash: string;
  middleHash: string | null;
  prunedCount: number;
}

function proxyAndRecord(
  upstream: UpstreamTarget,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer,
  res: http.ServerResponse,
  recordOpts: RecordOptions,
): void {
  const responseChunks: Buffer[] = [];
  let finished = false;

  const finish = (status: "recorded" | "error") => {
    if (finished) return;
    finished = true;
    if (status === "recorded") {
      recordUsageFromResponse(Buffer.concat(responseChunks), recordOpts);
    }
    recordOpts.db.close();
  };

  const upstreamReq = makeRequest(
    upstream,
    { path, method, headers: { ...headers, host: upstream.host } },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers as http.OutgoingHttpHeaders);

      upstreamRes.on("data", (chunk: Buffer) => {
        res.write(chunk);
        responseChunks.push(chunk);
      });

      upstreamRes.on("end", () => {
        res.end();
        finish("recorded");
      });

      upstreamRes.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
        finish("error");
      });
    },
  );

  // Client disconnects before the response is fully written — abort the upstream
  // and release the DB. Guard with writableEnded so normal completions don't
  // trigger this (res.on("close") fires even after a clean finish in keep-alive
  // mode when the socket is eventually recycled).
  res.on("close", () => {
    if (!finished && !res.writableEnded) {
      upstreamReq.destroy();
      finish("error");
    }
  });

  upstreamReq.on("error", (err) => {
    console.error("[cachelane proxy] upstream error", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "upstream_error" }));
    } else {
      // Headers already sent (partial SSE stream) — can't write JSON; just close
      res.destroy();
    }
    finish("error");
  });

  upstreamReq.write(body);
  upstreamReq.end();
}

function recordUsageFromResponse(raw: Buffer, opts: RecordOptions): void {
  try {
    const text = raw.toString("utf-8");
    interface UsageFields {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_creation_5m_tokens?: number;
      cache_creation_1h_tokens?: number;
      cache_read_input_tokens?: number;
    }
    let usage: UsageFields | null = null;

    // Parse SSE events in order: message_start carries input/cache tokens,
    // message_delta carries the final output_tokens.
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const jsonPart = trimmed.slice(5).trim();
      try {
        const evt = JSON.parse(jsonPart) as Record<string, unknown>;
        if (evt.type === "message_start" && evt.message) {
          const msg = evt.message as Record<string, unknown>;
          if (msg.usage) usage = msg.usage as UsageFields;
          // Don't break: message_delta later in the stream carries output_tokens
        }
        if (evt.type === "message_delta" && evt.usage) {
          const delta = evt.usage as UsageFields;
          // Only merge output_tokens from delta; never clobber input/cache fields
          // with a delta that lacks them. Guard against a delta arriving before
          // message_start (malformed stream): skip entirely in that case.
          if (usage !== null) {
            usage = Object.assign({}, usage, { output_tokens: delta.output_tokens }) as UsageFields;
          }
        }
      } catch { /* skip malformed SSE lines */ }
    }

    // Fall back to non-streaming JSON response body
    if (!usage) {
      try {
        const json = JSON.parse(text) as { usage?: UsageFields };
        if (json.usage) usage = json.usage;
      } catch { /* not JSON */ }
    }

    if (!usage) return;

    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const cacheCreation5m = usage.cache_creation_5m_tokens ?? usage.cache_creation_input_tokens ?? 0;
    const cacheCreation1h = usage.cache_creation_1h_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;

    const effective = calculateEffectiveCostUnits({
      input_tokens: inputTokens,
      cache_creation_5m_tokens: cacheCreation5m,
      cache_creation_1h_tokens: cacheCreation1h,
      cache_read_tokens: cacheRead,
    });

    try {
      opts.db.insertTurn({
        id: opts.turnId,
        workspace_id: opts.workspaceId,
        session_id: opts.sessionId,
        turn_number: opts.currentTurn,
        model: opts.model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_5m_tokens: cacheCreation5m,
        cache_creation_1h_tokens: cacheCreation1h,
        cache_read_tokens: cacheRead,
        effective_cost_units: effective,
        prefix_breakpoint_hash: opts.prefixHash || null,
        middle_breakpoint_hash: opts.middleHash,
        pruned_blocks_count: opts.prunedCount,
        keepalive_pings_since_last_turn: 0,
        created_at: Date.now(),
      });
      console.info("[cachelane proxy] recorded turn", {
        turn: opts.currentTurn,
        input: inputTokens,
        cache_read: cacheRead,
        effective,
      });
    } catch (insertErr) {
      // UNIQUE constraint = turn already recorded (idempotent re-delivery)
      if (!(insertErr instanceof Error && insertErr.message.includes("UNIQUE"))) {
        console.error("[cachelane proxy] failed to record turn", insertErr);
      }
    }
  } catch (err) {
    console.error("[cachelane proxy] failed to parse upstream response for recording", err);
  }
}

function headersFromIncoming(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? (v[0] ?? "") : (v as string);
  }
  return out;
}

function defaultConfigPath(): string {
  const home = process.env.CACHELANE_HOME ?? `${process.env.HOME ?? "~"}/.cachelane`;
  return `${home}/config.json`;
}

function defaultDbPath(): string {
  const home = process.env.CACHELANE_HOME ?? `${process.env.HOME ?? "~"}/.cachelane`;
  return `${home}/cachelane.db`;
}
