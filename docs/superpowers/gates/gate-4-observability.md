# Gate 4: Fail-Open Observability

**Goal:** Fail-open events recorded in DB with `signals: ["error:fallback"]`. `cachelane stats` shows "Pipeline fallback turns: N". `cachelane:health` MCP tool returns `status: "ok"` or `"degraded"`. Structured JSON-lines log file written at `~/.cachelane/cachelane.log` with rotation.

**Tag at completion:** `gate-4-done`
**Blocked by:** G3

## Files in scope
- Modify: `src/storage/migrations.ts` (migration 004)
- Modify: `src/proxy/server.ts`
- Modify: `src/cli/format.ts`
- Modify: `src/cli/doctor.ts`
- Create: `src/server/health.ts`
- Modify: `src/server/index.ts`
- Create: `src/logger/index.ts`

## Status log
- (blocked on G3)
