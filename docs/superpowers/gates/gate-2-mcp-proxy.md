# Gate 2: Unified MCP+Proxy Process

**Goal:** `cachelane mcp` starts HTTP proxy inline. Port collision handled gracefully. Graceful SIGTERM shutdown drains in-flight requests with 5s timeout.

**Tag at completion:** `gate-2-done`
**Blocked by:** G1

## Files in scope
- Create: `src/proxy/lifecycle.ts`
- Modify: `src/proxy/server.ts`
- Modify: `src/server/index.ts`
- Create: `src/proxy/__tests__/lifecycle.test.ts`

## Status log
- (blocked on G1)
