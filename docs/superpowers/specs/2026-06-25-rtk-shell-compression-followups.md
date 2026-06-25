# RTK Shell Compression — Follow-ups

Feature shipped 2026-06-25 (spec + plan in this directory). Core path is live and
verified (523 tests pass, tsc/lint clean). The items below are deliberately deferred —
none block the feature functioning.

## P1 — Wire a real exit-code source (the only "built but not live" piece)

**What:** Failure tee/recovery (spec §6.2) is fully implemented — on a non-zero exit code
it emits an aggressive failures-only summary and retains the full original (bypassing the
size gate) for `cachelane_expand`. But it never fires in practice.

**Why it's inert:** `buildCommandMap` in `src/compressor/index.ts` reads `exit_code` from
the Bash `tool_use.input`, but Claude Code's Bash `tool_use` input does not carry an exit
code. So `exit_code` is always `undefined` → every command is treated as success.

**Degrades gracefully:** absent exit code = treated as success, never a false failure. No
correctness risk, just unrealized failure-recovery behavior.

**Options to resolve:**
1. Parse exit status from the `tool_result` text signature (e.g. test runners print
   `N failed`, shells may include a status line) — heuristic, per-profile.
2. If a future Claude Code surfaces exit code in the result envelope, read it there.

**Acceptance:** a failed `pytest`/`npm test` run produces a failures-only summary AND a
retrievable original, demonstrated end-to-end through the proxy.

## P2 — Per-profile CLI toggle

`compression.shell_profiles` (per-profile on/off, e.g. disable just `git-log`) is honored
at runtime and persisted, but only editable by hand in the config file. There is no
`cachelane compression-profile <id> enable|disable` command. (`compression-compressor
shell enable|disable` for the whole shell compressor DOES exist.)

## P3 — Profile robustness (locale / format sensitivity)

The six profiles parse human-readable output (git porcelain, test summaries, tsc errors).
They are sensitive to non-English locales and format drift across tool versions. They fail
open to the original block on any mismatch, so this costs token savings, not correctness.
Worth widening fixtures (e.g. `git -c` porcelain v2, alternate test reporters) if savings
look low in real sessions.

## Minor (from final review, non-blocking)

- `shellCompressor.detect()` runs the profile transform outside `routeCompression`'s
  try/catch; a throwing profile is still caught at the `compressBlock` level, so fail-open
  holds, but the detect-time call is slightly redundant work.
- `SHELL_PROFILE_IDS` is exported but currently unused — keep if a future CLI/validation
  consumes it, otherwise remove.
- No adversarial-input fail-open test specifically for the shell path (garbled output that
  makes a profile throw). The generic compressor fail-open is tested; a shell-specific case
  would be belt-and-suspenders.
