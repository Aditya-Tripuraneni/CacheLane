import fs from "node:fs";
import net from "node:net";
import { loadConfig } from "../config/index.js";
import { openDatabase } from "../storage/index.js";
import { cachelaneConfigPath, cachelaneDbPath } from "./paths.js";
import { installSurfaceStatus } from "./install.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  probe?: boolean;
}

function nodeVersionOk(version: string): boolean {
  const [majorRaw, minorRaw] = version.replace(/^v/, "").split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  return major > 20 || (major === 20 && minor >= 10);
}

export function runDoctor(env: NodeJS.ProcessEnv = process.env): DoctorReport {
  const checks: DoctorCheck[] = [];
  const configPath = cachelaneConfigPath(env);
  const dbPath = cachelaneDbPath(env);

  checks.push({
    name: "node",
    ok: nodeVersionOk(process.version),
    detail: process.version,
  });

  try {
    loadConfig(configPath);
    checks.push({ name: "config", ok: true, detail: configPath });
  } catch (err) {
    checks.push({
      name: "config",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  let dbOpened = false;
  try {
    const db = openDatabase(dbPath);
    dbOpened = true;
    db.close();
  } catch (err) {
    checks.push({
      name: "database",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  if (dbOpened) {
    checks.push({ name: "database", ok: true, detail: dbPath });
  }

  const install = installSurfaceStatus(env);
  checks.push({
    name: "mcp",
    ok: install.mcp_registered,
    detail: install.mcp_registered ? "registered" : "not registered",
  });
  checks.push({
    name: "hooks",
    ok: install.hook_registered,
    detail: install.hook_registered ? "registered" : "not registered",
  });
  checks.push({
    name: "data",
    ok: fs.existsSync(dbPath),
    detail: dbPath,
  });

  // Upstream / chaining awareness.
  let upstreamConfig: { host: string; port: number; ssl: boolean } | null = null;
  try {
    const config = loadConfig(configPath);
    upstreamConfig = {
      host: config.proxy.upstream_host,
      port: config.proxy.upstream_port,
      ssl: config.proxy.upstream_ssl,
    };
  } catch {
    upstreamConfig = null;
  }

  if (upstreamConfig) {
    const isDefault =
      upstreamConfig.host === "api.anthropic.com" &&
      upstreamConfig.port === 443 &&
      upstreamConfig.ssl === true;
    checks.push({
      name: "upstream",
      ok: true,
      detail: isDefault
        ? "default (api.anthropic.com)"
        : `chained → ${upstreamConfig.host}:${upstreamConfig.port} (${upstreamConfig.ssl ? "https" : "http"})`,
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}

export function probeUpstream(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean, detail: string) => {
      socket.destroy();
      resolve({ ok, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true, `reachable ${host}:${port}`));
    socket.once("timeout", () => done(false, `timeout connecting ${host}:${port}`));
    socket.once("error", (err) => done(false, err.message));
    socket.connect(port, host);
  });
}

export function computeFallbackRate(
  explanations: { mutated: boolean }[],
): { fallback_count: number; total: number; fraction: number } {
  const total = explanations.length;
  const fallback_count = explanations.filter((e) => !e.mutated).length;
  return { fallback_count, total, fraction: total === 0 ? 0 : fallback_count / total };
}

export async function runDoctorAsync(
  env: NodeJS.ProcessEnv = process.env,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const report = runDoctor(env);

  if (options.probe) {
    try {
      const config = loadConfig(cachelaneConfigPath(env));
      const isDefault =
        config.proxy.upstream_host === "api.anthropic.com" &&
        config.proxy.upstream_port === 443 &&
        config.proxy.upstream_ssl === true;
      // Only probe a non-default (chained) upstream; the default Anthropic host
      // is assumed reachable and we avoid an outbound connection on plain doctor.
      if (!isDefault) {
        const probe = await probeUpstream(
          config.proxy.upstream_host,
          config.proxy.upstream_port,
          2000,
        );
        report.checks.push({ name: "upstream_reachable", ok: probe.ok, detail: probe.detail });
      }
    } catch {
      // fail-open: a probe failure is a warning, never a crash
    }
  }

  // DB-backed health checks (fail-open: never throw).
  try {
    const config = loadConfig(cachelaneConfigPath(env));
    const db = openDatabase(cachelaneDbPath(env));
    try {
      const workspaceId =
        env.CACHELANE_WORKSPACE_ID && env.CACHELANE_WORKSPACE_ID.length > 0
          ? env.CACHELANE_WORKSPACE_ID
          : "default";
      const recent = db.getRecentTurnExplanations({
        workspace_id: workspaceId,
        limit: config.health.fallback_window_turns,
      });
      const { fallback_count, total, fraction } = computeFallbackRate(recent);
      const thresholdFrac = config.health.fallback_warning_threshold_pct / 100;
      report.checks.push({
        name: "fallback_rate",
        ok: fraction <= thresholdFrac,
        detail: `${fallback_count} of last ${total} turns failed open (${(fraction * 100).toFixed(1)}%)`,
      });

      const stats = db.getStats({ scope: "workspace", workspace_id: workspaceId });
      const cacheReadsOk = stats.turns < 3 || stats.cache_hit_ratio > 0;
      report.checks.push({
        name: "cache_reads",
        ok: cacheReadsOk,
        detail: cacheReadsOk
          ? `cache hit ratio ${(stats.cache_hit_ratio * 100).toFixed(1)}%`
          : `cache reads ~0 over ${stats.turns} turns — a chained proxy may be stripping cacheable content`,
      });
    } finally {
      db.close();
    }
  } catch {
    // fail-open
  }

  report.ok = report.checks.every((c) => c.ok);
  return report;
}

export function formatDoctor(report: DoctorReport): string {
  return report.checks
    .map((check) => `${check.ok ? "ok" : "fail"} ${check.name}: ${check.detail}`)
    .join("\n");
}
