function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Chart-facing tokens (oklch, ported from web/app/globals.css).
export const THEME_COLORS = {
  accent: "oklch(0.55 0.17 40)", // Crail rust
  success: "oklch(0.48 0.045 145)", // sage green
  danger: "oklch(0.38 0.100 35)", // deep rust-brown
  warn: "oklch(0.48 0.070 50)",
  fgFaint: "oklch(0.55 0.01 75)",
  border: "oklch(0.90 0.005 75)",
  bgElev: "oklch(1 0 0)",
} as const;

// Design tokens + component styling, ported from web/app/globals.css.
export const CACHELANE_REPORT_CSS = `
:root {
  --color-bg: oklch(0.965 0.005 75);
  --color-bg-elev: oklch(1 0 0);
  --color-bg-inline: oklch(0.93 0.01 75);
  --color-fg: oklch(0.15 0.005 75);
  --color-fg-muted: oklch(0.40 0.01 75);
  --color-fg-faint: oklch(0.55 0.01 75);
  --color-border: oklch(0.90 0.005 75);
  --color-border-strong: oklch(0.75 0.01 75);
  --color-accent: oklch(0.55 0.17 40);
  --color-success: oklch(0.48 0.045 145);
  --color-success-bg: oklch(0.95 0.01 145);
  --color-warn: oklch(0.48 0.070 50);
  --color-danger: oklch(0.38 0.100 35);
  --color-danger-bg: oklch(0.95 0.020 35);
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 32px;
  background: var(--color-bg); color: var(--color-fg);
  font: 14px/1.6 -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-feature-settings: "ss01", "cv11";
  -webkit-font-smoothing: antialiased; letter-spacing: -0.005em;
}
h1 { font-size: 24px; letter-spacing: -0.02em; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 36px 0 8px; letter-spacing: -0.01em; }
.note { color: var(--color-fg-muted); max-width: 760px; }
.cards { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
.card {
  background: var(--color-bg-elev); border: 1px solid var(--color-border);
  border-radius: 12px; padding: 14px 18px; min-width: 130px;
}
.card.danger { border-color: var(--color-danger); }
.card-value { font-size: 22px; font-weight: 700; }
.card-label { color: var(--color-fg-faint); font-size: 12px; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td {
  text-align: left; padding: 7px 10px; font-size: 13px; vertical-align: top;
  border-bottom: 1px solid var(--color-border);
}
th { color: var(--color-fg-muted); font-weight: 600; }
.bar-cell { width: 160px; }
.prunes { color: var(--color-fg-faint); font-size: 12px; }
.badge { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.badge.ok { background: var(--color-success-bg); color: var(--color-success); }
.badge.fail { background: var(--color-danger-bg); color: var(--color-danger); }
.cl-chart {
  width: 100%; max-width: 760px; margin-top: 8px;
  background: var(--color-bg-elev); border: 1px solid var(--color-border); border-radius: 12px;
}
section { margin-top: 8px; }
footer { margin-top: 36px; color: var(--color-fg-faint); font-size: 12px; }
.tab-radio { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 16px; border-bottom: 1px solid var(--color-border); }
.tab-label { padding: 8px 14px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--color-fg-muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tab-label:hover { color: var(--color-fg); }
.tab-panel { display: none; }
`.trim();

export interface PageTab {
  id: string;
  label: string;
  html: string;
}

export interface PageShellOptions {
  title: string;
  subtitle: string;
  tabs: PageTab[];
  footerHtml?: string;
}

export function pageShell(opts: PageShellOptions): string {
  const radios = opts.tabs
    .map((t, i) => `<input type="radio" name="cl-tab" id="t-${esc(t.id)}" class="tab-radio"${i === 0 ? " checked" : ""}>`)
    .join("\n");
  const labels = opts.tabs
    .map((t) => `<label for="t-${esc(t.id)}" class="tab-label">${esc(t.label)}</label>`)
    .join("\n");
  const panels = opts.tabs
    .map((t) => `<section class="tab-panel" id="p-${esc(t.id)}">${t.html}</section>`)
    .join("\n");
  const tabRules = opts.tabs
    .map(
      (t) =>
        `#t-${esc(t.id)}:checked ~ .tabs label[for="t-${esc(t.id)}"] { color: var(--color-accent); border-bottom-color: var(--color-accent); }\n` +
        `#t-${esc(t.id)}:checked ~ #p-${esc(t.id)} { display: block; }`,
    )
    .join("\n");
  const footer = opts.footerHtml ?? "";
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="cachelane:content_persisted" content="false">
<title>${esc(opts.title)}</title>
<style>${CACHELANE_REPORT_CSS}
${tabRules}</style>
</head><body>
<h1>${esc(opts.title)}</h1>
<div class="note">${esc(opts.subtitle)}</div>
${radios}
<nav class="tabs">
${labels}
</nav>
${panels}
${footer}
</body></html>`;
}
