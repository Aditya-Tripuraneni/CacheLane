const KEEP_PATTERNS: RegExp[] = [
  /error/i,
  /warn/i,
  /fatal/i,
  /\bat\s/,
  /File\s"/,
  /line\s\d+/i,
  /\bFAIL\b/,
  /✗/,
  /×/,
  /\bexpected\b/i,
  /\breceived\b/i,
  /AssertionError/i,
];

function shouldKeep(line: string): boolean {
  return KEEP_PATTERNS.some((p) => p.test(line));
}

/**
 * Filter a log/CLI output string to only the lines that matter.
 * Always preserves the first and last line as context anchors.
 * Deduplicates kept lines.
 * Never returns an empty string.
 */
export function compressLog(text: string): string {
  if (!text) return text;

  const lines = text.split("\n");
  if (lines.length <= 1) return text;

  const first = lines[0]!;
  const last = lines[lines.length - 1]!;

  const kept = lines.filter(shouldKeep);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of [first, ...kept, last]) {
    if (!seen.has(line)) {
      seen.add(line);
      result.push(line);
    }
  }

  return result.filter(Boolean).join("\n") || text;
}
