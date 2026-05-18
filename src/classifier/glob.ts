function escapeForRegExp(literal: string): string {
  return literal.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function patternToRegExp(pattern: string): RegExp {
  let body = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      const sep = pattern[i + 2] === "/" ? 3 : 2;
      body += ".*";
      i += sep;
      continue;
    }
    if (ch === "*") {
      body += "[^/]*";
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
    return false;
  }
}
