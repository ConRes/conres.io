# ConRes Test Form Platform

This document describes the ConRes Test Form Platform — its scientific foundations, software architecture, and the 27-year collaboration that produced it. It was drafted by Saleh Abdel Motaal using Claude Opus 4.6 for prose generation, drawing on project source code, commit history, Franz Sigg's `content/History.md`, email archives (Gmail ConRes/Archive label), and ISO meeting records. The document is undergoing revisions and will be shared as a Google Doc with Franz Sigg, Eric Zeise, Auke Nauta, and Thomas Sprinzing for collaborative review. Technical facts, dates, and contributor attributions require scrutiny from all participants before publication.

---

## Overview

The ConRes (Contrast-Resolution) Test Form Platform is an open-source ecosystem for measuring the perceptual print quality of imaging systems. It addresses a long-standing problem in the graphic arts industry: there has been no standardized, automated way to evaluate whether a printing system can reproduce both the fine spatial detail and the subtle tonal differences that a human observer would notice at normal reading distance.

The platform spans the full measurement lifecycle. The [Color Engine](#color-engine) performs ICC profile-based color transformations in WebAssembly, including a [custom K-Only GCR rendering intent](#k-only-gcr-algorithm) that guarantees neutral grays convert to black-only ink, which is critical for [tone reproduction fidelity](#why-k-only-matters) in test forms. The [Test Form Generator](#test-form-generator) assembles individualized PDF test forms in the browser, applying color conversion to match each participant's output device without requiring Adobe Acrobat. The [ISO Analysis Pipeline](#iso-analysis-pipeline) implements the ISO 18621-31 measurement procedure in C++/WebAssembly, applying the [Barten contrast sensitivity model](#barten-contrast-sensitivity-model) and [cross-correlation scoring](#cross-correlation-scoring) to produce quantitative results from scanned prints. The [Test Form Segmenter](#test-form-segmenter) extracts regions of interest from high-resolution scans to feed the analysis pipeline.

The scientific foundation rests on 27 years of collaborative research. The [Contrast-Resolution methodology](#contrast-resolution-methodology) was established through Eliot Harper's RIT thesis (2000), originating from a discussion between Franz Sigg and Dr. Ed Granger at RIT in 1999, refined through [international round-robin testing](#round-robin-testing-workflow), and formalized in the [ISO/TS 18621-31 standard](#iso-standards-context). The [ConRes test targets](#conres-test-targets), hand-programmed in PostScript by Franz Sigg across [29+ revisions](#target-revision-history), encode a grid of spatial frequencies and contrast levels that probe the limits of any imaging system. The [pictorial assessment images](#pictorial-assets) from professional photographers enable [perceptual psychometrics research](#perceptual-psychometrics) using real-world content alongside the scientific patterns.

The platform is built for distributed participation. Researchers, print shops, and manufacturers anywhere can [generate test forms](#generation-workflow) tailored to their specific device, colorants, and substrate, print them, scan them, and submit scans for centralized analysis. The [assembly policy system](#assembly-policy) and [color conversion policy](#color-conversion-policy) ensure that the right rendering intents and color management rules are applied automatically based on the output ICC profile. The [specification validator](#specification-metadata) (in research) will verify that user-provided device and colorant metadata aligns with [JDF/XJDF standards](#jdf-xjdf-alignment) and the ICC profile characteristics.

All code runs in the browser. The platform targets Safari 16.4+, Chrome 80+, and Firefox 115+ with no server-side processing required beyond a static file server. Source code is available in the [ConRes GitHub organization](https://github.com/ConRes) and the [SMotaal GitHub account](https://github.com/SMotaal). The project represents over 3,490 workhours of voluntary academic-industry collaboration across the [ConRes team](#team).

---

## Contrast-Resolution Methodology

### Scientific Basis

Contrast Resolution measures two fundamental dimensions of imaging system performance:

- **Contrast** is the ability to distinguish tonal differences between adjacent areas. A system with poor contrast loses subtle gradations, rendering shadows and highlights as flat fields.
- **Resolution** is the ability to render fine spatial detail. A system with poor resolution blurs edges and merges closely-spaced features into uniform tone.

These two dimensions are not independent. A printing system may resolve fine detail at high contrast but lose it at low contrast, or vice versa. The ConRes methodology captures this interaction by testing a matrix of spatial frequencies against a range of contrast levels, producing a two-dimensional performance surface rather than a single number.

The test uses circular patch patterns rather than lines or checkerboards. Circles are rotationally symmetric, testing resolution in all angular directions with a single element. They avoid interference with printer addressability grids that plagued earlier line-based targets. The evaluation is a binary perceptual judgment: "Are the circles recognizable?" This simplifies observer decision-making and reduces fatigue compared to continuous rating scales.

### Measurement Dimensions

| Dimension         | Range                                              | What It Reveals                              |
| ----------------- | -------------------------------------------------- | -------------------------------------------- |
| Spatial Frequency | 0.625 to 6.250 lp/mm, 10 steps (settable)          | Detail rendering from coarse to fine         |
| Contrast          | 1% to 100%, 10 levels                              | Tonal discrimination from subtle to obvious  |
| Tone Value        | 50% (ISO current); 25%, 50%, 75% under exploration | Performance variation across the tonal range |

### Quantitative Metrics

**CR Index** (Contrast-Resolution Index) is the area under the contrast-versus-resolution curve at a given tone value. It collapses the 10x10 grid into a single figure of merit for quick comparison between systems.

**CRV** (Contrast-Resolution Volume) extends the CR Index to three dimensions by integrating across tone values. It represents the total volume underneath the contrast-resolution-tone surface. The resulting 3D graph functions as a "ConRes Gamut" analogous to a color gamut: different systems produce differently shaped volumes, and overlaying them reveals where one system outperforms another. Coated and uncoated paper on the same press, for instance, produce visibly different gamut shapes that quantify the substrate's contribution to perceptual quality.

**L-Score** is the automated evaluation algorithm developed by Thomas Liensberger at Fogra and refined by Fuji Xerox researchers (Miho Uno, Shinji Sasahara). It replaces subjective visual assessment with objective scanning and algorithmic analysis, producing quantitative scores independent of observer variability.

### Round-Robin Testing Workflow

The round-robin workflow enables distributed participants to produce comparable measurements:

1. Participant generates an individualized test form PDF using the [Test Form Generator](#test-form-generator) with their output ICC profile
2. Participant prints the test form on their device
3. Participant scans the print at 1200 DPI using a calibrated scanner
4. The [Test Form Segmenter](#test-form-segmenter) extracts patches from the scan
5. The [ISO Analysis Pipeline](#iso-analysis-pipeline) applies the Barten model and cross-correlation scoring
6. Results are reported in the standardized format defined by ISO/TS 18621-31

Each test form embeds QR codes linking to the generation metadata (device, colorants, substrate, settings, ICC profile), ensuring full traceability from printed output back to the generation parameters.

---

## ISO Standards Context

The platform supports the ISO/TC 130/JWG 14 (Joint Working Group on measurement of visual attributes) standardization of Contrast Resolution measurement:

**ISO/TS 18621-31** ("Graphic technology -- Measurement of visual attributes of printed materials -- Part 31: L-Score method for perceived resolution evaluation utilizing a contrast resolution target") defines the measurement procedure that the platform implements. The standard covers scanner conformance requirements, printer setup and linearization, data path specifications, the L-Score analysis algorithm, and reporting formats. The current edition is being revised as the 3rd edition.

**ISO/TS 18621-32** is a proposed companion standard for perceptual assessment using pictorial content, which the platform's [photographic assets](#pictorial-assets) and round-robin infrastructure are designed to support.

The platform's test targets have been integrated into ISO test pages since 2007, when ConRes targets were first used in ISO/IEC JTC-1 SC28 WG4 evaluation sessions.

---

## Color Engine

**Repository:** [SMotaal/conres-color-management](https://github.com/SMotaal/conres-color-management)

The ConRes Color Engine is a WebAssembly color management system that extends [LittleCMS](https://www.littlecms.com/) (Marti Maria Saguer, MIT license) with custom rendering intents, multiprofile pipeline support, and precision enhancements for print test form workflows. It runs entirely in the browser via WebAssembly, compiled from C using Emscripten.

### Why K-Only Matters

Standard ICC color management rendering intents (Perceptual, Relative Colorimetric, Saturation, Absolute Colorimetric) distribute the reproduction of neutral grays across all four CMYK channels. A 50% gray might become C=48, M=42, Y=38, K=12 depending on the profile and GCR strategy. This is acceptable for general printing but problematic for ConRes test forms, where the tone reproduction of neutral patches must be measured precisely.

When CMY inks contribute to neutral tones, the measurement is contaminated by:

- **Metamerism**: CMY-based grays shift color under different illuminants, while K-only grays remain stable
- **Registration sensitivity**: Slight misregistration of C, M, Y plates creates color fringing that is misinterpreted as contrast loss
- **Ink interaction**: CMY dot gain curves differ from K dot gain, making tone linearization unreliable

The K-Only GCR intent guarantees that neutral input colors (R=G=B or L with a=0, b=0) produce CMYK output with C=0, M=0, Y=0, ensuring that the K channel alone carries the tone information. Non-neutral colors are handled with chroma-modulated GCR that smoothly transitions between K-only and standard separation.

### K-Only GCR Algorithm

The algorithm builds a specialized Color Lookup Table (CLUT) with a 9-stage pipeline per grid point:

**Stage 1: Color Space Conversion.** Input RGB, Gray, or Lab values are converted to Lab D50 using the source ICC profile. This normalizes all input color spaces to a device-independent representation.

**Stage 2: Neutral Detection.** The input chroma is calculated as the Euclidean distance from the neutral axis in Lab space: `chroma = sqrt(a^2 + b^2)`. Colors with chroma below 0.5 are treated as perfectly neutral to avoid floating-point noise. The chroma modulation factor (Stage 5) is a continuous function — lower chroma produces more aggressive GCR, not a binary threshold.

**Stage 3: Black Point Compensation.** The algorithm computes a BPC scale factor by comparing the luminance (Y tristimulus) of two black references: standard black (CMYK 100,100,100,100) and K-only black (CMYK 0,0,0,100). The scale factor `(1 - Y_KOnly) / (1 - Y_Black)` is applied uniformly to all three XYZ tristimulus channels (after converting from Lab to XYZ) to map the input tonal range to the K-only output range.

**Stage 4: CMYK Conversion.** The BPC-adjusted Lab values are converted to CMYK using the destination profile with Relative Colorimetric intent.

**Stage 5: Gray Component Replacement.** The gray component `min(C, M, Y)` is extracted. A chroma modulation factor computed as `log(1 + normalizedChroma) / log(1 + 5.0)` (clamped to [0, 1]) controls the GCR intensity. At factor 0 (neutral), all gray component transfers to K. At factor 1 (chromatic), original CMY values are preserved. The K channel receives `K + grayComponent / 2` to match density without oversaturation.

**Stage 6-8: Iterative Refinement.** The algorithm iteratively adjusts K to match the target L* value (up to 1000 iterations), restores chroma for non-neutral colors through primary channel analysis, and performs boundary checks to ensure the output stays within the printable gamut.

**Stage 9: Quantization.** Float CMYK values are quantized to 16-bit for the CLUT output.

### Multiprofile Pipeline

LittleCMS supports Gray color spaces only in two-profile transforms. For chains involving Gray (e.g., Gray to sRGB to CMYK), the Color Engine builds composite transforms by chaining two-profile segments through a `CompositeLUTSampler`.

For Lab to CMYK with K-Only GCR, the engine uses pipeline concatenation rather than composite sampling. The analytical Lab-to-sRGB pipeline stages (matrices and curves from `_cmsDefaultICCintents`) are concatenated with the K-Only sRGB-to-CMYK CLUT using `cmsPipelineCat`. This preserves the mathematical precision of the analytical stages, which is critical because the 16-bit CLUT evaluation path introduces chromaticity errors for neutral Lab values.

### Lab16 Float Promotion

For 16-bit Lab input (`TYPE_Lab_16` or `TYPE_Lab_16_SE`), the Color Engine Plugin forces float pipeline evaluation instead of the default 16-bit path. The custom flag `cmsFLAGS_LAB16_FLOAT_PROMOTION` (bit 28) triggers the plugin's transform dispatch to read raw Lab16 bytes, convert to pipeline float using V4 scaling (`value / 65280.0`), and evaluate via `cmsPipelineEvalFloat`. This eliminates the quantization errors that caused neutral Lab values to produce non-zero CMY residuals in the 16-bit path.

### Dual Implementation

The project maintains two implementations:

**JavaScript Prototype** (`@conres/js-color-engine`, based on Glenn Wilton's jsColorEngine, GPL-3.0) is the reference implementation with 182 passing tests. It was developed first to validate the algorithm before porting to C.

**WebAssembly Production** (`@conres/color-engine`) compiles LittleCMS with five custom C modules via Emscripten. The WASM binary is approximately 300 KB (plus 44 KB JS wrapper). It runs in Web Workers for parallel image processing, achieving approximately 41–47 million pixels per second throughput (WASM SIMD, per CE-PERFORMANCE-ANALYSIS.md and Black-Point-Clamping-Optimization-Report.md benchmarks).

### Attribution

Algorithm design, color science decisions, and project direction are by Saleh Abdel Motaal. C code generation was assisted by Claude AI models (Sonnet 4.5, Opus 4, Opus 4.6). The ATTRIBUTION.md in the repository provides a detailed timeline of human versus AI contributions.

---

## Test Form Generator

**Repository:** [ConRes/conres.io](https://github.com/ConRes/conres.io) (path: `testing/iso/ptf/2026/`)

The Test Form Generator (TFG) is a browser-based tool that assembles individualized PDF test forms from pre-rendered asset pages, applying ICC color conversion and embedding traceability metadata. It replaces a manual workflow that previously required Adobe Acrobat for color conversion, PostScript for slug generation, and manual PDF assembly.

### Generation Workflow

For each participant, the Generator produces:

1. One or more test form PDFs, one per rendering intent when multi-PDF output is required (e.g., separate Relative Colorimetric and K-Only GCR versions for CMYK profiles)
2. A docket PDF containing generation metadata, ICC profile characteristics, and assembly parameters
3. QR code slugs on every page linking to the embedded specification metadata

The test forms contain 22 pages covering the full ConRes target grid plus step wedges and pictorial assessment pages. Total output size ranges from 500 MB to 1.1 GB depending on the output profile and bit depth.

### Converter Architecture

The PDF color conversion is decomposed into four hierarchical levels:

**PDFDocumentColorConverter** orchestrates the full document. It manages a ProfilePool (LRU-cached ICC profile handles), a BufferRegistry (deduplicating color lookups), and a WorkerPool (parallel Web Workers for image conversion). It determines which pages need conversion and dispatches them with appropriate concurrency.

**PDFPageColorConverter** coordinates per-page conversion with configurable concurrency. It iterates over image XObjects and content streams, dispatching each to the appropriate leaf converter. Multiple pages can be processed in parallel across worker pool subsets.

**PDFImageColorConverter** handles individual image XObjects. It decompresses FlateDecode streams, normalizes non-standard bit depths (1, 2, 4-bit to 8-bit), manages Lab absolute-zero pixel coercion (Photoshop mask encoding fix), and recompresses the converted output. For 16-bit Lab images, the Color Engine's Lab16 float promotion handles the encoding internally.

**PDFContentStreamColorConverter** parses PDF content stream operators (CS/cs, SC/sc/SCN/scn, G/g, RG/rg, K/k), builds color lookup tables for batch conversion, and reconstructs the stream text with converted values.

### Assembly Policy

An `assembly-policy.json` configuration defines profile categories, each with specific rendering intent passes and input color space compatibility:

| Category    | Profile Color Space | Rendering Intents                             | Multi-PDF |
| ----------- | ------------------- | --------------------------------------------- | --------- |
| Gray        | Gray                | Relative Colorimetric + BPC                   | No        |
| RGB         | RGB                 | Relative Colorimetric + BPC                   | No        |
| CMYK        | CMYK                | Relative Colorimetric + BPC, K-Only GCR + BPC | Yes       |
| CMYK-MaxGCR | CMYK                | Relative Colorimetric + BPC                   | No        |

A Max GCR detection test (11 neutral Lab test points, CMY threshold 1%) distinguishes standard CMYK profiles from Maximum GCR profiles. CMYK-MaxGCR profiles already produce K-only output for neutrals, so the separate K-Only GCR pass is unnecessary.

### Color Conversion Policy

Engine-version-specific behavior is managed by `color-conversion-rules.json`. Each rule specifies which engine versions it applies to, what source/destination/intent combinations trigger it, and what overrides to apply:

- **Intent fallbacks**: Lab K-Only GCR falls back to Relative Colorimetric on engines before `color-engine-2026-03-27` (which introduced the pipeline concatenation fix)
- **Multiprofile requirements**: Non-RGB inputs with K-Only GCR require multiprofile transforms on engines from `color-engine-2026-01-07` onward
- **BPC scaling**: RGB-to-RGB transforms with BPC require multiprofile transforms with black point scaling on engines from `color-engine-2026-01-30` onward

The policy system ensures the same Generator code works correctly across different Color Engine versions without hardcoded workarounds.

### Specification Metadata

Participants provide five specification fields through the Generator UI:

| Field     | Example                                                                                                                 | Purpose                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Device    | Epson SC-P9570                                                                                                          | Print system make and model                   |
| Colorants | UltraChrome Pro12 K,C,M,Y,LC,LM,LK,LLK,O,G,V                                                                            | Ink set or colorants used                     |
| Substrate | EFI Gravure Proof Paper 4245                                                                                            | Paper or media type                           |
| Settings  | PrismaPrePare, RGB None, Perceptual, use embedded Profils / CMYK None, Relative colormetric, Overrule embedded profiles | Color Management, resolution, screening… etc. |
| Email     | participant@example.com                                                                                                 | For QR code identification                    |

These specifications are embedded in docket pages and QR code slugs. A specification validator (in research phase) will cross-validate fields against each other, against the ICC profile header, and against JDF/XJDF standards for print job parameters.

### JDF XJDF Alignment

The specification fields map to structured elements in the CIP4 JDF (Job Definition Format) and XJDF (Exchange JDF) specifications:

- **Device** maps to `<Device Manufacturer="..." ModelName="..." />`
- **Colorants** maps to `<Ink InkName="..." ColorantType="Process|Spot" />`
- **Substrate** maps to `<Media MediaType="..." Weight="..." />`
- **Settings** maps to `<DigitalPrintingParams Resolution="..." />` or `<ImageSetterParams Resolution="..." />`

The validator does not produce JDF output. It verifies that the free-text input represents information that could be structured as JDF elements without contradiction.

### Browser Support

The Generator targets Safari 16.4+, Chrome 80+, and Firefox 115+. Large test form generation (1.5 GB source PDFs, 91.5 million pixel images at 16-bit) operates near Safari's per-tab memory limit. Worker pool concurrency is split into subsets to control peak memory usage during parallel image conversion.

---

## ISO Analysis Pipeline

**Repository:** [ConRes/conres-iso-cv](https://github.com/ConRes/conres-iso-cv)

The ISO Analysis Pipeline implements the ISO 18621-31 measurement procedure for evaluating printed ConRes test forms. It is written in C++ using OpenCV and compiled to WebAssembly via Emscripten for in-browser or server-side execution.

### Analysis Steps

The pipeline implements nine steps that transform a scanned print into quantitative Contrast Resolution measurements:

| Step | Name                  | Input                        | Output                                    |
| ---- | --------------------- | ---------------------------- | ----------------------------------------- |
| A1   | Block Extraction      | Full page scan               | Test form grid ROI, transformation matrix |
| A2   | Fiducial Localization | Block ROI                    | Predicted fiducial positions in sample    |
| B1   | Patch Extraction      | Block + fiducials            | Individual contrast-resolution patches    |
| B2   | Patch Transformation  | Sample + reference fiducials | Per-patch 3x3 homography matrices         |
| C1   | Patch Normalization   | Raw patches + homographies   | Geometrically corrected patches           |
| D1   | Barten Filtering      | Normalized patches           | CSF-weighted patches                      |
| E1   | Windowing             | Filtered patches             | Artifact-reduced ROIs                     |
| F1   | Cross-Correlation     | Reference + sample patches   | Correlation images                        |
| F2   | Scoring               | Correlation images           | Contrast Resolution scores                |

### Barten Contrast Sensitivity Model

Step D1 applies the Barten contrast sensitivity function (CSF), which models the human visual system's sensitivity to spatial frequency at a given luminance and viewing distance:

```
CSF(f) = (5200 * exp(-0.0016 * f^2 * (1 + 100/L)^0.08)) /
         sqrt((t + 0.64 * f_ang * f^2) * (63/L^0.83 + 1/(1 - exp(-0.02*f^2))))
         * exp(-(ln(Ls/L * t2)^2 - ln(t2)^2) / t3)
```

Where `f` is angular frequency in cycles per degree, `L` is reflected luminance, `Ls` is surround luminance, and `t`, `t2`, `t3` are derived from the field of view. The default parameters assume a 10 mm patch size, 400 mm viewing distance, and 1.75 degree field of view (foveal vision).

The filter is applied in the frequency domain: the CSF is evaluated at each spatial frequency, assembled into a 2D filter kernel, and multiplied with the FFT of each patch. This weights the image data by human perceptual sensitivity before scoring.

### Cross-Correlation Scoring

Steps F1-F2 use normalized cross-correlation (`cv::matchTemplate` with `TM_CCOEFF_NORMED`) to compare filtered sample patches against reference patches. The smaller patch is used as the template with a circular mask to isolate the region of interest. The peak correlation value (-1.0 to 1.0) indicates match quality: 1.0 means the sample perfectly reproduces the reference pattern at that frequency and contrast combination; negative values indicate anti-correlation.

### Cross-Environment Validation

The pipeline uses a JSON snapshot framework that serializes all intermediate matrices with metadata at each analysis step. These snapshots enable validation across C++, MATLAB, WASM, and browser environments, ensuring that the WebAssembly output matches reference implementations. This is critical because the ISO standard defines the algorithm in prose, not in source code, and implementations must demonstrate cross-platform reproducibility.

### Build

The project uses CMake with three library targets: `conres-iso-common` (shared utilities), `conres-iso-wasm` (browser WASM build), and `conres-iso-lib` (emerging native C/C++ library). Multiple build variants exist for OpenCV versions 4.7.0 through 4.12.0, SIMD support levels, and module formats. The optimized WASM binary is approximately 5 MB.

### Relationship to ConResLab2

The current pipeline succeeds ConResLab2, a MATLAB/Java application developed by Saleh Abdel Motaal (2011–2014) that explored automated analysis approaches. Thomas Liensberger's L-Score program (Fogra, 2013) was the first to achieve automated ConRes evaluation; ConResLab2's principal contribution was identifying algorithmic approaches that do not work, informing the design of subsequent pipelines. ConResLab2 used FFT-based frequency analysis with Gaussian band-pass filtering across 75 radial bands, applying a visual resolution filter (retinal Gaussian) before FFT. The current pipeline replaces this with the Barten CSF model (which accounts for luminance, viewing distance, and angular frequency) and normalized cross-correlation scoring (which is distribution-independent). Per-patch fiducial-guided homography correction replaces ConResLab2's global perspective transform, and optional Wiener filtering compensates for scanner blur using SFR calibration data.

---

## Test Form Segmenter

The Test Form Segmenter is a Node.js tool (3,300 lines) that extracts regions of interest from high-resolution scanned ConRes test prints at 1200 DPI. It bridges the gap between raw scans and the analysis pipeline's patch-level input requirements.

### Pipeline

1. **Downsample** from 1200 DPI to 150 DPI for contour detection (performance)
2. **Morphological processing**: grayscale conversion, thresholding, erosion/dilation
3. **Contour detection** with hierarchy analysis using OpenCV WASM
4. **ROI grouping** by hierarchy level with multiple contour approximation strategies (hexagon, quadrilateral, triangle)
5. **Barcode extraction**: PDF417 and QR code detection using ZXing for metadata recovery
6. **Patch output**: 16-bit PNG patches extracted at full 1200 DPI resolution

The segmenter processes batch configurations across multiple scan dates and resolutions (1200 DPI and 300 DPI), with asset definitions specifying expected grid structure and fiducial positions.

---

## ConRes Test Targets

The ConRes test targets are scientific test patterns authored in PostScript EPS by Franz Sigg. They encode the spatial frequency and contrast grid that the ISO 18621-31 standard measures.

### Target Structure

Each target contains:

- **10 spatial frequency steps**: 0.625 to 6.250 lp/mm (settable in EPS header)
- **10 contrast levels**: 100% down to 1%
- **40-step tone value grid** for linearization verification
- **Fiducial marks** and registration patterns for automated analysis
- **QR codes** with embedded metadata
- **Step wedges** for scanner calibration verification

### Target Revision History

The targets have evolved through 29+ revisions, all hand-programmed in PostScript by Franz Sigg. All versions use vector graphics. Each EPS file has a header with settable parameters including number of resolution and contrast steps, color, patch size, and the ranges of resolution and contrast (normally set to the perceptible range of the visual system at reading distance).

- **Version 1** (April 2000): Continuously varying checkerboard pattern. Created interference with addressability grids.
- **Version 5** (June 2000): Parallel lines replaced checkerboards. Still susceptible to registration and angular bias.
- **Version 8** (November 2000): Dropped multicolor overprints (registration-dependent) and yellow (difficult to see). Black-only target.
- **Version 9** (December 2000): Added visual reference tone area near each patch. Rectangular blocks for efficient space use with numeric value documentation.
- **Version 13** (April 2002): Explored gradient areas for additional tone reproduction evaluation.
- **Version 14** (July 2002): Demonstrated that testing only the black channel is sufficient, since the print engine for black is the same as for color. Smaller target.
- **Versions 16-18**: Breakthrough innovation: circular patches. Circles are symmetrical, testing resolution in all angular directions with a single yes/no judgment. First circular version was number 16.
- **Version 22** (October 2007): Configurable parameters, split-patch capability (one half K-only, other half CMY for registration comparison), adjustable average tone value. Also detects gray level limitations in binary systems (offset, Indigo) where low addressability and fine screen ruling produce fewer than 64 gray levels.
- **Version 28** (February 2008): Multi-tone-value blocks testing ConRes performance across the full tonal range. Small step increments for all three variables. Built-in tone reproduction linearization.
- **Compact variant** (2013): 35 mm strip version for gravure testing at Hochschule der Medien Stuttgart. Offset columns at lower contrast to reduce patch count.
- **ISO_ConRes19g**: Redesigned fiducials after Eric Zeise's research showed original marks were difficult to detect automatically. Symmetric reference tints around patches, fiducials repositioned to frame boundaries, step wedge for linearization verification, gray background to reduce internal reflection edge effects.
- **ConRes21Cr5** (2025-05-05): Working revision for ISO round-robin testing.
- **ConRes21Cr6** (2025-07-01): Incorporates Eric Zeise's analysis feedback, OutputType conditional barcode color control, canonical ICC profile definitions, PostScript logic corrections.

The targets have also been used in JPEG compression quality testing for the Library of Congress document archiving program.

### Color Space Variants

Each target revision is rendered in seven color space variants through Ghostscript:

| Variant | Description                | Bit Depth                        |
| ------- | -------------------------- | -------------------------------- |
| sRGB    | ICC sRGB                   | 48-bit TIFF (16-bit per channel) |
| sGray   | ICC sGray                  | 16-bit TIFF                      |
| Lab     | Device-independent CIE Lab | 16-bit per channel               |
| SepK    | K-only separation          | Single channel                   |
| Ref     | Reference (unmanaged)      | Native                           |
| Gray    | Non-ICC grayscale          | Native                           |
| RGB     | Non-ICC RGB                | Native                           |

---

## Pictorial Assets

The test forms include eight photographic images for perceptual assessment alongside the scientific target patterns. These images enable the proposed ISO/TS 18621-32 perceptual evaluation methodology.

### Perceptual Psychometrics

The pictorial assets serve a fundamentally different purpose from the scientific targets. While the targets measure objective contrast-resolution through algorithmic analysis, the pictorial pages test whether the measured performance translates to perceived quality with real-world content. A system might score well on the target grid but produce visible artifacts in photographic images due to screening interactions, ink spread patterns, or color management limitations.

The perceptual evaluation framework uses the same round-robin distribution model: participants print test forms containing both scientific targets and pictorial pages, enabling paired comparison between objective scores and subjective quality assessments.

### Photographers and Assets

| Asset            | Photographer  | Subject               |
| ---------------- | ------------- | --------------------- |
| London           | Mario Ouellet | Urban cityscape       |
| St. Paul         | Mario Ouellet | Architecture          |
| Winter Trees     | Mario Ouellet | Winter landscape      |
| Ice Trees Fog    | Mario Ouellet | Atmospheric landscape |
| Lake Forest      | Carey Rose    | Landscape with water  |
| Cat              | Carey Rose    | Animal portrait       |
| Winterthur Trees | Franz Sigg    | Trees in parkland     |
| Milano Trees     | Franz Sigg    | Urban trees           |

Each asset is prepared in three color space variants (sRGB, sGray, Lab) at 16-bit per channel, with step-wedges for tone scale normalization. The master assembly is approximately 1.5 GB.

---

## Supporting Tools

### Ghostscript WASM

Ghostscript is compiled to WebAssembly for browser-based PostScript and PDF rendering. The build uses GhostPDL 9.56.0 with patches by Auke Nauta for ConRes-specific output:

- CIELab TIFF support with correct 16-bit scaling (65284.0 vs 65535.0 quantization)
- `tiffgray16` 16-bit grayscale device
- JPEG chroma subsampling control
- TIFF Deflate compression
- Threading and autogen cache support

The WASM binary is approximately 15-17 MB. The Test Form Generator uses it through `GhostscriptService` for rendering PostScript slug templates (QR codes, metadata text, barcodes) into PDF docket pages.

### Scanner Calibration

An ISO 12233 slanted-edge method implementation for Spatial Frequency Response (SFR) and Modulation Transfer Function (MTF) characterization. The pipeline measures the effective resolution of the scanning device and produces correction factors used in the analysis pipeline's optional Wiener filter (Step B1).

The implementation follows the standard slanted-edge procedure: bilateral filtering for noise reduction, centroid-based edge detection, 4x oversampled Edge Spread Function extraction, Line Spread Function differentiation, Hamming windowing, and DFT magnitude spectrum computation. Calibration data for the Epson V600 at 1200 DPI shows MTF50 at approximately 0.03 cycles/pixel (36 lp/mm) with an effective resolution limit below 84 lp/mm.

### UTIF2

A fork of Photopea's UTIF2 TIFF library (v4.1.0) enhanced with CMYK color space encoding, ICC profile embedding/extraction, 16-bit image support, and a complete ESM rewrite with TypeScript type definitions. Used by the segmenter and analysis pipelines for reading and writing high-bit-depth TIFF images.

---

## Development Infrastructure

### Web Platform

**Repository:** [ConRes/conres.io](https://github.com/ConRes/conres.io)

The ConRes website ([www.conres.io](https://www.conres.io)) is hosted on GitHub Pages. The repository serves as both the public website and the development monorepo. The Test Form Generator lives within the `testing/iso/ptf/` directory and is served directly as static files.

The platform uses ES Modules throughout with no build step. Browser-native import maps resolve vendored dependencies at runtime. The development workspace uses Yarn 4.8.1 with Node.js 24+ as the target for ecosystem packages.

### Team

The ConRes project is a voluntary academic-industry collaboration spanning over two decades:

| Member             | Role                                     | Contributions                                                                                                                                |
| ------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Franz Sigg         | ConRes founder                           | PostScript test targets (29+ revisions), ISO committee liaison, visual QA, project history                                                   |
| Saleh Abdel Motaal | Platform development                     | Color Engine, Test Form Generator, LittleCMS and Ghostscript WebAssembly ports, ConRes ISO WebAssembly analysis pipeline, web infrastructure |
| Auke Nauta         | Ghostscript and analysis                 | Ghostscript patches, ConRes ISO C++ analysis pipeline                                                                                        |
| Eric Zeise         | Analysis and standards                   | ISO/TS 18621-31 standard authorship, analysis program development, target revision feedback                                                  |
| Frans Gaykema      | ISO JWG 14 Convenor and analysis tooling | Automated EXE analyzer for ISO_ConRes19 and ConRe281                                                                                         |

Historical contributors include Eliot Harper (RIT thesis establishing ConRes methodology, 2000), Deepak Dubay (CRV-MTF relationship research), Thomas Liensberger (L-Score automated evaluation algorithm, Fogra, 2013) and Fuji Xerox researchers Miho Uno and Shinji Sasahara (improved L-Score algorithm, 2014).

### Project History

The ConRes concept originated in the fall of 1999 from a discussion between Franz Sigg and Dr. Ed Granger at a lunch table at RIT.

- **1999-2000**: Franz Sigg designs multiple target versions. Eliot Harper completes RIT thesis "An Investigation Into the Relationship Between Contrast and Resolution of a Printing System Using the RIT Contrast Resolution Test Target" (December 2000).
- **2001**: Harper wins TAGA graduate student paper award with a compact description of the ConRes methodology.
- **2003-2005**: Deepak Dubay publishes RIT TAGA paper "Relationship between Contrast Resolution Volume (CRV) and Modulation Transfer Function (MTF)" (2003), followed by thesis "A Comparative Analysis between the RIT Contrast Resolution Test Target And the Gutenberg Test Target" (2005).
- **2006**: Franz Sigg writes "Testing for Resolution and Contrast" for the RIT TestTargets 6 publication. Topic taught to RIT students.
- **2007**: Targets integrated into ISO/IEC JTC-1 SC28 WG4 test pages. Eric Zeise (Kodak) develops MATLAB program for computer-assisted visual evaluation. Saleh Motaal writes analysis software with data input modules for scan processing; automatic analysis was not completed at this stage (per Franz Sigg, `content/History.md`).
- **2011-2014**: ConResLab2, the second-generation analysis software, integrating Saleh's earlier Java perceptual evaluation UI with MATLAB automated analysis modules. By the time the software was shelved, the team had learned what algorithmic approaches do not work rather than arriving at a working automated analysis.
- **2013**: Thomas Liensberger presents L-Score automated evaluation program (Fogra) at ISO/IEC JTC1/SC28 WG4 Vienna meeting.
- **2014**: Miho Uno and Shinji Sasahara (Fuji Xerox) present improved L-Score algorithm at ISO TC130 JWG14 Beijing meeting. Eric Zeise begins writing ISO/DTS 18621-31.
- **2018**: Standard progresses to Preliminary Draft Technical Specification (ISO/PDTS 18621-31.42, November 2018). Frans Gaykema (Océ-Technologies B.V.) develops automated EXE analyzer for ISO_ConRes19 and ConRe281. Eric Zeise, Saleh Motaal, and Franz Sigg begin weekly Skype meetings on automated analysis. Saleh pursues JavaScript/HTML approach for browser-based analysis.
- **2020-2023**: ISO analysis pipeline ported to C++/WebAssembly (Auke Nauta). 526+ workhours across 330 active days.
- **2024-2025**: Color Engine development eliminates Adobe Acrobat dependency for color conversion.
- **2025-2026**: Test Form Generator reaches browser-based production capability. Test targets revised through Cr5, Cr6, Cr7.

Total tracked investment: over 3,490 workhours across the platform ecosystem.

---

## Attribution and AI Disclosure

### Authorship

This document was authored by **Saleh Abdel Motaal** (dev@smotaal.io). AI agents are tools — they generate prose, they do not author documents. The author directs the work, owns the ideas, determines what is accurate, and takes responsibility for the content. See the [full analysis of AI authorship conventions](~/.claude/meta/conventions/Attribution.md) for the legal and professional framework behind this position.

### AI Assistance

**Claude Opus 4.6** (Anthropic) was used for prose generation, structural organization, and drafting technical descriptions from source materials. All technical claims, historical facts, dates, and contributor attributions are subject to review by the author and the ConRes team.

### Human Contributions to This Document

| Contributor                                          | Role                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Saleh Abdel Motaal                                   | Author — directed all content, provided source materials, reviewed and revised all sections  |
| Franz Sigg, Eric Zeise, Auke Nauta, Thomas Sprinzing | Reviewers (pending) — collaborative review for technical accuracy and historical correctness |

### Source Documents Referenced

| Source                              | Location                                                           | What It Provided                                                                       |
| ----------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| ConRes.io repository source code    | `testing/iso/ptf/2026/`                                            | Generator architecture, policy system, converter hierarchy, color engine integration   |
| Color Engine repository source code | `~/Projects/conres/color-engine/`                                  | K-Only GCR algorithm, multiprofile pipeline, Lab16 float promotion                     |
| Color Engine ATTRIBUTION.md         | `~/Projects/conres/color-engine/ATTRIBUTION.md`                    | Attribution framework, upstream dependencies, human vs AI contribution timeline        |
| Lab-K-Only-Neutrals.md              | `packages/color-engine-2026-03-27/documentation/`                  | CE fix documentation for Lab K-Only neutral preservation                               |
| Franz Sigg's ConRes History         | `content/History.md` (conres.io repository)                        | Target revision history, project timeline, team contributions — authored by Franz Sigg |
| Gmail archives (ConRes/Archive)     | Email threads 2007-2026 (cited in historical evidence compilation) | Meeting records, ISO correspondence, collaboration timeline                            |
| ISO meeting records                 | ISO/IEC JTC-1 SC28 WG4 and ISO TC130 JWG14                         | Standards progression, presentation dates, participant roles                           |
| CLAUDE.md project instructions      | `testing/iso/ptf/2026/CLAUDE.md`                                   | Code conventions, module descriptions, integration status                              |
| Git commit history                  | `git log` on `test-form-generator/2026/dev` branch                 | Development timeline, commit messages, feature progression                             |
| Claude Code conversation history    | `~/.claude/history.jsonl`                                          | Conversation context for technical decisions and design rationale                      |
| ISO/TS 18621-31                     | Referenced (not included)                                          | Measurement procedure, L-Score algorithm, reporting format                             |
| Eliot Harper RIT thesis (2000)      | Referenced (not included)                                          | ConRes methodology establishment                                                       |
