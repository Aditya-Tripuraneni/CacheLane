import { describe, it, expect, vi } from "vitest";
import { handleHookMutate } from "../hook-mutate.js";

// Mock the paths and database to avoid hitting the actual file system
vi.mock("../paths.js", () => ({
  cachelaneDbPath: vi.fn(() => ":memory:"),
  cachelaneConfigPath: vi.fn(() => "dummy-config.json"),
}));

vi.mock("../../config/index.js", () => ({
  loadConfig: vi.fn(() => ({
    features: { mutation_enabled: true },
    pruner: { enabled: true, k: 3 }
  })),
  defaultWorkspaceId: vi.fn(() => "default")
}));

vi.mock("../../storage/index.js", () => ({
  openDatabase: vi.fn(() => ({
    close: vi.fn(),
  })),
}));

describe("hook-mutate", () => {
  it("should return undefined if prompt is not present in payload", async () => {
    const result = await handleHookMutate({}, { session_id: "test" });
    expect(result).toBeUndefined();
  });

  it("should return the mutated string if mutation is enabled", async () => {
    const result = await handleHookMutate({}, { prompt: "Hello world" });
    expect(result).toBe("Hello world\n\n[CacheLane: Pruning active... (AWS Hook Mode)]");
  });

  // Note: Once actual mutation logic is implemented in handleHookMutate,
  // we would add a test here to verify the prompt is correctly modified.
});
