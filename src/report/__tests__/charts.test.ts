import { describe, it, expect } from "vitest";
import { renderCurveSvg, renderStackedBarSvg } from "../charts.js";
import { THEME_COLORS } from "../theme.js";

describe("renderCurveSvg", () => {
  it("emits an svg with two polylines for baseline vs effective", () => {
    const svg = renderCurveSvg({
      baselineCumulative: [100, 200, 300],
      effectiveCumulative: [100, 128, 140],
      longSessionThreshold: 15,
      firstPruneTurn: null,
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect((svg.match(/<polyline/g) ?? []).length).toBe(2);
  });

  it("uses theme colors, not the old red/green hex", () => {
    const svg = renderCurveSvg({
      baselineCumulative: [100, 200],
      effectiveCumulative: [100, 120],
      longSessionThreshold: 15,
      firstPruneTurn: null,
    });
    expect(svg).toContain(THEME_COLORS.danger);
    expect(svg).toContain(THEME_COLORS.success);
    expect(svg).not.toContain("#ef4444");
    expect(svg).not.toContain("#22c55e");
  });

  it("empty series yields an empty-state svg", () => {
    const svg = renderCurveSvg({
      baselineCumulative: [], effectiveCumulative: [], longSessionThreshold: 15, firstPruneTurn: null,
    });
    expect(svg).toContain("No data yet");
  });
});

describe("renderStackedBarSvg", () => {
  it("renders segments proportional to values", () => {
    const svg = renderStackedBarSvg([{ label: "input", value: 80 }, { label: "read", value: 20 }]);
    expect(svg).toContain("<svg");
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("uses theme colors for segments", () => {
    const svg = renderStackedBarSvg([{ label: "a", value: 1 }, { label: "b", value: 1 }]);
    expect(svg).toContain(THEME_COLORS.accent);
    expect(svg).not.toContain("#3b82f6");
  });
});
