export type ShellProfile = (rawOutput: string, exitCode: number | undefined) => string;

export const SHELL_PROFILE_IDS = [
  "git-status",
  "git-diff",
  "git-log",
  "pkg-install",
  "test-run",
  "build",
] as const;

function topDir(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "./" : `${path.slice(0, slash)}/`;
}

function gitStatus(rawOutput: string): string {
  const lines = rawOutput.split("\n");
  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];
  let section: "staged" | "modified" | "untracked" | null = null;

  for (const line of lines) {
    if (line.startsWith("Changes to be committed")) { section = "staged"; continue; }
    if (line.startsWith("Changes not staged")) { section = "modified"; continue; }
    if (line.startsWith("Untracked files")) { section = "untracked"; continue; }
    const m = line.match(/^\t(?:[a-z ]+:\s+)?(.+)$/);
    if (!m || section === null) continue;
    const path = m[1]!.trim();
    if (section === "staged") staged.push(path);
    else if (section === "modified") modified.push(path);
    else untracked.push(path);
  }

  const fmt = (label: string, items: string[]): string | null => {
    if (items.length === 0) return null;
    const dirs = [...new Set(items.map(topDir))].sort();
    return `${label}: ${items.length} (${dirs.join(", ")})`;
  };

  return [fmt("staged", staged), fmt("modified", modified), fmt("untracked", untracked)]
    .filter((s): s is string => s !== null)
    .join(", ");
}

function gitDiff(rawOutput: string): string {
  const lines = rawOutput.split("\n");
  const perFile = new Map<string, { adds: number; dels: number }>();
  let current: string | null = null;
  for (const line of lines) {
    const fileMatch = line.match(/^diff --git a\/(\S+) b\/\S+/);
    if (fileMatch) { current = fileMatch[1]!; perFile.set(current, { adds: 0, dels: 0 }); continue; }
    if (current === null) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) perFile.get(current)!.adds++;
    else if (line.startsWith("-") && !line.startsWith("---")) perFile.get(current)!.dels++;
  }
  return [...perFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, { adds, dels }]) => `${file}: +${adds} -${dels}`)
    .join("\n");
}

function gitLog(rawOutput: string): string {
  const commits: string[] = [];
  const blocks = rawOutput.split(/^commit /m).filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    const sha = block.slice(0, 7);
    const authorMatch = block.match(/^Author:\s+([^<]+?)\s*</m);
    const author = authorMatch ? authorMatch[1]!.trim() : "?";
    const bodyLines = block.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
    const subject = bodyLines.find((l) => !l.startsWith("commit") && !l.startsWith("Author:") && !l.startsWith("Date:")) ?? "";
    commits.push(`${sha} ${subject} (${author})`);
  }
  return commits.join("\n");
}

function pkgInstall(rawOutput: string): string {
  const lines = rawOutput.split("\n");
  const added = lines.find((l) => /added \d+ package/.test(l));
  const summary = added ? added.replace(/ in .*$/, "").trim() : "";
  const warns = lines
    .filter((l) => /\b(warn|error)\b/i.test(l))
    .map((l) => l.replace(/^npm\s+/, "").trim());
  return [summary, ...new Set(warns)].filter(Boolean).join("\n");
}

function testRun(rawOutput: string): string {
  const lines = rawOutput.split("\n");
  const tally = lines.find((l) => /\d+\s+(failed|passed)/i.test(l));
  const failedMatch = tally?.match(/(\d+)\s+failed/i);
  const passedMatch = tally?.match(/(\d+)\s+passed/i);
  const header = `${failedMatch ? failedMatch[1] : 0} failed, ${passedMatch ? passedMatch[1] : 0} passed`;
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^[✗×]/.test(line.trim())) {
      failures.push(line.trim());
      const next = lines[i + 1];
      if (next && /expected|received|assert/i.test(next)) failures.push(`  ${next.trim()}`);
    }
  }
  return [header, ...failures].join("\n");
}

function build(rawOutput: string): string {
  const byFile = new Map<string, string[]>();
  for (const line of rawOutput.split("\n")) {
    const m = line.match(/^(\S+?)\((\d+),(\d+)\):\s+(error.*)$/);
    if (!m) continue;
    const [, file, row, col, msg] = m;
    if (!byFile.has(file!)) byFile.set(file!, []);
    byFile.get(file!)!.push(`  (${row},${col}) ${msg}`);
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, errs]) => `${file}:\n${errs.join("\n")}`)
    .join("\n");
}

const PROFILES: { id: string; matches: RegExp; run: ShellProfile }[] = [
  { id: "git-status", matches: /^git\s+status\b/, run: (raw) => gitStatus(raw) },
  { id: "git-diff", matches: /^git\s+diff\b/, run: (raw) => gitDiff(raw) },
  { id: "git-log", matches: /^git\s+log\b/, run: (raw) => gitLog(raw) },
  { id: "pkg-install", matches: /^(npm|pnpm|yarn)\s+(install|i|ci)\b/, run: (raw) => pkgInstall(raw) },
  { id: "test-run", matches: /^(jest|vitest|pytest)\b/, run: (raw) => testRun(raw) },
  { id: "build", matches: /^(tsc|next\s+build|webpack)\b/, run: (raw) => build(raw) },
];

export function matchProfile(command: string): { id: string; run: ShellProfile } | null {
  const trimmed = command.trim();
  const found = PROFILES.find((p) => p.matches.test(trimmed));
  return found ? { id: found.id, run: found.run } : null;
}
