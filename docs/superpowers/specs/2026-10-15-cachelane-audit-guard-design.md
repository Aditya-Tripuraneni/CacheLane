# CacheLane Audit + Cold-Cache Guard (design)

Date: 2026-10-15 · Status: approved in brainstorm, pending spec review · Depends on: PR #40 (tail-breakpoint fix)

## Why

- Vanilla Claude Code already caches well. One real 744-call session: 98.1% of input tokens were cache reads.
- The expensive event is a **cold rebuild**: a large context sits idle past the cache TTL, then the next message re-writes it all.
  - Same session: 12 rebuilds of 69k to 678k tokens. 11 of the 12 followed an idle gap of 71 to 1,087 min on a 1h TTL.
  - Cache writes were about 44% of weighted input spend (6.74M write tokens x 2 vs 340.3M read tokens x 0.05).
- Claude Code only reports cold-cache numbers on **resume** (SessionStart fields `prompt_cache_likely_expired`, `estimated_cache_write_usd`). Nothing covers a session left open and continued after a break.
- The current proxy needs trust and a 76 MB install with a native dependency. A read-only audit and a hook avoid both.

## Goals

1. `npx cachelane-audit`: explains where input spend went and why each rebuild happened, in about 1 s on any Node 18 or later.
2. A cold-cache guard: intercepts the first prompt that would trigger a large cold rebuild, and shows the cost of each option.
3. Existing 1.1.7 users are told to upgrade and keep a working proxy.

## Non-goals

- Keepalive pings. They would reuse Claude Code credentials from a third-party tool (terms-of-service and trust risk). This is an open question, not planned.
- Running `/compact` automatically. Hooks cannot run slash commands.
- Any hosted backend, or sending prompt content anywhere. Audit reads usage metadata only.
- New proxy features. Those are tracked in the proxy roadmap below and wait on audit demand.

## Packages and layout (upstream repo)

| Path | Ships as | Contents |
|---|---|---|
| `packages/audit/` | npm `cachelane-audit` | Node stdlib only, zero deps. `bin: cachelane-audit`. Exports `parseSession`, `classifyRebuilds`, `costOf`, `guardDecision`. |
| `plugin/` | Claude Code plugin `cachelane` | `.claude-plugin/plugin.json`, `hooks/hooks.json` (UserPromptSubmit guard, Stop timestamp), `commands/audit.md`, bundled `bin/cachelane-audit.mjs` (built copy of `packages/audit`). |
| `.claude-plugin/marketplace.json` (repo root) | marketplace entry | Lists the `cachelane` plugin so `/plugin marketplace add Aditya-Tripuraneni/CacheLane` works. |
| root `cachelane` | npm `cachelane` 1.2.0 | Depends on `cachelane-audit`. Adds `cachelane audit` and `cachelane guard on|off`. The proxy becomes opt-in. Implemented in a second plan, after PR #40 merges. |

Hooks call the bundled script by path (`${CLAUDE_PLUGIN_ROOT}/bin/cachelane-audit.mjs`), never `npx`. That keeps them inside the 30 s UserPromptSubmit timeout.

## Audit

**Input:** `~/.claude/projects/*/*.jsonl`, filtered by `--days N` (default 30) or `--project <path>`.

**Parsing (`parseSession`)**
- Keep `type: "assistant"` entries that have `message.usage`.
- De-duplicate by `message.id`, keeping the last entry (streamed chunks repeat).
- Drop `model: "<synthetic>"`.
- Split into the main chain (`isSidechain` false) and sidechains. A sidechain's first write is expected and is never counted as a rebuild.
- Record `compact_boundary` positions (`type: "system", subtype: "compact_boundary"`).
- Usage fields:
  - `input_tokens`, `cache_read_input_tokens`
  - `cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`. Fall back to `cache_creation_input_tokens` as 5m when the split is absent.

**Rebuild rule:** on the main chain, call `i` is a rebuild when both hold:
- `write_i > 20_000`
- `read_i < 0.5 * (read_{i-1} + write_{i-1})`

**Cause, first match wins**

| Cause | Condition |
|---|---|
| `idle_expired` | gap since the previous main call is greater than the TTL. TTL is 1h if that call wrote any 1h tokens, else 5m. |
| `model_switch` | `model_i != model_{i-1}` |
| `compaction` | a `compact_boundary` lies between call `i-1` and call `i` |
| `proxy_stripped` | session hit ratio < 0.5 and `ANTHROPIC_BASE_URL` is set in env or in `~/.claude/settings.json` `env` |
| `prefix_changed` | none of the above (CLAUDE.md, MCP tools, settings or system prompt changed) |

**Cost (`costOf`)**
- **Weighted units:**
  - input = 1.0
  - read = the model's cache-read price / input price: 0.05 for Opus 5.5 ($0.20/$4), 0.025 for Fable 5.1 ($0.25/$10), 0.1 for Sonnet 5.5 ($0.20/$2) and the default
  - write = 1.25 for the 5m tier, 2.0 for the 1h tier
- **Dollars:** units x base input price per model, from `src/prices.ts`. Every dollar figure is labeled "at API price". Unknown model: show units only.
- `src/prices.ts` holds Anthropic first-party list prices (cached 2026-10-06) and is updated by PR. It is never fetched at runtime.

**Output (default terminal)**
- Header: period, number of projects, number of sessions.
- Hit ratio: reads / (input + reads + writes).
- Share of weighted input spend from rebuilds.
- Causes ranked by weighted cost: count and units/$ for each.
- The 3 worst sessions: project, short session id, largest rebuild (tokens, gap).
- One recommendation, picked by the top cause:
  - `idle_expired` → `cachelane guard on`, or `/clear` before breaks
  - `proxy_stripped` → check `ANTHROPIC_BASE_URL`, upgrade cachelane to 1.2.0 or later
  - `prefix_changed` → avoid editing CLAUDE.md or MCP config mid-session
  - `model_switch` → stay on one model per session
- `--json` prints the same data as JSON. It contains no prompt text and no file paths beyond project directory names. `--no-paths` hashes those names too.

## Guard

**Stop hook:** writes `{ [session_id]: last_response_at_ms }` into `~/.cachelane/guard.json`. It prunes entries older than 7 days.

**UserPromptSubmit hook (`guardDecision`)**
1. `last` = guard.json entry, else the timestamp of the transcript's last main-chain assistant entry.
2. TTL, in priority order:
   - env `FORCE_PROMPT_CACHING_5M=1` → 5m
   - env `CLAUDE_CODE_PROMPT_CACHE_TTL`
   - settings `promptCacheTtl` (project `.claude/settings.local.json`, then `.claude/settings.json`, then user settings)
   - the tier of the last write
3. `context` = read + write + input of the last main-chain call.
4. If `now - last > TTL` and `context >= threshold` (default 150_000, set with `cachelane guard threshold <n>`):
   - If this idle period was already warned (`warned[session_id] == last`): allow. One warning per break; Claude Code does not restore a blocked prompt, so retyping can take minutes.
   - Otherwise: block (`{"decision":"block","reason":...}`) and set `warned[session_id] = last`.
5. Any exception, a missing file, or more than 5 s elapsed: exit 0 (allow). The guard never blocks on its own failure.
6. Prompts starting with `<` (task notifications, loop wakeups), `/` (slash commands) or `!` (shell commands) are always allowed; only typed prompts are guarded.

**Block message** (about 8 lines)
- How long since the cache went cold, the TTL, and the context size.
- A cost table:

  | Option | Cost |
  |---|---|
  | continue | context x write multiplier |
  | `/compact` | context x 1.0 + ~20k summary x 5 (output) + ~89k post-compact context x write multiplier (labeled estimate). Shown as "costs more than continuing" when it does. 89k is the median of 12 real compactions. |
  | `/clear` | about 0, loses context |

- "Send your message again to continue; you are only warned once per break."

**Toggle:** `cachelane guard off|on` writes `enabled` into `~/.cachelane/guard.json`. The plugin path can also be disabled with `/plugin disable`.

## Release and existing users

- **1.2.0 contents:**
  - PR #40 fixes.
  - `cachelane-audit` dependency.
  - `audit` and `guard` subcommands.
  - `cachelane install` no longer wires the proxy unless `--proxy` is passed. Existing proxy installs are left as they are.
- **`cachelane doctor`:**
  - Warns if the installed version is below 1.2.0 while the proxy hook is active.
  - Suggests `cachelane audit`.
- **Telling 1.1.7 users:**
  - Release notes.
  - Pinned GitHub issue: "1.1.7 raises cost on long sessions; upgrade".
  - `npm deprecate cachelane@"<1.2.0" "<message>"` (maintainer action).
- **README and site:**
  - Lead with `npx cachelane-audit` and the plugin.
  - The proxy moves to a "power mode" section.
  - Remove the 90% and 30 to 60% claims until a billed-cost A/B exists.
  - Align the license to Apache-2.0.

## Proxy roadmap (gated on audit demand)

1. Preserve the client's TTL instead of forcing 5m.
2. Cold-cache compression: prune and compress history only when the cache has already expired.
3. After a fail-open, disable mutation for the rest of that session.

## Adoption plan

- **Launch asset:** a screenshot of a real `npx cachelane-audit` run, headlined with its rebuild share.
- **Channels, in order:**
  1. awesome-claude-code PR and the plugin marketplace entry.
  2. Show HN.
  3. Helpful replies on anthropics/claude-code usage-limit issues (#16157, #38335).
  4. One X thread.
- **Data engine:** opt-in `--json` submissions (a GitHub issue template) feed a monthly "State of Claude Code caching" post.
- **Success signals (30 days after launch):**
  - 100 audit runs, taken from issue submissions and npm downloads of `cachelane-audit`.
  - 300 GitHub stars.
  - Weekly npm downloads above 200 for 4 straight weeks.

## Testing

- **Fixtures:** `packages/audit/__tests__/fixtures/*.jsonl`. Synthetic, in the real transcript shape, one per cause, plus de-duplication, sidechain and synthetic-model cases.
- **Tests:**
  - `classifyRebuilds`, table-driven (`describe.each`) over the fixtures.
  - `costOf` checks the multipliers per model.
  - `guardDecision` takes an injected `now`, env and file reads: cold+large blocks; next prompt after a warning allows; a new response then a fresh break warns again; warm allows; small allows; corrupt guard.json allows.
- **Packaging check:**
  - `npm pack` of `packages/audit` is under 100 KB.
  - Install has zero dependencies.
  - `node bin/cachelane-audit.mjs --json` runs on Node 18, 20 and 24.
- **Plugin check:** `claude plugin validate plugin/`.

## Open questions

- How `systemMessage` renders for UserPromptSubmit. This only affects a possible warn-only mode.
- The `/compact` summary output size (20k estimate); it is not recorded in transcripts.
- Keepalive without credential reuse: is there any supported way?
