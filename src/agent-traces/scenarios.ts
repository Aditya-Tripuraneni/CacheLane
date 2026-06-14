import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ScenarioSpec, ScenarioWorkspaceFile } from "./types.js";

export const DEFAULT_SCENARIO_DIR = resolve(process.cwd(), "benchmark", "scenarios");
export const SCENARIO_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string, source: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${source}: ${field} must be a non-empty string`);
  }
  return value;
}

function readStringArray(value: unknown, field: string, source: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${source}: ${field} must be an array`);
  }
  return value.map((entry, index) => readString(entry, `${field}[${index}]`, source));
}

function readWorkspaceFiles(value: unknown, source: string): ScenarioWorkspaceFile[] {
  if (!Array.isArray(value)) {
    throw new Error(`${source}: workspace_files must be an array`);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`${source}: workspace_files[${index}] must be an object`);
    }
    return {
      path: readString(entry.path, `workspace_files[${index}].path`, source),
      content: readString(entry.content, `workspace_files[${index}].content`, source),
    };
  });
}

export function validateScenarioSpec(input: unknown, source = "scenario"): ScenarioSpec {
  if (!isRecord(input)) {
    throw new Error(`${source}: scenario must be an object`);
  }

  const id = readString(input.id, "id", source);
  if (!SCENARIO_ID_PATTERN.test(id)) {
    throw new Error(`${source}: id must be stable kebab-case`);
  }

  const hasPrompt = input.prompt !== undefined;
  const hasTurns = Array.isArray(input.turns);
  if (!hasPrompt && !hasTurns) {
    throw new Error(`${source}: scenario must define prompt or turns`);
  }

  const turns = hasTurns
    ? readStringArray(input.turns, "turns", source)
    : [readString(input.prompt, "prompt", source)];
  const firstTurn = turns[0];
  if (firstTurn === undefined) {
    throw new Error(`${source}: turns must contain at least one prompt`);
  }

  return {
    id,
    title: readString(input.title, "title", source),
    description: readString(input.description, "description", source),
    prompt: firstTurn,
    turns,
    workspace_files: readWorkspaceFiles(input.workspace_files, source),
    expected_references: input.expected_references
      ? readStringArray(input.expected_references, "expected_references", source)
      : [],
    tags: input.tags ? readStringArray(input.tags, "tags", source) : [],
  };
}

export function loadScenarioSpecs(dir = DEFAULT_SCENARIO_DIR): ScenarioSpec[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  const seen = new Set<string>();
  return files.map((file) => {
    const path = resolve(dir, file);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const scenario = validateScenarioSpec(parsed, path);
    if (seen.has(scenario.id)) {
      throw new Error(`${path}: duplicate scenario id ${scenario.id}`);
    }
    seen.add(scenario.id);
    return scenario;
  });
}

export function selectScenarios(scenarios: ScenarioSpec[], count?: number): ScenarioSpec[] {
  if (count === undefined) return scenarios;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("count must be a positive integer");
  }
  if (count > scenarios.length) {
    throw new Error(`count ${count} exceeds available scenarios ${scenarios.length}`);
  }
  return scenarios.slice(0, count);
}
