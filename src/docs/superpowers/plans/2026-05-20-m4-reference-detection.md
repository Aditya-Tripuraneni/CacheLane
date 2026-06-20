# M4 Reference Detection — Execution Notes

## Scope

Implemented the M4 production slice:

- `src/references/` three-signal deterministic reference detector
- `src/hooks/post-response.ts` PostResponse counter update flow
- `src/storage/index.ts` batch reference writes and counter updates
- `scripts/corpus/` corpus generation/evaluation tooling
- `src/references/__tests__/corpus-gate.test.ts` CI corpus gate

## Corpus Status

No funded Anthropic or GLM/Z.ai judge API was available. The GLM call reached
Z.ai but failed with:

```text
429 code=1113 Insufficient balance or no resource package
```

To keep the CI gate wired without making network calls, the current checked-in
`corpus/` fixture is bootstrapped from the deterministic detector over three
real CacheLane sessions. This is suitable as a regression fixture, but it is not
the final independent precision/recall corpus described by REQ-NF-008/009.

## Verification

```text
npm test            101 passed, 1 skipped
npm run lint        clean
npx tsc --noEmit    clean
tsx scripts/corpus/eval.ts corpus
  precision: 100.0%
  recall: 100.0%
  implicit-only recall: 100.0%
```

## Remaining Spec Gap

Q001 remains partially open: independent human- or judge-labeled validation is
still needed before treating the corpus metrics as real quality evidence.
