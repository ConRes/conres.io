# ConRes PDF Toolkit — Experiments

Primary CLI tools for PDF color conversion, analysis, and comparison.

## Tools

| Tool                               | Purpose                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `convert-pdf-color.js`             | Convert PDF colors using ICC profiles with rendering intents      |
| `compare-pdf-color.js`             | Compare two PDFs (expected vs actual color conversion output)     |
| `compare-pdf-outputs.js`           | Compare PDF outputs with configurable metrics and sampling        |
| `analyze-pdf-structure.js`         | Analyze PDF structure: resources, images, color spaces, operators |
| `validate-pdf.js`                  | Validate PDF color spaces, ICC profiles, and structure            |
| `pdf-diff.js`                      | Pixel-level PDF image comparison via Lab Delta-E                  |
| `tiff-diff.js`                     | TIFF Lab image pixel-level comparison                             |
| `generate-verification-matrix.mjs` | Config-driven PDF conversion regression verification matrix       |

## Diagnostics

| Tool                         | Purpose                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `diagnose-k-only-gcr.js`     | Comprehensive K-Only GCR rendering intent diagnostic     |
| `diagnose-worker-streams.js` | Diagnose worker vs main thread content stream conversion |
| `benchmark-color-engine.js`  | Benchmark LittleCMS vs JS color engine performance       |

## Usage

All tools support `--help`. Paths are resolved relative to CWD.

```bash
node convert-pdf-color.js input.pdf profile.icc output.pdf --rendering-intent=relative --bpc
node analyze-pdf-structure.js document.pdf --show-images --show-colorspaces
node pdf-diff.js expected.pdf actual.pdf --verbose
```

## Browser-Driven Generator Runs

Node.js drivers that launch a browser (via Playwright), open the
`2026/generator/` UI at `http://localhost/…`, configure it, upload an
output profile, click Generate, capture the console stream and downloads,
and extract a per-PDF fingerprint.

Located in `scripts/`:

| Script                        | Purpose                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `generator-run.mjs`           | Shared runner — browser launch, UI drive, memory polling, PDF fingerprint extraction         |
| `generate-baseline.mjs`       | Chromium baseline fingerprint (default CMYK profile, all layouts)                            |
| `webkit-verification.mjs`     | WebKit run + fingerprint diff against the Chromium baseline                                  |
| `debug-rgb-profile-loss.mjs`  | Targeted debug driver: user-specified RGB profile + layout subset, captures full trace       |

`generator-run.mjs` accepts:

- `profilePath` — any ICC profile; CWD-relative paths are resolved against `process.cwd()`; absolute paths pass through
- `enabledLayoutNames` — restricts assembly to a specific set of layouts (opens the customization panel, toggles layout mode to custom, checks only the named layouts)
- `port`, `headed`, `pollMemory`, `enableTracing`, `convertImages`, `convertContentStreams`, `useLegacyContentStreamParsing`, `interConversionDelay`

The dev server must be running (`yarn local` on port 80, or `yarn local:test` on 8080 with `--port=8080`).

Example:

```bash
node testing/iso/ptf/2026/experiments/scripts/debug-rgb-profile-loss.mjs \
     --profile-path=temp/FIPS_WIDE_28T-TYPEavg.icc
```

Downloads and log files land in the configured output directory (default `temp/debug-rgb-170/`).

## Internal Tools

Additional tools for agents and targeted debugging are in [`internal/`](internal/README.md).
