# RTK-style Command-Aware Shell Compression — Design

**Status:** Approved design, pre-implementation
**Date:** 2026-06-25
**Author:** brainstorming session (Claude + user)

## 1. Summary

Add RTK-style, command-aware compression of Bash `tool_result` outputs to CacheLane
by **extending the existing `src/compressor/` module** — not rebuilding it and not
shelling out to the Rust `rtk` binary.

CacheLane already has the compression seam: `compress()` runs in the proxy before the
canonical `classify → prune → reorder` pipeline (`src/proxy/server.ts:402`), routes
`tool_result` blocks through a registry (`json` | `log` | `passthrough`), applies a
never-worse guard, supports opt-in retention of originals (refetchable via
`cachelane_retrieve_tool_output`), and fails open on any error.

The gap versus RTK: CacheLane keys compression on **output shape only**. RTK keys on the
**originating command** (`git status` vs `pytest` vs `npm install`) and emits a structured
per-command summary. CacheLane's compressor never sees the command that produced a
`tool_result`. This design closes that gap.

## 2. Goals / Non-goals

### Goals
- Compress verbose Bash outputs (git, package install, tests, builds) into structured
  summaries keyed on the originating command.
- Preserve CacheLane's cache-stability guarantee: compressed bytes must be deterministic
  so a compressed block caches identically across turns and across the 3-run stability gate.
- Reuse existing infrastructure: registry, never-worse guard, retention, fail-open,
  compression-event accounting, and the `report/` dashboard.
- Per-command savings analytics (RTK `rtk gain` equivalent).

### Non-goals
- No Rust runtime, no `rtk` subprocess, no new process boundary.
- No compression of `Read`/`Grep`/`Glob` tool outputs (matches RTK's scope caveat; those
  are not Bash `tool_result` blocks).
- No new npm dependencies (per project ADR discipline).
- Not all 100+ RTK profiles — six high-traffic profiles in v1.

## 3. Architecture

A new **`shell` compressor** implementing the existing `ToolOutputCompressor` interface
(`src/compressor/types.ts`), registered in `src/compressor/registry.ts` alongside `json`
and `log`.

### 3.1 Command correlation (the one structural change)

`compress()` in `src/compressor/index.ts` currently reads only `tool_result` text. We
extend it to first walk the `messages` array once, building a map:

```
tool_use_id -> { command: string, exit_code?: number }
```

…from `tool_use` blocks whose tool is Bash. The `command` (and exit code when present)
is then passed into the routed `CompressorInput`. This is **additive**:

- `CompressorInput` gains an optional `command?: string` and `exit_code?: number`.
- Existing `json` and `log` compressors ignore the new fields — no behavior change.
- `compress()` builds the map in the same pass it already makes over `messages`.

### 3.2 Pipeline position (unchanged)

`compress → classify → prune → reorder`, identical to today (`proxy/server.ts:402`). The
canonical pipeline-order invariant is preserved.

### 3.3 Routing precedence

`detect()` precedence becomes: **shell → json → log → passthrough**. Shell is the most
specific (requires a known originating command), so it is tried first. `shell.detect()`
returns matched only when (a) an originating Bash command exists for the block **and**
(b) the command's leading tokens match a known profile.

## 4. The six profiles (v1)

Each profile is a **pure deterministic function** `(command, rawOutput, exitCode) -> summary`.

| Profile id    | Matches                          | Summary strategy |
|---------------|----------------------------------|------------------|
| `git-status`  | `git status`                     | grouped counts: staged / modified / untracked, grouped by directory |
| `git-diff`    | `git diff`                       | per-file `+adds/-dels`, hunk headers only, drop unchanged context |
| `git-log`     | `git log`                        | one line per commit: `sha subject (author)` |
| `pkg-install` | `npm install`, `pnpm install`, `yarn install`, `yarn` | final dependency-tree delta + warnings/errors only; drop progress/spinner noise |
| `test-run`    | `jest`, `vitest`, `pytest`       | pass/fail counts + only failing tests with their assertion lines |
| `build`       | `tsc`, `next build`, `webpack`   | errors grouped by file; drop success noise |

### Determinism requirements (mandatory for every profile)
- No timestamps, durations, or wall-clock values in output.
- Stable ordering: sort by path / deterministic key, never by hash-map iteration order.
- Same `(command, rawOutput, exitCode)` → byte-identical summary, every time.

This determinism is what allows a compressed block to migrate into the STABLE/cached
region without busting the prefix hash.

## 5. Cache interaction

Compression runs **once per block, before classification** (as today). Because each
profile is pure and deterministic:

- The compressed bytes for a block are stable across turns. A block compressed on turn 5
  yields the identical summary if re-derived on turn 12, so it can move into the cached
  prefix region without changing the prefix SHA-256.
- The merge-blocking **cache-stability gate** (byte-identical prefix across 3 identical-input
  runs) is satisfied by construction — no per-region special-casing required.
- The existing **never-worse guard** (`index.ts:152`) still applies: if a summary is not
  smaller than the original, the original passes through unchanged.

## 6. The three v1 extras

### 6.1 Shell savings in analytics
`BlockCompressEvent` (`src/compressor/types.ts`) gains an optional `profile_id` field
(e.g. `"git-status"`). Populated by the shell compressor; reuses the existing
`recordCompressionEvents` path and the `report/` dashboard to surface RTK-style
per-command savings.

### 6.2 Failure tee / recovery
When the originating command's `exit_code !== 0`:
- The profile emits an aggressive failures-only summary.
- The full original is retained via the **existing retention path** (no new storage),
  surfaced with an inline marker: `[expand via cachelane_expand(block_id=…)]`.
- Mirrors RTK's tee-on-failure behavior while reusing CacheLane's retrieval mechanism.

Note: failure-triggered retention should function even when general
`compression.retention.enabled` is off — to be confirmed during planning whether this
needs its own toggle so the privacy posture stays explicit. (See open questions.)

### 6.3 Per-profile config toggles
`compression.compressors` (`src/config/defaults.ts`) gains:
- a `shell: boolean` toggle (mirrors existing `json` / `log` toggles), and
- an optional `shell_profiles: { [profileId]: boolean }` map for enabling/disabling
  individual profiles.

Defaults: `shell: true`, all six profiles enabled.

## 7. Error handling

Fail-open everywhere, reusing the existing `try/catch` in `compressBlock`
(`src/compressor/index.ts`): any profile error returns the original, unmutated block.
A profile that throws, a command it cannot parse, or output that does not match its
expected structure all degrade to passthrough, never to a dropped or corrupted block.

## 8. Testing strategy

Per the project's lean TDD discipline:

- **Fixtures as JSON**: real captured command outputs per profile, stored as JSON so
  reviewers audit them without parsing test code.
- **Table-driven**: `describe.each` over the six profiles.
- **One assertion per test** where possible.
- **Determinism test**: asserts byte-identical summary across repeated runs of the same
  fixture.
- **Cache-stability test**: asserts prefix-hash stability across 3 identical-input runs
  with shell compression enabled (guards the merge-blocking gate).
- **Never-worse test**: asserts passthrough when a summary is not smaller than the original.
- **Fail-open test**: asserts a throwing/garbled profile returns the original block.
- **Correlation test**: asserts `compress()` correctly maps `tool_use_id → command` and
  routes only Bash-originated blocks to the shell compressor.

TDD order per task: red fixtures + failing tests first, watch them fail for the right
reason, implement minimum to green.

## 9. Vocabulary & naming conventions

- Volatility classes remain `STABLE | SEMI | VOLATILE` (no synonyms).
- Cross-boundary types (`BlockCompressEvent`, config fields, the new `command` / `exit_code`
  / `profile_id` fields) use `snake_case`.
- In-process working types (profile function params, local helpers) may use `camelCase`.

## 10. Files touched (anticipated)

| File | Change |
|------|--------|
| `src/compressor/shell-compress.ts` | **new** — six profile functions + dispatcher |
| `src/compressor/registry.ts` | register `shellCompressor`; precedence shell→json→log→passthrough |
| `src/compressor/index.ts` | build `tool_use_id → command` map; pass command/exit_code into `CompressorInput` |
| `src/compressor/types.ts` | add `command?`, `exit_code?` to `CompressorInput`; `profile_id?` to `BlockCompressEvent`; `shell` + `shell_profiles` to `CompressorConfig` |
| `src/config/defaults.ts` | default `shell: true`, profiles enabled |
| `src/compressor/__tests__/shell-compress.test.ts` | **new** — fixtures + table-driven tests |
| `src/report/*` | surface `profile_id` in the savings dashboard (minor) |

## 11. Open questions (resolve during planning)

1. **Failure retention vs. global retention toggle** — should failure tee/recovery retain
   originals even when `compression.retention.enabled` is off? Leaning yes with its own
   sub-toggle to keep the privacy posture explicit, but confirm against the binding spec.
2. **Bash tool identification** — confirm the exact tool name/shape Claude Code uses for
   Bash `tool_use` blocks so the correlation map keys correctly across harness versions.
3. **Exit code availability** — confirm whether/where exit code appears in the Bash
   `tool_result` (envelope vs. text) so failure detection is reliable; fall back to
   text-signature heuristics if absent.
4. **Profile match specificity** — `git diff` vs `git diff --stat`, `npm install` vs
   `npm ci`: define the exact leading-token match rules to avoid mis-routing.

## 12. Post-implementation notes (2026-06-25)

Implemented end-to-end via subagent-driven development. Resolutions and findings:

- **Config schema must include new fields.** The zod schema in `src/config/index.ts`
  strips unknown keys on load. `compressors.shell` and `shell_profiles` were added to the
  schema; without this, user config for these fields would be silently erased on every
  load. (Found during verification — both runtime gating and the schema are now wired.)
- **CLI parity.** `cachelane compression-compressor` now accepts `shell` alongside
  `json`/`log`. Per-profile toggling (`shell_profiles`) is config-file only — no dedicated
  CLI command yet (documented follow-up).
- **Exit code remains inert in practice (open question 3).** Claude Code's Bash `tool_use`
  input does not carry an exit code, so failure tee/recovery is wired but only fires when
  an `exit_code` is present in the input. It degrades gracefully (treated as success when
  absent). A real exit-code source (e.g. parsing `tool_result` text signatures) is the
  natural follow-up.
- **Open finding I-min:** profiles parse human-readable output (git porcelain, test
  summaries) and are locale/format-sensitive; they fail open to the original block on any
  mismatch, so this degrades savings, not correctness.
