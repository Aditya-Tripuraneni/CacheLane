import { describe, it, expect } from "vitest";
import { CACHELANE_REPORT_CSS, THEME_COLORS, pageShell } from "../theme.js";

describe("CACHELANE_REPORT_CSS", () => {
  it("uses the warm web/ palette, not the old dark theme", () => {
    expect(CACHELANE_REPORT_CSS).toContain("--color-accent");
    expect(CACHELANE_REPORT_CSS).toContain("oklch(");
    expect(CACHELANE_REPORT_CSS).not.toContain("#0b0d12");
    expect(CACHELANE_REPORT_CSS).not.toContain("color-scheme: light dark");
  });

  it("references no external resources", () => {
    expect(CACHELANE_REPORT_CSS).not.toMatch(/https?:\/\//);
    expect(CACHELANE_REPORT_CSS).not.toContain("@import");
  });
});

describe("THEME_COLORS", () => {
  it("exposes chart colors as oklch tokens", () => {
    expect(THEME_COLORS.danger).toContain("oklch(");
    expect(THEME_COLORS.success).toContain("oklch(");
    expect(THEME_COLORS.accent).toContain("oklch(");
  });
});

describe("pageShell", () => {
  const tabs = [
    { id: "alpha", label: "Alpha", html: "<p>alpha body</p>" },
    { id: "beta", label: "Beta", html: "<p>beta body</p>" },
  ];

  it("wraps tabs in a self-contained, content-free document", () => {
    const html = pageShell({ title: "T", subtitle: "S", tabs });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('name="cachelane:content_persisted" content="false"');
    expect(html).toContain(CACHELANE_REPORT_CSS);
    expect(html).toContain("<p>alpha body</p>");
    expect(html).toContain("<p>beta body</p>");
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("emits one radio per tab with only the first checked", () => {
    const html = pageShell({ title: "T", subtitle: "S", tabs });
    expect(html).toContain('id="t-alpha" class="tab-radio" checked');
    expect(html).toContain('id="t-beta" class="tab-radio"');
    expect(html).not.toContain('id="t-beta" class="tab-radio" checked');
  });

  it("emits a label button and a panel per tab", () => {
    const html = pageShell({ title: "T", subtitle: "S", tabs });
    expect(html).toContain('<label for="t-alpha" class="tab-label">Alpha</label>');
    expect(html).toContain('<label for="t-beta" class="tab-label">Beta</label>');
    expect(html).toContain('<section class="tab-panel" id="p-alpha">');
    expect(html).toContain('<section class="tab-panel" id="p-beta">');
  });

  it("emits a generated :checked rule that reveals each panel", () => {
    const html = pageShell({ title: "T", subtitle: "S", tabs });
    expect(html).toContain("#t-alpha:checked ~ #p-alpha");
    expect(html).toContain("#t-beta:checked ~ #p-beta");
  });

  it("renders an optional footer once, below the panels", () => {
    const html = pageShell({ title: "T", subtitle: "S", tabs, footerHtml: "<footer>fin</footer>" });
    expect(html).toContain("<footer>fin</footer>");
    const panelIdx = html.indexOf('id="p-beta"');
    const footerIdx = html.indexOf("<footer>fin</footer>");
    expect(footerIdx).toBeGreaterThan(panelIdx);
  });

  it("escapes HTML special characters in title and subtitle", () => {
    const html = pageShell({ title: "<a>&\"x\"", subtitle: "b<c>&d", tabs });
    expect(html).toContain("&lt;a&gt;&amp;&quot;x&quot;");
    expect(html).toContain("b&lt;c&gt;&amp;d");
    expect(html).not.toContain("<a>");
  });
});
