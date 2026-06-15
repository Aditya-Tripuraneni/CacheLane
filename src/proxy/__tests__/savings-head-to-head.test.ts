import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { startProxy } from "../server.js";
import { openDatabase } from "../../storage/index.js";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import {
  computeCacheUsage,
  createCacheSimUpstream,
  newCacheSimState,
  type CacheSimUpstream,
} from "./helpers/cache-sim-upstream.js";
import type {
  AnthropicMessage,
  AnthropicMessagesRequest,
} from "../../orchestrator/types.js";

// ===========================================================================
// Head-to-head proof: does running CacheLane cost less than NOT running it?
//
// Both arms are scored by an identical NEUTRAL cache simulator (see
// helpers/cache-sim-upstream.ts) that knows nothing about CacheLane. The only
// thing that differs between arms is `features.mutation_enabled` in the proxy
// config, so any cost gap is attributable to CacheLane's orchestration/pruning
// and nothing else.
// ===========================================================================

// ---------------------------------------------------------------------------
// S1, S2 — simulator fidelity (pure, no proxy). Prove the instrument is honest
// before we trust any A/B number from it.
// ---------------------------------------------------------------------------

function reqWithBreakpoint(): AnthropicMessagesRequest {
  return {
    model: "claude-opus-4-7",
    system: [
      // 400 chars => ~100 estimated tokens, marked as a cache breakpoint.
      { type: "text", text: "S".repeat(400), cache_control: { type: "ephemeral", ttl: "5m" } },
    ],
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    max_tokens: 1024,
  };
}

function reqWithoutBreakpoint(): AnthropicMessagesRequest {
  return {
    model: "claude-opus-4-7",
    system: [{ type: "text", text: "S".repeat(400) }],
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    max_tokens: 1024,
  };
}

describe("S1 — simulator models caching when a breakpoint is present", () => {
  it("first request writes cache, identical second request reads it", () => {
    const state = newCacheSimState();
    const req = reqWithBreakpoint();

    const first = computeCacheUsage(req, state);
    expect(first.cache_read_input_tokens).toBe(0);
    expect(first.cache_creation_5m_tokens).toBeGreaterThan(0);

    const second = computeCacheUsage(req, state);
    expect(second.cache_read_input_tokens).toBeGreaterThan(0);
    expect(second.cache_creation_5m_tokens).toBe(0);
  });
});

describe("S2 — simulator never caches without a breakpoint", () => {
  it("two identical requests with no cache_control both pay full input", () => {
    const state = newCacheSimState();
    const req = reqWithoutBreakpoint();

    const first = computeCacheUsage(req, state);
    const second = computeCacheUsage(req, state);

    expect(first.cache_read_input_tokens).toBe(0);
    expect(second.cache_read_input_tokens).toBe(0);
    expect(first.cache_creation_5m_tokens).toBe(0);
    expect(second.cache_creation_5m_tokens).toBe(0);
    expect(second.input_tokens).toBe(first.input_tokens);
    expect(first.input_tokens).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Shared proxy harness for the end-to-end arms (S3, A, B, C).
// ---------------------------------------------------------------------------

const WS = "test-ws";

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
    const withClose = server as unknown as { closeAllConnections?: () => void };
    if (typeof withClose.closeAllConnections === "function") withClose.closeAllConnections();
    server.close(() => resolve());
  });
}

function postMessages(proxyPort: number, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, "utf-8");
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: proxyPort,
        path: "/v1/messages",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(buf.length) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve());
      },
    );
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

async function waitForTurn(dbPath: string, sessionId: string, expected: number): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const db = openDatabase(dbPath);
    try {
      const stats = db.getStats({ scope: "session", workspace_id: WS, session_id: sessionId });
      if (stats.turns >= expected) return;
    } finally {
      db.close();
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Timed out waiting for ${expected} turn(s) in ${sessionId}`);
}

function writeConfig(dir: string, mutationEnabled: boolean): string {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as typeof DEFAULT_CONFIG;
  config.features.mutation_enabled = mutationEnabled;
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

interface ArmResult {
  totalCost: number;
  forwardedTokens: number;
  prunedBlocks: number;
  mutatedTurns: number;
  perTurnCost: number[];
}

/** Run an identical multi-turn workload through a fresh proxy + fresh neutral
 *  simulator, with mutation on or off, and report what it cost. */
async function runArm(turns: AnthropicMessagesRequest[], mutationEnabled: boolean): Promise<ArmResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-h2h-"));
  const dbPath = path.join(tmpDir, "test.db");
  const configPath = writeConfig(tmpDir, mutationEnabled);
  const sessionId = `sess-${randomUUID()}`;
  const upstream: CacheSimUpstream = createCacheSimUpstream();
  upstream.server.listen(0, "127.0.0.1");
  const upstreamPort = await waitForServer(upstream.server);

  const proxy = startProxy({
    port: 0,
    db_path: dbPath,
    workspace_id: WS,
    session_id: sessionId,
    config_path: configPath,
    upstream: { host: "127.0.0.1", port: upstreamPort, ssl: false },
  });
  const proxyPort = await waitForServer(proxy);

  try {
    for (let i = 0; i < turns.length; i++) {
      await postMessages(proxyPort, JSON.stringify(turns[i]));
      await waitForTurn(dbPath, sessionId, i + 1);
    }

    const db = openDatabase(dbPath);
    try {
      const perTurnCost: number[] = [];
      let prunedBlocks = 0;
      let mutatedTurns = 0;
      for (let i = 1; i <= turns.length; i++) {
        const turn = db.getTurnByNumber(WS, sessionId, i)!;
        perTurnCost.push(turn.effective_cost_units);
        prunedBlocks += turn.pruned_blocks_count;
        mutatedTurns += turn.request_mutated ? 1 : 0;
      }
      // Tokens the upstream actually had to read on each forwarded request.
      const forwardedTokens = upstream.capturedBodies.reduce((sum, body) => {
        const usage = computeCacheUsage(JSON.parse(body), newCacheSimState());
        return sum + usage.input_tokens + usage.cache_creation_5m_tokens + usage.cache_creation_1h_tokens + usage.cache_read_input_tokens;
      }, 0);
      return {
        totalCost: perTurnCost.reduce((a, b) => a + b, 0),
        forwardedTokens,
        prunedBlocks,
        mutatedTurns,
        perTurnCost,
      };
    } finally {
      db.close();
    }
  } finally {
    await closeServer(proxy);
    await closeServer(upstream.server);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Workload builder. A "turn" is the full conversation resent so far (the API is
// stateless), mirroring how Claude Code resends the whole transcript each turn.
// ---------------------------------------------------------------------------

interface WorkloadOptions {
  turns: number;
  /** Put a Claude-Code-style native cache_control breakpoint on the last system
   *  block (the baseline-with-native-caching scenario). */
  nativeBreakpoint?: boolean;
}

function buildWorkload(opts: WorkloadOptions): AnthropicMessagesRequest[] {
  const stableSystem = "You are a careful coding assistant. ".repeat(220); // ~8KB stable prefix
  const requests: AnthropicMessagesRequest[] = [];
  const history: AnthropicMessage[] = [];

  for (let t = 1; t <= opts.turns; t++) {
    history.push({ role: "user", content: [{ type: "text", text: `Question number ${t}: ${"detail ".repeat(20)}` }] });
    const request: AnthropicMessagesRequest = {
      model: "claude-opus-4-7",
      system: [
        {
          type: "text",
          text: stableSystem,
          ...(opts.nativeBreakpoint ? { cache_control: { type: "ephemeral" as const, ttl: "5m" as const } } : {}),
        },
      ],
      tools: [{ name: "Read", description: "Read a file", input_schema: { type: "object" } }],
      messages: history.map((m) => ({ role: m.role, content: m.content.map((c) => ({ ...c })) })),
      max_tokens: 1024,
    };
    requests.push(request);
    history.push({ role: "assistant", content: [{ type: "text", text: `Answer ${t}.` }] });
  }

  return requests;
}

describe("S3 — negative control: identical config, identical cost", () => {
  it("running the same workload twice with mutation OFF yields equal cost", async () => {
    const workload = buildWorkload({ turns: 4 });

    const runA = await runArm(workload, false);
    const runB = await runArm(workload, false);

    expect(runA.totalCost).toBeGreaterThan(0);
    expect(runB.totalCost).toBe(runA.totalCost);
    expect(runA.mutatedTurns).toBe(0);
  });
});

describe("A — CacheLane beats an uncached client", () => {
  it("costs strictly less, and at most 0.7x, vs a client that sets no breakpoints", async () => {
    const workload = buildWorkload({ turns: 6, nativeBreakpoint: false });

    const off = await runArm(workload, false); // uncached: no breakpoint, no mutation
    const on = await runArm(workload, true); // CacheLane orchestrates breakpoints

    console.log(`[A] cost off=${off.totalCost} on=${on.totalCost} ratio=${(on.totalCost / off.totalCost).toFixed(3)}`);

    expect(on.mutatedTurns).toBeGreaterThan(0);
    expect(on.totalCost).toBeLessThan(off.totalCost);
    expect(on.totalCost).toBeLessThanOrEqual(0.7 * off.totalCost);
  });
});

describe("B1 — orchestration alone never costs more than a native breakpoint", () => {
  it("matches (does not beat) a client that already sets one optimal breakpoint", async () => {
    // Honest finding: when the baseline client already places a single
    // cache_control breakpoint over the static prefix — and there is no idle
    // block to prune — CacheLane's reordering caches the SAME prefix and lands
    // at PARITY, not a strict win. Observed: off === on (both 4587.5). The real
    // marginal benefit over native caching comes from pruning (see B2).
    const workload = buildWorkload({ turns: 6, nativeBreakpoint: true });

    const off = await runArm(workload, false); // native cache: breakpoint present, no mutation
    const on = await runArm(workload, true); // CacheLane mutation on the same input

    console.log(`[B1] cost off=${off.totalCost} on=${on.totalCost} ratio=${(on.totalCost / off.totalCost).toFixed(3)}`);

    expect(off.totalCost).toBeGreaterThan(0);
    expect(on.totalCost).toBeLessThanOrEqual(off.totalCost); // never worse than native caching
  });
});

interface PruningWorkloadOptions {
  turns: number;
  nativeBreakpoint?: boolean;
}

function buildPruningWorkload(opts: PruningWorkloadOptions): AnthropicMessagesRequest[] {
  const stableSystem = "You are a careful coding assistant. ".repeat(220);
  const bigToolResult = "FILE LINE ".repeat(800); // ~8KB tool result left idle after turn 1
  const requests: AnthropicMessagesRequest[] = [];
  const history: AnthropicMessage[] = [
    { role: "user", content: [{ type: "text", text: "Please read config.ts" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_read1", name: "Read", input: { path: "config.ts" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_read1", content: bigToolResult }] },
  ];

  for (let t = 1; t <= opts.turns; t++) {
    history.push({ role: "user", content: [{ type: "text", text: `Follow-up ${t}: ${"more ".repeat(15)}` }] });
    requests.push({
      model: "claude-opus-4-7",
      system: [
        {
          type: "text",
          text: stableSystem,
          ...(opts.nativeBreakpoint ? { cache_control: { type: "ephemeral" as const, ttl: "5m" as const } } : {}),
        },
      ],
      tools: [{ name: "Read", description: "Read a file", input_schema: { type: "object" } }],
      messages: history.map((m) => ({ role: m.role, content: m.content.map((c) => ({ ...c })) })),
      max_tokens: 1024,
    });
    history.push({ role: "assistant", content: [{ type: "text", text: `Answer ${t}.` }] });
  }

  return requests;
}

describe("B2 — CacheLane beats native caching when there is an idle block to prune", () => {
  it("costs strictly less than a native-breakpoint client by pruning the idle tool result", async () => {
    const workload = buildPruningWorkload({ turns: 6, nativeBreakpoint: true });

    const off = await runArm(workload, false); // native cache + idle block resent every turn
    const on = await runArm(workload, true); // CacheLane caches AND prunes the idle block

    console.log(`[B2] cost off=${off.totalCost} on=${on.totalCost} prunedBlocks(on)=${on.prunedBlocks} ratio=${(on.totalCost / off.totalCost).toFixed(3)}`);

    expect(off.totalCost).toBeGreaterThan(0);
    expect(on.prunedBlocks).toBeGreaterThan(0);
    expect(on.totalCost).toBeLessThan(off.totalCost);
  });
});

describe("C — pruning removes real tokens from the forwarded request", () => {
  it("forwards fewer tokens than the unpruned baseline once a block goes idle >= K turns", async () => {
    const workload = buildPruningWorkload({ turns: 6 });

    const off = await runArm(workload, false);
    const on = await runArm(workload, true);

    console.log(`[C] forwardedTokens off=${off.forwardedTokens} on=${on.forwardedTokens} prunedBlocks(on)=${on.prunedBlocks}`);

    expect(on.prunedBlocks).toBeGreaterThan(0);
    expect(on.forwardedTokens).toBeLessThan(off.forwardedTokens);
  });
});
