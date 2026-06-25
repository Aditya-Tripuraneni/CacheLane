import http from "node:http";
import https from "node:https";
import { randomUUID, createHash } from "node:crypto";
import { loadConfig, defaultWorkspaceId } from "../config/index.js";
import { openDatabase, calculateEffectiveCostUnits, type CachelaneDb } from "../storage/index.js";
import { handlePreRequest } from "../hooks/pre-request.js";
import { classifyBlock } from "../classifier/index.js";
import { compress } from "../compressor/index.js";
import { CacheStateTracker } from "../orchestrator/index.js";
import { logger } from "../logger/index.js";
import { eventStreamToSSE, isEventStreamContentType } from "./eventstream.js";
import type { AnthropicMessagesRequest, AnthropicMessage } from "../orchestrator/index.js";
import type { UnclassifiedBlock } from "../classifier/index.js";
import type { Classification } from "../classifier/index.js";
import aws4 from "aws4";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { countTokens } from "../tokenizer/index.js";
import { reconcileTurnCost } from "../reconciler/index.js";

const tokenCache = new Map<string, number>();

const DEFAULT_UPSTREAM_HOST = "api.anthropic.com";
const DEFAULT_UPSTREAM_PORT = 443;
const DEFAULT_PORT = 7332;

/**
 * Inbound auth/signing headers that MUST be stripped before CacheLane re-signs a
 * request for AWS Bedrock. In Bedrock mode Claude Code's AWS SDK already SigV4-signs
 * the request, so the inbound request carries a stale `authorization`, `x-amz-date`,
 * `x-amz-content-sha256` (hash over the ORIGINAL body), and `x-amz-security-token`.
 * aws4 treats any pre-existing value as authoritative — so leaving them in makes it
 * sign the wrong body hash / token / timestamp → guaranteed 403 from Bedrock. We also
 * strip Anthropic-issued credentials so the user's `x-api-key` never reaches AWS.
 */
const BEDROCK_STRIP_HEADERS = [
  "authorization",
  "x-amz-date",
  "x-amz-content-sha256",
  "x-amz-security-token",
  "x-amzn-trace-id",
  "x-api-key",
  "anthropic-version",
  "anthropic-beta",
  "anthropic-dangerous-direct-browser-access",
] as const;

function scrubClientAuthHeaders(headers: Record<string, string>): Record<string, string> {
  const out = { ...headers };
  for (const key of Object.keys(out)) {
    const lower = key.toLowerCase();
    if (
      (BEDROCK_STRIP_HEADERS as readonly string[]).includes(lower) ||
      lower.startsWith("x-stainless-")
    ) {
      delete out[key];
    }
  }
  return out;
}

/**
 * Resolve the AWS region for signing. Claude Code encodes the target region in the
 * credential scope of its inbound SigV4 `authorization` header
 * (`Credential=AK.../20260612/us-west-2/bedrock/aws4_request`); prefer that so we
 * sign for the region Claude Code actually targeted. Fall back to proxy env, then
 * us-east-1.
 */
function resolveBedrockRegion(headers: Record<string, string>): string {
  const auth = headers["authorization"];
  if (typeof auth === "string") {
    const match = /\/\d{8}\/([a-z0-9-]+)\/bedrock\//.exec(auth);
    if (match?.[1]) return match[1];
  }
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
}

// Memoize the AWS credential provider once at module scope. defaultProvider()
// returns a provider that caches + refreshes credentials internally; constructing
// a fresh one per request (the old behavior) discarded that cache and walked the
// full provider chain (env → SSO → IMDS → STS) on every turn.
let memoizedCredentialProvider: ReturnType<typeof defaultProvider> | null = null;
function getCredentialProvider(): ReturnType<typeof defaultProvider> {
  if (memoizedCredentialProvider === null) {
    memoizedCredentialProvider = defaultProvider();
  }
  return memoizedCredentialProvider;
}

/**
 * Build the Bedrock upstream target + SigV4-signed headers for a request. Used by
 * both the main path and the fail-open catch so Bedrock requests are always routed
 * to the Bedrock host and signed correctly with the proxy's own credentials.
 */
async function signForBedrock(params: {
  upstream: UpstreamTarget;
  reqPath: string;
  method: string;
  body: Buffer;
  baseHeaders: Record<string, string>;
}): Promise<{ upstream: UpstreamTarget; headers: Record<string, string> }> {
  const region = resolveBedrockRegion(params.baseHeaders);
  // Default upstream (api.anthropic.com) means "no explicit Bedrock endpoint
  // configured" → rewrite to the regional Bedrock host. An explicitly-configured
  // upstream host (a Bedrock gateway, or a test fake) is honored as-is, and we
  // sign for that host so the SigV4 Host header matches what we connect to.
  const targetHost =
    params.upstream.host === DEFAULT_UPSTREAM_HOST
      ? `bedrock-runtime.${region}.amazonaws.com`
      : params.upstream.host;
  const finalUpstream: UpstreamTarget = {
    ...params.upstream,
    host: targetHost,
  };

  // Strip the client's stale auth/signing headers; aws4 will regenerate
  // x-amz-date, x-amz-content-sha256, x-amz-security-token, and authorization.
  const headers = scrubClientAuthHeaders(params.baseHeaders);
  delete headers["host"];
  delete headers["connection"];
  headers["content-length"] = String(params.body.length);

  const credentials = await getCredentialProvider()();

  const signOpts = {
    host: finalUpstream.host,
    path: buildUpstreamPath(finalUpstream, params.reqPath),
    service: "bedrock",
    region,
    method: params.method,
    body: params.body,
    headers,
  };

  aws4.sign(signOpts, {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
  });

  return { upstream: finalUpstream, headers: signOpts.headers as Record<string, string> };
}

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

export function computeBlockPlacements(
  messages: AnthropicMessage[],
  blocks: import("../storage/index.js").BlockRow[]
): import("../pruner/index.js").PromptBlockPlacement[] {
  const placements: import("../pruner/index.js").PromptBlockPlacement[] = [];
  const blockMap = new Map(blocks.map(b => [b.id, b]));

  for (let mIdx = 0; mIdx < messages.length; mIdx++) {
    const msg = messages[mIdx]!;
    if (msg.role === "user" && Array.isArray(msg.content)) {
      for (let cIdx = 0; cIdx < msg.content.length; cIdx++) {
        const c = msg.content[cIdx];
        if (c?.type === "tool_result" && c.tool_use_id) {
          const row = blockMap.get(c.tool_use_id);
          if (row) {
            placements.push({
              block_id: row.id,
              message_index: mIdx,
              content_index: cIdx,
              kind: row.kind,
              volatility: row.volatility,
              is_pinned: row.is_pinned === 1,
              refetch_handle: row.refetch_handle,
              restored_at_turn: row.restored_at_turn,
              token_count: row.token_count
            });
          }
        }
      }
    }
  }
  return placements;
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
  path_prefix: string;
}

function normalisePathPrefix(prefix: string | undefined): string {
  if (!prefix || prefix === "/") return "";
  const withLeadingSlash = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

function buildUpstreamPath(upstream: UpstreamTarget, reqPath: string): string {
  const prefix = normalisePathPrefix(upstream.path_prefix);
  if (!prefix) return reqPath;
  const [pathOnly = "/", query] = reqPath.split("?", 2);
  const withSlash = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
  const nextPath = `${prefix}${withSlash}`;
  return query === undefined ? nextPath : `${nextPath}?${query}`;
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
    { path: buildUpstreamPath(upstream, path), method, headers: { ...headers, host: upstream.host } },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers as http.OutgoingHttpHeaders);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", (err) => {
    // Avoid crashing the proxy process if upstream connection fails
    if (!res.headersSent) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: { message: `Bad Gateway: ${err.message}` } }));
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

/**
 * Build an HTTP server with the CacheLane proxy request handler wired up,
 * but do NOT call listen(). The caller (startProxy or lifecycle.tryBindProxy)
 * owns the listen call.
 *
 * DB and tracker are owned by the caller — this function never opens or closes
 * the DB, and never instantiates a tracker. The DB must remain open for the
 * full lifetime of the returned server.
 */
export function createProxyServer(
  opts: ProxyOptions,
  db: CachelaneDb,
  tracker: CacheStateTracker,
): http.Server {
  const workspaceId = opts.workspace_id ?? process.env.CACHELANE_WORKSPACE_ID ?? defaultWorkspaceId();
  let config;
  try {
    config = loadConfig(opts.config_path ?? defaultConfigPath());
  } catch {
    config = null;
  }
  const upstream: UpstreamTarget = {
    host: opts.upstream?.host ?? config?.proxy.upstream_host ?? DEFAULT_UPSTREAM_HOST,
    port: opts.upstream?.port ?? config?.proxy.upstream_port ?? DEFAULT_UPSTREAM_PORT,
    ssl: opts.upstream?.ssl ?? config?.proxy.upstream_ssl ?? true,
    path_prefix: opts.upstream?.path_prefix ?? config?.proxy.upstream_path_prefix ?? "",
  };

  return http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      const method = req.method ?? "GET";
      const reqPath = req.url ?? "/";

      logger.info("incoming", JSON.stringify({ method, path: reqPath }));

      // Only intercept POST /v1/messages or Bedrock /model/* paths
      // Claude Code appends ?beta=true and similar query params
      const pathOnly = reqPath.split("?")[0];
      const isBedrock = pathOnly?.startsWith("/model/");
      
      if (method !== "POST" || (pathOnly !== "/v1/messages" && !isBedrock)) {
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

      const requestHeaders = headersFromIncoming(req);
      const sessionIdHeader = requestHeaders["x-claude-code-session-id"];
      const sessionId = typeof sessionIdHeader === "string" && sessionIdHeader.length > 0 
        ? sessionIdHeader 
        : (opts.session_id ?? process.env.CACHELANE_SESSION_ID ?? randomUUID());

      let currentTurn = 0;
      const turnId = randomUUID();
      try {
        currentTurn = db.allocateTurnNumber({
          workspace_id: workspaceId,
          session_id: sessionId,
        });

        const config = loadConfig(opts.config_path ?? defaultConfigPath());
        const compressionEnabled = config.features.mutation_enabled && config.compression.enabled;
        const compressionResult = compressionEnabled
          ? compress(parsed.messages, config.compression, {
            now_ms: Date.now(),
            retainOriginal: (record) => db.recordCompressionOriginal({
              turn_id: turnId,
              session_id: sessionId,
              workspace_id: workspaceId,
              tool_use_id: record.tool_use_id,
              content_sha256: createHash("sha256").update(record.original_text).digest("hex"),
              original_text: record.original_text,
              original_tokens: record.original_tokens,
              created_at: record.created_at,
              expires_at: record.expires_at,
            }),
            discardOriginal: (handle) => db.deleteCompressionOriginal(handle),
          })
          : { messages: parsed.messages, events: [] };
        const compressionMutated = compressionResult.messages.some(
          (msg, index) => msg !== parsed.messages[index],
        );
        const requestForPipeline =
          compressionMutated ? { ...parsed, messages: compressionResult.messages } : parsed;

        const messageClassifications = classifyAllMessages(
          requestForPipeline.messages,
          currentTurn,
          config,
        );

        const result = handlePreRequest({
          db,
          tracker,
          workspace_id: workspaceId,
          session_id: sessionId,
          turn_id: turnId,
          current_turn: currentTurn,
          original_request: requestForPipeline,
          message_classifications: messageClassifications,
          block_placements: computeBlockPlacements(
            requestForPipeline.messages,
            db.getBlocksBySession(workspaceId, sessionId),
          ),
          pruner: config.pruner,
        });

        const actuallyMutate = config.features.mutation_enabled && (compressionMutated || result.mutated);
        const forwardBody = actuallyMutate
          ? Buffer.from(JSON.stringify(result.request), "utf-8")
          : body;

        if (compressionResult.events.length > 0 && actuallyMutate) {
          try {
            db.recordCompressionEvents(turnId, sessionId, workspaceId, compressionResult.events);
          } catch (err) {
            logger.error(
              "failed to record compression events",
              err instanceof Error ? err.message : String(err),
              err,
            );
          }
        }

        const finalSignals = [...result.signals];
        if (!config.features.mutation_enabled) {
          finalSignals.push("mode:baseline");
        }

        if (actuallyMutate) {
          logger.info("mutated request", JSON.stringify({
            session: sessionId,
            turn: currentTurn,
            signals: finalSignals,
            pruned: result.pruned_blocks_count,
          }));
        }

        let finalUpstream = upstream;
        let finalHeaders = sanitiseForwardHeaders(headersFromIncoming(req));
        finalHeaders["content-length"] = String(forwardBody.length);

        if (isBedrock) {
          const signed = await signForBedrock({
            upstream,
            reqPath,
            method,
            body: forwardBody,
            baseHeaders: headersFromIncoming(req),
          });
          finalUpstream = signed.upstream;
          finalHeaders = signed.headers;
        }

        proxyAndRecord(finalUpstream, method, reqPath, finalHeaders, forwardBody, res, {
          db,
          workspaceId,
          sessionId,
          currentTurn,
          turnId,
          model: parsed.model,
          prefixHash: result.prefix_hash,
          middleHash: result.middle_hash,
          prunedCount: result.pruned_blocks_count,
          requestMutated: actuallyMutate ? 1 : 0,
          signals: finalSignals,
          keepalivePings: result.keepalive_pings_since_last_turn ?? 0,
        });
      } catch (err) {
        // Fail-open: pipeline error → forward original request unchanged.
        // DB is owned by the caller; do NOT close it here.
        logger.error("pipeline error — failing open", err instanceof Error ? err.message : String(err), err);
        const fallbackTurn = currentTurn || 1;
        recordFallbackExplanation({
          db,
          workspaceId,
          sessionId,
          currentTurn: fallbackTurn,
          turnId,
          model: parsed.model || "unknown",
          signals: ["error:fallback"],
        });
        // Fail-open must still reach a destination that can serve the request.
        // For Bedrock (/model/*) that means routing to the Bedrock host AND
        // signing the (unmutated) body — an unsigned request to api.anthropic.com
        // would be a hard error, not a graceful pass-through.
        let fallbackUpstream = upstream;
        let fallbackHeaders = sanitiseForwardHeaders(headersFromIncoming(req));
        fallbackHeaders["content-length"] = String(body.length);
        if (isBedrock) {
          try {
            const signed = await signForBedrock({
              upstream,
              reqPath,
              method,
              body,
              baseHeaders: headersFromIncoming(req),
            });
            fallbackUpstream = signed.upstream;
            fallbackHeaders = signed.headers;
          } catch (signErr) {
            logger.error(
              "bedrock fail-open signing error",
              signErr instanceof Error ? signErr.message : String(signErr),
              signErr,
            );
          }
        }
        proxyAndRecord(fallbackUpstream, method, reqPath, fallbackHeaders, body, res, {
          db,
          workspaceId,
          sessionId,
          currentTurn: fallbackTurn,
          turnId,
          model: parsed.model || "unknown",
          prefixHash: "",
          middleHash: null,
          prunedCount: 0,
          requestMutated: 0,
          signals: ["error:fallback"],
          keepalivePings: 0,
        });
      }
    });

    req.on("error", (err) => {
      logger.error("request error", err.message, err);
      if (!res.headersSent) { res.writeHead(500); }
      res.end();
    });
  });
}

function recordFallbackExplanation(opts: Pick<
  RecordOptions,
  "db" | "workspaceId" | "sessionId" | "currentTurn" | "turnId" | "model"
> & { signals: string[] }): void {
  const now = Date.now();
  try {
    opts.db.insertTurnExplanation({
      turn_id: opts.turnId,
      workspace_id: opts.workspaceId,
      session_id: opts.sessionId,
      turn_number: opts.currentTurn,
      model: opts.model,
      prefix_breakpoint_hash: null,
      middle_breakpoint_hash: null,
      mutated: false,
      pruned_blocks_count: 0,
      prune_decisions: [],
      block_metadata: [],
      region_metadata: {
        message_count: 0,
        stable_count: 0,
        semi_count: 0,
        volatile_count: 0,
      },
      signals: opts.signals,
      created_at: now,
      updated_at: now,
    });
  } catch (err) {
    logger.error("failed to record fallback explanation", String(err), err);
  }
}

export function startProxy(opts: ProxyOptions = {}): http.Server {
  const port = opts.port ?? DEFAULT_PORT;
  const workspaceId = opts.workspace_id ?? process.env.CACHELANE_WORKSPACE_ID ?? defaultWorkspaceId();
  const sessionId = opts.session_id ?? process.env.CACHELANE_SESSION_ID ?? randomUUID();

  // Standalone proxy: owns its DB and tracker for the lifetime of the server.
  const db = openDatabase(opts.db_path ?? defaultDbPath());
  const tracker = new CacheStateTracker();

  const server = createProxyServer(
    { ...opts, workspace_id: workspaceId, session_id: sessionId },
    db,
    tracker,
  );

  // When the server closes (e.g., afterEach cleanup, signal handler), release the DB.
  server.once("close", () => {
    try { db.close(); } catch { /* ignore double-close */ }
  });

  server.listen(port, "127.0.0.1", () => {
    const boundPort = (server.address() as { port: number } | null)?.port ?? port;
    logger.info("listening", `http://127.0.0.1:${boundPort}`);
    logger.info("session initialized", JSON.stringify({ session: sessionId, workspace: workspaceId }));
  });

  return server;
}

interface RecordOptions {
  db: CachelaneDb;
  workspaceId: string;
  sessionId: string;
  currentTurn: number;
  turnId: string;
  model: string;
  prefixHash: string;
  middleHash: string | null;
  prunedCount: number;
  requestMutated?: number;
  signals?: string[] | null;
  keepalivePings?: number;
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
  let responseContentType: string | undefined;

  const finish = (status: "recorded" | "error") => {
    if (finished) return;
    finished = true;
    if (status === "recorded") {
      const responseBody = Buffer.concat(responseChunks);
      recordUsageFromResponse(responseBody, recordOpts, responseContentType);
      extractAndInsertToolResults(body, recordOpts);
    }
    // DB lifetime is owned by the caller (startProxy or tryBindProxy);
    // do NOT close here.
  };

  const upstreamReq = makeRequest(
    upstream,
    { path: buildUpstreamPath(upstream, path), method, headers: { ...headers, host: upstream.host } },
    (upstreamRes) => {
      const ct = upstreamRes.headers["content-type"];
      responseContentType = Array.isArray(ct) ? ct[0] : ct;
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
    logger.error("upstream error", err.message, err);
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

function recordUsageFromResponse(
  raw: Buffer,
  opts: RecordOptions,
  contentType?: string,
): void {
  try {
    // AWS Bedrock streaming returns binary event-stream framing rather than
    // text SSE. Decode it into Anthropic-style `data: {json}` lines so the same
    // parser below extracts usage. Falls back to raw text for Anthropic SSE/JSON.
    const text = isEventStreamContentType(contentType)
      ? eventStreamToSSE(raw)
      : raw.toString("utf-8");
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
          if (usage !== null) {
            // For each field, prefer the delta value when present, else keep the
            // value seeded by message_start. (The `?? usage` fallback already
            // applies the delta whenever it is non-nullish.)
            usage = {
              ...usage,
              input_tokens: delta.input_tokens ?? usage.input_tokens,
              output_tokens: delta.output_tokens ?? usage.output_tokens,
              cache_creation_input_tokens: delta.cache_creation_input_tokens ?? usage.cache_creation_input_tokens,
              cache_creation_5m_tokens: delta.cache_creation_5m_tokens ?? usage.cache_creation_5m_tokens,
              cache_creation_1h_tokens: delta.cache_creation_1h_tokens ?? usage.cache_creation_1h_tokens,
              cache_read_input_tokens: delta.cache_read_input_tokens ?? usage.cache_read_input_tokens,
            };
          } else {
            usage = { ...delta };
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
        keepalive_pings_since_last_turn: opts.keepalivePings ?? 0,
        request_mutated: opts.requestMutated ?? 0,
        signals: opts.signals ? JSON.stringify(opts.signals) : null,
        created_at: Date.now(),
      });
    } catch (insertErr) {
      if (!(insertErr instanceof Error && insertErr.message.includes("UNIQUE"))) {
        logger.error("failed to record turn", String(insertErr), insertErr);
      }
    }

    try {
      if (typeof opts.db.updateTurnExplanationUsage === "function") {
        let regionCost = null;
        try {
          const currentExp = opts.db.getTurnExplanation({ workspace_id: opts.workspaceId, session_id: opts.sessionId, turn_number: opts.currentTurn });
          const prevExp = opts.currentTurn > 1 ? opts.db.getTurnExplanation({ workspace_id: opts.workspaceId, session_id: opts.sessionId, turn_number: opts.currentTurn - 1 }) : null;
          
          if (currentExp) {
            const usage = {
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              cache_creation_5m_tokens: cacheCreation5m,
              cache_creation_1h_tokens: cacheCreation1h,
              cache_read_tokens: cacheRead,
              effective_cost_units: effective,
            };
            
            regionCost = reconcileTurnCost(
              usage,
              currentExp.block_metadata,
              { prefix_breakpoint_hash: opts.prefixHash || null, middle_breakpoint_hash: opts.middleHash },
              prevExp ? { prefix_breakpoint_hash: prevExp.prefix_breakpoint_hash, middle_breakpoint_hash: prevExp.middle_breakpoint_hash } : null
            );
          }
        } catch (reconcileErr) {
          logger.error("failed to compute region cost breakdown", String(reconcileErr), reconcileErr);
        }

        opts.db.updateTurnExplanationUsage(
          opts.turnId,
          {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_5m_tokens: cacheCreation5m,
            cache_creation_1h_tokens: cacheCreation1h,
            cache_read_tokens: cacheRead,
            effective_cost_units: effective,
          },
          regionCost,
          Date.now()
        );
      }
    } catch (err) {
      logger.error("failed to update turn explanation usage from response", String(err), err);
    }

    logger.info("recorded turn", JSON.stringify({
      turn: opts.currentTurn,
      input: inputTokens,
      cache_read: cacheRead,
      effective,
    }));
  } catch (err) {
    logger.error("failed to parse upstream response for recording", String(err), err);
  }
}

function extractAndInsertToolResults(body: Buffer, opts: RecordOptions): void {
  try {
    const req = JSON.parse(body.toString("utf-8")) as AnthropicMessagesRequest;
    if (!req.messages || !Array.isArray(req.messages)) return;

    opts.db.updateBlockCounters({
      workspace_id: opts.workspaceId,
      session_id: opts.sessionId,
      turn_number: opts.currentTurn,
      referenced_ids: new Set(),
      updated_at: Date.now(),
    });

    for (const msg of req.messages) {
      if (msg.role === "user" && Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if (c.type === "tool_result" && c.tool_use_id) {
            const contentStr = typeof c.content === "string" ? c.content : JSON.stringify(c.content);
            const contentHash = createHash("sha256").update(contentStr).digest("hex");
            
            let tokenCount = tokenCache.get(contentHash);
            if (tokenCount === undefined) {
              tokenCount = countTokens(contentStr, opts.model);
              tokenCache.set(contentHash, tokenCount);
            }
            
            try {
              opts.db.insertBlock({
                id: c.tool_use_id,
                workspace_id: opts.workspaceId,
                session_id: opts.sessionId,
                content_hash: contentHash,
                kind: "tool_output",
                volatility: "VOLATILE",
                is_pinned: false,
                token_count: tokenCount,
                added_at_turn: opts.currentTurn,
                last_referenced_at_turn: opts.currentTurn,
                unused_turns: 0,
                is_stub: false,
                stub_summary: null,
                refetch_handle: c.tool_use_id ? JSON.stringify({ type: "tool_use", id: c.tool_use_id }) : null,
                restored_at_turn: null,
                created_at: Date.now(),
                updated_at: Date.now(),
              });
            } catch (err) {
              if (!(err instanceof Error && err.message.includes("UNIQUE"))) {
                logger.error("failed to insert block", String(err), err);
              }
            }
          }
        }
      }
    }
  } catch (err) {
    logger.error("failed to extract tool_result blocks", String(err), err);
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
