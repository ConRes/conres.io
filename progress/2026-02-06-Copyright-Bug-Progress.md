# Copyright Symbol Bug Investigation

## Roadmap

- [x] Create progress document
- [x] Identify root cause
- [x] Provide recommendations for fix
- [x] Apply fix to Refactored path
- [x] Visual confirmation from user
- [x] Apply fix to Legacy and Worker paths
- [ ] Verify fix with full matrix run

## Current Status

**Fix applied to all three paths.** Visually confirmed on Refactored path.

**Last Updated:** 2026-02-07T00:00:00Z

## Root Cause

Content stream rewriting corrupts non-ASCII bytes through an incorrect UTF-8 encoding roundtrip. `TextDecoder('utf-8')` replaces invalid bytes like `0xA9` (©) with U+FFFD, then `TextEncoder('utf-8')` encodes U+FFFD as 3-byte `0xEF 0xBF 0xBD`. The original 1-byte `0xA9` becomes 3 bytes, rendering garbage.

PDF content streams have **no encoding dict entry** (ISO 32000-2, section 7.9.1: text string encoding conventions "apply only to strings outside content streams"). Content stream bytes must be preserved as-is.

### Affected Code Locations

| File                                  | Lines (decode, encode) | Role            |
| ------------------------------------- | ---------------------- | --------------- |
| `classes/pdf-page-color-converter.js` | 634–635, 834–835       | Refactored path |
| `services/ColorSpaceUtils.js`         | 866, 1051              | Legacy path     |
| `services/StreamTransformWorker.js`   | 338, 380               | Worker path     |

## Fix: Use pdf-lib Public API

pdf-lib's own `PDFRawStream.getContentsString()` uses `arrayAsString()` — a `String.fromCharCode()` loop that maps each byte to its identical Unicode codepoint (true ISO 8859-1 identity). The reverse, `copyStringIntoBuffer()`, uses `String.charCodeAt()` to write each codepoint back as a byte. Both are public exports of the `pdf-lib` package.

Replace `new TextDecoder().decode(bytes)` with `arrayAsString(bytes)` and `new TextEncoder().encode(text)` with `copyStringIntoBuffer(text, bytes, 0)`.

### Verified in both Node.js and Chromium

All 256 byte values roundtrip losslessly through `arrayAsString` + `copyStringIntoBuffer`. Tested with `test-pdflib-encoding-roundtrip.mjs` (Node.js) and `test-pdflib-encoding-browser.mjs` (Chromium via Playwright). The broken `TextDecoder`/`TextEncoder` baseline confirms corruption of `0xA9`.

### Earlier approaches considered

- `TextDecoder('latin1')`: WHATWG aliases this to windows-1252 which remaps bytes 0x80–0x9F to different codepoints in browsers. Works in Node.js but unreliable cross-environment.
- Custom utility functions: Would duplicate the logic pdf-lib already provides and exports.

## Activity Log

### 2026-02-06 ~22:00

- Created `debug-copyright-bug.mjs` investigation script
- Scanned input PDF: 6 occurrences of `0xA9` across 3 content streams
- Scanned unaffected output (2025-12-19): byte-identical, `0xA9` preserved (conversion aborted)
- Scanned affected output (2026-01-30): `0xA9` corrupted to `0xEF 0xBF 0xBD`
- Root cause confirmed: UTF-8 TextDecoder/TextEncoder roundtrip

### 2026-02-06 ~23:00

- Explored `TextDecoder('latin1')` approach — unreliable due to WHATWG windows-1252 aliasing
- Discovered pdf-lib public API (`arrayAsString`, `copyStringIntoBuffer`) provides the exact lossless roundtrip needed
- Verified fix in both Node.js and Chromium via Playwright — all 256 byte values roundtrip correctly
- Applied fix to `classes/pdf-page-color-converter.js` (Refactored path) for visual confirmation

### 2026-02-07 ~00:00

- User visually confirmed fix works on Refactored path
- Applied fix to `services/ColorSpaceUtils.js` (Legacy path): `arrayAsString` + `copyStringIntoBuffer` from pdf-lib
- Applied fix to `services/StreamTransformWorker.js` (Worker path): inlined `String.fromCharCode`/`charCodeAt` loops (no pdf-lib import available in worker)
