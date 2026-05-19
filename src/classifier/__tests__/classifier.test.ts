import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyBlock, classifyBlocks } from "../index.js";
import type {
  Classification,
  ClassifierConfig,
  UnclassifiedBlock,
} from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Fixture = {
  input: UnclassifiedBlock;
  config: ClassifierConfig;
  expected: Classification | null;
};

function loadFixture(name: string): Fixture {
  const path = resolve(__dirname, "fixtures", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf-8")) as Fixture;
}

const FIXTURES = [
  "01_system_prompt",
  "02_tool_schema",
  "03_claude_md",
  "04_project_rules",
  "05_prior_turn",
  "06_tool_use_result_pair",
  "07_file_read",
  "08_retrieval_result",
  "09_tool_output",
  "10_user_message",
  "11_stub",
  "12_pin_promotes_volatile",
  "13_exclude_filters",
  "14_default_fallback",
  "15_sliding_window_n_minus_2",
  "16_sliding_window_out",
  "17_file_read_missing_mtime_degrades",
  "18_current_turn_assistant",
];

describe.each(FIXTURES)("classifier fixture %s", (name) => {
  const { input, config, expected } = loadFixture(name);
  it("matches expected classification", () => {
    expect(classifyBlock(input, config)).toEqual(expected);
  });
});

describe("classifyBlocks", () => {
  const config: ClassifierConfig = {
    pin: [],
    exclude: ["**/.env*"],
    sliding_window_turns: 4,
  };

  it("preserves input order for non-excluded entries", () => {
    const inputs: UnclassifiedBlock[] = [
      { content: "system text", role: "system", turnNumber: 0, currentTurn: 0 },
      {
        content: "Hello",
        role: "user",
        turnNumber: 0,
        currentTurn: 0,
      },
      {
        content: "code",
        role: "tool",
        toolName: "Read",
        filePath: "/repo/a.ts",
        mtimeMs: 1700000000000,
        turnNumber: 0,
        currentTurn: 0,
      },
    ];
    const result = classifyBlocks(inputs, config);
    expect(result.map((c) => c.kind)).toEqual([
      "system_prompt",
      "user_message",
      "file_read",
    ]);
  });

  it("drops excluded entries from output", () => {
    const inputs: UnclassifiedBlock[] = [
      {
        content: "keep me",
        role: "user",
        turnNumber: 0,
        currentTurn: 0,
      },
      {
        content: "drop me",
        role: "tool",
        toolName: "Read",
        filePath: "/repo/.env",
        mtimeMs: 1700000000000,
        turnNumber: 0,
        currentTurn: 0,
      },
      {
        content: "keep me too",
        role: "user",
        turnNumber: 0,
        currentTurn: 0,
      },
    ];
    const result = classifyBlocks(inputs, config);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.kind === "user_message")).toBe(true);
  });
});

describe("fail-open", () => {
  it("returns VOLATILE when an internal error occurs", () => {
    const badConfig = {
      pin: null,
      exclude: [],
      sliding_window_turns: 4,
    } as unknown as ClassifierConfig;
    const result = classifyBlock(
      {
        content: "anything",
        role: "user",
        filePath: "/repo/foo.txt",
        turnNumber: 0,
        currentTurn: 0,
      },
      badConfig,
    );
    expect(result).toEqual({
      kind: "user_message",
      volatility: "VOLATILE",
      isPinned: false,
      signals: ["error:fallback"],
    });
  });

  it("returns a fresh fallback object so callers cannot leak mutations", () => {
    // Copilot review: returning a shared module-level constant means a caller
    // who mutates result.signals leaks the change into all later fallbacks.
    const badConfig = {
      pin: null,
      exclude: [],
      sliding_window_turns: 4,
    } as unknown as ClassifierConfig;
    const input = {
      content: "x",
      role: "user" as const,
      filePath: "/repo/foo",
      turnNumber: 0,
      currentTurn: 0,
    };
    const a = classifyBlock(input, badConfig);
    const b = classifyBlock(input, badConfig);
    expect(a).not.toBe(b);
    expect(a?.signals).not.toBe(b?.signals);
    (a?.signals as string[] | undefined)?.push("mutated");
    expect(b?.signals).toEqual(["error:fallback"]);
  });
});

describe("tool_schema rule precedence (Copilot review)", () => {
  it("does not misclassify a file_read of a JSON file with name + input_schema keys", () => {
    // A Read tool result returning JSON content that happens to have top-level
    // `name` and `input_schema` keys must NOT land in the STABLE prefix as a
    // tool_schema. That would put mutable file contents into the cached prefix.
    // The tool_schema rule should only fire when the caller has marked the
    // block with kindHint: "tool_schema" (i.e. it came from the API tools[]
    // field), not from a tool_result.
    const config: ClassifierConfig = {
      pin: [],
      exclude: [],
      sliding_window_turns: 4,
    };
    const result = classifyBlock(
      {
        content: '{"name":"thing","input_schema":{"type":"object"}}',
        role: "tool",
        toolName: "Read",
        filePath: "/repo/schemas/thing.json",
        mtimeMs: 1700000000000,
        turnNumber: 1,
        currentTurn: 1,
      },
      config,
    );
    expect(result?.kind).toBe("file_read");
    expect(result?.volatility).toBe("SEMI");
  });
});
