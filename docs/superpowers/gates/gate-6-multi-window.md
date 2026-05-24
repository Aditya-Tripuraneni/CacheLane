# Gate 6: Multi-Window Session ID

**Goal:** Two simultaneous Claude Code windows produce isolated session records. Starts with investigation (Claude Code env behavior) before any code.

**Tag at completion:** `gate-6-done`
**Blocked by:** G5

## Investigation (must complete before code)
- 6.1 Instrument `startCachelaneStdioServer` to log env keys (CLAUDE_*, SESSION_*, ANTHROPIC_*, CACHELANE_*)
- 6.2 Run a real Claude Code session; capture which vars Claude Code passes to the MCP child
- 6.3 Decide Option E (per-window port via MCP env interpolation) vs Option D (shared proxy, content-hash session attribution)
- 6.4 Document the finding in this file before writing code

## Implementation (after decision)
- Create: `src/proxy/session-router.ts`
- Modify: `src/proxy/server.ts`
- Create: `src/proxy/__tests__/session-router.test.ts`

## Investigation findings
- (pending)

## Status log
- (blocked on G5)
