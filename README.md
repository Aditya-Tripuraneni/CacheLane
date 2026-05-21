# CacheLane

CacheLane is a local cache-discipline layer for Claude Code. It runs as a stdio
MCP server plus Claude Code hooks, then uses prompt-cache breakpoints and
metadata-only K-pruning to reduce repeated input-token cost in long sessions.

## Install

```sh
npm install -g cachelane
cachelane install
cachelane doctor
```

`cachelane install` is idempotent. It registers the MCP server in
`~/.claude/mcp.json`, writes a CacheLane hook descriptor under
`~/.claude/hooks/`, and creates `~/.cachelane/config.json` if needed.

## CLI

```sh
cachelane stats [--scope session|workspace|all] [--since <ISO-time-or-duration>] [--json]
cachelane explain [--turn <number>] [--json]
cachelane prune --aggressive | --conservative | --default
cachelane keepalive off|static|adaptive|auto
cachelane pin <file|glob>
cachelane exclude <file|glob>
cachelane enable
cachelane disable
cachelane doctor [--json]
cachelane uninstall [--purge]
npm run benchmark:recorded
```

`stats`, `explain`, and `doctor` support `--json` for automation. `uninstall`
removes the Claude Code integration but preserves local CacheLane data;
`uninstall --purge` is the explicit full wipe.

## MCP Tools

CacheLane exposes three model-facing tools:

- `cachelane:stats` returns turn counts, cache-hit ratio, effective cost units,
  baseline cost units, savings ratio, pruner counts, and keepalive counts.
- `cachelane:explain` returns metadata-only breakpoint, region, pruning, and
  usage details for the latest or requested turn.
- `cachelane:expand` returns trusted refetch metadata for a stubbed block. The
  external tool call is still handled by the Claude Code/MCP host path.

## Privacy

CacheLane is local-first. The SQLite log at `~/.cachelane/cachelane.db` stores
block IDs, hashes, classifications, token counts, counters, breakpoint hashes,
prune decisions, and usage totals. It does not store prompt text, assistant text,
tool output, file contents, API keys, or raw request/response bodies.

Anonymous telemetry is off by default. `cachelane stats --opt-in` only flips the
local config flag; telemetry payloads are limited to aggregate cache statistics
and never include workspace IDs, session IDs, file paths, prompt content, model
names, API keys, or IP-correlatable timestamps.

## Data Paths

- Config: `~/.cachelane/config.json`
- SQLite log: `~/.cachelane/cachelane.db`
- Claude MCP registration: `~/.claude/mcp.json`
- Claude hook descriptor: `~/.claude/hooks/cachelane.json`

Cache scopes are keyed by both workspace and session. Prefixes are not shared
across workspaces.

## `/compact`

When Claude Code compacts a conversation, CacheLane treats the compacted history
as a fresh middle region. Replaced block counters are reset, and the compacted
summary is handled conservatively so breakpoint placement can stabilize again.

## Troubleshooting

- Run `cachelane doctor --json` for machine-readable install checks.
- Use `cachelane disable` for a quick A/B test, then `cachelane enable` to
  restore pruning.
- Use `cachelane prune --conservative` if stubs appear too aggressively.
- Use `cachelane uninstall --purge` only when you want to remove local config
  and SQLite data.

## Benchmark

`npm run benchmark:recorded` runs the deterministic, credential-free benchmark
described in `BENCHMARK.md`. Generated runs are written under `benchmark/runs/`
and are ignored by git unless explicitly curated under `benchmark/runs/committed/`.
