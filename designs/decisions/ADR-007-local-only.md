# ADR-007: Local-Only Architecture — No Hosted Backend

**Status:** Accepted  
**Date:** May 2026  
**Source:** Token Reduction Research §3.3; Phase 2 Spec §1.5, D7

## Context

Cachelane could operate as a local tool, a SaaS gateway/proxy, or a hybrid. The choice affects
cost, privacy, and operational complexity.

## Decision

Everything runs locally on the user's machine. The only network call is the direct HTTPS path to
`api.anthropic.com`. No hosted backend in v1.

Optional opt-in telemetry (a lightweight HTTPS endpoint at `https://telemetry.cachelane.dev/v1/report`)
is the only exception — and it is OFF by default, sends only aggregate metrics, and never includes
block content, API keys, or identifying information.

## Consequences

**Positive:**
- $0 infrastructure cost (zero-cost regime)
- No privacy risk — prompt content never touches a third-party server
- No operational complexity (no servers to run, monitor, or secure)
- Works offline (except for the Anthropic API itself)

**Negative:**
- No centralised analytics (only opt-in telemetry)
- No cross-user learning or adaptive classification models

## Invariant

No prompt content, API keys, user data, file paths, or workspace IDs may leave `api.anthropic.com`'s
direct request path. This is a hard security requirement (REQ-F-013).
