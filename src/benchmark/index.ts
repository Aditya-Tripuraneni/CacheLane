export {
  formatBenchmarkMarkdown,
  generateRecordedBenchmarkReport,
  loadNormalizedTraceSessions,
} from "./recorded.js";
export type {
  BenchmarkScenarioRow,
  GenerateRecordedBenchmarkOptions,
  RecordedBenchmarkReport,
} from "./recorded.js";
export { runLiveReport } from "./live-report.js";
export { runLiveAbTest } from "./live-ab-test.js";
export {
  runLatencyAb,
  runLatencyAbCli,
  formatLatencyReport,
  type LatencyAbReport,
  type RunLatencyAbCliOptions,
} from "./latency-ab.js";
export { runDashboard } from "./dashboard.js";
export { runDuel, type DuelDeps, type RunDuelOptions } from "./duel.js";
export { buildDuelReport, renderDuelMarkdown, type DuelReport } from "./duel-report.js";
export {
  computeCorrectnessForSession,
  generateCorrectnessReport,
  formatCorrectnessMarkdown,
} from "./correctness.js";
export type { GenerateCorrectnessOptions } from "./correctness.js";
export type { CorrectnessReport, CorrectnessScenarioRow } from "./types.js";

