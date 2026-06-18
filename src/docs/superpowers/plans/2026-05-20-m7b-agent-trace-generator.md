# M7B Agent Trace Generator

## Goal
Add a local-only trace generation harness that can run scripted agent scenarios through fake, Claude Code, or GLM providers and emit normalized replay material for later CacheLane benchmarks.

## Scope
- Commit repeatable scenario specs under `benchmark/scenarios`.
- Write generated artifacts under gitignored `benchmark/runs/<timestamp>/`.
- Normalize provider output into `CorpusTurn`-compatible records: `assistant_text`, `tool_calls`, and `blocks_in_prompt`.
- Produce `report.json` with counts for sessions, turns, prompt blocks, tool calls, and referenced candidates.
- Keep provider secrets out of raw traces, normalized traces, and reports.

## Non-Goals
- Do not commit generated raw or normalized traces by default.
- Do not implement the final enabled-vs-disabled CacheLane token savings benchmark.
- Do not require Claude Code or GLM credentials for automated tests.

## Validation
- `npm test`
- `npm run lint`
- `npx tsc --noEmit`
- `npx tsx scripts/sessions/run-agent-scenarios.ts --provider fake --count 3`
- `npx tsx scripts/sessions/run-agent-scenarios.ts --provider glm --count 3 --dry-run`
