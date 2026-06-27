import type { InstallTarget } from "./types.js";

// Aider reads its API base from the OPENAI_API_BASE process env var and has no
// hook or MCP surface, so installing it for Cachelane is purely an env-var
// redirect: point OPENAI_API_BASE at the local proxy.
export const aiderTarget: InstallTarget = {
  name: "aider",
  redirectMechanism: "env",
  envVars: ["OPENAI_API_BASE"],
  upstreamDefault: "api.openai.com",
  // No hookSurface / mcpSurface — left undefined.
};
