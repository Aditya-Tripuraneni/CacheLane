# Gate 7: Baseline A/B + Acceptance Suite

**Goal:** All §9 acceptance criteria pass. `features.mutation_enabled` flag lets the proxy run in baseline mode. `cachelane benchmark compare` produces a side-by-side report. No user-facing mention of "proxy."

**Tag at completion:** `gate-7-done`. Open PR after this tag.
**Blocked by:** G6

## Files in scope
- Modify: `src/config/defaults.ts`
- Modify: `src/types/index.ts` (add `mutation_enabled`)
- Modify: `src/proxy/server.ts`
- Create: `src/benchmark/baseline-compare.ts`
- Modify: `README.md` (docs lint)

## Status log
- (blocked on G6)
