---
name: CacheLane Design System
colors:
  background: "#FCFAF7"
  background-elevated: "#F5ECE3"
  foreground: "#1B1410"
  foreground-muted: "#5A3E31"
  border: "#E0D2C4"
  accent: "#995F2F"
  accent-muted: "#8A5A44"
  success: "#4E6E5D"
typography:
  fontFamily: Geist Sans, Inter, system-ui, sans-serif
  fontFamilyMono: Geist Mono, Courier New, monospace
  h1:
    fontSize: 48px
    lineHeight: 1.15
  h2:
    fontSize: 32px
    lineHeight: 1.25
  body:
    fontSize: 16px
    lineHeight: 1.65
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 64px
---

## Overview
This document specifies the official design tokens and user interface conventions for the CacheLane documentation website. CacheLane's visual brand is designed around a warm, premium, light-mode "mocha/java" palette, representing the stability, clarity, and richness of well-structured local caching.

## Colors
The color palette represents warm coffee, espresso, and steamed milk tones:
*   `background` (`#FCFAF7`): Creamy latte base background. Ensures a soft, high-contrast, low-fatigue reading experience.
*   `background-elevated` (`#F5ECE3`): Steamed milk/warm sand color used for cards, elevated code blocks, and containers.
*   `foreground` (`#1B1410`): Rich Dark Espresso color for dominant headings and body text, ensuring AAA-level contrast.
*   `foreground-muted` (`#5A3E31`): Medium Roast brown for secondary labels, text, and supporting information.
*   `border` (`#E0D2C4`): Soft milk-chocolate outline for tables, code blocks, and panels.
*   `accent` (`#995F2F`): Golden Mocha/Amber used for primary call-to-actions, hover highlights, and cache hits.
*   `accent-muted` (`#8A5A44`): Roasted Chestnut brown used for secondary buttons and tags.
*   `success` (`#4E6E5D`): Sage Green, used strictly to indicate cost savings and cache hit comparisons.

## Typography
The typography scale leverages the Geist font family for clean, technical precision:
*   **Font Sans:** Geist Sans, providing a modern geometric layout.
*   **Font Mono:** Geist Mono, used for code samples, terminal inputs, and tokens.
*   **Headings:** Thick, tracking-tight dark espresso headers.

## Layout
A standard modular grid with fluid layout spacing:
*   Page layouts are capped at `1280px` (`max-w-7xl`) with `16px` lateral margins (`px-4`) up to `24px` (`sm:px-6`).
*   Docs layout divides into a triple-column grid: a sidebar (`220px`), an article body (`minmax(0, 1fr)`), and a Table of Contents (`200px`).

## Components
*   **Primary Button:** Background is `accent` with `background` text. Clean hover micro-animations scaling the button up by `1.02`.
*   **Feature Card:** Rounded borders of `8px` (`rounded-lg`), using `background-elevated`, with a subtle scale-up transition on hover.
*   **Interactive Comparison Slider / Side-by-Side:** Shows the visual representation of CacheLane vs. standard Claude Code token growth.

## Do's and Don'ts
*   **Do** use `background-elevated` for block elements and callout backdrops.
*   **Do** keep text margins tight to preserve the technical aesthetic.
*   **Don't** use standard cool grays or deep blues for the web interface; stick to the warm mocha/java palette.
*   **Don't** use pure black (`#000000`) or pure white (`#FFFFFF`) to avoid visual fatigue.
