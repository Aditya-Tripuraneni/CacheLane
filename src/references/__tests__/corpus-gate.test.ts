import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";

const corpusDir = "corpus";
const sessionsDir = `${corpusDir}/sessions`;
const corpusReady =
  fs.existsSync(sessionsDir) &&
  fs.readdirSync(sessionsDir).some((file) => file.endsWith(".json"));

interface EvalModule {
  evaluate(corpus: unknown[]): { precision: number; recall: number };
  loadCorpus(dir: string): unknown[];
}

async function loadEvalModule(): Promise<EvalModule> {
  const evalUrl = new URL("../../../scripts/corpus/eval.ts", import.meta.url);
  const mod = (await import(evalUrl.href)) as EvalModule;
  return mod;
}

// When corpus is absent, emit a visible warning so CI output signals the gap
// rather than silently passing. Generate corpus via: scripts/corpus/ingest.ts
beforeAll(() => {
  if (!corpusReady) {
    console.warn(
      "[cachelane] corpus-gate: REQ-NF-008/009 precision/recall tests SKIPPED" +
        " — corpus/sessions is empty. Run scripts/corpus/ingest.ts to populate.",
    );
  }
});

describe.skipIf(!corpusReady)("M4 corpus gate (REQ-NF-008/009)", () => {
  it("precision >= 95%", async () => {
    const { evaluate, loadCorpus } = await loadEvalModule();
    const result = evaluate(loadCorpus(corpusDir));
    expect(result.precision).toBeGreaterThanOrEqual(0.95);
  });

  it("recall >= 85%", async () => {
    const { evaluate, loadCorpus } = await loadEvalModule();
    const result = evaluate(loadCorpus(corpusDir));
    expect(result.recall).toBeGreaterThanOrEqual(0.85);
  });
});
