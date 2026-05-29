import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installCachelane,
  uninstallCachelane,
  mergeBaseUrlIntoSettings,
  removeBaseUrlFromSettings,
  validateInstall,
} from "../install.js";

const EXPECTED_URL = "http://127.0.0.1:7332";
const EXPECTED_PORT = 7332;

type JsonObject = Record<string, unknown>;

let tmpDir: string;
let env: NodeJS.ProcessEnv;
let settingsPath: string;

function readSettings(): JsonObject {
  return JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as JsonObject;
}

function readCachelaneConfig(): JsonObject {
  return JSON.parse(
    fs.readFileSync(path.join(env.CACHELANE_HOME!, "config.json"), "utf-8"),
  ) as JsonObject;
}

function writeSettings(value: JsonObject): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(value, null, 2)}\n`);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-install-"));
  env = {
    ...process.env,
    CACHELANE_HOME: path.join(tmpDir, "cachelane"),
    CLAUDE_HOME: path.join(tmpDir, "claude"),
    CACHELANE_WORKSPACE_ID: "ws-1",
    CACHELANE_SESSION_ID: "sess-1",
  };
  settingsPath = path.join(env.CLAUDE_HOME!, "settings.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("mergeBaseUrlIntoSettings", () => {
  it("adds ANTHROPIC_BASE_URL when no env block exists", () => {
    writeSettings({ other: "value" });

    const changed = mergeBaseUrlIntoSettings(settingsPath, EXPECTED_PORT);

    expect(changed).toBe(true);
    const settings = readSettings() as { env: { ANTHROPIC_BASE_URL: string } };
    expect(settings.env.ANTHROPIC_BASE_URL).toBe(EXPECTED_URL);
  });

  it("merges ANTHROPIC_BASE_URL into an existing env block without clobbering other env keys", () => {
    writeSettings({ env: { FOO: "bar", BAZ: "qux" } });

    const changed = mergeBaseUrlIntoSettings(settingsPath, EXPECTED_PORT);

    expect(changed).toBe(true);
    const settings = readSettings() as {
      env: { ANTHROPIC_BASE_URL: string; FOO: string; BAZ: string };
    };
    expect(settings.env.ANTHROPIC_BASE_URL).toBe(EXPECTED_URL);
    expect(settings.env.FOO).toBe("bar");
    expect(settings.env.BAZ).toBe("qux");
  });

  it("is idempotent — re-running with the URL already correct does not modify the file", () => {
    writeSettings({ env: { ANTHROPIC_BASE_URL: EXPECTED_URL } });
    const mtimeBefore = fs.statSync(settingsPath).mtimeMs;

    // Force a measurable mtime gap before re-running.
    const stale = mtimeBefore - 5000;
    fs.utimesSync(settingsPath, stale / 1000, stale / 1000);
    const staleAfterUtimes = fs.statSync(settingsPath).mtimeMs;

    const changed = mergeBaseUrlIntoSettings(settingsPath, EXPECTED_PORT);

    expect(changed).toBe(false);
    expect(fs.statSync(settingsPath).mtimeMs).toBe(staleAfterUtimes);
  });
});

describe("validateInstall", () => {
  it("does not throw when settings.json has a different ANTHROPIC_BASE_URL (preserves for custom upstreams)", () => {
    writeSettings({ env: { ANTHROPIC_BASE_URL: "http://example.com:9999" } });

    expect(() => validateInstall(settingsPath, EXPECTED_PORT)).not.toThrow();
  });

  it("throws when settings.json is malformed JSON", () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, "{not json");

    expect(() => validateInstall(settingsPath, EXPECTED_PORT)).toThrow(/Invalid JSON/);
  });

  it("aborts when settings.json has a malformed env (non-object)", () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ env: "oops" }));

    expect(() => validateInstall(settingsPath, EXPECTED_PORT)).toThrow(
      /env.*not an object/i,
    );
  });

  it("does not modify settings.json on validation failure", () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    // Write invalid JSON
    fs.writeFileSync(settingsPath, "{malformed");
    const before = fs.readFileSync(settingsPath, "utf-8");

    expect(() => validateInstall(settingsPath, EXPECTED_PORT)).toThrow(/Invalid JSON/);

    expect(fs.readFileSync(settingsPath, "utf-8")).toBe(before);
  });
});

describe("removeBaseUrlFromSettings", () => {
  it("removes ANTHROPIC_BASE_URL but leaves other env keys intact", () => {
    writeSettings({
      env: { ANTHROPIC_BASE_URL: EXPECTED_URL, FOO: "bar" },
      other: "value",
    });

    const changed = removeBaseUrlFromSettings(settingsPath);

    expect(changed).toBe(true);
    const settings = readSettings() as { env: { FOO: string }; other: string };
    expect(settings.env).toEqual({ FOO: "bar" });
    expect(settings.other).toBe("value");
  });

  it("removes the entire env block when it becomes empty", () => {
    writeSettings({ env: { ANTHROPIC_BASE_URL: EXPECTED_URL }, other: "value" });

    const changed = removeBaseUrlFromSettings(settingsPath);

    expect(changed).toBe(true);
    const settings = readSettings();
    expect(settings).not.toHaveProperty("env");
    expect(settings.other).toBe("value");
  });

  it("is a no-op when ANTHROPIC_BASE_URL is not present", () => {
    writeSettings({ env: { FOO: "bar" } });

    const changed = removeBaseUrlFromSettings(settingsPath);

    expect(changed).toBe(false);
  });
});

describe("installCachelane / uninstallCachelane URL wiring", () => {
  it("install writes ANTHROPIC_BASE_URL to settings.json", () => {
    installCachelane(env);

    const settings = readSettings() as { env: { ANTHROPIC_BASE_URL: string } };
    expect(settings.env.ANTHROPIC_BASE_URL).toBe(EXPECTED_URL);
  });

  it("install rewrites a conflicting URL to the local proxy and stores the old URL as upstream", () => {
    writeSettings({ env: { ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic" } });

    // Should not throw, should perform writes successfully.
    installCachelane(env);

    const settings = readSettings() as { env: { ANTHROPIC_BASE_URL: string } };
    expect(settings.env.ANTHROPIC_BASE_URL).toBe(EXPECTED_URL);

    const config = readCachelaneConfig() as {
      proxy: {
        upstream_host: string;
        upstream_port: number;
        upstream_ssl: boolean;
        upstream_path_prefix: string;
      };
    };
    expect(config.proxy.upstream_host).toBe("api.z.ai");
    expect(config.proxy.upstream_port).toBe(443);
    expect(config.proxy.upstream_ssl).toBe(true);
    expect(config.proxy.upstream_path_prefix).toBe("/api/anthropic");
  });

  it("uninstall removes ANTHROPIC_BASE_URL", () => {
    installCachelane(env);
    uninstallCachelane(env);

    const settings = readSettings() as { env?: { ANTHROPIC_BASE_URL?: string } };
    expect(settings.env?.ANTHROPIC_BASE_URL).toBeUndefined();
  });
});
