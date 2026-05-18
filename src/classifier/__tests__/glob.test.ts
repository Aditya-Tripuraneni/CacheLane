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
});
