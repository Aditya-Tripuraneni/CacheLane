import { describe, expect, it } from "vitest";
import { globMatch } from "../glob.js";

describe("globMatch", () => {
  it("matches a literal path exactly", () => {
    expect(globMatch("/repo/CLAUDE.md", "/repo/CLAUDE.md")).toBe(true);
    expect(globMatch("/repo/CLAUDE.md", "/repo/other.md")).toBe(false);
  });

  it("matches a single * within one path segment", () => {
    expect(globMatch("/repo/*.ts", "/repo/foo.ts")).toBe(true);
    expect(globMatch("/repo/*.ts", "/repo/sub/foo.ts")).toBe(false);
  });

  it("matches ** across zero path segments", () => {
    expect(globMatch("**/CLAUDE.md", "CLAUDE.md")).toBe(true);
  });

  it("matches ** across multiple path segments", () => {
    expect(globMatch("**/CLAUDE.md", "/repo/sub/dir/CLAUDE.md")).toBe(true);
    expect(globMatch("**/*.env*", "/repo/cfg/.env.local")).toBe(true);
  });

  it("returns false on no match", () => {
    expect(globMatch("**/*.ts", "/repo/foo.md")).toBe(false);
  });

  it("returns false on invalid pattern without throwing", () => {
    expect(globMatch(null as unknown as string, "/repo/foo")).toBe(false);
  });

  it("**/ requires a path-segment boundary (does not match a basename suffix)", () => {
    // Copilot review: `^.*CLAUDE\.md$` wrongly matches `MY_CLAUDE.md`.
    // The `**/` translation must preserve the segment boundary while still
    // allowing zero directories (the basename-only case is already covered above).
    expect(globMatch("**/CLAUDE.md", "MY_CLAUDE.md")).toBe(false);
    expect(globMatch("**/CLAUDE.md", "/repo/sub/MY_CLAUDE.md")).toBe(false);
    expect(globMatch("**/.env", "/repo/my.env")).toBe(false);
  });

  it("? matches a single non-separator character (wildcard, not literal)", () => {
    // Aditya review (CH-006): `?` should be the bash/minimatch
    // single-char wildcard so user-supplied pins like `src/foo?.ts`
    // match `foo1.ts`, `foo2.ts`. Crucially `?` is NOT a regex
    // quantifier here — it consumes one non-separator char.
    expect(globMatch("file?.ts", "file.ts")).toBe(false);   // no char to match
    expect(globMatch("file?.ts", "fileX.ts")).toBe(true);   // X matches ?
    expect(globMatch("file?.ts", "file?.ts")).toBe(true);   // literal ? also matches
    expect(globMatch("file?.ts", "fileXY.ts")).toBe(false); // too many chars
    expect(globMatch("file?.ts", "file/X.ts")).toBe(false); // ? does not cross /
  });
});
