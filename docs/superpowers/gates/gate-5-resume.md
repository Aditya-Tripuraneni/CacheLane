# Gate 5: Session Resume + Keepalive

**Goal:** `CacheStateTracker.fromDb()` reconstructs prefix state from DB after a proxy restart. `KeepaliveWorker` wired into proxy lifecycle.

**Tag at completion:** `gate-5-done`
**Blocked by:** G4

## Files in scope
- Modify: `src/orchestrator/cache-state-tracker.ts`
- Modify: `src/storage/data-access.ts`
- Modify: `src/proxy/lifecycle.ts`
- Modify: `src/server/index.ts`
- Modify: `src/orchestrator/__tests__/cache-state-tracker.test.ts`

## Status log
- (blocked on G4)
