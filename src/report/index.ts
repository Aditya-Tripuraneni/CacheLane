import { writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { platform } from "node:process";
import type { CachelaneDb } from "../storage/index.js";
import { buildReportData } from "./query.js";
import { renderReportHtml } from "./render-html.js";
import type { ReportOptions } from "./types.js";
import type { RecordedBenchmarkReport } from "../benchmark/types.js";

export { buildReportData } from "./query.js";
export { renderReportHtml } from "./render-html.js";
export type { ReportData, ReportOptions, ReportTurn } from "./types.js";

export interface GenerateReportResult {
  out_path: string;
  turns: number;
  sessions: number;
}

export function generateReport(
  db: CachelaneDb,
  opts: ReportOptions,
  outPath: string,
  benchmark?: RecordedBenchmarkReport,
): GenerateReportResult {
  const data = buildReportData(db, opts);
  writeFileSync(outPath, renderReportHtml(data, benchmark), "utf8");
  return { out_path: outPath, turns: data.turns.length, sessions: data.sessions.length };
}

export function openInBrowser(filePath: string): void {
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const args = platform === "win32" ? ["", filePath] : [filePath];
  try {
    const child = execFile(cmd, args, () => { /* best-effort; ignore errors */ });
    child.unref?.();
  } catch {
    /* fail-open: never throw from opening a browser */
  }
}
