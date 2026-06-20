import { describe, it, expect } from "vitest";
import {
  percentile,
  summarizeArm,
  buildMessagesBody,
  measureTtft,
  runLatencyAb,
  type TtftTransport,
} from "../latency-ab.js";
import type { ScenarioSpec } from "../../agent-traces/types.js";

function scenario(overrides: Partial<ScenarioSpec> = {}): ScenarioSpec {
  return {
    id: "demo",
    title: "Demo",
    description: "d",
    prompt: "first turn",
    turns: ["first turn", "second turn"],
    workspace_files: [{ path: "a.ts", content: "export const x = 1;" }],
    expected_references: [],
    tags: [],
    ...overrides,
  };
}

describe("percentile", () => {
  it("returns the only sample for a single-element set", () => {
    expect(percentile([42], 50)).toBe(42);
  });

  it("computes p50 as the lower-mid of a sorted set", () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
  });

  it("computes p95 near the top of the set", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });

  it("is order-independent (sorts internally)", () => {
    expect(percentile([30, 10, 40, 20], 50)).toBe(20);
  });

  it("returns 0 for an empty set", () => {
    expect(percentile([], 50)).toBe(0);
  });
});

describe("summarizeArm", () => {
  it("reports p50, p95, and sample count", () => {
    const s = summarizeArm([10, 20, 30, 40, 50]);
    expect(s.samples).toBe(5);
    expect(s.ttft_p50_ms).toBe(30);
    expect(s.ttft_p95_ms).toBe(50);
  });
});

describe("buildMessagesBody", () => {
  it("includes all turns up to and including turnIndex (cumulative context)", () => {
    const body = buildMessagesBody(scenario(), 1, "claude-sonnet-4-6", { stream: true });
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.stream).toBe(true);
    const userTexts = body.messages.map((m) => m.content);
    expect(userTexts).toEqual(["first turn", "second turn"]);
  });

  it("includes only the first turn at turnIndex 0", () => {
    const body = buildMessagesBody(scenario(), 0, "claude-sonnet-4-6", { stream: true });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.content).toBe("first turn");
  });

  it("embeds workspace file content in the system prompt", () => {
    const body = buildMessagesBody(scenario(), 0, "claude-sonnet-4-6", { stream: true });
    expect(JSON.stringify(body.system)).toContain("export const x = 1;");
  });
});

describe("measureTtft", () => {
  it("returns elapsed ms from request to first streamed byte", async () => {
    let clock = 1000;
    const now = () => clock;
    const transport: TtftTransport = async () => {
      // first byte arrives 37ms after the call
      clock += 37;
      return {
        async *chunks() {
          yield new Uint8Array([1, 2, 3]);
        },
      };
    };
    const body = buildMessagesBody(scenario(), 0, "claude-sonnet-4-6", { stream: true });
    const ms = await measureTtft("http://x", {}, body, transport, now);
    expect(ms).toBe(37);
  });
});

describe("runLatencyAb", () => {
  it("produces a report with both arms, repeats, and a delta", async () => {
    let clock = 0;
    const now = () => clock;
    // treatment (proxy url) is faster than control by a fixed margin
    const transport: TtftTransport = async (url) => {
      const isProxy = url.includes("127.0.0.1");
      clock += isProxy ? 10 : 30;
      return {
        async *chunks() {
          yield new Uint8Array([0]);
        },
      };
    };
    const report = await runLatencyAb(
      {
        scenarios: [scenario()],
        repeats: 2,
        model: "claude-sonnet-4-6",
        proxyUrl: "http://127.0.0.1:7332/v1/messages",
        controlUrl: "https://api.anthropic.com/v1/messages",
        apiKey: "sk-test",
      },
      { transport, now },
    );

    expect(report.repeats).toBe(2);
    expect(report.scenario_count).toBe(1);
    expect(report.treatment.samples).toBe(4); // 2 turns * 2 repeats
    expect(report.control.samples).toBe(4);
    expect(report.treatment.ttft_p50_ms).toBe(10);
    expect(report.control.ttft_p50_ms).toBe(30);
    expect(report.delta_p50_ms).toBe(20); // control - treatment, treatment faster
    expect(report.samples.length).toBe(8);
  });

  it("records a failed turn as an error sample without aborting the run", async () => {
    let clock = 0;
    const now = () => clock;
    const transport: TtftTransport = async (url) => {
      if (url.includes("127.0.0.1")) {
        throw new Error("proxy down");
      }
      clock += 5;
      return {
        async *chunks() {
          yield new Uint8Array([0]);
        },
      };
    };
    const report = await runLatencyAb(
      {
        scenarios: [scenario({ turns: ["only"] })],
        repeats: 1,
        model: "claude-sonnet-4-6",
        proxyUrl: "http://127.0.0.1:7332/v1/messages",
        controlUrl: "https://api.anthropic.com/v1/messages",
        apiKey: "sk-test",
      },
      { transport, now },
    );

    expect(report.control.samples).toBe(1);
    expect(report.treatment.samples).toBe(0);
    const errs = report.samples.filter((s) => s.error);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.arm).toBe("treatment");
  });
});
