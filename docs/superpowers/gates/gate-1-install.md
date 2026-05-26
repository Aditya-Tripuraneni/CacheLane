# Gate 1: Install Foundation

**Goal:** `cachelane install` writes `ANTHROPIC_BASE_URL=http://127.0.0.1:7332` to `~/.claude/settings.json`; aborts if a conflicting URL is already set; `cachelane uninstall` removes it; fully idempotent. Adds proxy/features/health/logging sections to `CachelaneConfig`.

**Tag at completion:** `gate-1-done`

## Files in scope
- `src/types/index.ts` — extend `CachelaneConfig`
- `src/config/defaults.ts` — add defaults
- `src/config/schema.ts` (Zod) — extend validation
- `src/cli/install.ts` — add `validateInstall()`, `mergeBaseUrlIntoSettings()`, `removeBaseUrlFromSettings()`
- `src/cli/__tests__/install.test.ts` — new test cases

## Tasks (1.1–1.10 from plan)
See plan file gate-1 section. TDD: tests fail first, then implement.

## Status log
- 2026-05-24 — implementer dispatched, returned DONE
- 2026-05-24 — spec compliance review: ✅ all 10 spec items satisfied
- 2026-05-24 — code quality review: Approved-with-fixes (2 Important issues)
- 2026-05-24 — fix commit `78ef960`: removed redundant top-level `log_level`; hardened non-object `env` handling in `validateInstall` and `mergeBaseUrlIntoSettings` via shared `assertEnvIsObjectOrAbsent` helper
- 2026-05-24 — tag `gate-1-done` moved forward to `78ef960`. Tests: 236/236. Lint and tsc clean.

## Final commit chain
- `bcb0952` — initial G1 implementation (12 new tests, type + install/uninstall wiring)
- `78ef960` — code-quality fixes (drop `log_level`, harden env handling, +1 test)

## Files touched (final)
- `src/types/index.ts`
- `src/config/defaults.ts`
- `src/config/index.ts` (Zod schema, inline)
- `src/cli/install.ts`
- `src/cli/__tests__/install.test.ts` (new file, 13 tests)
- `src/config/__tests__/config.test.ts` (minor: type widening + fixture cleanup)
- `src/cli/__tests__/cli.test.ts` (minor: removed obsolete `log_level` fixture reference)

## Awaiting human validation
Run:
```bash
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
npm run build
node dist/cli/index.js install
cat ~/.claude/settings.json  # expect "ANTHROPIC_BASE_URL": "http://127.0.0.1:7332" under "env"
node dist/cli/index.js install   # idempotent — no error, file unchanged
node dist/cli/index.js uninstall
cat ~/.claude/settings.json  # ANTHROPIC_BASE_URL removed; other env keys intact
node dist/cli/index.js install   # reinstall works
```
