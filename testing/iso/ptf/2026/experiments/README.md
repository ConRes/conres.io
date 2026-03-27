# ConRes PDF Toolkit — Experiments

Primary CLI tools for PDF color conversion, analysis, and comparison.

## Tools

| Tool | Purpose |
|---|---|
| `convert-pdf-color.js` | Convert PDF colors using ICC profiles with rendering intents |
| `compare-pdf-color.js` | Compare two PDFs (expected vs actual color conversion output) |
| `compare-pdf-outputs.js` | Compare PDF outputs with configurable metrics and sampling |
| `analyze-pdf-structure.js` | Analyze PDF structure: resources, images, color spaces, operators |
| `validate-pdf.js` | Validate PDF color spaces, ICC profiles, and structure |
| `pdf-diff.js` | Pixel-level PDF image comparison via Lab Delta-E |
| `tiff-diff.js` | TIFF Lab image pixel-level comparison |
| `generate-verification-matrix.mjs` | Config-driven PDF conversion regression verification matrix |

## Diagnostics

| Tool | Purpose |
|---|---|
| `diagnose-k-only-gcr.js` | Comprehensive K-Only GCR rendering intent diagnostic |
| `diagnose-worker-streams.js` | Diagnose worker vs main thread content stream conversion |
| `benchmark-color-engine.js` | Benchmark LittleCMS vs JS color engine performance |

## Usage

All tools support `--help`. Paths are resolved relative to CWD.

```bash
node convert-pdf-color.js input.pdf profile.icc output.pdf --rendering-intent=relative --bpc
node analyze-pdf-structure.js document.pdf --show-images --show-colorspaces
node pdf-diff.js expected.pdf actual.pdf --verbose
```

## Internal Tools

Additional tools for agents and targeted debugging are in [`internal/`](internal/README.md).
