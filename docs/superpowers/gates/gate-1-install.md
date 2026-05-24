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
- (pending implementer dispatch)
