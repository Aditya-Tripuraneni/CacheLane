# M4 Corpus Fixture

This corpus is a **bootstrapped local CI fixture**, not the final independent
reference-detection validation corpus.

## Contents

- `sessions/*.json` — frozen labeled sessions generated from three real
  CacheLane Claude Code transcripts.
- `residual.human.json` — residual rows emitted by `scripts/corpus/build-corpus.ts
  anchor` and prefilled from the current deterministic detector.

## Source

The fixture was generated from:

```text
~/.claude/projects/-Users-jimmy-Documents-CacheLane--claude-worktrees-romantic-antonelli-a8667f
```

This was the smallest CacheLane transcript set available locally:

- 3 sessions
- 119 assistant turns
- 45 mechanical labels
- 2,841 residual labels

## Generation

```bash
PATH="$HOME/.local/node20/node-v20.18.0-darwin-arm64/bin:$PATH" \
npx tsx scripts/corpus/build-corpus.ts anchor \
  --in ~/.claude/projects/-Users-jimmy-Documents-CacheLane--claude-worktrees-romantic-antonelli-a8667f \
  --out corpus/residual.human.json \
  --sessions 999

PATH="$HOME/.local/node20/node-v20.18.0-darwin-arm64/bin:$PATH" \
npx tsx scripts/corpus/build-corpus.ts build-human \
  --in ~/.claude/projects/-Users-jimmy-Documents-CacheLane--claude-worktrees-romantic-antonelli-a8667f \
  --human corpus/residual.human.json \
  --out corpus \
  --sessions 999

PATH="$HOME/.local/node20/node-v20.18.0-darwin-arm64/bin:$PATH" \
npx tsx scripts/corpus/eval.ts corpus
```

## Gate Result

Current deterministic detector against this fixture:

```text
precision: 100.0%
recall: 100.0%
implicit-only recall: 100.0%
```

## Caveat

Because residual labels were bootstrapped from the detector and reconciled to
detector positives, this fixture validates wiring and regression behavior but
does **not** independently prove detector precision/recall. The binding spec's
independent corpus target remains open in `designs/07-open-questions.md`.

M5 uses this fixture only as a regression gate. Independent annotated-corpus
validation is still required before the K-pruner feature slice is considered
complete from a product-quality standpoint.
