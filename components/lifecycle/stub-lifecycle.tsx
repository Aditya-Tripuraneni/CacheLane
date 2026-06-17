'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ *
 *  Concrete example (matches CacheLane's `blocks` schema)
 *  block id 01KPRUNE0000000000000001  (short: 01KPRUNE)
 *  refetch_handle: tool:read:src/auth.ts
 *  full tool result = 250 tokens · stub ≈ 20 tokens · K = 3
 * ------------------------------------------------------------------ */
const FULL_ID = '01KPRUNE0000000000000001';
const HANDLE = 'tool:read:src/auth.ts';
const STUB_SUMMARY = 'tool_output tool:read:src/auth.ts (250 tokens elided)';
const CODE_HTML =
  '<span class="ll-kw">function</span> <span class="ll-fn">auth</span>(<span class="ll-pl">user</span>) { ... }';
const STUB_TEXT_HTML =
  '<span class="ll-bid">[stub:01KPRUNE]</span> tool_output tool:read:src/auth.ts (250 tokens elided) | ' +
  'refetch via <span class="ll-call">cachelane_expand(block_id=01KPRUNE)</span>';

type Row = {
  id: string;
  is_stub: string;
  stub_summary: string | null;
  refetch_handle: string;
  unused_turns: string;
  restored_at_turn: string | null;
};

const ROW: Record<string, Row> = {
  created: { id: FULL_ID, is_stub: '0', stub_summary: null, refetch_handle: HANDLE, unused_turns: '0', restored_at_turn: null },
  idle: { id: FULL_ID, is_stub: '0', stub_summary: null, refetch_handle: HANDLE, unused_turns: '3', restored_at_turn: null },
  stub: { id: FULL_ID, is_stub: '1', stub_summary: STUB_SUMMARY, refetch_handle: HANDLE, unused_turns: '3', restored_at_turn: null },
  restored: { id: FULL_ID, is_stub: '0', stub_summary: null, refetch_handle: HANDLE, unused_turns: '0', restored_at_turn: '9' },
};

type Tok =
  | { type: 'none'; msg: string }
  | { type: 'single'; value: number; kind: 'full' | 'stub'; label: string }
  | { type: 'compare'; before: number; after: number; restore?: boolean }
  | { type: 'summary' };

type Stage = {
  label: string;
  title: string;
  narr: string;
  slot: string[];
  row: Row | null;
  rowFlash?: 'all' | string[];
  rowLookup?: string[];
  preserved?: { txt: string; note: boolean }[];
  cacheMode: 'present' | 'stubbed' | 'evicted' | 'na';
  cacheList?: string[];
  showWorlds?: boolean;
  summary?: boolean;
  tok: Tok;
};

const STAGES: Stage[] = [
  {
    label: 'User prompt',
    title: 'The user asks a question',
    narr:
      'A developer types a request into Claude Code. No tool result exists yet. This user turn is what will <b>trigger</b> a tool call. Watch how this one block is born, ages, is stubbed, then restored.',
    slot: [
      '<span class="ll-p">{</span>',
      '  <span class="ll-k">"role"</span>: <span class="ll-s">"user"</span>,',
      '  <span class="ll-k">"content"</span>: [',
      '    { <span class="ll-k">"type"</span>: <span class="ll-s">"text"</span>,',
      '      <span class="ll-k">"text"</span>: <span class="ll-s">"Please read auth.ts and summarize the function."</span> }',
      '  ]',
      '}',
    ],
    row: null,
    cacheMode: 'na',
    tok: { type: 'none', msg: 'The auth.ts tool-result block does not exist in the prompt yet.' },
  },
  {
    label: 'Tool result block created',
    title: 'Claude calls Read, and the result becomes a block',
    narr:
      'Claude issues a <b>Read</b> tool call. The tool returns the source of <code>auth.ts</code>, and that output is inserted into the prompt as a <b>tool_result block</b>. The full code (about 250 tokens) is now in the model’s input. CacheLane records a metadata row, but it <b>never stores the content itself</b>.',
    slot: [
      '<span class="ll-c">// inserted into messages[].content</span>',
      '{',
      '  <span class="ll-k">"type"</span>: <span class="ll-s">"tool_result"</span>,',
      '  <span class="ll-k">"block_id"</span>: <span class="ll-s">"01KPRUNE"</span>,',
      '  <span class="ll-k">"content"</span>: <span class="ll-s">"function auth(user) { ... }"</span>  <span class="ll-c">// 250 tok</span>',
      '}',
    ],
    row: ROW.created,
    rowFlash: 'all',
    cacheMode: 'present',
    cacheList: ['Full source is live in the model input.', 'Metadata row written to SQLite (id + handle + counters only).'],
    tok: { type: 'single', value: 250, kind: 'full', label: 'auth.ts tool_result in prompt' },
  },
  {
    label: 'K turns of idleness',
    title: 'The block sits unused as unused_turns ticks up',
    narr:
      'The conversation moves on to other topics. Nobody references the auth.ts result. Each turn it goes untouched, CacheLane increments <code>unused_turns</code>. The default threshold is <b>K = 3</b>.',
    slot: [
      '<span class="ll-c">// block content unchanged in prompt…</span>',
      '<span class="ll-c">// …but aging in the metadata store:</span>',
      '',
      '  turn 2  →  <span class="ll-k">unused_turns</span> = <span class="ll-s">1</span>',
      '  turn 3  →  <span class="ll-k">unused_turns</span> = <span class="ll-s">2</span>',
      '  turn 4  →  <span class="ll-k">unused_turns</span> = <span class="ll-s">3</span>   <span class="ll-c">// == K</span>',
    ],
    row: ROW.idle,
    rowFlash: ['unused_turns'],
    cacheMode: 'present',
    cacheList: ['Content still live in prompt (still costing 250 tokens every turn).', 'Aging tracked by turn count, not wall-clock and not tool-call count.'],
    tok: { type: 'single', value: 250, kind: 'full', label: 'still 250 tok in prompt every idle turn' },
  },
  {
    label: 'Block becomes stub',
    title: 'unused_turns hits K, so the pruner stubs the block',
    narr:
      'With <code>unused_turns = 3 = K</code>, the pruner replaces the block’s full content with a compact <b>stub</b>. The block keeps its <b>identity and position</b>; only the payload is elided. This exists to <b>(1) preserve identity, (2) allow later restoration, and (3) save prompt tokens</b>.',
    slot: [
      '<span class="ll-c">// same slot, same position, content swapped</span>',
      '{',
      '  <span class="ll-k">"type"</span>: <span class="ll-s">"tool_result"</span>,',
      '  <span class="ll-k">"block_id"</span>: <span class="ll-s">"01KPRUNE"</span>,   <span class="ll-c">// ← unchanged</span>',
      '  <span class="ll-k">"content"</span>: <span class="ll-s ll-hl">"[stub:01KPRUNE] … (250 tokens elided)"</span>',
      '}',
    ],
    row: ROW.stub,
    rowFlash: ['is_stub', 'stub_summary'],
    preserved: [
      { txt: 'ID preserved (01KPRUNE)', note: false },
      { txt: 'refetch_handle preserved', note: false },
      { txt: 'position in prompt preserved', note: true },
    ],
    cacheMode: 'stubbed',
    cacheList: ['Full content removed from the live prompt.', 'Stub placeholder takes its place.', 'Everything needed to restore is kept in the row.'],
    tok: { type: 'compare', before: 250, after: 20 },
  },
  {
    label: 'Prompt now contains stub text',
    title: 'This is literally what the model now sees',
    narr:
      'In place of 250 tokens of source code, the model reads a single line. This exact string is the entire payload for that block now, yet the model can still see the block’s identity and how to get the real content back.',
    slot: [
      '<span class="ll-c">// the verbatim string in messages[].content:</span>',
      '',
      '<span class="ll-s">[stub:01KPRUNE] tool_output tool:read:src/auth.ts</span>',
      '<span class="ll-s">(250 tokens elided) | refetch via</span>',
      '<span class="ll-s">cachelane_expand(block_id=01KPRUNE)</span>',
    ],
    row: ROW.stub,
    rowFlash: [],
    cacheMode: 'stubbed',
    cacheList: ['The model sees the stub, not the code.', 'If it needs the code, the stub tells it exactly how to ask for it.'],
    tok: { type: 'single', value: 20, kind: 'stub', label: 'stub line in prompt (~20 tok)' },
  },
  {
    label: 'SQLite row updated',
    title: 'Two separate worlds: the prompt vs. the metadata store',
    narr:
      'This is the key distinction. The <b>live prompt</b> (what the model is charged for) now holds only the stub. The <b>SQLite metadata store</b> holds the row: id, summary, refetch handle, and counters. Note: CacheLane <b>does not store the original code</b>; restoration re-runs the deterministic tool call via the handle.',
    slot: [
      '<span class="ll-c">// live prompt payload (model input):</span>',
      '<span class="ll-s">[stub:01KPRUNE] … (250 tokens elided)</span>',
      '',
      '<span class="ll-c">// SQLite row (metadata only, no code):</span>',
      '<span class="ll-k">is_stub</span>=<span class="ll-s">1</span>  <span class="ll-k">stub_summary</span>=<span class="ll-s">"…elided"</span>',
      '<span class="ll-k">refetch_handle</span>=<span class="ll-s">"tool:read:src/auth.ts"</span>',
    ],
    row: ROW.stub,
    rowFlash: [],
    cacheMode: 'stubbed',
    showWorlds: true,
    tok: { type: 'single', value: 20, kind: 'stub', label: 'prompt payload ~20 tok · metadata row ~1 KB on disk' },
  },
  {
    label: 'cachelane:expand requested',
    title: 'The model asks for the block back',
    narr:
      'Later, the model (or user) needs the auth code again. The model issues the tool call <code>cachelane:expand(block_id=01KPRUNE)</code>. CacheLane looks up the row, reads <code>refetch_handle</code>, and <b>re-issues the original tool call</b> via <code>tool:read:src/auth.ts</code>.',
    slot: [
      '{',
      '  <span class="ll-k">"type"</span>: <span class="ll-s">"tool_use"</span>,',
      '  <span class="ll-k">"name"</span>: <span class="ll-s">"cachelane_expand"</span>,',
      '  <span class="ll-k">"input"</span>: { <span class="ll-k">"block_id"</span>: <span class="ll-s">"01KPRUNE"</span> }',
      '}',
      '<span class="ll-c">// → CacheLane reads refetch_handle, re-runs Read(src/auth.ts)</span>',
    ],
    row: ROW.stub,
    rowLookup: ['refetch_handle'],
    cacheMode: 'stubbed',
    cacheList: ['Expand call itself is tiny.', 'The handle (not stored code) is the source of truth for recovery.'],
    tok: { type: 'single', value: 20, kind: 'stub', label: 'still stubbed during the request (expand call ≈ a few tok)' },
  },
  {
    label: 'Block restored',
    title: 'Full content returns to its original slot, non-lossy',
    narr:
      'The re-issued Read returns the source. CacheLane writes it back into the <b>same block, same position</b>. Because identity and position are preserved and the content came from the same deterministic tool call, the restoration is <b>non-lossy</b>: byte-for-byte the original.',
    slot: [
      '{',
      '  <span class="ll-k">"type"</span>: <span class="ll-s">"tool_result"</span>,',
      '  <span class="ll-k">"block_id"</span>: <span class="ll-s">"01KPRUNE"</span>,   <span class="ll-c">// same id, same slot</span>',
      '  <span class="ll-k">"content"</span>: <span class="ll-s ll-hl">"function auth(user) { ... }"</span>',
      '}',
    ],
    row: ROW.restored,
    rowFlash: ['is_stub', 'stub_summary', 'unused_turns', 'restored_at_turn'],
    cacheMode: 'present',
    cacheList: ['Content live in the prompt again (250 tok).', '<code>restored_at_turn</code> records when it came back.', 'Was always recoverable → nothing was ever lost.'],
    tok: { type: 'compare', before: 20, after: 250, restore: true },
  },
  {
    label: 'Token savings summary',
    title: 'Net effect across the block’s life',
    narr:
      'While stubbed, the block cost ~20 tokens instead of 250, delivering a <b>230-token saving every turn it stayed idle</b>. The metadata row always remained, so the content was one <code>cachelane:expand</code> away. Across a long session with many idle blocks, this <b>flattens prompt-token growth</b> without ever losing information.',
    slot: [
      '<span class="ll-c">// per-turn prompt payload for this block</span>',
      '  full (present)   <span class="ll-s">250</span> tok',
      '  stub (stubbed)   <span class="ll-s"> 20</span> tok',
      '  ───────────────',
      '  saved / idle turn <span class="ll-k">230</span> tok',
    ],
    row: ROW.restored,
    rowFlash: [],
    cacheMode: 'present',
    summary: true,
    tok: { type: 'summary' },
  },
];

type TItem = {
  stage: number;
  view: 'plain' | 'raw';
  role: 'user' | 'assistant' | 'tool' | 'system';
  html?: string;
  label?: string;
  kind?: 'code' | 'stub';
  nested?: boolean;
  muted?: boolean;
};

const TRANSCRIPT: TItem[] = [
  // ---- PLAIN (User <-> Agent, plain English) ----
  { stage: 0, view: 'plain', role: 'user', html: 'Please read auth.ts and summarize the function.' },
  { stage: 1, view: 'plain', role: 'assistant', html: '<code>auth.ts</code> defines <code>auth(user)</code>. It validates the user and returns the auth result. Want me to add tests next?' },
  { stage: 2, view: 'plain', role: 'user', html: 'Now add a unit test for the parser.' },
  { stage: 2, view: 'plain', role: 'assistant', html: 'Added <code>parser.test.ts</code> with 3 cases. ✓' },
  { stage: 2, view: 'plain', role: 'user', html: 'Also fix the lint error in config.ts.' },
  { stage: 2, view: 'plain', role: 'assistant', html: 'Fixed. Removed the unused import. ✓' },
  { stage: 2, view: 'plain', role: 'user', html: 'Bump the version to 1.0.1.' },
  { stage: 2, view: 'plain', role: 'assistant', html: 'Done. Version is now 1.0.1. ✓' },
  { stage: 3, view: 'plain', role: 'system', html: '(Behind the scenes, the idle auth.ts result was just stubbed; the user sees nothing change.)' },
  { stage: 6, view: 'plain', role: 'user', html: 'Wait, what did <code>auth.ts</code> look like again?' },
  { stage: 7, view: 'plain', role: 'assistant', html: 'Here it is again:<div class="ll-codeblock" style="margin-top:7px">' + CODE_HTML + '</div>' },

  // ---- RAW (agent internals) ----
  { stage: 0, view: 'raw', role: 'user', html: 'Please read auth.ts and summarize the function.' },
  { stage: 1, view: 'raw', role: 'assistant', html: 'tool_use → <code>Read(src/auth.ts)</code>' },
  { stage: 1, view: 'raw', role: 'tool', nested: true, label: 'tool_result · block 01KPRUNE', kind: 'code' },
  { stage: 2, view: 'raw', role: 'user', html: 'Now add a unit test for the parser.' },
  { stage: 2, view: 'raw', role: 'assistant', html: 'tool_use → <code>Write(parser.test.ts)</code>' },
  { stage: 2, view: 'raw', role: 'tool', nested: true, muted: true, label: 'tool_result', html: 'ok, 3 tests added' },
  { stage: 2, view: 'raw', role: 'user', html: 'Also fix the lint error in config.ts.' },
  { stage: 2, view: 'raw', role: 'assistant', html: 'tool_use → <code>Edit(config.ts)</code>' },
  { stage: 2, view: 'raw', role: 'tool', nested: true, muted: true, label: 'tool_result', html: 'ok' },
  { stage: 2, view: 'raw', role: 'user', html: 'Bump the version to 1.0.1.' },
  { stage: 2, view: 'raw', role: 'assistant', html: 'tool_use → <code>Edit(package.json)</code>' },
  { stage: 2, view: 'raw', role: 'tool', nested: true, muted: true, label: 'tool_result', html: 'ok' },
  { stage: 2, view: 'raw', role: 'system', html: 'block 01KPRUNE untouched for 3 turns → <code>unused_turns = 3</code> (= K)' },
  { stage: 3, view: 'raw', role: 'tool', nested: true, label: 'block 01KPRUNE: content replaced ↓', kind: 'stub' },
  { stage: 6, view: 'raw', role: 'assistant', html: 'tool_use → <code>cachelane:expand(block_id="01KPRUNE")</code>' },
  { stage: 6, view: 'raw', role: 'tool', nested: true, muted: true, label: 'CacheLane', html: 'lookup 01KPRUNE → handle <code>tool:read:src/auth.ts</code> → re-issue Read' },
  { stage: 7, view: 'raw', role: 'tool', nested: true, label: 'block 01KPRUNE: content restored ↓', kind: 'code' },
];

const TAB_HINT = {
  plain: 'What the user actually sees. The agent answers in plain English; tool calls and stubbing stay hidden.',
  raw: 'Under the hood: tool_use and tool_result blocks. Watch block 01KPRUNE go full then stub then restored.',
};

const ROLE_LABEL: Record<TItem['role'], string> = {
  user: 'USER',
  assistant: 'ASSISTANT',
  tool: 'TOOL',
  system: 'SYSTEM',
};

const ROLE_STYLE: Record<TItem['role'], string> = {
  user: 'bg-[color-mix(in_oklch,var(--color-accent)_12%,transparent)] text-[var(--color-accent)]',
  assistant: 'bg-[color-mix(in_oklch,var(--color-warn)_14%,transparent)] text-[var(--color-warn)]',
  tool: 'bg-[color-mix(in_oklch,var(--color-success)_16%,transparent)] text-[var(--color-success)]',
  system: 'bg-[var(--color-bg-inline)] text-[var(--color-fg-faint)]',
};

const SQL_ORDER = ['id', 'is_stub', 'stub_summary', 'refetch_handle', 'unused_turns', 'restored_at_turn'] as const;

export function StubLifecycle() {
  const [cur, setCur] = useState(0);
  const [tab, setTab] = useState<'plain' | 'raw'>('plain');
  const transcriptRef = useRef<HTMLDivElement>(null);
  const s = STAGES[cur];

  // keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setCur((c) => Math.min(STAGES.length - 1, c + 1));
      else if (e.key === 'ArrowLeft') setCur((c) => Math.max(0, c - 1));
      else if (/^[1-9]$/.test(e.key)) {
        const i = +e.key - 1;
        if (i < STAGES.length) setCur(i);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // keep latest transcript message in view
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [cur, tab]);

  const items = TRANSCRIPT.filter((e) => e.stage <= cur && e.view === tab);

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elev)]/40 p-4 sm:p-6">
      {/* Stage nav */}
      <div className="mb-5 flex gap-2 overflow-x-auto pb-2">
        {STAGES.map((st, i) => (
          <button
            key={st.label}
            onClick={() => setCur(i)}
            className={cn(
              'flex flex-none items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors',
              i === cur
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)] font-semibold'
                : 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]',
            )}
          >
            <span
              className={cn(
                'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold',
                i === cur
                  ? 'bg-[var(--color-accent-fg)] text-[var(--color-accent)]'
                  : i < cur
                    ? 'bg-[var(--color-success)] text-[var(--color-accent-fg)]'
                    : 'bg-[var(--color-bg-elev)] text-[var(--color-fg-faint)] border border-[var(--color-border)]',
              )}
            >
              {i + 1}
            </span>
            {st.label}
          </button>
        ))}
      </div>

      {/* Narrative */}
      <div className="mb-5 rounded-xl border border-[var(--color-border)] border-l-[3px] border-l-[var(--color-accent)] bg-[var(--color-bg)] px-5 py-4">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-[var(--color-accent)]">
          Stage {cur + 1} of 9 · {s.label}
        </p>
        <h3 className="mb-1.5 text-lg font-bold text-[var(--color-fg)]">{s.title}</h3>
        <p
          className="text-sm leading-relaxed text-[var(--color-fg-muted)] [&_b]:text-[var(--color-fg)] [&_b]:font-semibold [&_code]:font-mono [&_code]:text-[var(--color-fg)] [&_code]:bg-[var(--color-bg-inline)] [&_code]:px-1 [&_code]:rounded"
          dangerouslySetInnerHTML={{ __html: s.narr }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* (1) Conversation transcript */}
        <Box title="① What the human reads" tag="full scrollable history">
          <div className="mb-3 flex gap-1.5">
            {(['plain', 'raw'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 rounded-md border px-2.5 py-2 text-[11.5px] transition-colors',
                  tab === t
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)] font-semibold'
                    : 'border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
                )}
              >
                {t === 'plain' ? '🗨 User ↔ Agent' : '{ } Agent internals (raw)'}
              </button>
            ))}
          </div>
          <p className="mb-2.5 text-[11px] italic text-[var(--color-fg-faint)]">{TAB_HINT[tab]}</p>
          <div ref={transcriptRef} className="flex max-h-[392px] flex-col gap-2.5 overflow-y-auto pr-1.5 scroll-smooth">
            {items.length === 0 ? (
              <p className="text-sm italic text-[var(--color-fg-faint)]">No messages in this view yet.</p>
            ) : (
              items.map((e, idx) => {
                const isNew = e.stage === cur;
                let inner: React.ReactNode;
                if (e.kind === 'code') inner = <div className="ll-codeblock" dangerouslySetInnerHTML={{ __html: CODE_HTML }} />;
                else if (e.kind === 'stub') inner = <div className="ll-stubline" dangerouslySetInnerHTML={{ __html: STUB_TEXT_HTML }} />;
                else inner = <span dangerouslySetInnerHTML={{ __html: e.html ?? '' }} />;
                return (
                  <div
                    key={idx}
                    className={cn(
                      'flex-none overflow-hidden rounded-lg border border-[var(--color-border)]',
                      e.nested && 'ml-5 rounded-l-none border-l-2 border-l-[var(--color-accent)]',
                      e.muted && 'opacity-80',
                      isNew && 'll-flash',
                    )}
                  >
                    {e.nested && (
                      <div className="px-3 pt-1 font-mono text-[9.5px] uppercase tracking-wide text-[var(--color-fg-faint)]">
                        ↳ internal
                      </div>
                    )}
                    <div className={cn('px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide', ROLE_STYLE[e.role])}>
                      {e.label ?? ROLE_LABEL[e.role]}
                    </div>
                    <div
                      className={cn(
                        'px-3 py-2 text-[13px] leading-relaxed text-[var(--color-fg)]',
                        e.muted && 'italic text-[var(--color-fg-faint)]',
                        '[&_code]:font-mono [&_code]:text-[var(--color-fg)] [&_code]:bg-[var(--color-bg-inline)] [&_code]:px-1 [&_code]:rounded [&_code]:text-[0.9em]',
                      )}
                    >
                      {inner}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Box>

        {/* (2) Model prompt slot */}
        <Box title="② Model prompt" tag="structured content slot">
          <pre
            className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[var(--color-fg)]"
            dangerouslySetInnerHTML={{ __html: s.slot.join('\n') }}
          />
        </Box>

        {/* (3) SQLite row */}
        <Box title="③ SQLite metadata row" tag="blocks table">
          <SqlRow stage={s} />
        </Box>

        {/* (4) Cache status */}
        <Box title="④ Cache status" tag="live prompt vs metadata store">
          <CacheStatus stage={s} />
        </Box>

        {/* (5) Token impact, full width */}
        <div className="lg:col-span-2">
          <Box title="⑤ Token impact" tag="before → after">
            <TokenImpact tok={s.tok} />
          </Box>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <button
          onClick={() => setCur((c) => Math.max(0, c - 1))}
          disabled={cur === 0}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2 text-sm transition-colors hover:border-[var(--color-accent)] disabled:opacity-40"
        >
          ◀ Prev
        </button>
        <div className="text-xs text-[var(--color-fg-muted)]">
          Stage <b className="text-[var(--color-fg)]">{cur + 1}</b> / 9 · {s.label}
          <span className="ml-3 hidden text-[var(--color-fg-faint)] sm:inline">← → arrows · 1 to 9 jump</span>
        </div>
        <button
          onClick={() => setCur((c) => Math.min(STAGES.length - 1, c + 1))}
          disabled={cur === STAGES.length - 1}
          className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[var(--color-accent)] px-5 py-2 text-sm font-semibold text-[var(--color-accent-fg)] transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-40"
        >
          {cur === STAGES.length - 1 ? 'Done ✓' : 'Next ▶'}
        </button>
      </div>
    </div>
  );
}

function Box({ title, tag, children }: { title: string; tag: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-faint)]">{title}</span>
        <span className="text-[10px] text-[var(--color-fg-faint)]">{tag}</span>
      </div>
      <div className="flex-1 p-4">{children}</div>
    </div>
  );
}

function SqlRow({ stage }: { stage: Stage }) {
  if (!stage.row) {
    return <p className="font-mono text-xs italic text-[var(--color-fg-faint)]">No block row exists yet.</p>;
  }
  const row = stage.row;
  const flash = stage.rowFlash === 'all' ? [...SQL_ORDER] : Array.isArray(stage.rowFlash) ? stage.rowFlash : [];
  const lookup = stage.rowLookup ?? [];
  const anim = flash.length || lookup.length ? 'll-rowflash' : '';

  return (
    <>
      <table className={cn('w-full border-collapse font-mono text-[12px]', anim)}>
        <tbody>
          {SQL_ORDER.map((k) => {
            const v = row[k];
            const changed = flash.includes(k);
            const isLookup = lookup.includes(k);
            return (
              <tr
                key={k}
                className={cn(
                  'border-b border-[var(--color-border)] last:border-0',
                  changed && 'bg-[color-mix(in_oklch,var(--color-warn)_12%,transparent)]',
                  isLookup && 'bg-[color-mix(in_oklch,var(--color-accent)_12%,transparent)]',
                )}
              >
                <td className="w-[150px] whitespace-nowrap px-2.5 py-1.5 align-top text-[var(--color-fg-faint)]">
                  {changed && <span className="text-[var(--color-warn)]">▸ </span>}
                  {isLookup && <span>🔍 </span>}
                  {k}
                </td>
                <td className="break-all px-2.5 py-1.5 align-top text-[var(--color-fg)]">
                  {v === null ? (
                    <span className="italic text-[var(--color-fg-faint)]">null</span>
                  ) : k === 'is_stub' ? (
                    <span className={v === '1' ? 'text-[var(--color-warn)]' : 'text-[var(--color-success)]'}>{v}</span>
                  ) : (
                    v
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {stage.preserved && (
        <div className="mt-3 flex flex-wrap gap-2.5">
          {stage.preserved.map((p) => (
            <span
              key={p.txt}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]',
                p.note
                  ? 'border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[var(--color-fg-muted)]'
                  : 'border-[color-mix(in_oklch,var(--color-success)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_10%,transparent)] text-[var(--color-success)]',
              )}
            >
              {p.note ? '○' : '✓'} {p.txt}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function CacheStatus({ stage }: { stage: Stage }) {
  const labels = { present: 'present', stubbed: 'stubbed', evicted: 'evicted', na: 'n/a' };
  const badgeStyle: Record<Stage['cacheMode'], string> = {
    present: 'border-[color-mix(in_oklch,var(--color-success)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_13%,transparent)] text-[var(--color-success)]',
    stubbed: 'border-[color-mix(in_oklch,var(--color-warn)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warn)_13%,transparent)] text-[var(--color-warn)]',
    evicted: 'border-[var(--color-border-strong)] bg-[var(--color-bg-elev)] text-[var(--color-fg-muted)]',
    na: 'border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[var(--color-fg-faint)]',
  };
  const dotColor: Record<Stage['cacheMode'], string> = {
    present: 'bg-[var(--color-success)]',
    stubbed: 'bg-[var(--color-warn)]',
    evicted: 'bg-[var(--color-border-strong)]',
    na: 'bg-[var(--color-border-strong)]',
  };
  return (
    <div>
      <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold', badgeStyle[stage.cacheMode])}>
        <span className={cn('h-2.5 w-2.5 rounded-full', dotColor[stage.cacheMode])} />
        {labels[stage.cacheMode]}
      </span>

      {stage.showWorlds && (
        <div className="mt-3.5 grid grid-cols-1 items-center gap-2.5 sm:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-lg border border-[color-mix(in_oklch,var(--color-accent)_35%,transparent)] bg-[var(--color-bg-elev)] p-3">
            <p className="mb-2 font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-fg-faint)]">live prompt / model input</p>
            <div className="break-words font-mono text-[11.5px] leading-relaxed text-[var(--color-fg)]" dangerouslySetInnerHTML={{ __html: STUB_TEXT_HTML }} />
          </div>
          <div className="text-center text-xl text-[var(--color-fg-faint)]">⇄</div>
          <div className="rounded-lg border border-[color-mix(in_oklch,var(--color-warn)_35%,transparent)] bg-[var(--color-bg-elev)] p-3">
            <p className="mb-2 font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-fg-faint)]">metadata store (SQLite)</p>
            <div className="break-words font-mono text-[11.5px] leading-relaxed text-[var(--color-fg)]">
              id=01KPRUNE · is_stub=1
              <br />
              refetch_handle=&quot;tool:read:src/auth.ts&quot;
              <br />
              <span className="text-[var(--color-fg-faint)]">↳ original code NOT stored, refetched on demand</span>
            </div>
          </div>
        </div>
      )}

      {stage.cacheList && (
        <ul className="mt-3 space-y-1 text-[12px] text-[var(--color-fg-muted)]">
          {stage.cacheList.map((x, i) => (
            <li key={i} className="relative pl-5 [&_code]:font-mono [&_code]:text-[var(--color-fg)]" >
              <span className="absolute left-1.5 text-[var(--color-accent)]">•</span>
              <span dangerouslySetInnerHTML={{ __html: x }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TokenImpact({ tok }: { tok: Tok }) {
  const MAX = 250;
  if (tok.type === 'none') {
    return <p className="text-[12.5px] italic text-[var(--color-fg-faint)]">{tok.msg}</p>;
  }
  if (tok.type === 'single') {
    const pct = Math.max(6, Math.round((tok.value / MAX) * 100));
    return (
      <div>
        <div className="mb-1.5 flex justify-between text-[11.5px] text-[var(--color-fg-muted)]">
          <span>{tok.label}</span>
          <b className="font-mono text-[var(--color-fg)]">{tok.value} tok</b>
        </div>
        <Bar pct={pct} kind={tok.kind} value={tok.value} />
      </div>
    );
  }
  if (tok.type === 'compare') {
    const bp = Math.max(6, Math.round((tok.before / MAX) * 100));
    const ap = Math.max(6, Math.round((tok.after / MAX) * 100));
    const saved = Math.abs(tok.before - tok.after);
    return (
      <div className="space-y-3.5">
        <div>
          <div className="mb-1.5 flex justify-between text-[11.5px] text-[var(--color-fg-muted)]">
            <span>before</span>
            <b className="font-mono text-[var(--color-fg)]">{tok.before} tok</b>
          </div>
          <Bar pct={bp} kind={tok.before >= tok.after ? 'full' : 'stub'} value={tok.before} />
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-[11.5px] text-[var(--color-fg-muted)]">
            <span>after</span>
            <b className="font-mono text-[var(--color-fg)]">{tok.after} tok</b>
          </div>
          <Bar pct={ap} kind={tok.after > tok.before ? 'full' : 'stub'} value={tok.after} />
        </div>
        <div className="font-mono text-[13px]">
          {tok.restore ? '↺ ' : '↓ '}
          <span className="text-[18px] font-bold" style={{ color: tok.restore ? 'var(--color-warn)' : 'var(--color-success)' }}>
            {saved} tok
          </span>{' '}
          {tok.restore ? `restored (+${saved} tok back in prompt)` : 'saved'}
        </div>
      </div>
    );
  }
  // summary
  return (
    <>
      <table className="w-full border-collapse font-mono text-[13px]">
        <thead>
          <tr>
            <th className="border-b border-[var(--color-border)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-faint)]">state</th>
            <th className="border-b border-[var(--color-border)] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-faint)]">tokens in prompt</th>
            <th className="border-b border-[var(--color-border)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-faint)]">note</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border-b border-[var(--color-border)] px-3 py-2 text-[var(--color-fg)]">before stubbing</td>
            <td className="border-b border-[var(--color-border)] px-3 py-2 text-right text-[var(--color-fg)]">250</td>
            <td className="border-b border-[var(--color-border)] px-3 py-2 text-[var(--color-fg-faint)]">full tool_result content</td>
          </tr>
          <tr>
            <td className="border-b border-[var(--color-border)] px-3 py-2 text-[var(--color-fg)]">after stubbing</td>
            <td className="border-b border-[var(--color-border)] px-3 py-2 text-right text-[var(--color-fg)]">~20</td>
            <td className="border-b border-[var(--color-border)] px-3 py-2 text-[var(--color-fg-faint)]">stub placeholder line</td>
          </tr>
          <tr>
            <td className="px-3 py-2 text-[15px] font-bold text-[var(--color-success)]">savings / idle turn</td>
            <td className="px-3 py-2 text-right text-[15px] font-bold text-[var(--color-success)]">230</td>
            <td className="px-3 py-2 text-[var(--color-success)]">~92% smaller payload</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-[12.5px] text-[var(--color-fg-muted)] [&_code]:font-mono [&_code]:text-[var(--color-fg)]">
        Metadata row (~1 KB) remains on disk the whole time; the prompt payload is what shrinks. The content is never lost; it is
        always one <code>cachelane:expand</code> away.
      </p>
    </>
  );
}

function Bar({ pct, kind, value }: { pct: number; kind: 'full' | 'stub'; value: number }) {
  return (
    <div className="h-[22px] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elev)]">
      <div
        className={cn(
          'flex h-full items-center rounded-l-md pl-2 font-mono text-[10.5px] font-bold text-[var(--color-accent-fg)] transition-[width] duration-500',
          kind === 'stub' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warn)]',
        )}
        style={{ width: `${pct}%` }}
      >
        {value}
      </div>
    </div>
  );
}
