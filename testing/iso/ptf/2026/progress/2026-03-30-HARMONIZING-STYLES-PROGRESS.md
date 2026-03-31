# Harmonizing Styles — PROGRESS

**Created:** 2026-03-30  
**Last Updated:** 2026-03-30  
**Status:** Design

---

## Context

The 2026 tools (generator, validator, and future entrypoints) share the same markout CSS framework (`https://smotaal.io/markout/styles/styles.css`). Each tool sets a `--shade` CSS custom property that determines the page background color and overall visual identity. The colors must:

1. Complement each other — the tools are siblings, not strangers
2. Complement the markout framework's built-in color system
3. Work in both light and dark mode (via `prefers-color-scheme`)
4. Use translucent backgrounds/foregrounds — not solid white/black
5. Meet accessibility contrast requirements (WCAG 2.1 AA minimum: 4.5:1 for text, 3:1 for UI)

---

## Markout Color System

### How It Works

The markout CSS (`root.css` + `styles.css`) uses a `--shade` / `--shade-dark` variable pair as the page accent color:

```css
/* Light mode: shade IS the page background */
html { background: var(--shade, #eee); }

/* Dark mode: shade-dark IS the page background */
@media (prefers-color-scheme: dark) {
    html { background: var(--shade-dark, #101010); }
}
```

Content sections float on translucent overlays:

| Variable               | Light       | Dark        |
| ---------------------- | ----------- | ----------- |
| `--section-background` | `#ffffffee` | `#1f1f1fee` |
| `--section-shadow`     | `#0003`     | `#0006`     |
| `--section-band`       | `#0002`     | `#fff2`     |
| `--section-overlay`    | `#fffa`     | `#333a`     |

Text inherits from the page — `#000` (light) / `#ccc` (dark). Links: `#36c` / `#69f`. Band fills, strokes, and fades all use alpha channels.

### Key Principle

**Nothing is solid.** Every color in the markout system has an alpha channel. The `--shade` bleeds through section backgrounds, band fills, and overlays. This means the choice of `--shade` affects the perceived color of EVERYTHING on the page — not just the background.

---

## Current Tool Colors

| Tool      | `--shade`   | Perceived Color | Notes                                                      |
| --------- | ----------- | --------------- | ---------------------------------------------------------- |
| Generator | `#66aa99f6` | Teal-green      | Warm but professional, good contrast with section overlays |
| Validator | `#cc7733f6` | Burnt orange    | Too aggressive, clashes with error red, poor harmony       |

### What's Wrong with the Validator

- `#cc7733` is visually loud — it fights with error indicators (`#c00`) instead of complementing them
- The orange hue bleeds through section overlays and makes the whole page feel "warning-colored"
- Finding severity colors (error red, warning amber, pass green) are hard-coded solid colors that don't adapt to the page background
- No `--shade-dark` defined — dark mode falls back to `#101010` (markout default), losing the tool identity entirely

---

## Design Principles (for all 2026 entrypoints)

### 1. Shade Selection

Each tool's `--shade` should be a distinct hue that:

- Sits on the warm-cool spectrum relative to the generator's teal (`#66aa99`)
- Has the same lightness/saturation family (muted, not neon)
- Produces pleasant section overlay tinting when blended with `#ffffffee` / `#1f1f1fee`
- Is distinguishable at a glance from sibling tools

### 2. Severity / Status Colors

Error, warning, pass, info, and skipped indicators must:

- Use translucent backgrounds (not solid `#c00` on solid white)
- Adapt to the page shade via alpha channels
- Meet WCAG 2.1 AA contrast against the section background (which itself is translucent over the shade)
- Use `color-mix()` or CSS custom properties rather than hard-coded hex values

Pattern:

```css
/* Instead of: */
.finding[data-severity="error"] { border-left-color: #c00; }

/* Use: */
.finding[data-severity="error"] {
    border-left-color: var(--status-error);
    background: color-mix(in srgb, var(--status-error) 8%, transparent);
}
```

### 3. Dark Mode

Every `--shade` must have a `--shade-dark` companion:

- Same hue, darker, less saturated
- Must produce readable text (`#ccc`) over `#1f1f1fee` section overlays

### 4. No Solid Backgrounds

Replace all solid background colors with:

- Translucent fills: `color-mix(in srgb, var(--color) N%, transparent)`
- `light-dark()` where supported, or `@media (prefers-color-scheme)` fallbacks
- Section backgrounds inherit from markout — don't override

---

## Proposed Color Palette

### Tool Shades

| Tool      | Hue                | `--shade` (light) | `--shade-dark` (dark) | Identity               |
| --------- | ------------------ | ----------------- | --------------------- | ---------------------- |
| Generator | Teal-green (160°)  | `#66aa99f6`       | `#2a5548f6`           | Creation, production   |
| Validator | Slate-blue (220°)  | `#6688aaf6`       | `#2a3a55f6`           | Analysis, verification |
| (Future)  | Warm-violet (280°) | `#8866aaf6`       | `#3a2a55f6`           | Reserved               |

The validator moves from burnt orange to slate-blue — cool-toned to contrast the generator's warm teal, professional rather than alarming, and crucially, it does not compete with the red/amber/green status colors.

### Status Colors

Defined as CSS custom properties on the tool's root element. These are the SAME across all tools (consistency):

```css
:root {
    /* Status indicators — translucent, shade-aware */
    --status-error: #cc3333;
    --status-error-background: color-mix(in srgb, #cc3333 10%, transparent);
    --status-warning: #cc9933;
    --status-warning-background: color-mix(in srgb, #cc9933 10%, transparent);
    --status-pass: #339933;
    --status-pass-background: color-mix(in srgb, #339933 10%, transparent);
    --status-info: #3366cc;
    --status-info-background: color-mix(in srgb, #3366cc 10%, transparent);
    --status-skipped: #999999;
    --status-skipped-background: color-mix(in srgb, #999999 10%, transparent);
}
```

### Finding Display

```css
.finding {
    border-left: 4px solid transparent;
    background: transparent;
    padding: 0.4em 0.6em;
    margin: 0.2em 0;
    border-radius: 0 4px 4px 0;
}

.finding[data-status="fail"][data-severity="error"] {
    border-left-color: var(--status-error);
    background: var(--status-error-background);
}

.finding[data-status="fail"][data-severity="warning"] {
    border-left-color: var(--status-warning);
    background: var(--status-warning-background);
}

.finding[data-status="pass"] {
    border-left-color: var(--status-pass);
    background: var(--status-pass-background);
}

.finding[data-status="skipped"] {
    border-left-color: var(--status-skipped);
    background: var(--status-skipped-background);
}
```

---

## Implementation Checklist

- [x] Update `validator/index.html` — changed `--shade` to `#6688aaf6`, added `--shade-dark: #2a3a55f6`
- [x] Add status color custom properties to validator CSS — `--status-error`, `--status-warning`, `--status-pass`, `--status-info`, `--status-skipped`
- [x] Replace hard-coded hex severity colors with custom properties — findings use `var(--status-*)`, summary bar uses `.summary-*` classes
- [x] Replace solid backgrounds with translucent `color-mix()` fills — findings, changelog, drop zone hover
- [x] Replace solid text colors with `opacity` — `.finding-details` uses `opacity: 0.7` instead of `color: #666`
- [ ] Verify contrast in both light and dark mode (browser DevTools)
- [ ] Apply same status color properties to generator (if it uses status indicators in the future)
- [x] Document final color values in this progress file
- [x] Footer alignment — `slot="footer"` with flex layout to push copyright to bottom of viewport
- [x] Custom element `display: flex; flex-direction: column` on both `pdf-validator-app` and `test-form-generator-app`
- [x] Shadow root `<form>` uses `flex: 1` with `<article style="flex: 1">` and `<footer style="flex-shrink: 0">`
- [x] `hgroup` heading structure with centered title, subtitle, and description for both tools
- [x] `hgroup` styles shared: `hgroup:has(h1)` centered with margin, `hgroup:has(h1) + p` max-width 35em centered
- [x] Drop zone replaced with native `<input type="file">` respecting user agent appearance
- [x] Findings use `width: 100%` with `box-sizing: border-box`
- [x] Report/summary/actions/changelog fieldsets use `display: block; width: 100%` instead of grid centering
- [x] Changelog aggregation: per-page entries collapsed into "Set TrimBox, BleedBox, CropBox from MediaBox — pages 1, 2 and 3"

---

## Layout Pattern (shared across tools)

### Footer-to-Bottom

The markout CSS makes `body > main` a flex column. Each tool's custom element is a `body > main > *` child with equal margins from `calc(var(--section-spacing) * 2)`.

To push the footer to the bottom when content is short:

```css
/* Light DOM — custom element itself must be flex */
pdf-validator-app,
test-form-generator-app {
    display: flex;
    flex-direction: column;
}
```

```html
<!-- Shadow root — form fills element, article pushes footer down -->
<template shadowrootmode="closed">
    <form method="dialog" style="display: flex; flex-direction: column; flex: 1;">
        <article style="flex: 1;">
            <header><slot name="header"></slot></header>
            <slot name="article"></slot>
        </article>
        <footer style="flex-shrink: 0;">
            <slot name="footer"></slot>
        </footer>
    </form>
</template>
```

```html
<!-- Footer uses slot="footer", NOT slot="article" -->
<footer slot="footer">
    <p>Copyright ...</p>
</footer>
```

### Heading Structure

Both tools use the same `hgroup` pattern:

```html
<header slot="header">
    <hgroup>
        <p>Contrast-Resolution</p>
        <h1>Test Form Validator</h1>
        <p><small>For Internal Use Only</small></p>
    </hgroup>
    <p>Description text...</p>
</header>
```

---

## Activity Log

### 2026-03-30

- Analyzed markout CSS color system: `root.css` variables, `--shade` mechanism, translucent overlays
- Identified problems with validator's `#cc7733` (burnt orange): fights error red, too aggressive, no dark mode
- Designed complementary palette: generator teal (160°), validator slate-blue (220°)
- Established design principles: translucent everywhere, `color-mix()` for status backgrounds, WCAG AA contrast
- Defined status color custom properties (shared across tools)
- Implemented all CSS changes in `validator/index.html`:
  - `--shade: #6688aaf6` (slate-blue), `--shade-dark: #2a3a55f6`
  - Findings use `color-mix(in srgb, var(--status-*) 8%, transparent)` backgrounds with 4px left border
  - Changelog uses `color-mix(in srgb, var(--status-pass) 8%, transparent)` with green left border
  - Summary bar uses `.summary-*` classes referencing `var(--status-*)` colors
  - `.finding-details` uses `opacity: 0.7` instead of solid `#666`
  - No solid white or solid color backgrounds anywhere
- Layout fixes for both generator and validator:
  - Footer uses `slot="footer"` with flex layout chain (custom element → form → article/footer)
  - Custom elements styled as `display: flex; flex-direction: column`
  - `hgroup` heading with shared CSS for centered title/subtitle
  - Drop zone replaced with native file input
  - Findings `width: 100%`, report/actions/changelog fieldsets block display
  - Changelog aggregation: 66 per-page entries → 1 line with page list
