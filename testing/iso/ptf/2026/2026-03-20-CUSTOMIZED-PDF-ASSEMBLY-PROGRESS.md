# Customized PDF Assembly — PROGRESS

**Created:** 2026-03-20
**Last Updated:** 2026-03-20
**Status:** Implementation

---

## Context

The 2026 PDF Test Form Generator currently hardcodes the `preserve-k-only-relative-colorimetric-gcr` rendering intent for all color conversions, regardless of the output ICC profile type. This feature introduces adaptive PDF assembly driven by:

- **Output profile analysis** — detecting RGB, CMYK (Max-GCR), and CMYK (non-Max GCR) profile categories
- **Declarative assembly policy** — JSON configuration mapping profile categories to included color spaces, rendering intents, and multi-PDF requirements
- **User-facing filter controls** — collapsible UI for toggling layouts, color spaces, and rendering intents
- **Multi-pass generation** — producing multiple PDFs with different rendering intents when required
- **Slug metadata** — embedding rendering intent and profile category in both text and QR codes

### Profile Category Rules

| Category | Included Color Space Types | Rendering Intents | Multi-PDF |
|---|---|---|---|
| RGB | RGB, Gray, Lab | Relative Colorimetric with BPC | No |
| CMYK (Max-GCR) | RGB, Gray, Lab, DeviceN | Relative Colorimetric with BPC | No |
| CMYK (non-Max GCR) | RGB, Gray, Lab, DeviceN | Relative Colorimetric with BPC + K-Only GCR with BPC | Yes |

### Design Reference

Full implementation plan: `~/.claude/plans/functional-mapping-thimble.md`

---

## Roadmap

- [x] **Step 0** — Create progress tracker
- [x] **Step 1** — Create `assembly-policy.json` in `classes/configurations/`
- [x] **Step 2** — Create `OutputProfileAnalyzer` in `generator/classes/`
- [x] **Step 3** — Create `AssemblyPolicyResolver` in `generator/classes/`
- [x] **Step 4** — Parameterize rendering intent in `AssetPagePreConverter`
- [x] **Step 5** — Extend slug metadata in `GhostscriptService`
- [x] **Step 6** — Multi-pass generation in `TestFormPDFDocumentGenerator`
- [x] **Step 7** — UI filter controls (`index.html` + `test-form-generator-app-element.js`)
- [x] **Step 8** — Bootstrap worker protocol extension
- [ ] **Step 9** — Verification and testing `IN-PROGRESS`

### File Plan

**New Files (3):**

| File | Step | Purpose |
|---|---|---|
| `classes/configurations/assembly-policy.json` | 1 | Declarative assembly rules |
| `generator/classes/output-profile-analyzer.js` | 2 | ICC profile category detection via WASM color engine |
| `generator/classes/assembly-policy-resolver.js` | 3 | Policy resolution + manifest filtering |

**Modified Files (6):**

| File | Step | Change Scope |
|---|---|---|
| `generator/classes/asset-page-pre-converter.js` | 4 | Parameterize rendering intent (surgical) |
| `services/GhostscriptService.js` | 5 | Extend slug metadata (small) |
| `generator/classes/test-form-pdf-document-generator.js` | 6 | Multi-pass generation loop (major) |
| `generator/elements/test-form-generator-app-element.js` | 7 | Filter UI + override collection (moderate) |
| `generator/index.html` | 7 | Filter section HTML (moderate) |
| `generator/bootstrap-worker-entrypoint.js` | 8 | Forward assemblyOverrides (small) |

---

## Current Status

**Focus:** Step 9 — Verification and testing
**Last Updated:** 2026-03-20

---

## Activity Log

### 2026-03-20

- Created progress tracker document
- Completed brainstorming and design phase
- Explored codebase: generator, manifest, services, color conversion classes, UI, worker protocol
- Clarified requirements: Max GCR test (11 Lab test points, CMY < 1%), two PDFs for non-Max GCR CMYK (same pages, different intents), collapsible filter UI, assembly policy in `classes/configurations/`, BPC-less intents only in custom UI mode
- Plan approved and implementation started
- **Step 1**: Created `classes/configurations/assembly-policy.json` with profile category rules, Max GCR test parameters, rendering intent labels, and 6 custom intent options
- **Step 2**: Created `generator/classes/output-profile-analyzer.js` — static class analyzing ICC profiles via WASM color engine Lab→CMYK transforms
- **Step 3**: Created `generator/classes/assembly-policy-resolver.js` — loads policy JSON, resolves assembly plan with manifest filtering and user override support
- **Step 4**: Parameterized rendering intent in `asset-page-pre-converter.js` — replaced hardcoded K-Only GCR with constructor options `renderingIntent` and `blackPointCompensation`
- **Step 5**: Extended `GhostscriptService.processSlugTemplate()` — added rendering intent to Parameters and profile category to SlugHeader
- **Step 6**: Integrated multi-pass generation into `test-form-pdf-document-generator.js` — profile analysis, policy resolution, single-pass and multi-pass branches, updated slug and metadata generation
- **Step 7**: Added collapsible Assembly Filters section to `index.html`, dynamic toggle population and override collection in `test-form-generator-app-element.js`
- **Step 8**: Extended `bootstrap-worker-entrypoint.js` to forward `assemblyOverrides` and always provide `onChainOutput` callback
