import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadScenarioSpecs, validateScenarioSpec } from "../scenarios.js";

function scenario(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "read-file",
    title: "Read File",
    description: "Read one file and summarize it.",
    prompt: "Summarize src/a.ts.",
    workspace_files: [{ path: "src/a.ts", content: "export const value = 1;" }],
    expected_references: ["src/a.ts"],
    tags: ["read"],
    ...overrides,
  };
}

describe("agent trace scenarios", () => {
  it("validates required scenario fields", () => {
    expect(() => validateScenarioSpec(scenario({ prompt: "" }))).toThrow(
      "prompt must be a non-empty string",
    );
  });

  it("rejects unstable scenario ids", () => {
    expect(() => validateScenarioSpec(scenario({ id: "Read File!" }))).toThrow(
      "id must be stable kebab-case",
    );
  });

  it("loads scenarios in filename order and rejects duplicate ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "cachelane-scenarios-"));
    writeFileSync(join(dir, "02-second.json"), JSON.stringify(scenario({ id: "second" })));
    writeFileSync(join(dir, "01-first.json"), JSON.stringify(scenario({ id: "first" })));

    expect(loadScenarioSpecs(dir).map((spec) => spec.id)).toEqual(["first", "second"]);

    writeFileSync(join(dir, "03-duplicate.json"), JSON.stringify(scenario({ id: "first" })));
    expect(() => loadScenarioSpecs(dir)).toThrow("duplicate scenario id first");
  });
});

describe("validateScenarioSpec turns", () => {
  const base = {
    id: "multi-turn-demo",
    title: "Demo",
    description: "d",
    workspace_files: [],
  };

  it("defaults turns from a single prompt", () => {
    const spec = validateScenarioSpec({ ...base, prompt: "do the thing" });
    expect(spec.turns).toEqual(["do the thing"]);
    expect(spec.prompt).toBe("do the thing");
  });

  it("accepts an explicit turns array and sets prompt to turns[0]", () => {
    const spec = validateScenarioSpec({ ...base, turns: ["first", "second"] });
    expect(spec.turns).toEqual(["first", "second"]);
    expect(spec.prompt).toBe("first");
  });

  it("rejects a scenario with neither prompt nor turns", () => {
    expect(() => validateScenarioSpec({ ...base })).toThrow(/prompt or turns/);
  });

  it("rejects an empty turns array", () => {
    expect(() => validateScenarioSpec({ ...base, turns: [] })).toThrow(/turns/);
  });
});
