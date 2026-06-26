import type { InstallTarget } from "./types.js";

// Claude Code is the default install target: it redirects via ANTHROPIC_BASE_URL
// and additionally registers a hook surface (settings.json hooks) and an MCP
// surface (the cachelane MCP server). The actual install/uninstall logic lives
// in install.ts (installCachelane / uninstallCachelane); this descriptor just
// declares the surface so the InstallTarget seam can branch on it.
export const claudeCodeTarget: InstallTarget = {
  name: "claude-code",
  redirectMechanism: "env",
  envVars: ["ANTHROPIC_BASE_URL"],
  upstreamDefault: "api.anthropic.com",
  hookSurface: { events: ["UserPromptSubmit", "Stop"] },
  mcpSurface: { server: "cachelane" },
};
