import { resolve } from "node:path";
import { loadNormalizedTraceSessions } from "../../src/benchmark/recorded.js";
import { generateCorrectnessReport } from "../../src/benchmark/index.js";

const dir = process.argv[2] ?? "benchmark/runs/committed/fake-smoke-3/normalized";
const sessions = loadNormalizedTraceSessions(resolve(process.cwd(), dir));
const report = generateCorrectnessReport({
  run_id: "ci-correctness",
  generated_at: new Date().toISOString(),
  sessions,
  k: 3,
  normalized_dir: dir,
});

// CI gate: pruning must be non-lossy on committed traces.
const failed =
  report.totals.rehydration_recall < 1 || report.totals.stale_answer_rate > 0;
process.stdout.write(JSON.stringify(report.totals, null, 2) + "\n");
if (failed) {
  process.stderr.write(
    `[correctness] GATE FAILED: recall=${report.totals.rehydration_recall} stale=${report.totals.stale_answer_rate}\n`,
  );
  process.exitCode = 1;
}
