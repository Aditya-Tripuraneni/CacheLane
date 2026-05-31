---
name: CacheLane Claude Aesthetic Design System
colors:
  background: "#F4F3EE"             # Pampas Off-White
  background-elevated: "#FFFFFF"    # White Card sheets
  foreground: "#191816"             # Deep Espresso/Charcoal
  foreground-muted: "#5c5850"       # Muted Charcoal-Taupe
  border: "#E2E0D9"                 # Soft Cloudy Border
  accent: "#C15F3C"                 # Crail Orange/Rust Accent
  accent-muted: "#B1ADA1"           # Cloudy Taupe Secondary
  success: "#4F675A"                # Sage Green (for cache cost savings)
typography:
  fontFamily: Plus Jakarta Sans, system-ui, sans-serif
  fontFamilySerif: Lora, Georgia, serif
  fontFamilyMono: JetBrains Mono, Courier New, monospace
  h1:
    fontSize: 48px
    lineHeight: 1.1
  h2:
    fontSize: 32px
    lineHeight: 1.2
  body:
    fontSize: 17px
    lineHeight: 1.7
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 64px
---

## Overview
This document specifies the official design tokens and user interface conventions for the CacheLane website, aligned directly with the visual identity of Anthropic's **Claude** brand. The aesthetic is print-inspired, organic, and clean—designed to feel warm and human-centric rather than cold and technical.

## Colors
The color palette utilizes Claude's UI brand values:
*   `background` (`#F4F3EE` / Pampas): Off-white/cream paper-textured background. Reduces eye strain.
*   `background-elevated` (`#FFFFFF` / White): Pure white panels, cards, and dialogue containers.
*   `foreground` (`#191816` / Espresso): Dark charcoal-brown body and header color for high contrast reading.
*   `foreground-muted` (`#5C5850`): Soft charcoal-gray for descriptions, secondary links, and subtext.
*   `border` (`#E2E0D9`): Warm gray outline derived from Pampas/Cloudy.
*   `accent` (`#C15F3C` / Crail Orange): Claude's iconic rust orange/rust accent. Used for CTAs, active states, and highlights.
*   `accent-muted` (`#B1ADA1` / Cloudy): Warm taupe used for secondary borders, tags, and inline dividers.
*   `success` (`#4F675A`): Sage Green, indicating positive statistics and prompt cache hits.

## Typography
Typography bridges print design and technical precision:
*   **Font Serif (Headers & Prose):** Lora / Georgia. Used for h1, h2, h3, and descriptive prose body paragraphs. Creates a warm, literary atmosphere.
*   **Font Sans (UI Elements):** Plus Jakarta Sans. Clean, geometric sans-serif used for buttons, navigation items, sidebar groups, and text input boxes (referencing Claude's Styrene B).
*   **Font Mono:** JetBrains Mono, used for CLI code blocks, database values, and configuration snippets.

## Components
*   **Hero Section:** Highlights a bold Lora-serif title paired with a clean Styrene-like command line box.
*   **Side-by-Side Panel:** Visualizes cost curves side-by-side using the Pampas, White, and Crail accent colors.
*   **Primary Button:** Features `#C15F3C` background with `#FFFFFF` text and slightly rounded corners.

## Do's and Don'ts
*   **Do** use serif fonts (`Lora`) for all primary article copy, headings, and quotes.
*   **Do** keep border styles thin (`1px`) and rounded corners moderate (`6px` to `8px`) to match the editorial print style.
*   **Don't** use standard cool blue or pure dark backgrounds.
*   **Don't** use generic high-vibrancy primary colors.
