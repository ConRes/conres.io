# Attribution — @conres/color-engine

**Package:** @conres/color-engine  
**Author:** Saleh Abdel Motaal <dev@smotaal.io>  
**License:** GPL-3.0-or-later  
**Last Updated:** 2026-02-12  

---

## Summary

This package is a WebAssembly port of the K-Only BPC+GCR algorithm developed by Saleh Abdel Motaal in `packages/js-color-engine`. It compiles custom C code alongside [Little-CMS](https://github.com/mm2/Little-CMS) using Emscripten, with JavaScript API wrappers inspired by [lcms-wasm](https://github.com/mattdesl/lcms-wasm).

The algorithm design, architectural decisions, and all color science methodology are by Saleh Abdel Motaal. AI tools were used for code generation under the developer's direction and review.

---

## Upstream Dependencies

### Little-CMS

- **Author:** Marti Maria Saguer
- **License:** MIT
- **Repository:** https://github.com/mm2/Little-CMS
- **Reference copy:** `upstream/Little-CMS/` (git submodule)
- **Role:** Core color management library, compiled to WebAssembly
- **Patches applied:** 3 non-invasive patches in `patches/` to support K-Only GCR intent registration and multiprofile transforms

### lcms-wasm

- **Author:** Matt DesLauriers
- **License:** MIT
- **Copyright:** 2024 Matt DesLauriers
- **Repository:** https://github.com/mattdesl/lcms-wasm
- **Reference copy:** `upstream/lcms-wasm/`
- **Role:** Architectural reference for Emscripten build approach and JavaScript API wrapper pattern. No code was directly copied; the pattern was reimplemented with substantial extensions.

### jsColorEngine / @conres/js-color-engine

- **Author:** Glenn Wilton (original), Saleh Abdel Motaal (K-Only algorithm)
- **License:** GPL-3.0-or-later
- **Role:** The C implementation in this package is a port of the JavaScript prototype algorithm in `packages/js-color-engine/src/transform.js`

---

## Per-File Attribution

### C Source Files — Original Algorithm Implementation

All C source files implement original algorithms by Saleh Abdel Motaal, ported from the JavaScript prototype with AI-assisted code generation.

| File                      | Author             | AI                                                              | Description                                                            |
| ------------------------- | ------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/k-only-gcr.c`        | Saleh Abdel Motaal | Claude Sonnet 4.5 (initial port), Claude Opus 4 (modifications), Claude Opus 4.6 (fallback detection) | K-Only BPC+GCR rendering intent (1,819 lines)                          |
| `src/k-only-gcr.h`        | Saleh Abdel Motaal | Claude Sonnet 4.5, Claude Opus 4.6 (fallback detection)          | Header with `KOnlyGCRParams` structure                                 |
| `src/multiprofile-lut.c`  | Saleh Abdel Motaal | Claude Sonnet 4.5 (initial), Claude Opus 4 (modifications), Claude Opus 4.6 (pure-black pretest) | Gray color space workaround for multiprofile transforms (2,200+ lines) |
| `src/multiprofile-lut.h`  | Saleh Abdel Motaal | Claude Sonnet 4.5 (initial), Claude Opus 4 (modifications), Claude Opus 4.6 (pure-black pretest) | Header with `CompositeLUTSamplerCargo` structures                      |
| `src/blackpoint-compensation-clamping.c` | Saleh Abdel Motaal | Claude Sonnet 4.5 (initial), Claude Opus 4 (SIMD optimization), Claude Opus 4.6 (bit-depth generalization) | Blackpoint Compensation boundary clamping with SIMD optimization |
| `src/blackpoint-compensation-clamping.h` | Saleh Abdel Motaal | Claude Sonnet 4.5 (initial), Claude Opus 4 (modifications), Claude Opus 4.6 (bit-depth generalization)     | Blackpoint Compensation clamping header                          |
| `src/lab-mask-sentinel.c` | Saleh Abdel Motaal | Claude Opus 4 (initial), Claude Opus 4.6 (rewrite)              | Lab Mask Sentinel Passthrough and Correction                           |
| `src/lab-mask-sentinel.h` | Saleh Abdel Motaal | Claude Opus 4 (initial), Claude Opus 4.6 (rewrite)              | Lab Mask Sentinel header                                               |
| `src/color-engine-plugin.c` | Saleh Abdel Motaal | Claude Opus 4.6 (code generation)                              | Full Transform Plugin — lifecycle management in C                      |
| `src/color-engine-plugin.h` | Saleh Abdel Motaal | Claude Opus 4.6 (code generation)                              | Plugin header with `ColorEngineTransformData` struct                   |

### JavaScript Wrapper Files

| File                 | Author                                            | AI                                                      | Description                                       |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| `src/api-wrapper.js` | Saleh Abdel Motaal                                | Claude Sonnet 4.5 (initial), Claude Opus 4 (extensions) | WASM API bindings; inspired by lcms-wasm approach |
| `src/index.js`       | Saleh Abdel Motaal                                | Claude Sonnet 4.5 (initial), Claude Opus 4 (extensions) | `ColorEngine` class wrapper                       |
| `src/constants.js`   | Matt DesLauriers (lcms-wasm) / Saleh Abdel Motaal | —                                                       | Upstream constants with K-Only GCR additions      |

### Build System

| File                                            | Author             | AI                | Description                                       |
| ----------------------------------------------- | ------------------ | ----------------- | ------------------------------------------------- |
| `scripts/build-wasm.sh`                         | Saleh Abdel Motaal | Claude Sonnet 4.5 | Emscripten compilation with patch application     |
| `patches/00-add-k-only-gcr-intent.patch`        | Saleh Abdel Motaal | Claude Sonnet 4.5 | Register K-Only GCR intent in Little-CMS          |
| `patches/01-export-default-intents.patch`       | Saleh Abdel Motaal | Claude Sonnet 4.5 | Export DefaultICCintents for multiprofile support |
| `patches/02-export-alloc-empty-transform.patch` | Saleh Abdel Motaal | Claude Sonnet 4.5 | Export AllocEmptyTransform for custom pipelines   |

### Test Files

| File                              | Author             | AI            | Description                  |
| --------------------------------- | ------------------ | ------------- | ---------------------------- |
| `tests/lab-mask-sentinel.test.js`                         | Saleh Abdel Motaal | Claude Opus 4 (initial), Claude Opus 4.6 (rewrite)  | Lab Mask Sentinel validation (baseline comparison)     |
| `tests/parity.test.js`                                    | Saleh Abdel Motaal | Claude Opus 4                                        | Cross-package parity testing                           |
| `tests/k-only-gcr/fallback.test.js`                       | Saleh Abdel Motaal | Claude Opus 4.6                                      | K-Only GCR fallback to Relative Colorimetric           |
| `tests/multiprofile-transforms/blackpoint-scaling.test.js` | Saleh Abdel Motaal | Claude Opus 4.6                                      | Multiprofile blackpoint scaling conditional             |

---

## AI Disclosure

### Models Used

| Period        | Model             | Tool                        | Files Affected                                                                      |
| ------------- | ----------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| November 2025 | Claude Sonnet 4.5 | GitHub Copilot, Claude Code | Initial C port: k-only-gcr, multiprofile-lut, blackpoint-compensation-clamping, api-wrapper, build scripts |
| December 2025 | Claude Opus 4     | Claude Code                 | BPC clamping SIMD optimization, benchmark scripts                                   |
| January 2026  | Claude Opus 4     | Claude Code                 | Multiprofile LUT float modifications, k-only-gcr refinements                        |
| February 2026 | Claude Opus 4, Claude Opus 4.6 | Claude Code          | Lab Mask Sentinel Passthrough and Correction, api-wrapper extensions, little-cms parity work |

### AI Role

All AI-generated code was produced under the developer's explicit direction, specifying:

- Algorithm logic and mathematical formulas
- Architecture and integration points
- Function signatures and data structures
- Error handling strategies

The developer reviewed, tested, debugged, and iteratively refined all AI-generated output across months of development.

---

## Copyright

```
Copyright (c) 2025-2026 Saleh Abdel Motaal (K-Only BPC+GCR algorithm, all C source code,
  JavaScript wrappers, build system, patches, and tests)

Upstream components:
  Copyright (c) Marti Maria Saguer (Little-CMS, MIT license)
  Copyright (c) 2024 Matt DesLauriers (lcms-wasm API pattern reference, MIT license)
  Copyright (c) 2019, 2024 Glenn Wilton, O2 Creative Limited (jsColorEngine algorithm
    prototype, GPL-3.0-or-later)

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later version.
```
