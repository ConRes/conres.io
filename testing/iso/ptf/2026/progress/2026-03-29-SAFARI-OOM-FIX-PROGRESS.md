# Safari OOM Fix — PROGRESS

**Created:** 2026-03-29  
**Last Updated:** 2026-03-29  
**Status:** Investigation Needed

---

## Problem

Safari macOS crashes with "A problem repeatedly occurred" during PDF generation with the F10a 1.5 GB asset PDF. This is a regression — Safari macOS was previously stable.

### Affected Browsers

| Browser             | Status                                           |
| ------------------- | ------------------------------------------------ |
| Chrome 145 (macOS)  | Works                                            |
| Firefox 115 (macOS) | Works                                            |
| Safari 26.3 (macOS) | Crashes (OOM) — intermittent, succeeded on retry |
| Safari (iOS/iPad)   | Rarely stable (pre-existing)                     |

### When It Started

After commits on `test-form-generator/2026/dev` branch, specifically:

- `39a7a53` — `feat(2026): enable Lab K-Only GCR policy rules for color-engine-2026-03-27`
- `eb6c072` — `refactor(2026): replace hardcoded Lab K-Only GCR workarounds with policy evaluation`
- `3c43ad5` — `chore(2026/experiments): move staging tools from scripts/ to tools/`
- `a0d22f7` — `refactor(2026/helpers): split helpers into imports, streams, and buffers modules`

Plus uncommitted WIP changes for Gray profile support and Compression Streams API adoption.

### Reproduction

1. Open `http://localhost/testing/iso/ptf/2026/generator/` in Safari 26.3
2. Select the F10a asset PDF (~1.5 GB) and eciCMYK v2 ICC profile
3. Click Generate
4. Safari crashes during image conversion phase with: "A problem repeatedly occurred with 'localhost/testing/iso/ptf/2026/generator/' — Reload Webpage?"

### What Was Observed

The generation proceeds normally through:

- Manifest loading
- ICC profile parsing
- Profile analysis (OutputProfileAnalyzer)
- Assembly plan resolution
- Docket generation (pass 1 RelCol + pass 2 K-Only GCR content streams)
- Asset PDF loading (22 pages)
- Asset pre-conversion plan (26 unique pairs, 3 concurrent subsets)

Then crashes during concurrent image conversion of 10167x9000 16-bit RGB images.

## Timeline Analysis

Safari Web Inspector timeline captured in: `temp/Compression Tests/2026-03-30 - ConRes - ISO PTF - CR1 (F10a) Assets - eciCMYK v2 - Safari 26.3 (macOS).json`

Analysis script: `experiments/scripts/analyze-safari-timeline.mjs`

### Memory Profile (from successful run)

| Metric               | Value          |
| -------------------- | -------------- |
| Peak total memory    | 9.53 GB        |
| Peak JavaScript heap | 2.02 GB        |
| Peak page memory     | ~8 GB          |
| Duration             | 417s           |
| Snapshots >1 GB      | 793/793 (100%) |
| Snapshots >2 GB      | 772/793 (97%)  |
| Snapshots >3 GB      | 763/793 (96%)  |
| First >2 GB          | t=30.3s        |
| First >3 GB          | t=31.3s        |

### Memory Over Time (sampled)

```
Time (s)   JS Heap (MB)   Page (MB)   Total (GB)
     1.7          1083          61         1.14
    38.8            26        7683         7.56
   105.7            28        5044         4.98
   153.6            28        7608         7.49
   201.4          1095        8058         8.97
   325.8          1095        7094         8.03
   418.5          2023         158         2.15 (final)
```

### Key Observations

1. **Page memory dominates** — JS heap peaks at ~2 GB, but `page` category (ArrayBuffer allocations from pdf-lib) hits ~8 GB
2. **Sawtooth pattern** — huge spikes (+1.5 GB) followed by drops (-2.5 GB) during image buffer allocation/deallocation
3. **3 concurrent subsets** — `AssetPagePreConverter` splits 19 pages into 3 concurrent subsets, meaning up to 3 images (~549 MB each decompressed) processed simultaneously
4. **9.5 GB peak** — Safari barely survives; any additional memory pressure causes OOM

## Safari Console Log (from crash)

```
[Log] Ⓜ️ [TestFormGeneratorAppElement] Bootstrap Worker: creating module worker…
[Log] Ⓜ️ [TestFormGeneratorAppElement] Bootstrap Worker: ready, sending generation task…
[Log] 🅱️ [TestFormPDFDocumentGenerator] Manifest loaded: {assets: 22, layouts: 22, pages: 22}
[Log] 🅱️ [TestFormPDFDocumentGenerator] ICC profile: {colorSpace: "CMYK", description: "eciCMYK v2"}
[Log] Little-CMS API wrapper initialized
[Log] 🅱️ [OutputProfileAnalyzer] Max GCR test: Lab-based (CMY <= 1%): fail
[Log] 🅱️ [OutputProfileAnalyzer] Profile category: CMYK (Max GCR: false)
[Log] 🅱️ [AssemblyPolicyResolver] Resolved plan: {profileCategory: "CMYK", multiPDF: true, passes: 2}
[Log] 🅱️ [AssetPagePreConverter] conversion plan: {uniquePairs: 1, chains: 1, passthrough: 0}
[Log] 🅱️ [AssetPagePreConverter] chain "direct" — 1 pages [0]: sRGB → CMYK
[Log] Little-CMS API wrapper initialized
[Log] 🅱️ [PDFContentStreamColorConverter] Processing stream 463 0 R
[Log] 🅱️   Stream length: 91175 characters
[Log] 🅱️   Found 333 color operations
[Log] 🅱️ [ColorConverter] convertColorsBuffer: RGB → CMYK, multiprofile=undefined, intent=relative-colorimetric, pixels=22
(... content streams for pass 1 RelCol and pass 2 K-Only GCR ...)
[Log] 🅱️ [TestFormPDFDocumentGenerator] Docket slugs: userMetadata=true, pages=2
(... Ghostscript slugs generation ...)
[Log] 🅱️ [TestFormPDFDocumentGenerator] Docket PDF generated: 1969.7 KB
[Log] 🅱️ [TestFormPDFDocumentGenerator] Asset PDF loaded: 22 pages
[Log] 🅱️ [AssetPagePreConverter] conversion plan: {uniquePairs: 26, chains: 2, passthrough: 3}
[Log] 🅱️ [AssetPagePreConverter] chain "direct" — 19 pages, split into 3 concurrent subsets
[Log] Little-CMS API wrapper initialized (x3)
[Log] 🅱️ [PDFContentStreamColorConverter] Processing stream 463 0 R
[Log] 2️⃣ [PDFImageColorConverter] Converting image 18 0 R
[Log] 2️⃣   Size: 10167×9000, ColorSpace: RGB, BPC: 16
[Log] 1️⃣ [PDFImageColorConverter] Converting image 17 0 R
[Log] 1️⃣   Size: 10167×9000, ColorSpace: RGB, BPC: 16
(... crash occurs here ...)
```

## Potential Causes

1. **Concurrent image processing** — 3 subsets × 91.5M-pixel 16-bit images = ~3 GB pixel buffers concurrent with 1.5 GB source PDF
2. **pdf-lib memory model** — entire PDF loaded as single ArrayBuffer; no streaming
3. **Accumulated changes** — color engine version (2026-03-27), policy rule changes, helpers refactor, WIP generator changes all in working tree together
4. **Safari memory limits** — Safari has stricter per-tab memory limits than Chrome/Firefox

## Potential Fixes to Investigate

1. **Reduce concurrent subsets** — configure `AssetPagePreConverter` to use 1 subset in Safari (or based on available memory)
2. **Streaming output** — write PDF incrementally instead of materializing in memory
3. **Image processing sequencing** — process one image at a time, release buffers between
4. **Compression Streams adoption** — native streaming compression reduces peak memory vs pako's synchronous buffers

## Roadmap

- [ ] **Step 1** — Bisect: test with ONLY committed changes (stash WIP) to isolate regression
- [ ] **Step 2** — Profile: compare Safari timeline before and after the commits
- [ ] **Step 3** — Reduce concurrency: test with 1 concurrent subset on Safari
- [ ] **Step 4** — Measure: quantify memory savings from Compression Streams transition
- [ ] **Step 5** — Fix: implement the most impactful change

---

## Activity Log

### 2026-03-29

- Safari crashed during F10a generation with eciCMYK v2 CMYK profile
- Captured Safari Web Inspector timeline (882 MB JSON)
- Analyzed timeline: peak 9.53 GB, page memory dominates at ~8 GB
- Safari succeeded on retry — crash is intermittent (memory pressure dependent)
- Chrome 145 and Firefox 115 generate successfully with same inputs
- Created progress document for investigation
