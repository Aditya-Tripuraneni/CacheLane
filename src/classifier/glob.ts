function escapeForRegExp(literal: string): string {
  return literal.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function patternToRegExp(pattern: string): RegExp {
  let body = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        // `**/` matches zero or more path segments, preserving the segment
        // boundary so `**/CLAUDE.md` does not match `MY_CLAUDE.md`.
        body += "(?:.*/)?";
        i += 3;
      } else {
        body += ".*";
        i += 2;
      }
      continue;
    }
    if (ch === "*") {
      body += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      // Single non-separator wildcard — matches user expectation from
      // bash/minimatch globs (e.g. `src/foo?.ts` matches `foo1.ts`).
      body += "[^/]";
      i += 1;
      continue;
    }
    body += escapeForRegExp(ch);
    i += 1;
  }
  return new RegExp(`^${body}$`);
}

export function globMatch(pattern: string, path: string): boolean {
  if (typeof pattern !== "string" || typeof path !== "string") {
    return false;
  }
  try {
    return patternToRegExp(pattern).test(path);
  } catch {
    // Malformed pattern — treat as no match. Intentional silence: the
    // classifier is fail-open by design and a bad glob in user config
    // should not crash the whole pipeline.
    return false;
  }
}
