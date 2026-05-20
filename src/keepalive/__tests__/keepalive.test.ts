import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import { CacheStateTracker } from "../../orchestrator/index.js";
import type { PrefixState } from "../../types/index.js";
import {
  decideKeepalive,
  KeepaliveWorker,
  type KeepalivePingResult,
} from "../index.js";

const config = DEFAULT_CONFIG.keepalive;

function state(overrides: Partial<PrefixState> = {}): PrefixState {
  return {
    workspace_id: "ws-1",
    prefix_hash: "prefix",
    middle_hash: null,
    prefix_token_count: 100,
    ttl_class: "5m",
    cached_at_ms: 0,
    last_read_at_ms: 0,
    expected_expiry_ms: 300_000,
    ...overrides,
  };
}

describe("decideKeepalive", () => {
  it("skips when policy is off", () => {
    const decision = decideKeepalive(state(), {
      workspace_id: "ws-1",
      session_id: "s-1",
      config: { ...config, policy: "off" },
      now_ms: 300_000,
    });

    expect(decision).toEqual({ action: "skip", reason: "policy_off" });
  });

  it("skips when idle threshold has not passed", () => {
    const decision = decideKeepalive(state(), {
      workspace_id: "ws-1",
      session_id: "s-1",
      config,
      now_ms: 100_000,
    });

    expect(decision).toEqual({ action: "skip", reason: "not_idle" });
  });

  it("skips when TTL is still fresh", () => {
    const decision = decideKeepalive(
      state({ last_read_at_ms: 0, expected_expiry_ms: 900_000 }),
      {
        workspace_id: "ws-1",
        session_id: "s-1",
        config,
        now_ms: 300_000,
      },
    );

    expect(decision).toEqual({ action: "skip", reason: "ttl_fresh" });
  });

  it("pings when idle and near expiry", () => {
    const decision = decideKeepalive(state(), {
      workspace_id: "ws-1",
      session_id: "s-1",
      config: { ...config, policy: "static" },
      now_ms: 260_000,
    });

    expect(decision.action).toBe("ping");
    if (decision.action === "ping") {
      expect(decision.request).toMatchObject({
        workspace_id: "ws-1",
        session_id: "s-1",
        prefix_hash: "prefix",
        ttl_class: "5m",
      });
    }
  });

  it("adaptive policy skips 1h prefixes", () => {
    const decision = decideKeepalive(
      state({ ttl_class: "1h", expected_expiry_ms: 260_000 }),
      {
        workspace_id: "ws-1",
        session_id: "s-1",
        config: { ...config, policy: "adaptive" },
        now_ms: 260_000,
      },
    );

    expect(decision).toEqual({ action: "skip", reason: "adaptive_1h" });
  });

  it("auto policy pings 1h prefixes only when near expiry", () => {
    const decision = decideKeepalive(
      state({ ttl_class: "1h", expected_expiry_ms: 3_600_000 }),
      {
        workspace_id: "ws-1",
        session_id: "s-1",
        config: { ...config, policy: "auto" },
        now_ms: 3_500_000,
      },
    );

    expect(decision.action).toBe("ping");
  });
});

describe("KeepaliveWorker", () => {
  it("updates cache state after a successful ping", async () => {
    const tracker = new CacheStateTracker();
    tracker.update("ws-1", "s-1", state());
    const executor = vi.fn((): KeepalivePingResult => ({ ok: true }));
    const worker = new KeepaliveWorker({ tracker, config, executor });

    const result = await worker.tick(260_000);

    expect(result).toEqual({ pinged: 1, skipped: 0, failed: 0 });
    expect(executor).toHaveBeenCalledTimes(1);
    const updated = tracker.get("ws-1", "s-1");
    expect(updated?.last_read_at_ms).toBe(260_000);
    expect(updated?.expected_expiry_ms).toBe(560_000);
  });

  it("logs ping failures without throwing or updating expiry", async () => {
    const tracker = new CacheStateTracker();
    tracker.update("ws-1", "s-1", state());
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const worker = new KeepaliveWorker({
      tracker,
      config,
      executor: () => ({ ok: false, error: new Error("network") }),
      logger,
    });

    const result = await worker.tick(260_000);

    expect(result).toEqual({ pinged: 0, skipped: 0, failed: 1 });
    expect(logger.info).toHaveBeenCalledWith(
      "[cachelane] keepalive ping failed",
      expect.any(Error),
    );
    expect(tracker.get("ws-1", "s-1")?.expected_expiry_ms).toBe(300_000);
  });

  it("does not overlap pings for the same session", async () => {
    const tracker = new CacheStateTracker();
    tracker.update("ws-1", "s-1", state());
    let finish!: (value: KeepalivePingResult) => void;
    const executor = vi.fn(
      () =>
        new Promise<KeepalivePingResult>((resolve) => {
          finish = resolve;
        }),
    );
    const worker = new KeepaliveWorker({ tracker, config, executor });

    const firstTick = worker.tick(260_000);
    const secondTick = await worker.tick(260_000);

    expect(secondTick).toEqual({ pinged: 0, skipped: 1, failed: 0 });
    expect(executor).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await firstTick;
  });

  it("does not clobber newer cache state after an in-flight ping resolves", async () => {
    const tracker = new CacheStateTracker();
    tracker.update("ws-1", "s-1", state());
    let finish!: (value: KeepalivePingResult) => void;
    const executor = vi.fn(
      () =>
        new Promise<KeepalivePingResult>((resolve) => {
          finish = resolve;
        }),
    );
    const worker = new KeepaliveWorker({ tracker, config, executor });

    const firstTick = worker.tick(260_000);
    tracker.update(
      "ws-1",
      "s-1",
      state({
        prefix_hash: "new-prefix",
        middle_hash: "new-middle",
        ttl_class: "1h",
        last_read_at_ms: 275_000,
        expected_expiry_ms: 3_875_000,
      }),
    );
    finish({ ok: true });

    const result = await firstTick;

    expect(result).toEqual({ pinged: 1, skipped: 0, failed: 0 });
    expect(tracker.get("ws-1", "s-1")).toMatchObject({
      prefix_hash: "new-prefix",
      middle_hash: "new-middle",
      ttl_class: "1h",
      last_read_at_ms: 275_000,
      expected_expiry_ms: 3_875_000,
    });
  });

  it("logs unexpected interval tick failures", async () => {
    vi.useFakeTimers();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const tracker = {
      entries: () => {
        throw new Error("tracker failed");
      },
    } as unknown as CacheStateTracker;
    const worker = new KeepaliveWorker({
      tracker,
      config: { ...config, interval_seconds: 1 },
      executor: () => ({ ok: true }),
      logger,
    });

    try {
      worker.start();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(logger.error).toHaveBeenCalledWith(
        "[cachelane] keepalive tick failed",
        expect.any(Error),
      );
    } finally {
      worker.stop();
      vi.useRealTimers();
    }
  });
});
