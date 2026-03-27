# Internal Tools

Supporting tools for agents and targeted debugging. These complement the [primary tools](../README.md) but are not part of the primary toolkit surface.

## Agent Tools

| Tool | Purpose | Usage |
|---|---|---|
| `convert-colors.js` | Convert individual color values through the engine | `node convert-colors.js profile.icc [--verbose] [--legacy]` |
| `inspect-content-stream-colors.js` | Parse and display content stream color operators | `node inspect-content-stream-colors.js document.pdf [--verbose] [--legacy]` |
| `trace-pdf-conversion.js` | Trace the full PDF conversion pipeline step by step | `node trace-pdf-conversion.js input.pdf profile.icc [output.pdf] [--legacy]` |
| `compare-color-values.js` | Compare color values between two converted PDFs | `node compare-color-values.js expected.pdf actual.pdf` |
| `analyze-image-masking.mjs` | Analyze stencil and soft mask properties on PDF images | `node analyze-image-masking.mjs document.pdf [--verbose]` |

## Engine Inspection

| Tool | Purpose | Usage |
|---|---|---|
| `inspect-color-engine.js` | Consolidated engine inspection and validation | See modes below |

### `inspect-color-engine.js` Modes

```bash
node inspect-color-engine.js --dump-formats              # Dump all format constants
node inspect-color-engine.js --test-format=Gray           # Test format resolution for a color space
node inspect-color-engine.js --test-sampler               # Test 16-bit image sampling path
node inspect-color-engine.js --smoke-test                 # Smoke test all color spaces
node inspect-color-engine.js --noise-test                 # Engine determinism characterization
```

## Testing

| Tool | Purpose | Usage |
|---|---|---|
| `test-experiment-classes.js` | Test runner for `experiments/classes/` | `node test-experiment-classes.js [--suite=all] [--verbose]` |

### Test Suites

```bash
node test-experiment-classes.js --suite=all                      # Run all
node test-experiment-classes.js --suite=color-change-metrics     # ColorChangeMetrics
node test-experiment-classes.js --suite=comparison-classes        # Coordinator + metrics classes
node test-experiment-classes.js --suite=content-stream-extractor # ContentStreamColorExtractor
node test-experiment-classes.js --suite=delta-e                  # Delta-E computation
```

## Other

| Item | Purpose |
|---|---|
| `convert-diagnostics-profile.js` | Convert diagnostics JSON to various formats |
| `extract-pdf-text.js` | Extract text content from PDF pages |
| `parse-preflight-report.js` | Parse Adobe Acrobat preflight XML reports |
| `diagnose-worker-lifecycle.html` | Browser diagnostic for worker pool lifecycle |

## Legacy

The `legacy/` directory contains standalone procedural implementations spawned by `--legacy` flags on dual-mode tools. Do not invoke directly.
