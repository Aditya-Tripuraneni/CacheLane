import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CacheStateTracker, orchestrate } from "../index.js";
import type {
  OrchestratorInput,
  PrefixState,
} from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Fixture = {
  input: OrchestratorInput;
  prev_state: PrefixState | null;
};

function loadFixture(name: string): Fixture {
  const path = resolve(__dirname, "fixtures", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf-8")) as Fixture;
}

const SCENARIOS = [
  "scenario-1-empty-schemas",
  "scenario-2-large-schemas",
  "scenario-3-middle-included",
  "scenario-4-middle-empty",
  "scenario-5-stub-just-created",
];

// REQ-NF-010, AC-1, AC-3: same logical input produced through 3 consecutive runs
// must yield byte-identical prefix bytes. We assert via SHA-256 equality across
// 3 runs for each of the 5 AC-2 scenarios. Failure blocks merge — no exceptions.
describe.each(SCENARIOS)("cache-stability %s", (name) => {
  it("produces byte-identical prefix_hash across 3 runs", () => {
    const fixture = loadFixture(name);
    const hashes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const tracker = new CacheStateTracker();
      if (fixture.prev_state) {
        tracker.update(fixture.input.workspace_id, fixture.prev_state);
      }
      const out = orchestrate(fixture.input, tracker);
      hashes.push(out.prefix_hash);
    }
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[1]).toBe(hashes[2]);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});
