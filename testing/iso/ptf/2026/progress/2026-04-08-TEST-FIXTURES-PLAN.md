# Test Fixtures Plan — Smart Multi-Purpose PDF Fixture

**Created:** 2026-04-08
**Last Updated:** 2026-04-08
**Status:** Planning

---

## Problem

Unit tests pass but bugs surface in production. Tests use small synthetic inputs and mock conversions. Nothing tests real PDFs through the full conversion pipeline. Bugs occur at boundaries (chunk, scope, worker lifecycle, timing) that unit tests never exercise.

## Design Principle

**One rich fixture PDF, many test perspectives.** A single comprehensive PDF exercises all test scenarios. Tests slice into it at different levels of granularity, using a staged conditional strategy that runs fast when everything works and becomes verbose only when something fails.

## Directory Structure

```
tests/fixtures/
  references/           — smart multi-purpose PDFs (committed, built by generate-fixtures.mjs)
  baselines/            — known-good conversion outputs (committed JSON)
  snapshots/            — node:test auto-generated snapshots (--test-update-snapshots)
  profiles/             — (existing) ICC profiles
  pdfs/                 — (existing) large real-world PDFs
  generate-fixtures.mjs — builds all reference PDFs using pdf-lib low-level APIs
```

## The Fixture: `color-conversion-matrix.pdf`

A single PDF (~20-30 KB) that packs the maximum diagnostic value into the minimum size. Every page, every stream, every image, every pixel is chosen to exercise specific code paths and catch specific historical bugs.

### Page 1: ICCBased RGB + Lab + Device Colors + Graphics State

One content stream containing ALL of the following in sequence:

| Segment                | Content                                 | What It Tests                                                  |
| ---------------------- | --------------------------------------- | -------------------------------------------------------------- |
| ICCBased RGB fill      | `/CS0 cs 0.8 0.2 0.1 scn` + rect fill   | Color conversion accuracy (Bug 2: downsampling)                |
| ICCBased RGB stroke    | `/CS0 CS 0.1 0.3 0.9 SCN` + rect stroke | Stroke vs fill operator mapping                                |
| Graphics state push    | `q`                                     | State stack save                                               |
| DeviceGray fill        | `0.5 g` + rect fill                     | Device passthrough / `convertDeviceGray` flag                  |
| DeviceRGB fill         | `1 0 0 rg` + rect fill                  | Device passthrough / `convertDeviceRGB` flag                   |
| DeviceCMYK fill        | `0 0 0 1 k` + rect fill                 | CMYK passthrough                                               |
| Graphics state pop     | `Q`                                     | State stack restore — color space must revert to `/CS0`        |
| ICCBased RGB after Q   | `0.3 0.6 0.9 scn` + rect fill           | Color space restoration after Q (Bug: state stack)             |
| Parenthesized string   | `(The rg color 0 1 0 rg is inside) Tj`  | String span handling — must not parse operators inside strings |
| Nested parens          | `(Nested (0.8 G) parens) Tj`            | Balanced paren depth counter                                   |
| Lab fill               | `/CS1 cs 50 -20 40 sc` + rect fill      | Lab color space conversion                                     |
| Lab stroke             | `/CS1 CS 90 0 0 SC` + rect stroke       | Lab stroke conversion                                          |
| ICCBasedGray fill      | `/CS2 cs 0.5 scn` + rect fill           | Single-component ICC profile                                   |
| Padding to > 400 bytes | Drawing ops (`m`, `l`, `re`, `S`)       | Ensures carry zone (last 200 bytes) contains operators         |
| SCN near end           | `0.7 0.4 0.2 SCN` + rect stroke         | Carry boundary — `SCN` in last 200 bytes (Bug 4: `kn`)         |

Total: ~500-600 bytes decompressed. Compressed to ~200-300 bytes via FlateDecode.

Color spaces in Resources:

- `/CS0` → ICCBased, 3 components, sRGB profile
- `/CS1` → Lab, WhitePoint `[0.9505 1.0 1.089]`, Range `[-128 127 -128 127]`
- `/CS2` → ICCBased, 1 component, sGray profile

### Page 2: Multi-Stream Color Space Carryover

Two content streams in a `Contents` array (PDF spec allows multiple streams logically concatenated per page):

**Stream 1:**

- `/CS0 cs 0.8 0.2 0.1 scn` + rect fill — sets fill color space to ICCBased RGB
- `/CS0 CS 0.4 0.5 0.6 SCN` + rect stroke — sets stroke color space

**Stream 2 (no `cs`/`CS` — must inherit from Stream 1):**

- `0.3 0.6 0.9 scn` + rect fill — must resolve to ICCBased RGB via carryover
- `0.1 0.2 0.3 SCN` + rect stroke — must resolve to ICCBased RGB via carryover
- `q` / `0.5 g` + rect / `Q` / `0.9 0.1 0.1 scn` + rect — state stack with carryover

Same Resources as Page 1.

### Page 3: Device Colors Only

One content stream with ALL six Device color operators interleaved with drawing:

```
0.5 g 50 50 100 100 re f
0.75 G 50 50 100 100 re S
1 0 0 rg 200 50 100 100 re f
0 1 0 RG 200 50 100 100 re S
0 0 0 1 k 350 50 100 100 re f
0.2 0.3 0.4 0.5 K 350 50 100 100 re S
```

No Resources/ColorSpace entries. Tests Device color passthrough and `convertDevice*` flag paths.

### Images (XObjects on Page 1)

#### `/Im0`: ICCBased RGB, 16-bit, 4×4 pixels

Diagnostic pixel grid — each pixel chosen to exercise a specific conversion path:

| Row | Pixel 1                       | Pixel 2                       | Pixel 3                           | Pixel 4                              |
| --- | ----------------------------- | ----------------------------- | --------------------------------- | ------------------------------------ |
| 1   | Pure red `[FFFF,0000,0000]`   | Pure green `[0000,FFFF,0000]` | Pure blue `[0000,0000,FFFF]`      | White `[FFFF,FFFF,FFFF]`             |
| 2   | Black `[0000,0000,0000]`      | 50% gray `[8000,8000,8000]`   | 25% gray `[4000,4000,4000]`       | 75% gray `[C000,C000,C000]`          |
| 3   | Skin tone `[D4A0,8C60,6E40]`  | Sky blue `[5080,90C0,E0FF]`   | Grass green `[4080,A040,2000]`    | Sunset orange `[FF00,8000,2000]`     |
| 4   | Near-black `[0100,0100,0100]` | Near-white `[FE00,FE00,FE00]` | Saturated cyan `[0000,FFFF,FFFF]` | Saturated magenta `[FFFF,0000,FFFF]` |

Row 1: primaries + white (tests gamut boundary conversion).
Row 2: neutrals (tests K-Only GCR rendering intent).
Row 3: real-world colors (tests practical accuracy).
Row 4: edge cases (near-limits, secondary primaries).

Color space: ICCBased RGB, 3 components, sRGB profile. BitsPerComponent: 16. FlateDecode compressed.

Raw size: 4×4×3×2 = 96 bytes.

#### `/Im1`: DeviceGray, 8-bit, 4×4 pixels

16-step grayscale ramp from 0 to 255:

```
0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255
```

Tests passthrough when `convertDeviceGray=false`, conversion when `true`.

Raw size: 16 bytes.

## Baseline Format

One baseline JSON per conversion configuration:

```json
{
  "metadata": {
    "fixture": "color-conversion-matrix.pdf",
    "generated": "2026-04-08T...",
    "sourceProfiles": {
      "CS0": "sRGB IEC61966-2.1",
      "CS1": "Lab",
      "CS2": "sGray"
    },
    "destinationProfile": "eciCMYK v2",
    "renderingIntent": "relative-colorimetric",
    "blackPointCompensation": true
  },
  "pages": [
    {
      "pageIndex": 0,
      "streams": [
        {
          "operatorCount": { "cs/CS": 6, "sc/SC/scn/SCN": 8, "g/G": 2, "rg/RG": 2, "k/K": 2 },
          "conversions": [
            { "original": { "op": "scn", "values": [0.8, 0.2, 0.1] },
              "converted": { "op": "k", "values": [0.05, 0.89, 0.82, 0.01] },
              "tolerance": 0.005 }
          ],
          "passthrough": { "deviceGrayCount": 1, "deviceRGBCount": 1, "deviceCMYKCount": 1 },
          "streamHash": "sha256-of-passthrough-bytes"
        }
      ],
      "images": [
        { "name": "Im0", "pixels": 16, "outputHash": "sha256-of-converted-pixels" }
      ]
    }
  ]
}
```

## Staged Conditional Test Strategy

Tests run in a cascade — each level only triggers if the broader level fails.

### Level 0: Broad Pass (always runs, < 1s)

```javascript
test('color-conversion-matrix: full document conversion', async (t) => {
    const result = await convertFixture('color-conversion-matrix.pdf', config);
    t.assert.snapshot({
        pageCount: result.pageCount,
        totalStreamsConverted: result.totalStreamsConverted,
        totalImagesConverted: result.totalImagesConverted,
        errors: result.errors,
    });
});
```

If this passes → all below are skipped. If it fails → Level 1 triggers.

### Level 1: Per-Page (triggered by Level 0 failure)

```javascript
test('color-conversion-matrix: page-level diagnostics', {
    skip: level0Passed && 'Level 0 passed — page diagnostics not needed',
}, async (t) => {
    for (const page of result.pages) {
        t.assert.snapshot({
            pageIndex: page.pageIndex,
            streamCount: page.streams.length,
            imageCount: page.images.length,
            operatorCounts: page.operatorCounts,
        });
    }
});
```

Identifies WHICH page failed. If all pages match → problem is in document-level orchestration. If one page fails → Level 2 triggers for that page.

### Level 2: Per-Stream (triggered by Level 1 failure)

```javascript
test('color-conversion-matrix: stream-level diagnostics', {
    skip: level1Passed && 'Level 1 passed — stream diagnostics not needed',
}, async (t) => {
    for (const stream of failingPage.streams) {
        t.assert.snapshot({
            operatorInventory: stream.operators.map(op => ({
                operator: op.operator,
                values: roundValues(op.values, 4),
            })),
            ordering: stream.operatorPositions, // verify operators before drawing ops
            passthroughHash: stream.passthroughHash,
        });
    }
});
```

Identifies WHICH stream and WHAT about it failed — wrong values, wrong ordering, missing operators, stray characters.

### Level 3: Boundary Diagnostics (triggered by specific Level 2 failures)

```javascript
test('color-conversion-matrix: carry boundary verification', {
    skip: !level2FoundOrderingOrStrayChar && 'No ordering/boundary issues detected',
}, async (t) => {
    // Extract raw content stream bytes from Page 1
    // Re-chunk at controlled offsets around CARRY_SIZE boundaries
    // Run through transformFromAsync with each chunking
    // Verify round-trip identity
});
```

Only runs if Level 2 found ordering issues or stray characters — the signature of a carry boundary bug.

## Snapshot Testing

Node.js 24.7 `t.assert.snapshot()`:

- Snapshots auto-stored in `tests/fixtures/snapshots/`
- Update with `node --test --test-update-snapshots`
- Captures structured data (operator inventories, color values rounded to 4 decimals, hashes)
- Platform-stable: float values rounded, hashes only on passthrough bytes

## Test File Organization

| Test File                       | What It Tests              | Fixture Coverage |
| ------------------------------- | -------------------------- | ---------------- |
| `pdf-conversion-matrix.test.js` | Staged cascade (Level 0-3) | Entire fixture   |

One test file. The staged cascade handles all granularity levels internally. No need for separate files per concern — the cascade routes to the right diagnostics automatically.

Existing unit tests remain for fast isolated checks. The fixture test is the integration gate.

## Implementation Sequence

1. Create `generate-fixtures.mjs` — pdf-lib low-level helpers for ICCBased, Lab, images
2. Build `color-conversion-matrix.pdf` with all 3 pages, 2 images, all color space varieties
3. Generate baselines by converting with the current (working) Chromium pipeline
4. Write `pdf-conversion-matrix.test.js` with Level 0-3 cascade
5. Run with `--test-update-snapshots` to bootstrap
6. Verify regression detection: break a value, confirm test failure at correct level

## Pattern Generator + Validator Architecture

The fixture PDF uses small (4 DPI) diagnostic images for correctness testing. For pressure testing, the same PDF structure is used but with large (2400 DPI) pattern-generated images.

### Pattern Generator

Creates deterministic pixel data at any resolution:

- Gradients (linear ramp across a channel)
- Ramps (full gamut sweep)
- Checker patterns (alternating known values)
- Neutral ramps (gray axis for K-Only GCR testing)

Parameterized: `generatePattern(width, height, type, colorSpace)`. Same patterns at 4x4 and 2400x2400 — only the resolution changes.

### Validator

Verifies converted output **mathematically**, not by comparison to a stored baseline:

- Given input pattern + conversion parameters (profiles, intent, BPC), computes expected output
- Reports: delta-E distribution, max error, outlier count, pass/fail per region
- Uses CRC checksums on pixel regions for fast pass/fail — when CRC matches, skip delta-E
- When CRC mismatches, delta-E analysis quantifies the difference

### What Snapshots Capture

Snapshots capture the **validator's summary indicators**, not raw pixel data:

```json
{
  "regionCRCs": { "row0": "a1b2c3d4", "row1": "e5f6a7b8" },
  "deltaE": { "mean": 0.12, "max": 0.45, "p95": 0.31, "outliers": 0 },
  "passRate": 1.0
}
```

If the validator's indicators change, the snapshot test catches it. The validator is the source of truth.

### Two Modes

| Mode                  | Image Size       | Run Condition                                     | What It Tests                                 |
| --------------------- | ---------------- | ------------------------------------------------- | --------------------------------------------- |
| Correctness (default) | 4x4 pixels       | Always (`yarn test`)                              | Value accuracy, operator handling             |
| Pressure              | 2400x2400 pixels | Conditional (env var or after correctness passes) | Memory, chunking, worker lifecycle under load |

Pressure mode only triggers after all correctness tests pass — correctness failures would make pressure results unreliable.

## Challenges

1. **pdf-lib low-level construction** — no high-level API for ICCBased/Lab. Use `context.register(context.obj(...))` matching `#extractColorSpaceDefinitions`
2. **Chunk boundaries non-deterministic** — Level 3 uses manual chunking for deterministic tests alongside full pipeline for realistic tests
3. **Float precision** — round to 4 decimal places in snapshots, CRCs for fast comparison
4. **Fixture idempotency** — `generate-fixtures.mjs` must produce byte-identical output on every run (fixed timestamps, deterministic compression)
5. **Pattern generator determinism** — patterns must be reproducible across runs and platforms for CRC stability

---

## Roadmap

- [ ] Create `generate-fixtures.mjs` with pdf-lib helpers
- [ ] Build `color-conversion-matrix.pdf`
- [ ] Generate baselines from Chromium conversion
- [ ] Write `pdf-conversion-matrix.test.js` (Level 0-3 cascade)
- [ ] Bootstrap snapshots
- [ ] Verify regression detection

---

## Activity Log

### 2026-04-08

- Identified 6 historical bugs that unit tests failed to catch
- Designed single multi-purpose fixture covering all failure patterns
- Defined staged conditional test strategy (4 levels, verbose only when needed)
- Each pixel in the image grid chosen for specific diagnostic value (primaries, neutrals, edge cases, real-world colors)
