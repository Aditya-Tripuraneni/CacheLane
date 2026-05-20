# M6 Keepalive Core — Execution Notes

## Scope

M6 adds the internal keepalive core only. It does not add CLI commands, MCP
transport, real Anthropic API calls, structured file logging, or new runtime
dependencies.

## Decisions

- Base: `feat/m6-keepalive` from updated `origin/main` after the M4/M5 merge.
- Ping execution: injectable `KeepalivePingExecutor`; real transport is deferred.
- Timing: config-driven check cadence using `keepalive.interval_seconds`.
- Idle gate: `keepalive.idle_threshold_seconds`, measured from
  `PrefixState.last_read_at_ms`.
- TTL selection: orchestrator records prefix token count and switches large
  prefixes to `ttl_class: "1h"` using
  `keepalive.large_prefix_threshold_tokens`.
- Runtime logging: existing console-backed fail-open logging only. Full local
  JSON log rotation remains a future logging milestone.

## Test Strategy

- Pure keepalive policy matrix with no timers or network.
- Worker tests use fake clock/input and injected executor.
- Orchestrator tests cover prefix token counting and `5m`/`1h` TTL markers.
- Full gates remain `npm test`, `npm run lint`, `npx tsc --noEmit`, and corpus
  eval.

## Reflections

- Keepalive is intentionally metadata-only in M6. A real Anthropic ping needs
  current prefix payload ownership that does not exist yet; forcing it now would
  couple the worker to request construction and increase secret/logging risk.
- The default config has a long `interval_seconds` relative to a 5-minute TTL.
  M6 honors config as requested; future empirical tuning can revise defaults
  without changing worker semantics.
