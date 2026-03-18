# Lab Absolute-Zero Pixel Coercion

## Problem

Photoshop uses Lab `0/-128/-128` in mask images to represent black. This value has L*=0 (correct for black) but a*=-128, b*=-128 which are at the extreme out-of-gamut boundary. When color engines perform transforms (e.g., Lab to CMYK, Lab to RGB, or Lab to Lab via a different profile), the out-of-gamut a/b values get pushed into gamut boundaries, producing non-black output. The result is visually incorrect: mask areas that should be solid black appear tinted.

## Byte-Level Encoding

Lab `0/-128/-128` encodes as **all-zero bytes** in every standard encoding:

| Encoding              | L      | a        | b        | Raw bytes                          |
| --------------------- | ------ | -------- | -------- | ---------------------------------- |
| 8-bit (ICC/LittleCMS) | 0x00   | 0x00     | 0x00     | `[0x00, 0x00, 0x00]`              |
| 16-bit big-endian     | 0x0000 | 0x0000   | 0x0000   | `[0x00, 0x00, 0x00, 0x00, 0x00, 0x00]` |

Lab `0/0/0` (proper black, neutral a/b) encodes as:

| Encoding              | L      | a        | b        | Raw bytes                          |
| --------------------- | ------ | -------- | -------- | ---------------------------------- |
| 8-bit (ICC/LittleCMS) | 0x00   | 0x80     | 0x80     | `[0x00, 0x80, 0x80]`              |
| 16-bit big-endian     | 0x0000 | 0x8000   | 0x8000   | `[0x00, 0x00, 0x80, 0x00, 0x80, 0x00]` |

## Fix Applied in PDFImageColorConverter

`classes/pdf-image-color-converter.js` applies coercion controlled by `const COERCE_LAB_ABSOLUTE_ZERO_PIXELS = true`:

1. **Before transform**: Scan Lab input pixels for all-zero byte triplets/sextets. Replace with Lab `0/0/0` encoded bytes. Track pixel positions when write-back is needed.
2. **If output is Lab**: Write back all-zero bytes at tracked positions after the transform (preserves round-trip fidelity for mask images).
3. **If output is CMYK with K-Only GCR intent**: Compute the profile's Relative Colorimetric black via an extra single-pixel transform (Lab `0/0/0` → CMYK, Relative Colorimetric + BPC). Write that CMYK value at tracked positions after the main transform. This ensures the correct black independent of the main transform's intent fallback logic.
4. **If output is anything else** (RGB, CMYK with other intents): No write-back needed. The engine produces proper black from Lab `0/0/0`.

## What pdf-diff Needs To Do

The `pdf-diff.js` tool extracts images from PDFs, converts them to Lab TIFF, and passes them to `tiff-diff` for pixel comparison. The same coercion must be applied during the Lab conversion step in `pdf-diff`:

1. **When converting extracted image pixels to Lab for TIFF writing**: After the color engine transform produces Lab output, scan for pixels that originated from Lab `0/-128/-128` and ensure they appear as Lab `0/-128/-128` (all-zero) in the output TIFF, not as the gamut-mapped value the engine produced.

2. **Alternatively**: Apply the same pre-transform coercion (replace `0/-128/-128` with `0/0/0` in Lab input) and post-transform restoration (write back zeros in Lab output) that `PDFImageColorConverter` uses.

3. **Detection**: Check for all-zero byte triplets (8-bit) or sextets (16-bit) at pixel boundaries in Lab pixel data.

## Scope

This is a temporary fix localized to `PDFImageColorConverter`. The intent is to eventually move the coercion higher up (possibly into `ColorConverter` or the color engine itself) once the behavior is fully understood and validated.
