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
- Claude Code natively appends tracing headers to all outgoing requests, including `X-Claude-Code-Session-Id` and `X-Claude-Code-Agent-Id`.
- This fundamentally simplifies the session routing. We do not need complex content-hashing (Option D) or dynamic proxy ports (Option E).
- The shared proxy on port 7332 will simply extract the `x-claude-code-session-id` header from the incoming request and use it as the `session_id`.

## Status log
- (done) Native header discovery implemented and tested in `server.ts` and `server.test.ts`. Gate 6 complete!
