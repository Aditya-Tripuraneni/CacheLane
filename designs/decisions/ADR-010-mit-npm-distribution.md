# ADR-010: MIT License, Distribute via npm + Claude Code Plugin Marketplace

**Status:** Accepted  
**Date:** May 2026  
**Source:** Token Reduction Research §3.7; Phase 2 Spec §1.1

## Context

Cachelane's target audience is Claude Code users. Distribution friction directly impacts adoption.

## Decision

- **License:** MIT (public, permissive)
- **Repository:** Public GitHub
- **Distribution channel 1:** `npm install -g cachelane`
- **Distribution channel 2:** `claude plugin add` (Claude Code plugin marketplace)
- **Release signing:** npm provenance attestation via GitHub Actions (links tarball to source commit)
- **Build output:** Dual ESM and CJS via `tsup` (esbuild)
- **Benchmark artifact:** `BENCHMARK.md` with reproducible savings scripts

## Alternatives Considered

| Alternative | Rejection reason |
|-------------|-----------------|
| Commercial license | Creates friction; limits adoption; no monetisation path in v1 anyway |
| npm-only distribution | Fewer users; marketplace listing is low-cost and high-reach |
| Binary distribution (pkg/nexe) | Harder to audit; incompatible with npm provenance approach |

## Consequences

**Positive:**
- Maximum reach across both npm users and Claude Code plugin users
- MIT license allows community contributions and forks
- Provenance attestation builds trust (users can verify tarball = source commit)

**Negative:**
- No direct monetisation path in v1
- Must maintain two distribution channels (npm + marketplace manifest)
