# M4 reference-detection corpus pipeline

Builds the labeled corpus that gates M4 (REQ-NF-008/009: precision ≥ 95%,
recall ≥ 85%). Designed so the human does **~1 hour once**, not 6 hours of
clicking 15,000 yes/no rows.

This whole directory is **tooling, not product**. It lives in `scripts/`, is
never bundled by `tsup`, and never ships in the npm tarball. The shipped
surface stays lean. The LLM judge is one-time scaffolding — **CI never runs it.**

## The idea in one breath

Real Claude Code transcripts → auto-label the mechanically-certain references
(file in a tool call, id_token in text) → label the fuzzy residual with either
an LLM judge or a human JSON pass → freeze to a static fixture. CI then runs the
**deterministic** detector against the frozen labels.

```
ingest (real JSONL) ─► mechanical labels (Layer 1, deterministic positives)
                       └► residual ─► LLM judge (Layer 2, unattended)
                                      └► freeze ─► corpus/sessions/*.json
                                                   └► eval.ts  ◄── the CI gate
human labels (no API) ───────────────────────────────┘
human anchor (optional) ─► calibrate judge-vs-human
```

## What sessions to use

**Real ones — you already have them.** Claude Code stores every session as
JSONL under `~/.claude/projects/<encoded-path>/<session-id>.jsonl`. The sessions
in which you built CacheLane (M1–M3) are sitting there now:

```bash
ls ~/.claude/projects/*/        # find your transcripts
```

Do **not** synthesize the validity corpus — generated references are ones you
anticipated by construction, so recall would read ~100% while real implicit
references slip through. Synthetic sessions are fine only as unit/regression
fixtures, never as the gate.

How many: the spec says 100, but that's coverage, not statistics. ~30 diverse
real sessions clears a ±10% CI around 85% recall. Amending the target to ~30 is
legitimate **but it's a spec change** — reconcile `designs/06`/`07` and get the
second sign-off; don't let it drift silently.

## Run it

Install dev deps (`tsx`, `@anthropic-ai/sdk`). If you have a funded judge API
key, use the automated judge path. If not, use the no-API human path below.

Anthropic:

```bash
export ANTHROPIC_API_KEY=...
export CORPUS_JUDGE_PROVIDER=anthropic
export CORPUS_JUDGE_MODEL=claude-opus-4-7
```

GLM / Z.ai:

```bash
export GLM_API_KEY=...              # or ZAI_API_KEY
export CORPUS_JUDGE_PROVIDER=glm    # optional; auto-selected when GLM_API_KEY is set
export CORPUS_GLM_MODEL=glm-5.1
# Optional override; default is the current Z.ai v4 chat-completions base:
export GLM_BASE_URL=https://api.z.ai/api/paas/v4
```

```bash
# 1. (optional, recommended) emit residual rows for 15 sessions to hand-label
tsx scripts/corpus/build-corpus.ts anchor --in ~/.claude/projects \
    --out corpus/anchor.residual.json --sessions 15
#    -> open the file, set "referenced": true/false on each row (~1 hour),
#       save as corpus/anchor.human.json

# 2. full automated labeling pass (mechanical + judge), freezes the fixture
tsx scripts/corpus/build-corpus.ts build --in ~/.claude/projects --out corpus --sessions 30

# 3. (optional) check the judge agrees with your anchor set
tsx scripts/corpus/build-corpus.ts calibrate --human corpus/anchor.human.json --out corpus
#    >=90% agreement -> trust the judge. <90% -> tighten the rubric in judge.ts.

# 4. run the gate locally
tsx scripts/corpus/eval.ts corpus
```

### No-API path

If you have no funded Anthropic/GLM balance, freeze the corpus from human
residual labels:

```bash
# 1. Emit residual rows for the exact sessions you want in the gate.
tsx scripts/corpus/build-corpus.ts anchor --in ~/.claude/projects \
    --out corpus/residual.human.json --sessions 30

# 2. Edit corpus/residual.human.json:
#    set every "referenced": null to true or false.

# 3. Freeze corpus/sessions/*.json with no model/API calls.
tsx scripts/corpus/build-corpus.ts build-human --in ~/.claude/projects \
    --human corpus/residual.human.json --out corpus --sessions 30

# 4. Run the deterministic gate.
tsx scripts/corpus/eval.ts corpus
```

`build-human` warns if residual rows are missing human labels. Missing residuals
are skipped by `eval.ts`, so do not treat that as a valid M4 gate unless every
residual row for the selected sessions has been labeled.

## Wiring into the real code (when M4 lands)

Two seams marked with `SEAM`:

1. `decompose.ts` → replace the fallback with `src/orchestrator`'s real
   `decomposeIntoBlocks` so corpus blocks == production blocks.
2. `eval.ts` → replace `./detector-stub` with
   `src/references/three-signal-detector`. Then delete `detector-stub.ts`.

The vitest CI gate just imports `evaluate` + `loadCorpus` from `eval.ts` and
asserts `precision >= 0.95 && recall >= 0.85`.

## Why two recall numbers

`eval.ts` prints **overall recall** (the spec gate) and **implicit-only recall**
(over judge/human labels only). The implicit number is the one that matters:
grading Signals 1 & 2 against the mechanical labels is grading the detector on
its own homework. If overall passes but implicit recall is low, the detector is
coasting on explicit signals and missing the conceptual references Signal 3 is
supposed to catch.

## Honest caveats

- Judge + detector can share blind spots, inflating measured recall. The human
  anchor set is what catches that — keep it, even small.
- The Anthropic judge defaults to `claude-opus-4-7` (`CORPUS_JUDGE_MODEL` to
  override). The GLM judge defaults to `glm-5.1` (`CORPUS_GLM_MODEL` to
  override). Strong model for the hard cases; drop to a cheaper one only if
  calibration still clears 90%.
- Transcript schemas drift. If parsing misses content, fix `parseLine` /
  `toContentBlocks` in `ingest.ts` only.
