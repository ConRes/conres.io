# Specification Validator — Requirements

**Created:** 2026-03-31
**Status:** Research Phase

---

## Problem

The ISO PTF Generator accepts user-provided specifications (Device, Colorants, Substrate, Settings) via free-text inputs with no semantic validation. Current validation is HTML5 only (`minlength="2"`, `pattern=".{2,}"`). Users can submit nonsensical combinations — e.g., an inkjet device with offset colorants, or a substrate that doesn't match the output ICC profile's device class.

The generated test forms embed these specifications in slugs and QR codes. Invalid specifications undermine the traceability purpose of the test forms and create confusion during ISO conformance evaluation.

---

## Goal

A client-side specification validator that:

1. Validates each field against real-world patterns in the print/prepress domain
2. Cross-validates fields against each other and against the selected output ICC profile
3. Suggests corrections when fields need rewriting
4. Runs entirely in the browser — no backend dependency

---

## Current Data Model

### User-Provided Fields

| Field     | HTML ID           | Placeholder Example                            | Purpose                                 |
| --------- | ----------------- | ---------------------------------------------- | --------------------------------------- |
| Device    | `device-input`    | "Epson SC-P9570"                               | Print system make and model             |
| Colorants | `colorants-input` | "UltraChrome Pro12 K,C,M,Y,LC,LM,LK,LLK,O,G,V" | Ink set or colorants used               |
| Substrate | `substrate-input` | "EFI Gravure Proof Paper 4245"                 | Paper or media type                     |
| Settings  | `settings-input`  | "720x720 dpi, Level 4"                         | Resolution, screening, quality settings |
| Email     | `email-input`     | "participant@example.com"                      | Participant email (not validated here)  |

**Typedef** (from `test-form-pdf-document-generator.js`):

```javascript
/** @typedef {{ device: string, colorants: string, substrate: string, settings: string, email: string }} UserMetadata */
```

### ICC Profile Header (from `ICCService.parseICCHeaderFromSource`)

Available for cross-validation:

| Field             | Type   | Example                               | Validation Use                              |
| ----------------- | ------ | ------------------------------------- | ------------------------------------------- |
| `colorSpace`      | string | `"CMYK"`, `"RGB"`, `"Gray"`           | Must align with colorant count and type     |
| `deviceClass`     | string | `"Printer"`, `"Monitor"`, `"Scanner"` | Must align with device type                 |
| `description`     | string | `"eciCMYK v2"`                        | Informational — manufacturer/purpose hints  |
| `manufacturer`    | string | `"HDM "` (4-char ICC sig)             | Cross-reference with device manufacturer    |
| `version`         | string | `"4.0"`, `"2.4"`                      | Informational                               |
| `connectionSpace` | string | `"Lab"`, `"XYZ"`                      | Informational                               |
| `copyright`       | string | varies                                | May contain manufacturer/organization hints |

### Assembly Policy Categories

The generator classifies profiles into categories that constrain rendering intents:

| Category    | Profile Color Space | Rendering Intents                             |
| ----------- | ------------------- | --------------------------------------------- |
| Gray        | Gray                | Relative Colorimetric + BPC                   |
| RGB         | RGB                 | Relative Colorimetric + BPC                   |
| CMYK        | CMYK                | Relative Colorimetric + BPC, K-Only GCR + BPC |
| CMYK-MaxGCR | CMYK                | Relative Colorimetric + BPC                   |

---

## Validation Rules

### 1. Device Field

**Pattern recognition:**

- Should contain a manufacturer name and a model identifier
- Common manufacturers: Epson, Canon, HP, Konica Minolta, Ricoh, Xerox, Heidelberg, Komori, manroland, KBA, Kodak, Fujifilm, Roland DG, Mimaki, EFI, Durst, swissQprint, Agfa
- Device types: inkjet printers, digital presses, offset presses, flexo presses, gravure presses, large-format printers, proofers, monitors (for soft proofing)
- Model identifiers vary by manufacturer (e.g., "SC-P9570", "iPR C10010VP", "Speedmaster CX 104")

**Cross-validation with ICC profile:**

- `deviceClass: "Printer"` → device should be a printer/press, not a monitor
- `deviceClass: "Monitor"` → device should be a display (Dell, EIZO, NEC, BenQ, etc.)
- `colorSpace: "CMYK"` → device should be a printer/press (not an RGB-only device)
- `colorSpace: "RGB"` → device could be a monitor, RGB printer, or proofing system

**Rewrite suggestions:**

- Typo correction for known manufacturers (e.g., "Epsn" → "Epson")
- Missing model number (just "Epson" without a model)
- Nonsensical combinations (e.g., "Samsung TV" with a CMYK printer profile)

### 2. Colorants Field

**Pattern recognition:**

- Should contain an ink set name and/or comma-separated colorant abbreviations
- Standard CMYK: `C,M,Y,K` or `Cyan,Magenta,Yellow,Black`
- Extended gamut: `C,M,Y,K,O,G,V` (Orange, Green, Violet)
- Light inks: `LC,LM,LK,LLK` (Light Cyan, Light Magenta, Light Black, Light Light Black)
- Spot colors: Pantone references, custom names
- Named ink sets: "UltraChrome Pro12", "Lucia Pro", "DesignJet", "Offset CMYK"
- Offset/flexo: "Process CMYK", "CMYK + Spot", paper-specific formulations

**Cross-validation with ICC profile:**

- `colorSpace: "CMYK"` → colorants must include C, M, Y, K (or equivalents)
- `colorSpace: "RGB"` → colorants should reference RGB primaries or display phosphors
- `colorSpace: "Gray"` → colorants should reference a single black channel or gray ink
- Colorant COUNT should be plausible for the color space (4 for CMYK, 3 for RGB, 1 for Gray; more for extended gamut if the profile supports it)

**Rewrite suggestions:**

- Colorant list that doesn't match the profile color space
- Missing key colorants (e.g., listing "C,M,Y" without K for a CMYK profile)
- Unrecognized abbreviations

### 3. Substrate Field

**Pattern recognition:**

- Should contain a paper/media name, optionally with manufacturer and product code
- Paper types: coated, uncoated, matte, glossy, semi-gloss, satin, luster, fine art, canvas, vinyl, film, synthetic
- Weights: gsm (g/m²) or lb (US)
- Sizes: not typically here (this is media TYPE, not sheet size)
- Known paper brands: EFI, Epson, Hahnemühle, Canson, Moab, Ilford, HP, Mohawk, Sappi, Fedrigoni, UPM, Stora Enso
- Proofing substrates: "EFI Gravure Proof Paper", "Epson Proofing Paper", "GMG ProofMedia"

**Cross-validation with ICC profile:**

- Profile description may reference a substrate class (e.g., "Coated FOGRA39" implies coated stock)
- `deviceClass: "Monitor"` → substrate field is nonsensical (should be empty or "N/A")
- Offset profiles often embed substrate assumptions (coated vs uncoated) in the profile name

**Rewrite suggestions:**

- Substrate type inconsistent with profile assumptions (e.g., uncoated paper with a coated-stock profile)
- Missing weight or type specification (just a brand name)

### 4. Settings Field

**Pattern recognition:**

- Should contain resolution (dpi), screening type, and/or quality level
- Resolution formats: "720x720 dpi", "1200 dpi", "2400×1200 dpi"
- Screening: "AM 175 lpi", "FM/Stochastic", "Hybrid", specific screen names
- Quality levels: manufacturer-specific (e.g., "Level 4", "High Quality", "Production")
- RIP settings: specific RIP software names, linearization references
- Offset-specific: "CTP 2400 dpi, AM 175 lpi", plate types
- Proofing-specific: "Absolute Colorimetric", "Simulate Paper White"

**Cross-validation with ICC profile:**

- Resolution should be plausible for the device type (inkjet: 360-5760 dpi, offset: 1200-4000 dpi CTP, digital: 600-2400 dpi)
- Profile description may reference a screening setting or quality mode

**Rewrite suggestions:**

- Resolution not plausible for device type
- Missing resolution entirely
- Screening specification inconsistent with device type (e.g., AM lpi for an inkjet)

---

## X/JDF Alignment

The CIP4 JDF (Job Definition Format) and XJDF (Exchange JDF) specifications define structured representations for print job parameters. The validator should ensure user specifications are reasonably conformant to these representations.

**Relevant JDF/XJDF elements:**

### Device

- JDF: `<Device DeviceID="..." FriendlyName="..." Manufacturer="..." ModelName="..." />`
- XJDF: `<Device DeviceID="..." FriendlyName="..." />`
- Validation: Device field should be parseable into manufacturer + model components

### Colorants (Inks/Media)

- JDF: `<Ink InkName="..." ColorantType="Process|Spot" />`
- JDF: `<ColorantOrder>` specifying colorant sequence
- XJDF: `<Color ColorName="..." ColorType="Process|Spot" />`
- Validation: Colorant abbreviations should map to recognized JDF ColorantType values

### Substrate (Media)

- JDF: `<Media MediaType="Paper|Film|Vinyl|..." Grade="..." Weight="..." Thickness="..." />`
- JDF: `<MediaLayers>` for multi-layer media
- XJDF: `<Media MediaType="..." Weight="..." />`
- Validation: Substrate should be parseable into media type + optional weight/grade

### Settings (Device Capabilities)

- JDF: `<ImageSetterParams Resolution="..." />` (for CTP)
- JDF: `<DigitalPrintingParams Resolution="..." />` (for digital)
- JDF: `<ConventionalPrintingParams PrintingType="Offset|Flexo|Gravure|..." />`
- XJDF: `<InterpretingParams Resolution="..." />`
- Validation: Settings should include resolution and be consistent with device type

### Reference

- CIP4 JDF specification: https://www.cip4.org/print-automation/jdf
- XJDF 2.1: https://cip4.org/document_archive/xjdf21.pdf
- The validator does NOT need to produce JDF/XJDF output — it only needs to verify that the free-text user input represents information that COULD be structured as JDF/XJDF elements without contradiction.

---

## Implementation Approach — Research Needed

The validator needs to understand the print/prepress domain well enough to evaluate free-text input. Three approaches to research:

### Option A: Lightweight AI Model (Client-Side)

Package a small language model (e.g., Claude Haiku equivalent, or a fine-tuned small model) in pure JavaScript to run inference in the browser.

**Research questions:**

- What is the smallest model capable of print/prepress domain reasoning?
- Can it run in a Web Worker without exceeding Safari's memory constraints (~4 GB tab limit, already under pressure from the generator)?
- What is the inference latency for 5 fields × ~50 tokens each?
- Can the model be quantized (4-bit, 8-bit) to fit in browser memory?
- Viable runtimes: ONNX Runtime Web, Transformers.js, WebLLM, llama.cpp WASM
- Could a fine-tuned classifier (not a full LLM) handle the structured validation patterns?

### Option B: Rule-Based Engine with Fuzzy Matching

A curated knowledge base of manufacturers, models, ink sets, paper types, and resolution ranges, with fuzzy string matching for typo tolerance.

**Research questions:**

- What databases or open datasets list printer manufacturers, models, and ink sets?
- Can we scrape/curate a sufficient knowledge base from ICC profile registries, manufacturer catalogs, and JDF device capability files?
- How do we handle the long tail of unknown/new devices while still catching nonsense?
- Is fuzzy matching (Levenshtein distance, n-gram) sufficient, or do we need semantic understanding?

### Option C: Hybrid (Rules + Lightweight Model)

Use a rule-based engine for structural validation (field format, colorant count vs profile, device class alignment) and a lightweight model for semantic plausibility (does this combination of device + colorants + substrate + settings make sense together?).

**Research questions:**

- What is the right boundary between rules and model?
- Can the model be limited to a binary plausibility classifier rather than free-text generation?
- What training data would a fine-tuned classifier need?

---

## Validation UX

### When Validation Runs

- **On input blur**: Validate individual fields as the user fills them in
- **On profile selection**: Re-validate all fields against the new ICC profile
- **Before generation**: Final validation gate — block generation if critical issues found

### Validation Output Per Field

```javascript
/** @typedef {{
 *   field: 'device' | 'colorants' | 'substrate' | 'settings',
 *   severity: 'error' | 'warning' | 'suggestion',
 *   message: string,
 *   suggestedValue?: string,
 * }} ValidationResult */
```

- **error**: Field is definitively wrong (e.g., RGB colorants with CMYK profile). Block generation.
- **warning**: Field is suspicious but possibly valid (e.g., unusual resolution for device type). Allow generation with confirmation.
- **suggestion**: Field could be improved (e.g., manufacturer typo, missing model number). Show inline, don't block.

### Integration Point

```javascript
// In test-form-generator-app-element.js, before generation:
const validationResults = await specificationValidator.validate(userMetadata, iccProfileHeader);
```

---

## Constraints

1. **Client-side only** — No backend API calls for validation
2. **Safari memory** — The generator already operates near Safari's memory limit with large PDFs. The validator's memory footprint must be minimal (target: <50 MB for rules, <500 MB for a model)
3. **Offline capable** — Must work without network access once loaded
4. **Latency** — Per-field validation should complete in <500 ms. Full cross-validation in <2 s.
5. **Extensibility** — Must accommodate new manufacturers, ink sets, and substrates without retraining a model or major code changes
6. **Unknown tolerance** — Must allow genuinely new or uncommon devices/colorants/substrates. The goal is to catch NONSENSE, not to enforce a whitelist.

---

## Curated Examples for Training/Testing

### Valid Specifications

| Device                        | Colorants                                    | Substrate                    | Settings                        | ICC Profile                        |
| ----------------------------- | -------------------------------------------- | ---------------------------- | ------------------------------- | ---------------------------------- |
| Epson SC-P9570                | UltraChrome Pro12 K,C,M,Y,LC,LM,LK,LLK,O,G,V | EFI Gravure Proof Paper 4245 | 720x720 dpi, Level 4            | Epson proofer profile (CMYK)       |
| Canon iPR C10010VP            | Process CMYK                                 | Mondi Color Copy 100 gsm     | 600x600 dpi, Standard           | Canon digital press profile (CMYK) |
| Heidelberg Speedmaster CX 104 | Offset CMYK (Sun Chemical)                   | Sappi Magno Satin 150 gsm    | CTP 2400 dpi, AM 175 lpi        | FOGRA51 (CMYK)                     |
| HP DesignJet Z9+              | HP 747 C,M,Y,mK,pK,Gy,CB                     | HP Premium Satin Photo Paper | 1200x1200 dpi, Best             | HP large-format profile (CMYK)     |
| EIZO ColorEdge CG2700X        | sRGB                                         | N/A                          | Hardware calibration, 140 cd/m² | sRGB (RGB)                         |

### Invalid Specifications (should be caught)

| Device                 | Colorants            | Substrate    | Settings   | Problem                                    |
| ---------------------- | -------------------- | ------------ | ---------- | ------------------------------------------ |
| Samsung Galaxy S24     | CMYK                 | Paper        | 300 dpi    | Phone is not a print device                |
| Epson SC-P9570         | RGB                  | Coated paper | 720 dpi    | RGB colorants on an inkjet that uses CMYK+ |
| Heidelberg Speedmaster | Inkjet K,C,M,Y,LC,LM | Vinyl        | AM 175 lpi | Inkjet colorants on an offset press        |
| Generic Printer        | Colors               | Material     | Settings   | All fields are too vague                   |
| aaaa                   | bbbb                 | cccc         | dddd       | Obvious nonsense                           |

---

## Deliverables for Research Phase

1. **X/JDF field mapping** — Document how each of the 4 specification fields maps to JDF/XJDF elements, with examples from real JDF files
2. **Knowledge base scope** — Estimate the size and maintainability of a curated manufacturer/model/colorant/substrate database
3. **Model feasibility** — Test at least one lightweight model (Transformers.js or WebLLM) for print domain reasoning, measuring memory usage, latency, and accuracy
4. **Rule engine prototype** — Build a minimal rule-based validator with the structural checks (colorant count vs profile color space, device class alignment)
5. **Recommendation** — Option A, B, or C, with evidence

---

## Files Referenced

| File                                                              | What                                     |
| ----------------------------------------------------------------- | ---------------------------------------- |
| `generator/index.html:338-362`                                    | Specification input fields               |
| `generator/elements/test-form-generator-app-element.js:1208-1222` | User metadata extraction                 |
| `generator/classes/test-form-pdf-document-generator.js:107-113`   | `UserMetadata` typedef                   |
| `generator/classes/test-form-pdf-document-generator.js:1615-1622` | Docket embedding                         |
| `services/ICCService.js`                                          | ICC profile header parsing               |
| `classes/configurations/assembly-policy.json`                     | Profile categories and rendering intents |
| `packages/icc/index.d.ts`                                         | ICC profile header interface             |
