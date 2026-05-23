import type { CachelaneConfig, CacheTier, PrefixState } from "../types/index.js";
import type { CacheStateTracker } from "../orchestrator/cache-state-tracker.js";

const TTL_MS: Record<CacheTier, number> = {
  "5m": 5 * 60 * 1000,
  "1h": 60 * 60 * 1000,
};

export type KeepaliveSkipReason =
  | "policy_off"
  | "not_idle"
  | "ttl_fresh"
  | "already_expired"
  | "adaptive_1h"
  | "in_flight";

export interface KeepalivePingRequest {
  workspace_id: string;
  session_id: string;
  prefix_hash: string;
  middle_hash: string | null;
  prefix_token_count: number;
  ttl_class: CacheTier;
  now_ms: number;
}

export type KeepaliveDecision =
  | { action: "skip"; reason: KeepaliveSkipReason }
  | { action: "ping"; request: KeepalivePingRequest };

export interface KeepalivePingResult {
  ok: boolean;
  cache_read_tokens?: number;
  error?: unknown;
}

export type KeepalivePingExecutor = (
  request: KeepalivePingRequest,
) => Promise<KeepalivePingResult> | KeepalivePingResult;

export interface KeepaliveTickResult {
  pinged: number;
  skipped: number;
  failed: number;
}

interface KeepaliveLogger {
  info(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
  error(message?: unknown, ...optionalParams: unknown[]): void;
}

export interface KeepaliveWorkerOptions {
  tracker: CacheStateTracker;
  config: CachelaneConfig["keepalive"];
  executor: KeepalivePingExecutor;
  logger?: KeepaliveLogger;
  now_ms?: () => number;
  /** Max ms to wait for a single ping before treating it as failed. Default 5000. */
  ping_timeout_ms?: number;
}

export function decideKeepalive(
  state: PrefixState,
  context: {
    workspace_id: string;
    session_id: string;
    config: CachelaneConfig["keepalive"];
    now_ms: number;
    in_flight?: boolean;
  },
): KeepaliveDecision {
  if (context.config.policy === "off") {
    return { action: "skip", reason: "policy_off" };
  }

  if (context.in_flight === true) {
    return { action: "skip", reason: "in_flight" };
  }

  if (context.config.policy === "adaptive" && state.ttl_class === "1h") {
    return { action: "skip", reason: "adaptive_1h" };
  }

  const idleMs = context.now_ms - state.last_read_at_ms;
  if (idleMs < context.config.idle_threshold_seconds * 1000) {
    return { action: "skip", reason: "not_idle" };
  }

  const timeUntilExpiryMs = state.expected_expiry_ms - context.now_ms;
  if (timeUntilExpiryMs <= 0) {
    return { action: "skip", reason: "already_expired" };
  }
  if (timeUntilExpiryMs > context.config.interval_seconds * 1000) {
    return { action: "skip", reason: "ttl_fresh" };
  }

  return {
    action: "ping",
    request: {
      workspace_id: context.workspace_id,
      session_id: context.session_id,
      prefix_hash: state.prefix_hash,
      middle_hash: state.middle_hash,
      prefix_token_count: state.prefix_token_count,
      ttl_class: state.ttl_class,
      now_ms: context.now_ms,
    },
  };
}

function nextExpiry(nowMs: number, ttlClass: CacheTier): number {
  return nowMs + TTL_MS[ttlClass];
}

export class KeepaliveWorker {
  private readonly tracker: CacheStateTracker;
  private readonly config: CachelaneConfig["keepalive"];
  private readonly executor: KeepalivePingExecutor;
  private readonly logger: KeepaliveLogger;
  private readonly nowMs: () => number;
  private readonly pingTimeoutMs: number;
  private readonly inFlight = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(options: KeepaliveWorkerOptions) {
    this.tracker = options.tracker;
    this.config = options.config;
    this.executor = options.executor;
    this.logger = options.logger ?? console;
    this.nowMs = options.now_ms ?? Date.now;
    this.pingTimeoutMs = options.ping_timeout_ms ?? 5_000;
  }

  private executorWithTimeout(
    request: KeepalivePingRequest,
  ): Promise<KeepalivePingResult> {
    return Promise.race([
      Promise.resolve(this.executor(request)),
      new Promise<KeepalivePingResult>((_, reject) =>
        setTimeout(
          () => reject(new Error("keepalive ping timed out")),
          this.pingTimeoutMs,
        ),
      ),
    ]);
  }

  start(): void {
    if (this.timer !== null || this.config.policy === "off") return;
    this.timer = setInterval(
      () =>
        void this.tick().catch((err: unknown) => {
          this.logger.error("[cachelane] keepalive tick failed", err);
        }),
      this.config.interval_seconds * 1000,
    );
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(nowMs = this.nowMs()): Promise<KeepaliveTickResult> {
    const result: KeepaliveTickResult = { pinged: 0, skipped: 0, failed: 0 };

    // Collect all sessions that need a ping this tick (decision phase).
    // Mark them all in-flight before dispatching so a concurrent tick sees them.
    const targets: Array<{
      key: string;
      workspace_id: string;
      session_id: string;
      request: KeepalivePingRequest;
    }> = [];

    for (const entry of this.tracker.entries()) {
      const key = `${entry.workspace_id}:${entry.session_id}`;
      const decision = decideKeepalive(entry.state, {
        workspace_id: entry.workspace_id,
        session_id: entry.session_id,
        config: this.config,
        now_ms: nowMs,
        in_flight: this.inFlight.has(key),
      });

      if (decision.action === "skip") {
        result.skipped += 1;
        continue;
      }

      this.inFlight.add(key);
      targets.push({
        key,
        workspace_id: entry.workspace_id,
        session_id: entry.session_id,
        request: decision.request,
      });
    }

    // Dispatch all pings in parallel with per-ping timeout.
    await Promise.all(
      targets.map(async ({ key, workspace_id, session_id, request }) => {
        try {
          const ping = await this.executorWithTimeout(request);
          if (ping.ok) {
            const latestState = this.tracker.get(workspace_id, session_id);
            if (
              latestState?.prefix_hash === request.prefix_hash &&
              latestState.middle_hash === request.middle_hash &&
              latestState.ttl_class === request.ttl_class
            ) {
              this.tracker.update(workspace_id, session_id, {
                ...latestState,
                last_read_at_ms: nowMs,
                expected_expiry_ms: nextExpiry(nowMs, latestState.ttl_class),
              });
            }
            result.pinged += 1;
          } else {
            result.failed += 1;
            this.logger.info("[cachelane] keepalive ping failed", ping.error);
          }
        } catch (err) {
          result.failed += 1;
          this.logger.info("[cachelane] keepalive ping failed", err);
        } finally {
          this.inFlight.delete(key);
        }
      }),
    );

    return result;
  }
}
