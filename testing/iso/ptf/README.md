# ISO PTF (PDF Test Form) Generator

**Purpose:** Generate PDF test forms for ISO standards compliance testing with integrated color management.  
**Status:** Active development - Color Engine integration in progress

---

## Quick Start

### Prerequisites

- Node.js 18+ (for `node:test` support)
- Yarn 4.x (package manager)

### Installation

```bash
# From repository root
yarn install
```

### Running the Application

```bash
# Start local development server on port 80
yarn local

# Or for testing on port 8080
yarn local:test
```

Then navigate to: `http://localhost/testing/iso/ptf/2025/index.html`

### Running Tests

```bash
# Run all tests (auto-starts server if needed)
yarn test

# Or run tests directly (requires server running)
yarn test
```

---

## Directory Structure

```
testing/iso/ptf/
├── 2025/                          # Current version
│   ├── index.html                 # Main entry point
│   ├── generate.js                # TestFormGenerator class
│   ├── helpers.js                 # Utility functions (Buffer, etc.)
│   │
│   ├── services/
│   │   ├── PDFService.js          # PDF manipulation service
│   │   ├── ColorSpaceUtils.js     # Color space analysis utilities
│   │   ├── ColorEngineService.js  # Color conversion abstraction (stub)
│   │   ├── ICCService.js          # ICC profile parsing
│   │   └── GhostscriptService.js  # GhostScript WASM integration
│   │
│   ├── packages/                  # Vendored dependencies
│   │   ├── pdf-lib/               # PDF manipulation library
│   │   ├── icc/                   # ICC profile parser
│   │   └── ghostscript-wasm/      # GhostScript WASM build
│   │
│   ├── experiments/               # Development experiments
│   │   ├── convert-color.html     # Standalone color conversion
│   │   ├── embed-output-intent.html
│   │   └── decalibrate/
│   │
│   └── tests/                     # Test suite
│       ├── PDFService.test.js     # Main test file
│       ├── playwright.config.js   # Playwright configuration
│       ├── run-tests.js           # Test runner with auto-server
│       └── fixtures/              # Test fixtures
│
└── README.md                      # This file
```

---

## Key Services

### PDFService

Main service for PDF manipulation. Key methods:

| Method                            | Description                                |
| --------------------------------- | ------------------------------------------ |
| `attachManifestToPDF`             | Attach JSON manifest to PDF                |
| `extractManifestFromPDF`          | Extract attached manifest                  |
| `extractICCProfilesFromPDF`       | Extract ICC profiles from document         |
| `setOutputIntentForPDF`           | Set PDF/X output intent                    |
| `embedSlugsIntoPDF`               | Embed slug pages into PDF                  |
| `decalibratePDFDocument`          | Replace ICC-based with device color spaces |
| `convertDocumentColors`           | Locate colors for conversion (WIP)         |
| `convertColor` / `convertColors`  | Color value conversion (stub)              |
| `replaceTransarencyBlendingSpace` | Update transparency blending               |
| `dumpPDFInfo`                     | Debug: dump PDF structure                  |

### ColorSpaceUtils

Utilities for color space analysis:

| Function                          | Description                        |
| --------------------------------- | ---------------------------------- |
| `analyzeColorSpaces`              | Analyze all color spaces in a PDF  |
| `isICCBasedColorSpace`            | Check if color space is ICC-based  |
| `getDeviceColorSpaceForICC`       | Map ICC to device color space      |
| `replaceICCWithDeviceColorSpaces` | Perform decalibration              |
| `parseContentStreamColors`        | Parse color operators from streams |
| `analyzePageColors`               | Analyze colors on a page           |

### ColorEngineService (Stub)

Abstraction layer for color conversion. Currently a stub pending integration with:

- `@conres/js-color-engine` (JavaScript implementation)
- `@conres/color-engine` (WebAssembly/LittleCMS implementation)

---

## Testing

Tests use `node:test` with Playwright for browser-based testing.

### Test Commands

```bash
# Run all tests with auto-server management
yarn test

# Run tests directly (requires server on port 8080)
yarn test

# Run specific test file
node --test testing/iso/ptf/2025/tests/PDFService.test.js
```

### Test Structure

```javascript
// Tests run in browser context via Playwright
describe('PDFService', () => {
    describe('Module Loading', () => { /* ... */ });
    describe('ICCService', () => { /* ... */ });
    describe('PDF Document Operations', () => { /* ... */ });
    describe('Color Space Analysis', () => { /* ... */ });
});
```

### Current Test Coverage

- Module loading verification
- pdf-lib import via importmap
- ICCService functionality
- PDF creation and loading
- Manifest attach/extract
- PDF info dumping

---

## Development

### Adding New Tests

1. Create test file in `testing/iso/ptf/2025/tests/`
2. Follow pattern from `PDFService.test.js`
3. Tests run in browser context via Playwright

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright-chromium';

describe('MyService', () => {
    test('my test', async () => {
        const result = await page.evaluate(async () => {
            // Browser context code
            const { MyService } = await import('./services/MyService.js');
            return MyService.doSomething();
        });
        assert.strictEqual(result, expected);
    });
});
```

### Adding Test Fixtures

Place test files in `testing/iso/ptf/2025/tests/fixtures/`:

- PDF files for testing
- ICC profiles
- Expected output files

---

## Color Engine Integration

This project is in the process of integrating the ConRes Color Engine to enable in-browser color transformations, eliminating the Adobe Acrobat dependency.

### Current Workflow (requires Adobe Acrobat)

```
Download PDF → Manual Acrobat Color Convert → Validate → Generate Labelled
```

### Target Workflow (Color Engine integrated)

```
Download PDF → In-Browser Color Transform → Validate → Generate Labelled
```

### Integration Progress

See [Color-Engine-Integration-Progress.md](/Color-Engine-Integration-Progress.md) for detailed status.

| Phase                      | Status                   |
| -------------------------- | ------------------------ |
| 1. Test Infrastructure     | Complete                 |
| 2. PDFService Refactoring  | Complete                 |
| 3. ColorEngineService      | Partial (stub)           |
| 4. convertDocumentColors   | Partial (discovery only) |
| 5. Workflow Integration    | Not Started              |
| 6. Cleanup & Documentation | Not Started              |

---

## Future: Monorepo Structure

The longer-term goal is to extract this as a separate package within a monorepo structure. This will enable:

- Independent versioning
- Shared color engine dependencies
- Cleaner separation of concerns

---

## Related Documentation

- [ConRes-Color-Engine-For-PDF-Processing.md](/ConRes-Color-Engine-For-PDF-Processing.md) - Color Engine API reference
- [Color-Engine-Integration-Progress.md](/Color-Engine-Integration-Progress.md) - Integration progress tracking
