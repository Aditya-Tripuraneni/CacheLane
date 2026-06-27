import { describe, it, expect } from "vitest";
import { matchProfile } from "../shell-profiles.js";
import { compressShell } from "../shell-compress.js";

describe("matchProfile", () => {
  it("matches `git status` to the git-status profile", () => {
    expect(matchProfile("git status")?.id).toBe("git-status");
  });

  it("returns null for an unknown command", () => {
    expect(matchProfile("cowsay hi")).toBeNull();
  });
});

describe("git-status profile", () => {
  const raw = [
    "On branch main",
    "Changes to be committed:",
    "\tmodified:   src/a.ts",
    "Changes not staged for commit:",
    "\tmodified:   src/b.ts",
    "Untracked files:",
    "\tsrc/c.ts",
  ].join("\n");

  it("summarizes counts by category", () => {
    const out = matchProfile("git status")!.run(raw, 0);
    expect(out).toBe("staged: 1 (src/), modified: 1 (src/), untracked: 1 (src/)");
  });

  it("is deterministic across repeated runs", () => {
    const a = matchProfile("git status")!.run(raw, 0);
    const b = matchProfile("git status")!.run(raw, 0);
    expect(a).toBe(b);
  });
});

describe.each([
  {
    id: "git-diff",
    command: "git diff",
    raw: "diff --git a/src/a.ts b/src/a.ts\n@@ -1,2 +1,3 @@\n+added\n-removed\n context",
    expected: "src/a.ts: +1 -1",
  },
  {
    id: "git-log",
    command: "git log -n 2",
    raw: "commit abc1234\nAuthor: Jane <j@x.io>\n\n    Fix bug\n\ncommit def5678\nAuthor: Bob <b@x.io>\n\n    Add thing",
    expected: "abc1234 Fix bug (Jane)\ndef5678 Add thing (Bob)",
  },
  {
    id: "pkg-install",
    command: "npm install",
    raw: "npm warn deprecated foo@1.0.0\nadded 42 packages in 3s\nnpm fund ...",
    expected: "added 42 packages\nwarn deprecated foo@1.0.0",
  },
  {
    id: "test-run",
    command: "vitest run",
    raw: "✓ a.test.ts > works\n✗ b.test.ts > fails\n  expected 1 received 2\nTests 1 failed | 1 passed",
    expected: "1 failed, 1 passed\n✗ b.test.ts > fails\n  expected 1 received 2",
  },
  {
    id: "build",
    command: "tsc",
    raw: "src/a.ts(3,5): error TS2322: Type error\nsrc/a.ts(9,1): error TS1005: ; expected\nDone.",
    expected: "src/a.ts:\n  (3,5) error TS2322: Type error\n  (9,1) error TS1005: ; expected",
  },
])("$id profile", ({ id, command, raw, expected }) => {
  it("produces the expected summary", () => {
    expect(matchProfile(command)!.run(raw, 1)).toBe(expected);
  });
  it("matches its command", () => {
    expect(matchProfile(command)!.id).toBe(id);
  });
  it("is deterministic", () => {
    expect(matchProfile(command)!.run(raw, 1)).toBe(matchProfile(command)!.run(raw, 1));
  });
});

describe("compressShell", () => {
  it("returns null when the command has no matching profile", () => {
    expect(compressShell({ tool_use_id: "t1", content: "x", mode: "balanced", json_max_array_items: 20, command: "cowsay" })).toBeNull();
  });

  it("returns null when no command is present", () => {
    expect(compressShell({ tool_use_id: "t1", content: "x", mode: "balanced", json_max_array_items: 20 })).toBeNull();
  });

  it("compresses git status and reports the profile id", () => {
    const result = compressShell({
      tool_use_id: "t1",
      content: "On branch main\nUntracked files:\n\tsrc/c.ts",
      mode: "balanced",
      json_max_array_items: 20,
      command: "git status",
      exit_code: 0,
    });
    expect(result?.profile_id).toBe("git-status");
    expect(result?.output.content_type).toBe("shell");
    expect(result?.output.lossiness).toBe("lossy");
  });
});
