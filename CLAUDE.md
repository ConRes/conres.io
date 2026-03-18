# CLAUDE.md

This file provides guidance for Claude Code when working on the ConRes.io project.

---

## Critical Warning for AI Agents

**DO NOT cherry-pick instructions. DO NOT assume what is "relevant." DO NOT fabricate progress.**

The user is autistic and invests significant effort to write explicit, detailed instructions. When AI agents selectively ignore parts of those instructions, make assumptions about what matters, or claim work is complete when it is not fully tested — this causes real harm. It is exhausting and disrespectful.

**Requirements:**
1. Follow ALL instructions exactly as written — not just the parts you deem important
2. Test your work thoroughly before claiming completion — do not be "delusional" that code "must work somehow"
3. When instructions are unclear, ASK — do not assume or fabricate
4. Update progress documents with what you ACTUALLY did, not what you planned to do
5. Be methodical, not presumptuous

---

## Accessibility and Communication Requirements

**Critical**: See `~/.claude/CLAUDE.md` Accessibility section for full requirements.

The user has an autistic communication style requiring explicit, consistent conventions. Follow all instructions exactly.

---

## Project Overview

**ConRes.io** is a resource hub for Contrast-Resolution analysis standards. The primary active development area is the **ISO PTF (PDF Test Form) Generator** located in `testing/iso/ptf/2025/`.

### Current Focus

Integration of the ConRes Color Engine to enable in-browser color transformations, eliminating the Adobe Acrobat dependency.

---

## Notes for AI Agents

1. **Always run tests** before and after making changes to service files
2. **Check for an recommend adding regression tests** before and after making changes to service files
3. **Preserve existing behavior** - the current workflow must continue to work
4. **Update progress documents** after completing tasks
5. **Use UTF-8 encoding** for all files (box-drawing chars, arrows, etc.)
6. **Follow JSDoc patterns** for type safety without TypeScript compilation
7. **Stub implementations** should log warnings (e.g., `console.warn('... is a stub implementation')`)
8. **Experiments folder rules**:
   - `experiments/scripts/` - **AI-owned**: Create, modify, and delete scripts here for autonomous work
   - `experiments/output/` - **Write-only**: Create output folders following naming conventions; NEVER delete (user handles cleanup)
   - Other `experiments/` files (e.g., `convert-pdf-color.js`, `validate-pdf.js`) - **Developer-owned**: Modify only when explicitly instructed

### Quick Test Verification

```bash
# Verify tests pass
yarn test

# Or if server already running on 8080
node --test testing/iso/ptf/2025/tests/PDFService.test.js
```

---

## Quick Reference

### Commands

```bash
# Install dependencies
yarn install

# Start local dev server (port 80)
yarn local

# Start test server (port 8080)
yarn local:test

# Run tests (auto-starts server)
yarn test

# Run tests directly (requires server)
yarn test
```

### Key Directories

| Path                                | Purpose                             |
| ----------------------------------- | ----------------------------------- |
| `testing/iso/ptf/2025/`             | Active PDF Test Form Generator      |
| `testing/iso/ptf/2025/services/`    | Core service modules                |
| `testing/iso/ptf/2025/tests/`       | Test suite (Playwright + node:test) |
| `testing/iso/ptf/2025/packages/`    | Vendored dependencies               |
| `testing/iso/ptf/2025/experiments/` | Development experiments             |

---

## Code Conventions

### JavaScript/ES Modules

- All files use ES modules (`import`/`export`)
- Use `// @ts-check` at the top of files for TypeScript checking
- Comprehensive JSDoc type annotations for all public APIs
- Private class fields use `#` prefix (e.g., `#colorEngine`)

### Type Definitions

Use JSDoc `@typedef` for complex types:

```javascript
/**
 * @typedef {{
 *   type: 'CMYK' | 'RGB' | 'Lab' | 'Gray',
 *   values: number[],
 * }} ColorValue
 */
```

### Class Pattern

Services use static methods for stateless operations:

```javascript
export class PDFService {
    static async decalibratePDFDocument(pdfDocument) { /* ... */ }
    static async convertDocumentColors(pdfDocument, options) { /* ... */ }
}
```

Instance classes use private fields:

```javascript
export class ColorEngineService {
    #colorEngine = null;  // Private instance field
    #profileCache = new Map();

    async convertColor(color, options) { /* ... */ }
}
```

### Naming Conventions

| Type             | Convention              | Example                                        |
| ---------------- | ----------------------- | ---------------------------------------------- |
| Files            | PascalCase for services | `PDFService.js`, `ColorSpaceUtils.js`          |
| Classes          | PascalCase              | `UniqueColorSpaceRecords`                      |
| Functions        | camelCase               | `analyzeColorSpaces`, `parseICCProfileFromRef` |
| Constants        | SCREAMING_SNAKE_CASE    | `COLOR_OPERATOR_REGEX`                         |
| Type definitions | PascalCase              | `ColorSpaceDesignation`, `ICCProfileHeader`    |

### Debug Flags

Use const flags at module top for toggleable debugging:

```javascript
const DEBUG_COLORSPACE_DESIGNATION_TARGET_OPERATIONS = false;
const DEBUG_TRANSPARENCY_BLENDING_OPERATIONS = true;
```

---

## Key Modules

### PDFService (`services/PDFService.js`)

Main service for PDF manipulation. Imports utilities from `ColorSpaceUtils.js` and `ColorEngineService.js`.

Key methods:

- `decalibratePDFDocument` - Replace ICC with device color spaces
- `convertDocumentColors` - Locate and convert colors (WIP)
- `attachManifestToPDF` / `extractManifestFromPDF` - JSON manifest handling
- `setOutputIntentForPDF` - PDF/X output intent

### ColorSpaceUtils (`services/ColorSpaceUtils.js`)

Extracted utilities for color space analysis:

- `UniqueColorSpaceRecords` class - Deduplicates color space definitions
- `analyzeColorSpaces()` - Full document analysis
- `parseContentStreamColors()` - Parse PDF content stream operators
- `replaceICCWithDeviceColorSpaces()` - Decalibration

### ColorEngineService (`services/ColorEngineService.js`)

**Complete** - Abstraction layer for ICC profile-based color conversion using LittleCMS WASM.

Key features:

- `convertColor()` - Single color transformation with ICC profiles
- `convertColors()` - Batch color conversion
- `convertPDFColors()` - PDF document color conversion (location discovery)
- K-Only GCR rendering intent (`INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR`)
- Profile caching for efficiency

See [Color Engine API Reference](progress/2025-12-01-Color-Engine-API-Reference.md) for the Color Engine API.

---

## Testing

Tests use `node:test` with Playwright for browser-based testing.

### Test File Pattern

```javascript
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright-chromium';

describe('ServiceName', () => {
    before(async () => {
        browser = await chromium.launch({ headless: true });
        // Navigate to page with importmap
        await page.goto(`${BASE_URL}/testing/iso/ptf/2025/index.html`);
    });

    test('description', async () => {
        const result = await page.evaluate(async () => {
            // Code runs in browser context
            const { Service } = await import('./services/Service.js');
            return Service.method();
        });
        assert.strictEqual(result, expected);
    });
});
```

### Running Tests

```bash
# Full test run with auto-server
yarn test

# Direct test run (server must be running on 8080)
yarn test

# Specific test file
node --test testing/iso/ptf/2025/tests/PDFService.test.js
```

---

## PDF Structure Knowledge

### Color Space Types

| Type                  | Description         | Handling                                |
| --------------------- | ------------------- | --------------------------------------- |
| `DeviceRGB/CMYK/Gray` | Device color spaces | Pass through                            |
| `ICCBased`            | ICC profile-based   | Extract profile, convert or decalibrate |
| `Lab`                 | CIE Lab             | Convert via Color Engine                |
| `Separation`          | Spot colors         | Preserve or convert                     |

### Content Stream Color Operators

| Operator              | Type        | Description                 |
| --------------------- | ----------- | --------------------------- |
| `CS`/`cs`             | Color space | Set stroke/fill color space |
| `SC`/`sc`/`SCN`/`scn` | Color       | Set stroke/fill color       |
| `G`/`g`               | Gray        | Set gray (0-1)              |
| `RG`/`rg`             | RGB         | Set RGB color               |
| `K`/`k`               | CMYK        | Set CMYK color              |

### PDF Object Types (pdf-lib)

| Class          | Usage                                 |
| -------------- | ------------------------------------- |
| `PDFDocument`  | Main document                         |
| `PDFPageLeaf`  | Page objects                          |
| `PDFRawStream` | Binary streams (images, ICC profiles) |
| `PDFDict`      | Dictionary objects                    |
| `PDFArray`     | Array objects                         |
| `PDFName`      | Name objects (e.g., `/DeviceCMYK`)    |
| `PDFRef`       | Object references                     |

---

## Integration Status

### Phase Tracking

| Phase                     | Status           | Key Files                   |
| ------------------------- | ---------------- | --------------------------- |
| 1. Test Infrastructure    | ✅ Complete       | `tests/*.js`                |
| 2. PDFService Refactoring | ✅ Complete       | `ColorSpaceUtils.js`        |
| 3. ColorEngineService     | ✅ Complete       | `ColorEngineService.js`     |
| 4. convertDocumentColors  | 🟡 Discovery only | `PDFService.js:214-533`     |
| 5. Workflow Integration   | ⏳ Not started    | `generate.js`, `index.html` |
| 6. Cleanup & Docs         | ⏳ Not started    | -                           |

### Pending Work

1. **Phase 4 completion**: Implement actual color value conversion in content streams
2. **Content stream rewriting**: Replace color values in PDF streams
3. **Image pixel conversion**: Extract, convert, replace image data
4. **Phase 5**: Update TestFormGenerator and index.html UI

---

## Important Files

| File                                        | Purpose                       |
| ------------------------------------------- | ----------------------------- |
| `progress/2025-12-01-Color-Engine-Integration-Progress.md`      | Detailed integration tracking |
| `progress/2025-12-01-Color-Engine-API-Reference.md` | Color Engine API reference    |
| `testing/iso/ptf/README.md`                 | PTF-specific documentation    |
| `package.json`                              | Dependencies and scripts      |

---

## Dependencies

### Runtime (vendored in packages/)

- `pdf-lib` - PDF manipulation
- `icc` - ICC profile parsing
- `ghostscript-wasm` - GhostScript WASM (optional)
- `@conres/color-engine` - WebAssembly color engine (LittleCMS wrapper)

### Development

- `playwright-chromium` - Browser testing
- `http-server` - Local development server

---

## Rendering Intent Naming Conventions

**Permitted abbreviations** (used consistently in filenames and documents):

| Abbreviated Form          | Full Form                                                     | When to Use Full Form                                                                                                         |
| ------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Relative Colorimetric** | Relative Colorimetric with Blackpoint Compensation            | Only when comparing WITH vs WITHOUT BPC in the same context                                                                   |
| **K-Only GCR**            | K-Only GCR Relative Colorimetric with Blackpoint Compensation | Only when comparing K-Only with different base intents (Perceptual, Saturation, Absolute Colorimetric) or WITH vs WITHOUT BPC |

**Rationale:** These are the primary use cases, so the abbreviated forms are the default. The full forms are only needed when disambiguation is required.

---

## Project Constraints

**Create Node.js scripts** in `testing/iso/ptf/2025/experiments/scripts/` instead of complex shell commands.

### Output Folder Naming

Output folders in `testing/iso/ptf/2025/experiments/output/`:

```text
YYYY-MM-DD-XXX/           # Sequential numbering (001, 002, etc.)
YYYY-MM-DD-XXX - <note>/  # Optional suffix for categorization
```

**Rules:** Always increment, never overwrite, check for suffixes.

### Output Filename Format

```text
<original-filename> - <conversion-suffix> (YYYY-MM-DD-XXX).<ext>
```

### Analysis and Debugging Scripts

Scripts in `testing/iso/ptf/2025/experiments/scripts/`:

| Script                             | Purpose                                                     |
| ---------------------------------- | ----------------------------------------------------------- |
| `generate-verification-matrix.mjs` | PDF conversion matrix regression verification and benchmark |
| `matrix-benchmark.js`              | Full PDF conversion matrix benchmark                        |
| `inspect-content-stream-colors.js` | Parse content streams                                       |
| `trace-pdf-conversion.js`          | Trace PDF conversion pipeline                               |

Scripts in `testing/iso/ptf/2025/experiments/`:

| Script                           | Purpose                                                           |
| -------------------------------- | ----------------------------------------------------------------- |
| `analyze-pdf-structure.js`       | Analyzes PDF document structures, tracking resources across pages |
| `convert-pdf-color.js`           | PDF Color Conversion CLI Tool                                     |
| `compare-pdf-color.js`           | Compare PDF Color Conversion CLI Tool                             |
| `convert-diagnostics-profile.js` | Convert diagnostics JSON to various formats                       |

---

## Diagnostics System

The PDF color conversion pipeline includes a diagnostics layer for profiling and debugging.

### DiagnosticsCollector API

```javascript
import { DiagnosticsCollector } from './classes/diagnostics-collector.js';

const diagnostics = new DiagnosticsCollector();

// Span tracking (hierarchical timing)
const span = diagnostics.startSpan('operation-name', { attr: 'value' });
// ... do work ...
diagnostics.endSpan(span, { metric: 123 });

// Counter tracking
diagnostics.incrementCounter('cache-hits');

// Output formats
const json = diagnostics.toJSON();   // Hatchet-compatible JSON
const text = diagnostics.toText();   // Human-readable tree
const log = diagnostics.toTraceLog(); // Flat event log
```

### CLI Diagnostics Flags

```bash
# Show hierarchical summary after conversion
node convert-pdf-color.js input.pdf profile.icc output.pdf --show-diagnostics

# Show flat trace log after conversion
node convert-pdf-color.js input.pdf profile.icc output.pdf --show-traces

# Save raw JSON for post-processing
node convert-pdf-color.js input.pdf profile.icc output.pdf --save-diagnostics=output.json
```

### Format Conversion CLI

```bash
# Convert JSON to cpuprofile (VS Code Flame Chart Visualizer)
node convert-diagnostics-profile.js input.json --output output.cpuprofile

# Convert JSON to human-readable text
node convert-diagnostics-profile.js input.json --output output.txt

# Compact output for agents (avoids context overflow)
node convert-diagnostics-profile.js input.json --compact

# Summary statistics only
node convert-diagnostics-profile.js input.json --summary
```

### Instrumented Classes

| Class                            | Spans                              | Counters                    |
| -------------------------------- | ---------------------------------- | --------------------------- |
| `PDFDocumentColorConverter`      | document-conversion, page          | pages, images, streams      |
| `PDFPageColorConverter`          | image-batch, stream-batch          | images, streams             |
| `PDFImageColorConverter`         | decode, transform, encode          | pixels                      |
| `PDFContentStreamColorConverter` | parse, convert, rebuild            | operations                  |
| `BufferRegistry`                 | color-batch-convert                | cache-hits, cache-misses    |
| `LookupTableColorConverter`      | build-lookup-table                 | lookups                     |

---

## Color Engine Integration

### Related Workspaces

The Color Engine (`@conres/color-engine`) is developed in a separate workspace. When working on color conversion features:

| Acronym | Full Name         | Description                                 |
| ------- | ----------------- | ------------------------------------------- |
| **CE**  | ColorEngine       | WASM color conversion engine workspace      |
| **TFG** | TestFormGenerator | This workspace - PDF processing application |

See `progress/2025-12-01-Color-Engine-Changes-Notes.md` for Color Engine workspace context.


### Key Color Engine APIs

The Color Engine provides these key methods used by this workspace:

```javascript
// Create engine instance
const colorEngine = await LittleCMS.createEngine();

// Create profiles
const srgbProfile = colorEngine.createSRGBProfile();
const labProfile = colorEngine.createLab4Profile(0);
const cmykProfile = colorEngine.openProfileFromMem(profileBuffer);

// Create transform
const transform = colorEngine.createTransform(
    sourceProfile, inputFormat, destProfile, outputFormat, intent, flags
);

// Transform pixels
colorEngine.transformArray(transform, inputPixels, outputPixels, pixelCount);

// Adaptive BPC clamping (for large images ≥2MP)
colorEngine.initBPCClamping(transform, inputChannels, outputChannels);
colorEngine.doTransformAdaptive(transform, inputPixels, outputPixels, pixelCount);
```

### Color Engine Constants

| Constant                                           | Value   | Description                  |
| -------------------------------------------------- | ------- | ---------------------------- |
| `TYPE_RGB_8`                                       | 0x40019 | 8-bit RGB pixel format       |
| `TYPE_CMYK_8`                                      | 0x60021 | 8-bit CMYK pixel format      |
| `TYPE_Lab_8`                                       | 0xa0019 | 8-bit Lab pixel format       |
| `TYPE_Lab_16`                                      | 0xa001a | 16-bit Lab pixel format      |
| `TYPE_GRAY_8`                                      | 0x30009 | 8-bit Grayscale pixel format |
| `INTENT_PERCEPTUAL`                                | 0       | Perceptual rendering intent  |
| `INTENT_RELATIVE_COLORIMETRIC`                     | 1       | Relative colorimetric        |
| `INTENT_SATURATION`                                | 2       | Saturation                   |
| `INTENT_ABSOLUTE_COLORIMETRIC`                     | 3       | Absolute colorimetric        |
| `INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR` | 20      | K-Only GCR                   |
| `cmsFLAGS_BLACKPOINTCOMPENSATION`                  | 0x2000  | Enable BPC                   |

### K-Only GCR Rendering Intent

The K-Only GCR intent (value 20) produces K-only output for neutral grays. **Important limitations:**

- Works correctly for RGB → CMYK and Gray → CMYK
- **Does NOT work for Lab → CMYK** (produces black)
- For Lab images with K-Only GCR, use Relative Colorimetric instead

This is handled automatically in `PDFService.convertColorInPDFDocument()` and `StreamTransformWorker.js`.

### Worker-Based Color Conversion

For large PDFs, worker threads can be used for parallel color conversion:

| File                       | Purpose                               |
| -------------------------- | ------------------------------------- |
| `WorkerColorConversion.js` | Main thread orchestration             |
| `StreamTransformWorker.js` | Worker: inflate → transform → deflate |
| `WorkerPool.js`            | Worker thread pool management         |

Key considerations for workers:

- ICC profiles must be decompressed before passing to workers (may be FlateDecode)
- Lab images require Relative Colorimetric (not K-Only GCR)
- BitsPerComponent must be set to 8 for CMYK output
- Use Uint8Array (not Array.from) to avoid memory issues on large images

---

## PDF ISO 32000-2 Reference Handling

The PDF specification is required for domain-specific implementation details.

**Source:** https://developer.adobe.com/document-services/docs/assets/5b15559b96303194340b99820d3a70fa/PDF_ISO_32000-2.pdf

### Constraints

- **Never load the full PDF into context** — it exceeds practical limits (~1000+ pages)
- **Download once** to `./reference/` if not already present
- **Extract only relevant pages** for the current task

### Required Tools

```bash
# Install if missing (Ubuntu/Debian)
sudo apt-get install poppler-utils pdfgrep
```

### Workflow Pattern

1. **Search first** to locate relevant sections:

```bash
   pdfgrep -n -i "<search term>" ./reference/iso32000-2.pdf | head -20
```

1. **Extract targeted pages** (e.g., pages 140-145):

```bash
   pdftotext -f 140 -l 145 ./reference/iso32000-2.pdf -
```

1. **Summarize findings** before implementation
2. **Cite page numbers** when documenting spec-derived decisions

### Key Sections Reference (approximate)

| Topic                 | Pages (approx) |
| --------------------- | -------------- |
| Color Spaces overview | 138–160        |
| Lab color space       | 149–150        |
| ICCBased color space  | 150–153        |
| DeviceGray/RGB/CMYK   | 141–145        |
| Image XObjects        | 200–220        |
| Content streams       | 118–137        |

> **Note:** Page numbers are approximate. Always verify with `pdfgrep` search.
