import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ProviderAdapter, RawTraceSession } from "../types.js";

const execFileAsync = promisify(execFile);

export interface ClaudeCodeAdapterOptions {
  command?: string;
  args?: string[];
  transcriptRoot?: string;
}

function walkJsonlFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsonlFiles(path, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(path);
    }
  }
}

function newestTranscriptAfter(root: string, afterMs: number): string | undefined {
  const files: string[] = [];
  walkJsonlFiles(root, files);

  return files
    .map((path) => ({ path, mtimeMs: statSync(path).mtimeMs }))
    .filter((entry) => entry.mtimeMs >= afterMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path;
}

export function createClaudeCodeAdapter(options: ClaudeCodeAdapterOptions = {}): ProviderAdapter {
  const command = options.command ?? process.env.CLAUDE_CODE_COMMAND ?? "claude";
  const baseArgs = options.args ?? ["-p"];
  const transcriptRoot =
    options.transcriptRoot ?? process.env.CLAUDE_CODE_TRANSCRIPTS ?? join(homedir(), ".claude", "projects");

  return {
    name: "claude-code",
    async runScenario(scenario, runOptions): Promise<RawTraceSession> {
      const startedDate = runOptions.now();
      const startedAt = startedDate.toISOString();
      const turns = scenario.turns.length > 0 ? scenario.turns : [scenario.prompt];
      const sessionId = randomUUID();

      if (runOptions.dry_run) {
        return {
          session_id: sessionId,
          provider: "claude-code",
          scenario_id: scenario.id,
          started_at: startedAt,
          ended_at: runOptions.now().toISOString(),
          command_summary: {
            command,
            args: [...baseArgs, "<scenario-turn>"],
            transcript_root: transcriptRoot,
            session_id: sessionId,
            turn_count: turns.length,
          },
          turns: turns.map((_, i) => ({
            assistant_text: `Dry run only. Planned Claude Code turn ${i + 1}/${turns.length} for ${scenario.id}.`,
          })),
        };
      }

      for (let i = 0; i < turns.length; i++) {
        const turnPrompt = turns[i]!;
        const turnArgs =
          i === 0
            ? ["--session-id", sessionId, ...baseArgs, turnPrompt]
            : ["--resume", sessionId, ...baseArgs, turnPrompt];
        await execFileAsync(command, turnArgs, {
          cwd: process.cwd(),
          timeout: 120_000,
          maxBuffer: 1024 * 1024 * 10,
        });
      }

      const transcriptPath = newestTranscriptAfter(transcriptRoot, startedDate.getTime());
      if (!transcriptPath) {
        throw new Error(`Claude Code completed but no JSONL transcript was found under ${transcriptRoot}`);
      }

      return {
        session_id: sessionId,
        provider: "claude-code",
        scenario_id: scenario.id,
        started_at: startedAt,
        ended_at: runOptions.now().toISOString(),
        transcript_path: transcriptPath,
        command_summary: {
          command,
          args: [...baseArgs, "<scenario-turn>"],
          transcript_root: transcriptRoot,
          session_id: sessionId,
          turn_count: turns.length,
        },
        turns: [],
      };
    },
  };
}
