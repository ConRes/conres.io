# Test Snapshots

This folder contains JSON snapshot files for regression testing color conversion.

## Purpose

Snapshots capture known-good color conversion outputs to enable regression detection when code changes. Unlike mock-based tests that verify object shapes, snapshot tests verify **actual color values**.

## Structure

```text
snapshots/
  rgb-to-cmyk/
    relative-colorimetric.json    # RGB to CMYK with Relative Colorimetric
    k-only-gcr.json              # RGB to CMYK with K-Only GCR
  gray-to-cmyk/
    relative-colorimetric.json
    k-only-gcr.json
  lab-to-cmyk/
    relative-colorimetric.json    # Lab MUST use Relative Colorimetric
  content-streams/
    type-sizes-page1.json         # Content stream color ops from page 1
  images/
    16bit-rgb.json                # 16-bit big-endian RGB image
    8bit-lab.json                 # 8-bit Lab image
```

## Snapshot Format

Each JSON file contains:

```json
{
  "metadata": {
    "generated": "2026-01-23T00:00:00.000Z",
    "generator": "legacy",
    "sourceProfile": "sRGB IEC61966-2.1",
    "destinationProfile": "eciCMYK v2",
    "renderingIntent": "relative-colorimetric",
    "blackPointCompensation": true
  },
  "samples": [
    {
      "input": { "type": "RGB", "values": [1.0, 0.0, 0.0] },
      "expected": { "type": "CMYK", "values": [0.0, 1.0, 1.0, 0.0] },
      "tolerance": 0.001
    }
  ]
}
```

## Generating Snapshots

Use the legacy implementation to generate known-good snapshots:

```bash
node testing/iso/ptf/2025/experiments/scripts/generate-snapshots.js
```

## Updating Snapshots

When intentional changes are made to color conversion:

1. Verify the new output is correct (visual comparison, Acrobat validation)
2. Run `generate-snapshots.js` with the new implementation
3. Commit the updated snapshots with the code changes
