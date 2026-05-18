# 02 — Architecture

**Purpose:** Component catalog, data flows, and all 7 engineering diagrams interpreted as text.  
**Scope:** Structural/architectural — not algorithmic detail (see [`04-turns-and-pruning.md`](04-turns-and-pruning.md)).  
**Source:** `Cachelane_Engineering_Diagrams_v2.html` (canonical visual reference — 7 diagrams).

> **Note on diagram versions:** D1–D4 were in the original diagrams document.  
> D5, D6, D7 are new in v2 (added to resolve review contradictions #4, #5, #6, #7).  
> The sub-component order in D1 was corrected in v2 (see [Pipeline Order](#pipeline-order)).

---

## System Architecture (D1)

**Lede:** Cachelane sits between Claude Code and the Anthropic API. The canonical pipeline is
Classifier → Pruner → Reorderer. The Keepalive worker runs independently.

```
┌─────────────────────────────────────────┐
│  Claude Code CLI                        │
│  User sessions, hooks, plugin runtime   │
└────────────────┬──────────────▲─────────┘
                 │ PreRequest   │ assistant turn
                 ▼              │
┌────────────────────────────────────────────────────────────────────────┐
│  Cachelane Orchestrator  (local MCP server, stdio)                     │
│                                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │ 1. Classifier│→ │  2. Pruner   │→ │ 3. Reorderer │                │
│  │ STABLE/SEMI/ │  │ Stubs unused │  │ Sets cache   │                │
│  │ VOLATILE     │  │ blocks       │  │ breakpoints  │                │
│  └──────────────┘  └──────────────┘  └──────────────┘                │
│                                                                        │
│  ┌──────────────┐    (async, independent)                             │
│  │  Keepalive   │    TTL refresh                                       │
│  └──────────────┘                                                      │
│                                                                        │
│  ┌────────────────────────┐  ┌────────────────────────┐               │
│  │ Reference log          │  │ Cache state tracker    │               │
│  │ SQLite, per-block      │  │ In-memory, per-prefix  │               │
│  │ usage counters         │  │ (resets on restart)    │               │
│  └────────────────────────┘  └────────────────────────┘               │
└──────────────────────────────┬──────────────▲──────────────────────────┘
                               │ POST messages│ response + usage block
                               │ 2 breakpoints│
                               ▼              │
┌──────────────────────────────────────────────────────────────────────┐
│  Anthropic Messages API                                               │
│  Cache reads at 0.1×, writes at 1.25× or 2×                         │
└──────────────────────────────────────────────────────────────────────┘
```

### Pipeline Order

**Canonical execution order: Classifier → Pruner → Reorderer**

This order is not arbitrary. The Pruner must run **before** the Reorderer because:
- Pruning changes block token counts (stubs are smaller)
- Pruning may change block volatility (a stubbed block is a different shape)
- The Reorderer computes `cache_control` breakpoints from the **final** block set

If Reorderer ran first, its breakpoints would be computed against the pre-prune block sizes and
would be wrong after pruning.

> The visual left-to-right layout in Diagram 1 v1 showed Classifier → Reorderer → Pruner — that
> was drawn for visual balance and was the error. Diagram 4 and the Systems Design doc always
> had the correct order. Fixed in v2.

### Cache State Tracker Interactions (D1 v2 addition)

- **Reads counters** ← from reference log (per block, on PreRequest)
- **Writes prefix hash** → after successful API response
- **Reads expiry** → keepalive worker checks before firing
- **Updates** → after keepalive ping resets the TTL

---

## Block Model and Cache Boundaries (D2)

**Lede:** Every content unit is one block. The Classifier tags each by volatility, the Reorderer
pivots them into three regions, and two `cache_control` breakpoints mark where the cache prefix ends.

**Unsorted input → three-region output:**

```
Unsorted input blocks          After reorder
────────────────               ─────────────────────────────────────
System prompt     STABLE  ─┐  ┌─ Prefix  ─────────────────────────┐
Tool schemas      STABLE   ├──►│  System prompt   STABLE           │
CLAUDE.md, rules  STABLE  ─┘  │  Tool schemas    STABLE  cached   │
                               │  CLAUDE.md       STABLE  at 0.1×  │
Turn N-2          SEMI    ─┐  └───────────── cache_control breakpoint
Turn N-1          SEMI     ├──►┌─ Middle  ───────────────────────── ┐
                           │   │  Turn N-2  SEMI   cached if stable  │
                           ┘   │  Turn N-1  SEMI                     │
                               └───────────── cache_control breakpoint
Retrieval result  VOLATILE─┐  ┌─ Suffix  ──────────────────────────┐
Tool output       VOLATILE  ├──►│  Retrieval result  VOLATILE  paid  │
User message      VOLATILE ─┘  │  Tool output       VOLATILE  in    │
                               │  User message      VOLATILE  full  │
                               └────────────────────────────────────┘
```

**Block rules:**
- One block = one logical content unit; never split or merged
- Each block carries: volatility class, token count, usage record
- Vocabulary: `STABLE | SEMI | VOLATILE` — no other naming anywhere

---

## K-Pruning Walkthrough (D3)

**Lede:** Four blocks across five turns. After each turn the unused counter ticks or resets; when
it reaches K=3 the block is replaced with a stub.

See [`04-turns-and-pruning.md`](04-turns-and-pruning.md) for full algorithm specification.

**Timeline matrix (K=3):**

| Block | T1 | T2 | T3 | T4 | T5 |
|-------|----|----|----|----|-----|
| Block A `file: auth.py` | added, used (0) | used, reset (0) | idle (1) | used, reset (0) | idle (1) |
| Block B `grep result` | added, used (0) | idle (1) | idle (2) | **idle (3) → stub** | stub, handle only |
| Block C `tool output` | absent | added, used (0) | idle (1) | idle (2) | used, reset (0) |
| Block D `retrieval result` | added, used (0) | idle (1) | idle (2) | **idle (3) → stub** | stub, handle only |

**Decision rule:**
1. After the assistant turn: parse tool calls and text for references to each retained block
2. If referenced → reset `unused_turns` to 0
3. If not referenced → increment `unused_turns` by 1
4. If `unused_turns` reaches K → replace with stub (id + one-line summary + refetch handle)
5. Stubs never expire further — remain until model calls `cachelane:expand` (see D7)
6. Pinned blocks and `STABLE` blocks are **exempt** — never tick

---

## Per-Turn API Flow (D4)

**Lede:** Sequence across four participants on one assistant turn. Canonical pipeline order:
classify → prune → reorder.

```
Claude Code      Cachelane          SQLite log       Anthropic API
     │                │                  │                 │
     │─PreRequest─────►                  │                 │
     │ unsorted blocks │                 │                 │
     │                 │──load usage─────►                 │
     │                 │◄─usage records──│                 │
     │                 │                 │                 │
     │                 ├─[classify]──────────────────      │
     │                 ├─[prune]─────────────────────      │
     │                 ├─[reorder]───────────────────      │
     │                 │                 │                 │
     │                 │──POST messages + 2 breakpoints────►
     │                 │                 │  ┌─────────────┤
     │                 │                 │  │match/hash/  │
     │                 │                 │  │read or write│
     │                 │◄──────────────────response+usage─┘
     │                 │                 │                 │
     │                 ├─[parse usage]───────────────────  │
     │◄──assistant turn─┤                │                 │
     │ model emits tool │                │                 │
     │ calls + text     │                │                 │
     │─PostResponse────►│                │                 │
     │                  ├─[detect refs]─────────────────   │
     │                  ├─[tick counters]───────────────   │
     │                  │──persist updated usage──────────►│
     │                  │                 │                │
```

---

## Keepalive Sequence (D5 — new in v2)

**Lede:** The keepalive worker runs on a 10-second check loop. It only sends a ping when the user
has been idle long enough AND the cache is approaching expiry.

```
Keepalive worker    Cache tracker    Anthropic API
        │                 │                │
        │──every 10s: read expected_expiry──►
        │◄──expiry in 90s, idle 4m20s───────│
        │                 │                │
        │ check: idle > threshold? YES      │
        │ check: cache at risk? YES         │
        │                                   │
        │──POST minimal request─────────────►
        │  (same prefix, 1-token user msg,  │
        │   max_tokens=1)                   │
        │                                   │ cache hit
        │                                   │ TTL resets
        │◄──response (cache_read > 0)───────│
        │                                   │
        │──update last_read_at_ms───────────►
        │  update expected_expiry_ms        │
```

**When keepalive does NOT fire:**
- A real turn happened within the idle threshold → skip
- Time until expiry > check interval → cache still fresh, skip
- Prefix size ≤ threshold and adaptive policy is off → skip

---

## `/compact` Handling (D6 — new in v2)

**Lede:** When the user runs `/compact`, Claude Code replaces conversation history with a summary.
Cachelane detects this, resets block counters for replaced blocks, and starts a fresh middle region.

```
Claude Code        Cachelane           SQLite log
     │                  │                   │
     │─PreRequest with───►                   │
     │ compacted history │                   │
     │                   │                   │
     │              detect: middle hashes don't match
     │                   │──delete blocks not present──►
     │                   │◄──done────────────────────────
     │                   │                   │
     │              create new Block for compacted summary
     │              classify as SEMI         │
```

**Middle-region breakpoint rule after `/compact`:**
- The compacted summary is a brand-new block
- The stable-middle heuristic requires seeing it byte-identical **at least twice** before placing a
  `cache_control` breakpoint on it
- **Turn N (first after /compact):** no middle breakpoint → pays full write for the middle
- **Turn N+1 (second, if identical):** middle breakpoint placed → cache hit
- This is the conservative-correct behavior

---

## Refetch Flow (D7 — new in v2)

**Lede:** When the model needs content that was stubbed, it calls `cachelane:expand`. The
orchestrator re-issues the original tool call; restored content enters the suffix for the next turn.

```
Claude (model)    Cachelane MCP    SQLite log
      │                 │               │
  (model sees a stub,   │               │
   needs original)      │               │
      │─tool_use:────── ►               │
      │  cachelane:expand               │
      │  { block_id: "01J..." }         │
      │                 │──lookup───────►
      │                 │◄──refetch_handle = "view:auth.py:23-89"
      │                 │               │
      │          issue original tool call (read auth.py lines 23-89)
      │                 │               │
      │                 │──restore block─►
      │                 │  is_stub → false
      │                 │  reset unused_turns = 0
      │◄─tool_result:───│               │
      │  { restored: true,              │
      │    content_preview: "def auth..." }
```

**Post-refetch behaviour:**
- Restored block enters the suffix on the next turn
- `unused_turns = 0` → pruner won't re-stub for another K turns
- Block_id stays the same; block is re-categorised by the Classifier on next turn

---

## Unified Component Catalog

| Component | Category | Responsibility | Owns / State |
|-----------|----------|----------------|-------------|
| **Claude Code CLI** | Host process | User sessions; fires PreRequest/PostResponse hooks | User session state (out of scope) |
| **Cachelane Orchestrator** | Local MCP server (stdio) | Coordinates classify/prune/reorder per turn | Owns all sub-components; drives both stores |
| **Classifier** | Sub-component | Tags each block `STABLE | SEMI | VOLATILE` using fingerprints; defaults to `VOLATILE` | Stateless per-turn |
| **Pruner** | Sub-component | Checks `unused_turns ≥ K`; materialises stubs; updates reference log | Reads/writes reference log |
| **Reorderer** | Sub-component | Sorts blocks into prefix/middle/suffix; places two `cache_control` breakpoints | Reads cache state tracker |
| **Keepalive worker** | Async sub-component | Fires minimal pings to refresh TTL; writes cache state tracker | Timer state, expected_expiry_ms |
| **Reference log** | Persistent store (SQLite) | Per-block: id, classification, token_count, unused_turns, is_stub, refetch_handle | `~/.cachelane/cachelane.db` |
| **Cache state tracker** | Volatile store (in-memory) | Per-prefix: hash, ttl_class, cached_at_ms, expected_expiry_ms, last_read_at_ms | RAM only; resets on restart |
| **Anthropic Messages API** | Remote service | Hashes prefix, caches at TTL, returns `usage` block | Server-side prompt cache |
| **PreRequest hook** | Claude Code hook | First event per turn; passes unsorted blocks to Cachelane | n/a |
| **PostResponse hook** | Claude Code hook | Fires after turn; triggers reference detection and counter updates | n/a |

---

## Interaction Catalog

| ID | Source → Target | Mechanism | Payload | Sync/Async |
|----|----------------|-----------|---------|------------|
| I1 | Claude Code → Cachelane | MCP / hook | Unsorted prompt blocks | Sync |
| I2 | Cachelane → SQLite | SELECT | Per-block usage records | Sync |
| I3 | Cachelane → Anthropic | HTTPS POST | `messages[]` + 2 `cache_control` breakpoints | Sync |
| I4 | Anthropic → Cachelane | HTTPS response | Assistant message + `usage` block | Sync |
| I5 | Cachelane → Claude Code | MCP return | Assistant turn | Sync |
| I6 | Claude Code → Cachelane | PostResponse hook | Trigger (assistant output available) | Sync |
| I7 | Cachelane → SQLite | INSERT/UPDATE | Updated per-block counters | Sync |
| I8 | Keepalive → Anthropic | HTTPS POST | Minimal request (1-token, same prefix) | Async (timer) |
| I9 | Keepalive → Cache tracker | In-process | Update `last_read_at_ms`, `expected_expiry_ms` | Async |
| I10 | Model → Cachelane | `tool_use: cachelane:expand` | `{ block_id }` | Sync (via model turn) |
| I11 | Cachelane → SQLite | SELECT | Lookup refetch_handle by block_id | Sync |
| I12 | Cachelane → (original tool) | Re-issue tool call | Original tool + args | Sync |

---

## Deployment Topology

- **All components run locally** on the user's machine
- No external process except `api.anthropic.com` (remote network boundary)
- One Cachelane MCP server process per Claude Code session (~10 MB each)
- Multiple concurrent sessions: multiple processes, each writing to the same SQLite via WAL mode
  (concurrent readers + serialised writers — well within SQLite's write throughput for < 5 writes/turn)
- No load balancer, no replicas, no sharding

---

## Open Questions

| # | Question |
|---|----------|
| Q004 | When the middle region is mostly stubs, do breakpoints shift? Current design uses stable-middle heuristic (byte-identical twice) which may result in sparse middle not getting a breakpoint. |
| Q005 | How does `cachelane:expand` interact with the reorderer on the turn immediately after refetch (restored block may now be eligible for middle vs. suffix depending on its age)? |

See [`07-open-questions.md`](07-open-questions.md) for full list.
