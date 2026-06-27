// InstallTarget seam — describes how Cachelane redirects a given tool's LLM
// traffic at the local proxy. Claude Code is the default target; other tools
// (e.g. Aider) redirect via a different env var and have no hook/MCP surface.
export interface InstallTarget {
  // Stable identifier, e.g. "claude-code" | "aider".
  name: string;
  // How the tool is pointed at the local proxy.
  redirectMechanism: "env" | "config-file" | "ui-manual";
  // Env var(s) the user/tool reads for the API base URL,
  // e.g. ["OPENAI_API_BASE"] or ["ANTHROPIC_BASE_URL"].
  envVars: string[];
  // The upstream the tool talks to by default, e.g. "api.openai.com".
  upstreamDefault: string;
  // Claude Code only — undefined for tools without a hook surface.
  hookSurface?: unknown;
  // Claude Code only — undefined for tools without an MCP surface.
  mcpSurface?: unknown;
}
