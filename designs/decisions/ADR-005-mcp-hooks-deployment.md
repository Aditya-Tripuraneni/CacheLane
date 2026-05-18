# ADR-005: Deploy as MCP Server + Claude Code Hooks (stdio)

**Status:** Accepted  
**Date:** May 2026  
**Source:** Token Reduction Research §3.2, §3.3, §3.4; Phase 2 Spec D8

## Context

Cachelane needs to intercept every conversation turn — both before the request goes to Anthropic
(to reorder and prune) and after the response arrives (to update usage counters). Several
deployment patterns were considered.

## Decision

Deploy as:
1. An MCP server over stdio transport (no network ports) — primary interface
2. A PreRequest hook — fires before each turn; hands unsorted blocks to Cachelane
3. A PostResponse hook — fires after each turn; triggers reference detection and counter updates
4. A CLI (`commander`) — install/stats/explain/pin/exclude/prune/keepalive/disable/doctor/uninstall

Requires: Claude Code ≥ 0.6 (MCP server registration + PostResponse hooks).

## Alternatives Considered

| Alternative | Rejection reason |
|-------------|-----------------|
| API proxy at network layer | Heavier integration; requires intercepting HTTPS; harder to install |
| Pure CLI (no hooks) | Can't intercept per-turn; would require user to manually invoke each turn |
| Daemon process with IPC | More complex; outside the MCP ecosystem norm |

## Consequences

**Positive:**
- Ecosystem-native pattern (familiar to Claude Code users)
- Coexists with all other MCP tools without conflict
- stdio transport means no port conflicts; no network exposure

**Negative:**
- Two hook surfaces to maintain (PreRequest + PostResponse)
- Depends on Claude Code ≥ 0.6 feature availability
