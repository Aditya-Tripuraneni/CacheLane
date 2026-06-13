import { openDatabase } from "../storage/index.js";
import { loadConfig } from "../config/index.js";
import { cachelaneConfigPath, cachelaneDbPath } from "./paths.js";
import { logger } from "../logger/index.js";

export async function handleHookMutate(
  env: NodeJS.ProcessEnv,
  parsed: Record<string, unknown>
): Promise<string | undefined> {
  // If the hook payload doesn't contain a prompt, we can't do anything
  const prompt = typeof parsed.prompt === "string" ? parsed.prompt : null;
  if (!prompt) return undefined;

  // hook-mutate is DEPRECATED: the supported path is the CacheLane proxy, which
  // performs real cache-aware orchestration + K-pruning on the request body. The
  // UserPromptSubmit hook cannot prune tool_result blocks (it only sees the typed
  // prompt string), so it must NOT mutate the prompt — injecting text here would
  // pollute the user's actual prompt for no benefit. This is now a no-op that only
  // verifies config/storage are reachable, then fails open.
  try {
    const db = openDatabase(cachelaneDbPath(env));
    loadConfig(cachelaneConfigPath(env));
    db.close();
  } catch (err) {
    logger.error("hook-mutate pipeline error", err instanceof Error ? err.message : String(err));
  }

  // No prompt mutation — let Claude Code use the prompt unchanged.
  return undefined;
}
