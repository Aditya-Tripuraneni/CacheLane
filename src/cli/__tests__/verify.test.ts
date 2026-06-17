import { describe, it, expect } from "vitest";
import { runVerify } from "../verify.js";

describe("runVerify (offline)", () => {
  it("passes all core checks on a healthy synthetic session", () => {
    const report = runVerify();
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c.ok]));
    expect(byName["mutates"]).toBe(true);
    expect(byName["stubs"]).toBe(true);
    expect(byName["rehydrates"]).toBe(true);
    expect(byName["fail_open"]).toBe(true);
    expect(report.ok).toBe(true);
  });
});
