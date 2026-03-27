# 2026-03-26 Recovery Handoff

## Paste this at conversation start

```
Read progress/2026-03-26-Recovery-Handoff-001.md, progress/2026-03-26-Interface-Progress.md, and progress/2026-03-26-Workflow-Progress.md before proceeding. All code is committed. Resume from Task 4: Add Gray output profile support. Also address the known issues listed below.
```

## Commits today (2026-03-26)

Branch: `test-form-generator/2026/dev`

| Commit | Description |
|---|---|
| `0c6a661` | Lab K-Only disable (policy rules + baseline loader) |
| `379dabc` | Generate/cancel button, UI lock, wake lock, beforeunload |
| `312de23` | Fix Lissajou SepK color space in F10a assets |
| `2bf223c` | Docket PDF generation (squashed) |
| `325160a` | Generator UI: r2 layout, debugging details, required toggle |
| `c9bccbe` | F10a test form assets and 8-bit variant |
| `9a1699f` | Replace 8-bit asset folders with symlinks, remove classes/root |
| `b1e18b9` | OutputParameters line support in slug template |

## What was completed

### Slug OutputParameters
- `GhostscriptService.js` splits `/Parameters` (colorSpace + resolution) and `/OutputParameters` (renderingIntent + outputProfileName) with backwards-compatible template detection
- `slugs.ps` (F9f): 9pt title / 6pt body, conditional `SlugOutputParameters` rendering

### Generator UI (r2 layout)
- `index.html`: output-fieldset, optgroups (F10a/F9f/F9e), customization-details + debugging-details, `data-required` + `type="email"`, `name` on worker checkboxes
- `test-form-generator-app-element.js`: all element refs updated, `#updateRequiredState()` toggles required based on debugging details open/closed, details persistence for both sections, `input[type="email"]` in persist/restore

### Docket PDF
- `#generateDocketPDF()` runs as litmus test BEFORE main pipeline — failure aborts everything
- Downloaded immediately via `onDocketReady` callback before test form PDFs
- One page per rendering intent pass with converted background asset
- Full ICC profile header (version, deviceClass, PCS, manufacturer, copyright), output bit-depth
- Assembly filter state: auto/custom radios, layout/colorspace checkboxes (vector-drawn, no Unicode)
- Debugging settings (workers, strategy)
- Slugs embedded on each docket page
- Stripped metadata.json (minus profile base64) attached
- DeviceCMYK K-only black (0/0/0/1) for all rendered content
- Line wrapping for long values within bounds
- `#downloadGenerationResult()` shared by main-thread and worker
- Worker entrypoint forwards `docket-ready` message with transferable
- All return paths include `docketPDFBuffer`

### Generate/Cancel UI
- Single click handler: Generate when idle, Cancel when generating
- Cancel: confirm prompt, aborts generator or terminates worker, rejects pending Promise
- All fieldsets disabled during generation (including inside details)
- Legend radios (auto/custom) disabled during generation
- Details summaries locked via pointer-events + click prevention
- `beforeunload` prevention during generation
- Screen Wake Lock API when available
- Progress shows "Cancelled" on cancellation
- Clear Cache: confirm prompt only when cache exists

### Lab K-Only GCR Disable
- `color-conversion-rules.json`: `"disabled": true` on `relative-colorimetric-lab-fallback` policy
- `baseline/color-conversion-policy.js`: `#loadRulesForEngine()` skips `policy.disabled` and `rule.disabled`
- Color engine does NOT force Lab to Relative Colorimetric internally — all override was application-layer

## Remaining tasks

### Task 4: Add Gray output profile support
- New `Gray` profile category in `assembly-policy.json`
  - Included color space types: `Gray`, `Lab`
  - Excluded: `RGB`, `DeviceN`
  - Same default rendering intents as RGB (Relative Colorimetric + BPC)
- Update `OutputProfileAnalyzer` to recognize Gray profiles (`header.colorSpace === 'GRAY'`)
- Update `AssemblyPolicyResolver` if needed for new category
- Update UI auto-state preview in `test-form-generator-app-element.js` to handle Gray
- Update the profile color space validation in `generate()` (currently throws for non-CMYK/RGB)

### Task 5: Add specification field validation
- Pattern attributes for device, colorants, substrate, settings inputs
- Autocomplete: retain last 10 values per field in localStorage (non-debug mode only)
- Reset non-email inputs after generation completes
- Proper HTML5 validation using `reportValidity()`/`checkValidity()`

## Known issues

### Worker `onChainOutput` metadata download (pre-existing)
The worker `chain-output` handler downloads metadata.json on first chain output. Fixed with `docketDelivered` flag but the `onChainOutput` callbacks are still duplicated between main-thread and worker paths. Should be extracted to shared handler like `#downloadGenerationResult`.

### Separate-chains does not honour layout selections (pre-existing)
`#generateSeparateChains` receives the full manifest, not the filtered one from the assembly plan. The in-place path uses `singlePass.manifest` (filtered); separate-chains bypasses this. Layout/color-space overrides are ignored.

### Chain filenames missing intent label (pre-existing)
Separate-chains filenames use color space only (`sRGB.pdf`). Multi-intent uses pass label. Neither includes both intent + color space, which can cause filename clashes when multiple intents produce the same color space grouping.

### Docket checkmark rendering
SVG path checkmark orientation may need tuning depending on PDF viewer. Currently uses SVG Y-axis convention (top-down) with `drawSvgPath` origin at top-left of checkbox.

## Architecture notes

- `testing/iso/ptf/2026/classes/baseline/` — ecosystem classes used by BOTH main thread and workers. There is NO separate "root" class layer (deleted).
- `color-conversion-rules.json` is the single source of truth for rendering intent overrides. `disabled` flag honored at policy and rule level.
- `testing/iso/ptf/2026/helpers/import-helpers.js` exports `safeDynamicImport` for Firefox 115 compatibility.
- Customization details closed → all modes forced to auto. Debugging details closed → defaults (worker on, in-place, not debugging). Field values persist in DOM for when user reopens.

## Cleanup
- `testing/iso/ptf/2026/classes/root/` still exists on disk (untracked) — delete it
- `content/assets/*.pdf` show as modified (17 files) — LFS pointer changes, not from today
