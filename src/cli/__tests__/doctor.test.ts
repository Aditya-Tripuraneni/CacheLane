import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { runDoctor, probeUpstream, computeFallbackRate } from "../doctor.js";

let tmpDir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-doctor-"));
  env = {
    ...process.env,
    CACHELANE_HOME: path.join(tmpDir, "cachelane"),
    CLAUDE_HOME: path.join(tmpDir, "claude"),
    CACHELANE_WORKSPACE_ID: "ws-1",
    CACHELANE_SESSION_ID: "sess-1",
  };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("doctor upstream check", () => {
  it("reports default upstream as ok without probing", () => {
    const report = runDoctor(env);
    const upstream = report.checks.find((c) => c.name === "upstream");
    expect(upstream).toBeDefined();
    expect(upstream!.ok).toBe(true);
    expect(upstream!.detail).toContain("default");
    // no probe attempted by default
    expect(report.checks.find((c) => c.name === "upstream_reachable")).toBeUndefined();
  });
});

describe("probeUpstream", () => {
  it("resolves ok=true for a reachable port", async () => {
    const server = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as net.AddressInfo).port;
    const result = await probeUpstream("127.0.0.1", port, 1000);
    server.close();
    expect(result.ok).toBe(true);
  });

  it("resolves ok=false for an unreachable port", async () => {
    const result = await probeUpstream("127.0.0.1", 1, 500);
    expect(result.ok).toBe(false);
  });
});

describe("computeFallbackRate", () => {
  it("matches health.ts threshold semantics", () => {
    const explanations = [
      { mutated: true }, { mutated: true }, { mutated: false },
    ] as { mutated: boolean }[];
    const { fallback_count, total, fraction } = computeFallbackRate(explanations);
    expect(fallback_count).toBe(1);
    expect(total).toBe(3);
    expect(fraction).toBeCloseTo(1 / 3, 5);
  });
});
