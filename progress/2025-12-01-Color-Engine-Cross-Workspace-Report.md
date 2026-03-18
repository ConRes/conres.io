# ColorEngine Cross-Workspace Development Report

**Date:** 2025-12-19  
**Purpose:** Historical record of ColorEngine development for article generation  
**Audience:** Claude Code in TFG (TestFormGenerator) workspace  

---

## Executive Summary

ColorEngine is a WebAssembly-based color transformation library that implements a specialized **K-Only GCR+BPC algorithm** for PDF color conversion. The project evolved from a JavaScript prototype to a production-ready WASM implementation with SIMD optimizations, developed across two AI-assisted workspaces over approximately 4 months.

---

## Workspace Division

### CE (ColorEngine) Workspace

**Location:** `/Volumes/Pro-Blade/ConRes/.../color-engine`  
**Purpose:** Core algorithm development, WASM compilation, performance optimization  
**Transferred to TFG:** `packages/color-engine/` and `packages/js-color-engine/`

**Key directories:**

- `packages/color-engine/` - WASM port (C + JavaScript bindings)
- `packages/js-color-engine/` - JavaScript prototype (reference implementation)
- `upstream/Little-CMS/` - Little-CMS source (git submodule)
- `upstream/emsdk/` - Emscripten SDK (git submodule)
- `experiments/` - Validation scripts and benchmarks
- `scripts/` - Build automation

### TFG (TestFormGenerator) Workspace

**Purpose:** PDF processing application that consumes ColorEngine  
**Receives:** Pre-built WASM modules and JavaScript packages  
**Role:** Integration, real-world usage, feedback on API requirements

---

## AI Models and Tools Used

### Primary Development

| Phase                     | AI Model          | Tool              | Role                                               |
| ------------------------- | ----------------- | ----------------- | -------------------------------------------------- |
| JavaScript Prototype      | Claude 3.5 Sonnet | Claude Code CLI   | Algorithm implementation, test writing             |
| WASM Port Planning        | Claude 3.5 Sonnet | Claude Code CLI   | Architecture design, C code structure              |
| WASM Bindings Fix         | GitHub Copilot    | VS Code Extension | Fixed critical api-wrapper.js bindings (Phase 3.1) |
| K-Only GCR Implementation | Claude Opus 4     | Claude Code CLI   | C implementation, transform architecture           |
| BPC Regression Fix        | Claude Opus 4     | Claude Code CLI   | Ported adaptive step size algorithm                |
| SIMD Optimization         | Claude Opus 4.5   | Claude Code CLI   | WASM SIMD, adaptive BPC clamping                   |

### Key AI Contributions

1. **Claude Code (Sonnet/Opus):** Primary development, algorithm porting, test suites
2. **GitHub Copilot:** Critical fix for WASM bindings that unblocked Phase 3
3. **Claude Opus 4.5:** Final optimizations, SIMD implementation, documentation

---

## User Contributions and Original Ideas

### Saleh Abdel Motaal (@aspect:smotaal)

#### Original Algorithm Design

The user developed the core **K-Only GCR+BPC algorithm** concept:

- **Key insight:** Treat 100% K (pure black) as the black point reference instead of CMYK(100,100,100,100)
- **Goal:** Guarantee neutral grays always convert to K-only output on CMYK devices
- **Innovation:** Combines Gray Component Replacement (GCR) with Black Point Compensation (BPC) in a novel way

#### JavaScript Prototype

The user created the initial JavaScript implementation in `packages/js-color-engine/`:

- Ported from original `jsColorEngine` library
- Implemented `create3DDeviceLUT_KOnly()` algorithm (~1300 lines)
- Established test suite (182 tests passing)
- Defined the API surface for WASM port

#### Architectural Decisions

1. **Little-CMS Plugin System:** User specified using Little-CMS's custom intent mechanism rather than patching core code
2. **Transform-Based Architecture:** User guided the shift from direct color calculation to using Little-CMS transforms internally
3. **Adaptive Step Size:** User's BPC fix introduced adaptive iteration (variable step sizes for convergence)
4. **2MP Threshold for Optimization:** User specified that adaptive BPC clamping should only apply to images ≥2 megapixels
5. **JIT-Aware Benchmarking:** User introduced cycling 3 unique arrays in benchmarks to tease out JIT effects
6. **Workspace Separation:** User designed the package transfer model (only `packages/` transferred to TFG)

#### Development Process Guidance

- **"Work autonomously per CLAUDE.md"** - Established autonomous AI workflow
- **"No CDing!"** - Mandated using `yarn --cwd` instead of directory changes
- **"Use yarn build scripts!"** - Standardized build process
- **Output consistency verification** - Required byte-identical output validation

---

## Development Timeline

### Phase 0: Infrastructure (October 2024)

- Set up monorepo with Yarn 4.5.3+
- Configured git submodules (Little-CMS, emsdk, jsColorEngine)
- Established build pipeline with Emscripten

### Phase 1: JavaScript Prototype (October-November 2024)

- User ported jsColorEngine to ES modules
- Implemented K-Only GCR algorithm in JavaScript
- Created comprehensive test suite (182 tests)
- Documented algorithm in Transform.md

### Phase 2: WASM Port Planning (November 2024)

- Designed C implementation structure
- Created `k-only-gcr.h` and `k-only-gcr.c`
- Implemented Little-CMS plugin registration
- Set up api-wrapper.js for JavaScript bindings

### Phase 3: WASM Implementation (November 2024)

**Phase 3.1: Bindings Fix (GitHub Copilot)**

- Fixed critical bug in api-wrapper.js
- Enabled proper memory marshaling between JS and WASM

**Phase 3.2: Transform-Based Architecture**

- Shifted from direct calculation to Little-CMS transforms
- Resolved profile handle issues

**Phase 3.3: Recursion Prevention**

- Fixed circular call detection in custom intent
- Achieved functional K-Only GCR in WASM

**Phase 3.4: BPC Regression Fix (December 2024)**

- Ported adaptive step size algorithm from JavaScript
- Enabled BPC flags on internal transforms
- Increased MAX_ITERATIONS from 100 to 1000
- Test results: 93/98 passing (94.9%)

### Phase 4: Performance Optimization (December 2024)

**Phase 4.1: SIMD Enable**

- Added `-msimd128` flag to Emscripten build
- Verified 3,547 SIMD instructions in compiled WASM

**Phase 4.2: BPC Clamping Optimization**

- Implemented boundary pixel detection in C
- Created SIMD-optimized batch detection
- Benchmark result: Only effective for 100% boundary images

**Phase 4.3: Adaptive Detection (Final)**

- Implemented `doTransformAdaptive()` function
- Samples first 256 pixels to detect binary masks
- 2MP threshold prevents overhead on small images
- Achieves 3x speedup for binary masks ≥2MP
- No overhead for photographs (verified byte-identical)

---

## Key Technical Achievements

### 1. K-Only GCR Algorithm

Guarantees neutral grays (R=G=B) convert to K-only CMYK output:

```
RGB(128, 128, 128) → CMYK(0, 0, 0, 50)  // K-only, no CMY
RGB(0, 0, 0)       → CMYK(0, 0, 0, 100) // Pure black
RGB(255, 255, 255) → CMYK(0, 0, 0, 0)   // No ink
```

### 2. Custom Little-CMS Intent

Registered as `INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR` (value 20):

- Uses plugin system, not core patches
- Integrates cleanly with Little-CMS transform pipeline
- Supports any CMYK output profile

### 3. WASM SIMD Optimization

- 128-bit SIMD vectors for batch pixel processing
- 4 pixels processed per iteration
- Peak throughput: 47 million pixels/second

### 4. Adaptive BPC Clamping

Intelligent routing based on image content:

| Image Type   | Size | Action            | Speedup |
| ------------ | ---- | ----------------- | ------- |
| Any          | <2MP | Regular transform | N/A     |
| Photographs  | ≥2MP | Regular transform | N/A     |
| Binary masks | ≥2MP | BPC clamping      | 3x      |

---

## Files Summary

### Transferred to TFG

**`packages/color-engine/` (WASM implementation):**

- `src/k-only-gcr.c` - K-Only GCR C implementation (800+ lines)
- `src/k-only-gcr.h` - Header with KOnlyGCRParams structure
- `src/bpc-clamp.c` - SIMD-optimized BPC clamping (615 lines)
- `src/bpc-clamp.h` - Cache structures and function declarations
- `src/api-wrapper.js` - JavaScript bindings for WASM functions
- `src/index.js` - ColorEngine class with public API
- `dist/color-engine.js` - Compiled WASM module + glue code
- `dist/color-engine.wasm` - WebAssembly binary (276 KB)

**`packages/js-color-engine/` (JavaScript reference):**

- `src/transform.js` - Reference implementation (393 KB)
- `src/lut.js` - LookupTable class
- `specs/` - Test suite (182 tests)

### Remaining in CE Workspace

- `upstream/` - Git submodules (Little-CMS, emsdk)
- `scripts/build-wasm.sh` - WASM build script
- `experiments/` - Benchmarks and validation scripts
- `patches/` - Little-CMS integration patch
- Documentation files (this report, CLAUDE.md, etc.)

---

## Lessons Learned

### What Worked Well

1. **JavaScript prototype first:** Enabled rapid algorithm iteration before C port
2. **Comprehensive test suite:** Caught regressions during WASM port
3. **Plugin architecture:** Avoided modifying Little-CMS source code
4. **AI collaboration:** Different models contributed different strengths
5. **Workspace separation:** Clean package transfer model

### Challenges Overcome

1. **WASM bindings:** Took multiple attempts and different AI tools
2. **Recursion in custom intent:** Required transform-based architecture
3. **BPC convergence:** Needed adaptive step size algorithm
4. **Optimization trade-offs:** BPC clamping only helps specific content

### Future Considerations

1. Float32 array support in WASM (currently Uint8 only)
2. Additional rendering intents
3. Multi-profile transforms
4. Worker thread parallelization

---

## Credits

### Human Contributors

- **Saleh Abdel Motaal** - Algorithm design, architecture, project direction

### AI Contributors

- **Claude Code (Anthropic)** - Primary development across all phases
- **GitHub Copilot (Microsoft)** - Critical WASM bindings fix

### Open Source Dependencies

- **Little-CMS** (Marti Maria) - Core color management engine
- **Emscripten** - WASM compilation toolchain
- **jsColorEngine** (Glenn Wilton) - Original JavaScript reference

---

## Document History

| Date       | Author          | Changes                        |
| ---------- | --------------- | ------------------------------ |
| 2025-12-19 | Claude Opus 4.5 | Initial cross-workspace report |

---

*This document is intended for Claude Code in TFG to generate a detailed development article.*
