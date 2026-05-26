# Gate 3: K-Pruner Wiring + Pipeline Smoke Test

**Goal:** Proxy extracts tool-result blocks from each request and inserts them into `blocks` table; queries them before each request to populate `block_placements`. Pipeline smoke test (§7.2.1) all 5 assertions green.

**Tag at completion:** `gate-3-done`
**Blocked by:** G2

## Files in scope
- Modify: `src/proxy/server.ts`
- Modify: `src/storage/data-access.ts`
- Create: `src/proxy/__tests__/pipeline-smoke.test.ts`

## Status log
- in-progress (subagent dispatched)
