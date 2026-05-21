import fs from "node:fs";
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

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}

export function formatDoctor(report: DoctorReport): string {
  return report.checks
    .map((check) => `${check.ok ? "ok" : "fail"} ${check.name}: ${check.detail}`)
    .join("\n");
}
