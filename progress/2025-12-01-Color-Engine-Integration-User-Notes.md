# User Notes

AI AGENTS: THIS FILE SHOULD NOT TO BE READ FROM OR WRITTEN TO UNLESS EXPLICITLY INSTRUCTED DIRECTLY IN A PROMPT.

This document is only meant to be read and written to by the developer.

---
---
---

- Progress UI: `claude --resume cc214358-8d37-436d-8eff-ab86a169a0d2`
- Bootstrap Worker: `claude --resume c160e1e9-5482-4b6d-82d4-487258f81b72`
- Firefox Limits: `claude --resume 384918ce-bda4-403a-82d7-e914bc0729f2`

---
---
---

2026-02-17-002

I also found a huge factor that significantly affects separate/recombined chains, and likely also affects in-place. Basically, when I used separate chains, when the recombined pdf is 22pg ~2.14 GB, I got sRGB 8pg 1.84 GB, sGray 10pg 892.8 MB, SepK 2pg 1.5 GB, and Lab 2pg 1.5 GB. This tells me that the pdf documents in general are not being properly cleaned up. We previously addressed cleanup in `services/` and `services/legacy`, it may be left out or it is not being used properly.

Investigate and refine your findings.

We need to update the progress document which I renamed to `2026-02-17-WORKFLOWS-PROGRESS.md`, we need it to track more than just parallel workers, we need it to track what we are doing in this thread. Make sure you include the test matrix and all the identified patterns to allow me to read and plan my next steps.

---

2026-02-17-001

Chrome worked vey well with the full 8-bit form (down to < 3m) with bootstrap+parallel, but it could not handle the full 16-bit output due to some PDF-lib issues.

The following files live in `~/Downloads`

Chrome:

- Crashed: `2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets (16-bit) - eciCMYK v2 - In-Place - Chrome - Bootstrap - 6 Workers - Local (R2).pdf.log`
- Crashed: `2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets (16-bit) - eciCMYK v2 - Recombined - Chrome - Bootstrap - 6 Workers - Local (R2).pdf.log`
- Worked: `2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets (8-bit) - eciCMYK v2 - In-Place - Chrome - Bootstrap - 6 Workers - Local (R2).pdf.log`

Safari:

- Creashed: `2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets (8-bit) - eciCMYK v2 - Recombined - Safari - Bootstrap - 4 Workers - Local (R2).pdf.log`
- Creashed: `2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets (8-bit) - eciCMYK v2 - In-Place - Safari - Bootstrap - 4 Workers - Local (R2).pdf.log`
- Creashed: `2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets (8-bit) - eciCMYK v2 - In-Place - Safari - Bootstrap - 6 Workers - Local (R2).pdf.log`
- Worked: `2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets (8-bit) - FIPS_WIDE28T-TYPEavg - 16-bit - Recombined - Safari (No Console) - Main - Local (R2).pdf.log`
- Worked: `2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets (8-bit) - eciCMYK v2 - 8-bit - In-Place - Safari (No Console) - Bootstrap - 2 Workers - Local (R2).pdf` (no log)
- No download: `2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets (16-bit) - FIPS_WIDE28T-TYPEavg - 16-bit - Recombined - Safari (No Console) - Main - Local (R2)`
- No download: `2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets (16-bit) - eciCMYK v2 - 16-bit - In-Place - Safari (No Console) - Bootstrap - 2 Workers - Local (R2)`
- No download: `2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets (8-bit) - FIPS_WIDE28T-TYPEavg - 16-bit - In-Place - Safari (No Console) - Main - Local (R2)`

---
---
---

2026-02-16-003

**Immediate task** (update progress document accordingly)

I replaced the `workers-checkbox` with two separate checkboxes:

- A Bootstrap Worker is a worker specific to `2025/generator/` which will be used to for the entire generation process, including `PDFDocumentColorConverter`(s), `AssetPagePreConverter` and any blocking functionality in `TestFormPDFDocumentGenerator` will be performed — this is what "do not block main thread means.

- Parallel Workers refer to the existing worker-pool functionality in `PDFDocumentColorConverter` and related classes, which is a secondary priority for now.

GOAL: Implement and test a working Bootstrap Worker.

---

**Chrome In-Place**

```
Generating test form — 95% — 5:14
Saving PDF — 0% — 0:13
Finalizing PDF — 0:00
Generating slugs — 0:01
Converting colors — 4:57
Loading asset PDF — 0:00
Preparing ICC profile — 0:00
Downloading assets — 0:00
Loading manifest — 0:00
```

```
PDFWriter.js:28 Uncaught (in promise) RangeError: Array buffer allocation failed
    at new ArrayBuffer (<anonymous>)
    at new Uint8Array (<anonymous>)
    at PDFStreamWriter.<anonymous> (PDFWriter.js:28:34)
    at step (tslib.es6.js:100:23)
    at Object.next (tslib.es6.js:81:53)
    at fulfilled (tslib.es6.js:71:58)
(anonymous)	@	PDFWriter.js:28
step	@	tslib.es6.js:100
(anonymous)	@	tslib.es6.js:81
fulfilled	@	tslib.es6.js:71
Promise.then		
step	@	tslib.es6.js:73
(anonymous)	@	tslib.es6.js:74
__awaiter	@	tslib.es6.js:70
PDFWriter.serializeToBuffer	@	PDFWriter.js:20
(anonymous)	@	PDFDocument.js:1261
step	@	tslib.es6.js:100
(anonymous)	@	tslib.es6.js:81
fulfilled	@	tslib.es6.js:71
Promise.then		
step	@	tslib.es6.js:73
(anonymous)	@	tslib.es6.js:74
__awaiter	@	tslib.es6.js:70
PDFDocument.save	@	PDFDocument.js:1240
generate	@	test-form-pdf-document-generator.js:390
await in generate		
#handleGenerate	@	test-form-generator-app-element.js:367
await in #handleGenerate		
(anonymous)	@	test-form-generator-app-element.js:71
```

**Chrome Recomined Chains**


```
Generating test form — 89% — 5:24
Recombining chains — 14% — 0:06
Processing chains — 5:15
Generating slugs — 0:01
Converting colors — 0:00
Loading asset PDF — 0:00
Preparing ICC profile — 0:00
Downloading assets — 0:00
Loading manifest — 0:00
```


```
PDFRawStream.js:14 Uncaught (in promise) RangeError: Array buffer allocation failed
    at new ArrayBuffer (<anonymous>)
    at Uint8Array.slice (<anonymous>)
    at PDFRawStream.clone (PDFRawStream.js:14:55)
    at PDFObjectCopier.copyPDFStream (PDFObjectCopier.js:84:14)
    at PDFObjectCopier.copy (PDFObjectCopier.js:35:54)
    at PDFObjectCopier.copyPDFIndirectObject (PDFObjectCopier.js:100:40)
    at PDFObjectCopier.copy (PDFObjectCopier.js:36:59)
    at PDFObjectCopier.copyPDFDict (PDFObjectCopier.js:64:43)
    at PDFObjectCopier.copy (PDFObjectCopier.js:33:49)
    at PDFObjectCopier.copyPDFDict (PDFObjectCopier.js:64:43)
PDFRawStream.clone	@	PDFRawStream.js:14
PDFObjectCopier.copyPDFStream	@	PDFObjectCopier.js:84
PDFObjectCopier.copy	@	PDFObjectCopier.js:35
PDFObjectCopier.copyPDFIndirectObject	@	PDFObjectCopier.js:100
PDFObjectCopier.copy	@	PDFObjectCopier.js:36
PDFObjectCopier.copyPDFDict	@	PDFObjectCopier.js:64
PDFObjectCopier.copy	@	PDFObjectCopier.js:33
PDFObjectCopier.copyPDFDict	@	PDFObjectCopier.js:64
PDFObjectCopier.copy	@	PDFObjectCopier.js:33
PDFObjectCopier.copyPDFStream	@	PDFObjectCopier.js:89
PDFObjectCopier.copy	@	PDFObjectCopier.js:35
PDFObjectCopier.copyPDFIndirectObject	@	PDFObjectCopier.js:100
PDFObjectCopier.copy	@	PDFObjectCopier.js:36
PDFObjectCopier.copyPDFDict	@	PDFObjectCopier.js:64
PDFObjectCopier.copy	@	PDFObjectCopier.js:33
PDFObjectCopier.copyPDFDict	@	PDFObjectCopier.js:64
PDFObjectCopier.copy	@	PDFObjectCopier.js:33
PDFObjectCopier.copyPDFDict	@	PDFObjectCopier.js:64
PDFObjectCopier.copyPDFPage	@	PDFObjectCopier.js:53
PDFObjectCopier.copy	@	PDFObjectCopier.js:32
(anonymous)	@	PDFDocument.js:649
step	@	tslib.es6.js:100
(anonymous)	@	tslib.es6.js:81
fulfilled	@	tslib.es6.js:71
Promise.then		
step	@	tslib.es6.js:73
(anonymous)	@	tslib.es6.js:74
__awaiter	@	tslib.es6.js:70
PDFDocument.copyPages	@	PDFDocument.js:634
#generateSeparateChains	@	test-form-pdf-document-generator.js:750
await in #generateSeparateChains		
generate	@	test-form-pdf-document-generator.js:326
await in generate		
#handleGenerate	@	test-form-generator-app-element.js:367
await in #handleGenerate		
(anonymous)	@	test-form-generator-app-element.js:71
```



---

2026-02-16-002

Re: `classes/baseline/` Workers and Concurrency
Progress: `testing/iso/ptf/2025/classes/baseline/2026-02-16-CONCURRENCY-PROGRESS.md`

In the past days, we managed to get the implementation in `classes/baseline/` to work well in the main thread across Safari, Chrome and Firefox. We've identified and addressed a lot of memory leaks and inefficiencies.

Meanwhile, we were conflating the issues and making assumptions about the causes being related to workers, and this has left us with a big mess. Essentially, workers are no longer usable in any browser, when before they were at least usable in Safari, and this is the result of Claude insisting on fixing what was never actually broken.

Our goal is to investigate and close the gaps for workers. Afterall, workers were created specifically to make sure the main thread is not blocked and to make it possible to complete tasks more efficenctly across threads. The concurrency layer needs to be optimized for ever-green browsers (and Firefox 115 specifically for Franz) and Node.js. For this, we need to revamp our diagnostics layer and make sure we are using to accurately identify real issues.

The requirements for this session:

1. Requirement: Do not block main thread
   
   Intiating primary `PDFColorConverter` operations in both the main thread or in a worker — making it possible to avoid blocking the main thread irrespective of concurrency.

2. Requirement: Adaptive isomorphic concurrency

   To  investigate and resolve regressions and gaps in the current concurrency layer, including memory,  buffer transfer… etc.

I need you to carefully review the current implementation in `classes/baseline/` specifically focusing on how it relates to:

- `2025/generator/`
- `experiments/scripts/generate-verification-matrix-baseline.js`
- `experiments/convert-pdf-color-baseline.js`
- Any other `experiment/` or `experiment/script/` using the `classes/baseline/` implementation

Review relevant progress documents, including:

- `testing/iso/ptf/2025/generator/PROGRESS.md`
- `testing/iso/ptf/2025/generator/2026-02-15-MEMORY-MANAGEMENT-PROGRESS.md`
- `testing/iso/ptf/2025/experiments/2026-02-15-BASELINE-CLEANUP-PROGRESS.md`
- `testing/iso/ptf/2025/experiments/2026-02-13-BASELINE-CLASSES-FIXES-PROGRESS.md`
- `testing/iso/ptf/2025/experiments/2026-01-27-DIAGNOSTICS-PROGRESS.md`
- `testing/iso/ptf/2025/experiments/2026-01-27-DIAGNOSTICS-REVISION-PLAN.md`
- `testing/iso/ptf/2025/experiments/2026-01-31-DIAGNOSTICS-PROGRESS.md`

Review relevant historical plans, including:

- `/Users/daflair/.claude/plans/eager-launching-feigenbaum-002.md`
- `/Users/daflair/.claude/plans/eager-launching-feigenbaum-001.md`
- `/Users/daflair/.claude/plans/composed-napping-engelbart.md`

Review parallel implementations for context, including:

- `2025/classes/baseline` (core implementation — used exclusively by `2025/generator/`, `experiments/*-baseline.js`, `experiments/scripts/*-baseline.js`)
- `2025/classes/` (onhold due to many gaps and regressions — likely used by `experiments/` and `scripts/`)
- `2025/classes/legacy` (onhold due to many gaps and regressions — likely used by `experiments/` and `scripts/`)
- `2025/services/` (transitional prototype likely used by `experiments/legacy/` and `experiments/scripts/legacy/`)
- `2025/services/legacy` (initial prototype used by `2025/generate.js`)

TODOs:

- Review the above references

- Draft the progress document `2026-02-16-CONCURRENCY-PROGRESS.md` (it's empty) and include in it all relevant context and references based on your thorough review and assessment. The progress document needs to provide humans and agents all necessary context to be able to coordinate work towards the goals and requirements.

- Review the current implementation in `2025/generator/` and `classes/baseline/` to identify potential issues and gaps that need to be addressed, and lay the groundwork for devising the work plan, reflecting it in the progress document.

- Once this is done, sequentially task 3 subagents (giving them all the facts and references) to review the progress document and plan, looking for gaps, improvements, conducting close research into the different implementations, and into the internals of the `packages/` used… etc. — leverage this process to iteratively refine the progress document, but don't just take the subagent reports for granted, evaluate, verify, and expand on them, before updating the progress document and invoking the next subagent.

- Finally, draft a plan, keeping track of all key questions and decisions in it so I can review it, indicate preferences, clarify requirements, address open questions… etc.

---

2026-02-16-001

The Most Efficient Encoding Method

If you are dealing specifically with the Latin-1 range (`U+0000` to `U+00FF`) and want a 1:1 mapping (where the byte value equals the character code), you have two primary options depending on your environment.

1. The Modern "Buffer" Method (Fastest in Node.js)

If you are working in Node.js, the Buffer class is highly optimized for this exact operation. It bypasses the need for manual loops.

```javascript
const str = "Café"; // contains 'é' (U+00E9)
const latin1Buffer = Buffer.from(str, 'latin1'); 
// Result: Uint8Array [ 67, 97, 102, 233 ]
```

Use code with caution.

1. The Uint8Array.from Method (Best for Browser)
In the browser, since TextEncoder won't help, the most concise and efficient way to perform an identity mapping is to iterate through the string codes.

```javascript
const str = "Café";
const bytes = Uint8Array.from(str, c => c.charCodeAt(0));
Use code with caution.
```

Performance Comparison

| Method                   | Efficiency | Context                                      |
| ------------------------ | ---------- | -------------------------------------------- |
| Buffer.from(s, 'latin1') | Highest    | Node.js (C++ backed)                         |
| Uint8Array.from(s, map)  | High       | Browser (Single-pass)                        |
| Manual for loop          | Medium     | Good for very old engines                    |
| TextEncoder              | N/A        | Incorrect (produces 2 bytes for chars > 127) |

[!IMPORTANT]
A Note on Safety: This method effectively "truncates" characters. If your string accidentally contains a character outside the `U+00FF` range (like a Euro symbol € or an emoji), charCodeAt(0) will return a value higher than 255. When assigned to a Uint8Array slot, it will be bit-masked (e.g., 256 becomes 0), potentially corrupting your data.

---
---
---

2026-02-15-002

I thought the whole point was to copy-into the same PDFDocument, copying asset pages that need to be converted through more than one chain, converting the asset pages for each chain all at once, deleting any asset pages no longer needed, moving on to the next chain, then finally, once all asset pages have been converted and are in output color space, assembling the layouts pages in the same document, then deleting the converted asset pages.---

2026-02-15-001

I redoplyed ../conres.io-staging and I hit the same meory problems, but I am sure this is due to poor memory management in how you are using PDF lib.

TASKS:

From now on we are working in the new progress document `testing/iso/ptf/2025/generator/2026-02-15-MEMORY-MANAGEMENT-PROGRESS.md`.

1. I added  `workers-checkbox` to index.html, it is off by default, if I check it then useWorkers must be true, and workers should be limited to two workers. Make this work, replicate it in staging and let me know to deploy and test.

2. Investigate very carefully the workflow, this means adding a tests (to be skipped by defauled) using the playright infrastructure in place, which you use to properly track the memory managemnt using official playwright APIs, using it carefully to generate insights, converting to the `FIPS_WIDE_28T-TYPEavg.icc` and `eciCMYK v2.icc` profiles, in 8-bit first, and when we get that sorted out, we can do 16 bit.

3. Add a new `PDFDocumentColorConverter` argument in classes/baseline, ``perPageConfigurations: Record<`${number}`, Partial<Configuration>>``, which we will use to allow `PDFDocumentColorConverter` to resolve configurtion it is passing to the specific `PDFPageColorConverter` for specific pages. We're not removing features, we are adding a new strategy to our generator classes, one which determines per-page configurations to avoid using selective conversions. I will add the currently hidden `conversion-strategy` radio inputs which we will use to toggle between strategies.

---
---
---

2026-02-14-006

---
---
---

2026-02-14-006

I need to share the staged copy with Franz who does not want to update his macOS, and is stuck using Firefox 115. If you check the `2025/generate.js` and its dependencies in conres.io-staging, you will see that I use workarounds for features that need to be polyfilled.

I need a clean solution to do this for the `2025/generator/generator.js` and its dependencies in `conres.io-staging`.

---

2026-02-14-005

I need to push the current work temporarily to deploy and test, so I checked out a separate copy of this repo in `../conrs.io-staging`. I don't want to break existing code, I want to add `2025/generator/` and copy over the necessary modules and packages.

Currently, upstream main is still at `9c17c5dc42d4ff5935fd5058683bfea98f94b108`, once all the necessary files are copied over to `../conrs.io-staging`, I will make a single commit to deploy. Later on, we will clean up all the commits and force push, but I need the fastest path to deploy `2025/generator/` now.

---

2026-02-14-004

What I mean about progress output looks like this:

```
<div>Generating test form — {{overall}}% — {{elapsed overall m:ss}}</div>
<small>
<div>Pre-converting assets — {{…}}% — {{elapsed m:ss}}</div>
<div>Downloading assets — {{loading/download}}% — {{elapsed m:ss}}</div>
</small>
```

When new stages of operations start, they are inserted right under the overall div.

---

2026-02-14-003

Conversion must use workers, using a detection logic similar to what is used in `classes/baseline` or `services/` to determine the ideal number of workers, then having that number of PDFColorConverter instances using 2 workers (they handle the worker logic). Use `Promise.withResolvers()` to create promises for all the conversion operations for fine-grained control, then separately make sure you are only running the maximum number of conversions at any given time, initiating the next in queue once a prior async conversion operation concludes (while also calling that concluded operations `operationPromiseWithResolvers.resolve()`). This spearation makes it possible to have a single `await Promise.all()` for all the individual promises that resolve after the conclusion of the operation at one level, while also having the async queing logic awaiting individual operation promises.

Does that make sense? Elaborate this back to me in a concise unambigious outline format to be sure we are on the same page before you work on this enhancement.

---

2026-02-14-002

> For non-matching assets, the baseline PDFDocumentColorConverter doesn't support caller-specified intermediate profiles (intermediates come from policy rules in color-conversion-rules.json). How should we handle the source -> layout -> output chain?

→ NO IT DOES NOT — If and when a page in the manifest uses a layout that uses an asset, the specific page for that asset in the assets PDF is extacted using pdflib, if the asset's own color space matches the layout's color space, the one-stage PDFDocumentConverter is used, if the asset has a different color space, then the respective PDFDocumentColorConverter is used, in both cases, the converted asset is cached to be reused for the same layout and asset color spaces if necessary. The eco-system of the baseline classes that includes the `PDFDocumentColorConverter` uses clean separation of concerns and inheritance patterns. If there is only support for output profile, then the eco system needs to be amended to allow the use of an array of profiles in the configuration, and that should result in multiprofile transforms using existing and/or new methods (when necessary, and which should be added in the correct class based on the current architecture and conventions). Lazy, cached, multiprofile transformations all work to improve the efficiency of an otherwise very taxing process.

---

2026-02-14-001

❯ Re: New Generator Prototype

I'm in the process of mocking up the prototype of the new generator.

Changes from previous generator:

- Instead of asking the user to download the pre-assembled PDF, the new generator uses the new `PDFDocumentColorConverter` (using `classes/baseline` for now)

- Instead of working with a pre-assembled PDF with a `Slugs.json`, the new generator assembles the PDF during the generation process from an assets PDF file with a new `manifest.json`, composing each page  from the layout, color space, and asset descriptors.

- Instead of using a complex multi-step generator-based UI, the new generator is simplified for prototyping purposes, all fields are enabled, and a single Generate button, which validates that a output profile is selected, that all fields are filled (unless Debugging is checked), downloads (unless cached) the asset PDF, converts the asset pages to the output profile, generates the slugs, and assembles the pages.

- Instead of coupling the generation logic with the user interface, the new generator prototype separates the concerns, with new `TestFormPDFDocumentGenerator` (generation logic) and `TestFormGeneratorAppElement` (custom-element) classes.

Task:

Refactor and implement changes in `testing/iso/ptf/2025/generator/generate.js` based on the new user interface in `testing/iso/ptf/2025/generator/index.html`, using the new assets from `testing/iso/ptf/assets/2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets.pdf` and its related resources in `testing/iso/ptf/assets/2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets` which are specifically designed to work with the new generator.

The task is successful once the changes are in place and users can generate a PDF with a specific output ICC profile using the new `testing/iso/ptf/2025/generator/index.html` entrypoint.

Work will be tracked in the `testing/iso/ptf/2025/generator/PROGRESS.md` progress document. This document needs to be created first-and-foremost, to work out the specifics needed to complete this preliminary stage. This document will continue to be used for tracking in subsequent stages yet to be determined.

---
---
---

2026-02-13-004

The problems persisted exactly still!

Upon first checks, most of `* - Color-Engine 2025-12-19 (2026-02-13-007)` outputs seem to be in order, except for `eciCMYK v2 - K-Only GCR - * - Color-Engine 2025-12-19 (2026-02-13-007)`, while, all of `* - Color-Engine 2026-01-30 (2026-02-13-006)` outputs seem to be in order.

In essence, the only problems I observed are in:

- `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - K-Only GCR - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-13-007).pdf`
- `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - K-Only GCR - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-13-007).pdf`

The problems are consistent between main thread and worker:

- `ICCBasedRGB` images were converted with the expected intent (`preserve-k-only-relative-colorimetric-gcr`).
- `ICCBasedGray` and `ICCBased were not converted
- None of the content streams were converted

Investigate and let me know what you recommend — what you recommended and fixed did not resolve the problems!

See log for error details: `testing/iso/ptf/2025/experiments/output/2026-02-13-007.log`

---

2026-02-13-003

For Issue one:

- Implement fallback "multi-stage" (not "two-stage") transformations using `colorEngine.createTransform()` and `colorEngine.doTransform()`, when `requireMultiprofileTransformation: true` and `colorEngine.createMultiprofileTransformation()` is `undefined`, for every `intermediateProfiles`, limited to a single transformation when `intermediateProfiles` is empty, or, otherwise, two or more when `intermediateProfiles` is not empty.
- Eliminate any hard-coded intent overrides, in `ImageColorConverter.getEffectiveRenderingIntent` or other places that are being handled with the policy rules, ensuring that only the policy determines overrides for either `requireMultiprofileTransformation` and `intermediateProfiles`.

For Issue 2 and 3:

- Fixes recommended as discussed.

Just apply the fixes to `classes/baseline` for now.

Update the progress document to reflect decisions and tasks.

---

2026-02-13-002

For issues 1, 2 and 3:

- Do the same issue apply also to the same class(es) `classes/` as they do in `classes/baseline`, and if so would the same recommendations apply or something else?
  For issue 2:
- Workers need to honour the engine version specified by the main thread, ensuring that it is reflected in `colorEngineProvider.module.VERSION, correct? - How is`rgb-to-rgb-multiprofile-black-point-scaling-enhancement` not firing correctly, and is/how is that being fixed per your recommendation?
  For issue 3:
- Are there any other hard-coded overrides that need to be addressed?

---

2026-02-13-001

Re: Baseline classes and color-engine-2025-12-19

I've notice descrpencies in how baseline classes handle color-engine-2025-12-19, but not color-engine-2026-01-30 (last supported version).

To investigate I created ran the following commands:

- `2026-02-12-REFACTOR-FIXTURES-DEBUGGING-2025-12-19.json` → `output/2026-02-13-003`:

  - Generation: `(cd testing/iso/ptf/2025/experiments && node scripts/generate-verification-matrix-baseline.mjs --using-diagnostics --config=configurations/2026-02-12-REFACTOR-FIXTURES-DEBUGGING-2025-12-19.json)`
  - Comparison: `(cd testing/iso/ptf/2025/experiments && node compare-pdf-outputs.js --config=configurations/2026-02-12-REFACTOR-FIXTURES-DEBUGGING-2025-12-19.json --source-dir=output/2026-02-13-003 --output-dir="output/2026-02-13-003-C01" 2>&1 | tee "output/2026-02-13-003-C01.log"`

- `2026-02-12-REFACTOR-FIXTURES-DEBUGGING-2026-01-30.json` → `output/2026-02-13-004`:

  - Generation: `(cd testing/iso/ptf/2025/experiments && node scripts/generate-verification-matrix-baseline.mjs --using-diagnostics --config=configurations/2026-02-12-REFACTOR-FIXTURES-DEBUGGING-2026-01-30.json)`
  - Comparison: `(cd testing/iso/ptf/2025/experiments && node compare-pdf-outputs.js --config=configurations/2026-02-12-REFACTOR-FIXTURES-DEBUGGING-2026-01-30.json --source-dir=output/2026-02-13-004 --output-dir="output/2026-02-13-004-C01" 2>&1 | tee "output/2026-02-13-004-C01.log"`

- Observations for color-engine-2025-12-19 K-Only GCR Main Thread and Workers (`output/2026-02-13-003`):

  - Images (`output/2026-02-13-003-C01/COMPARISONS.md`):

    - `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (8-bit) - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (8-bit) - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (16-bit) - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (16-bit) - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - FIPS_WIDE_28T-TYPEavg - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - Relative Colorimetric - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-13-003).pdf`

      - **All** images were converted

    - `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - K-Only GCR - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - K-Only GCR - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-13-003).pdf`

      - **All** `ICCBasedRGB` images were converted
      - **No** `ICCBasedGray` images were converted
      - **All** `Lab` images were converted

    - `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - FIPS_WIDE_28T-TYPEavg - Relative Colorimetric - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-13-003).pdf`

      - **No** images were converted

  - Content Streams (`output/2026-02-13-003-C01/SUMMARY.md`):

    - `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (8-bit) - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (8-bit) - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (16-bit) - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (16-bit) - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - FIPS_WIDE_28T-TYPEavg - Relative Colorimetric - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - FIPS_WIDE_28T-TYPEavg - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - K-Only GCR - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - K-Only GCR - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - Relative Colorimetric - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-13-003).pdf`

      - **No** content streams were converted

- Observations for color-engine-2026-01-30 K-Only GCR Main Thread and Workers (`output/2026-02-13-004`):

  - Images (`output/2026-02-13-004-C01/COMPARISONS.md`):

    - `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (8-bit) - Refactored - 7 Workers - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (8-bit) - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (16-bit) - Refactored - 7 Workers - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (16-bit) - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - FIPS_WIDE_28T-TYPEavg - Relative Colorimetric - Refactored - 7 Workers - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - FIPS_WIDE_28T-TYPEavg - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - K-Only GCR - Refactored - 7 Workers - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - K-Only GCR - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - Relative Colorimetric - Refactored - 7 Workers - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-13-004).pdf`

      - **All** images were converted

  - Content Streams (`output/2026-02-13-004-C01/SUMMARY.md`):

    - `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (8-bit) - Refactored - 7 Workers - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (8-bit) - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (16-bit) - Refactored - 7 Workers - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Lab (16-bit) - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - FIPS_WIDE_28T-TYPEavg - Relative Colorimetric - Refactored - 7 Workers - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - FIPS_WIDE_28T-TYPEavg - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - K-Only GCR - Refactored - 7 Workers - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - K-Only GCR - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - Relative Colorimetric - Refactored - 7 Workers - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
      `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-13-004).pdf`

      - **All** content streams were converted

Based on those observations:

1. Baseline classes fail to apply the `policyId: "k-only-gcr-legacy-multistage-transform-requirement"` rule correctly for engines that do not expose `createMultiprofileTransform`

   - Rationale:
     - `ICCBasedGray` images were not converted in `* - eciCMYK v2 - K-Only GCR - Refactored - * - Color-Engine 2025-12-19 (2026-02-13-003).pdf` suggesting that:
       - A fallback JavaScript implementation is not used (or missing) when `createMultiprofileTransform` is not exported by the color-engine itself
     - `Lab` images were converted in `* - eciCMYK v2 - K-Only GCR - Refactored - * - Color-Engine 2025-12-19 (2026-02-13-003).pdf` suggesting that, either:
       - A fallback JavaScript implementation is used when `createMultiprofileTransform` is not exported by the color-engine itself; or
       - Fallback JavaScript implementation is not used (or missing) but color-engine-2025-12-19 only supported 3-channel k-only-gcr transformations (i.e., `Lab` and `RGB`).
   - Resolution:
     - Ensure proper handling for the equivalent operations for `createMultiprofileTransforms` in the `classes/baseline` JavaScript implementation when it is not exported by the color-engine itself
     - Ensure proper handling for policy-based rules and elimination any conflicting hardcoded assumptions, specifically for `policyId: "k-only-gcr-legacy-multistage-transform-requirement"` overrides `requiresMultiprofileTransform: true` for `renderingIntents: ["preserve-k-only-relative-colorimetric-gcr"], sourceColorSpaces: ["Gray", "CMYK", "Lab"], destinationColorSpaces: ["CMYK"]`

2. Baseline classes fail to properly congfigure workers.

   - Rationale:
     - ALL images were converted in `* - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
       and ALL images were converted in `Lab ({8,16}-bit) - * - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
       and ALL or SOME images were convered in `eciCMYK v2 - * - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
       and ALL images were converted in `FIPS_WIDE_28T-TYPEavg - * - Main Thread - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  
       but NO images were converted in `* - FIPS_WIDE_28T-TYPEavg - * - 7 Workers - Color-Engine 2025-12-19 (2026-02-13-003).pdf`, suggesting that:
       - Configuration from main thread did not properly propogate to the worker in specific cases; and,
       - Potentially, hardcoded logic may be interefering with the policy-based architecture
   - Resolution:
     - Ensure proper handling of configuration propogation from main thread to worker without exceptions
     - Ensure proper handling for policy-based rules and elimination any conflicting hardcoded assumptions, specifically for `policyId: "k-only-gcr-to-relative-colorimetric-fallback"` overrides `renderingIntent: "relative-colormetric"` for `renderingIntents: ["preserve-k-only-relative-colorimetric-gcr"], "destinationColorSpaces": ["Gray", "RGB", "Lab"]`

3. Baseline classes fail to handle content streams for specific color-engines:

   - Rationale:
     - ALL content streams were converted in `* - Color-Engine 2026-01-30 (2026-02-13-004).pdf`  
       but NO content streams were converted in `* - Color-Engine 2025-12-19 (2026-02-13-003).pdf`  

Tasks:

1. Create the `experiments/2026-02-13-BASELINE-CLASSES-FIXES-PROGRESS.md` progress document
2. Sequentially, for each of the issues observed above
   - Investigate and document each of the above observations to determine the actual causes and recommend suitable resolutions
   - Document findings and recommendations in progress document
3. Create a table summarizing the causes and recommendations for all the above issues for readability
4. Await my instructions on what to do afterwards

---
---
---

2026-02-12-001

Re: color-engine-2026-02-14

I added the new `color-engine-2026-02-14` and replaced the `color-engine` symbolic link to default to it instead of `color-engine-2026-01-30`. A lot has changed in the new engine, including significant cleanup of useless JavaScript consumer-side APIs, internal changes without API changes, as well as the internalization of the special handling for Lab `0/-128/-128` and other aspects that have been implemented in the `classes/` first and that may be needed for older engines, but must not be used with the new one.

The code is the single source of truth, next to that, Claude prepared `testing/iso/ptf/2025/experiments/2026-02-14-COLOR-ENGINE-UPDATE-PROGRESS.md` with a lot of the insights needed to transition to the new engine.

You need to explore the current code in `classes/` and `services/` thoroughly to determine what changes are needed to support the new engine while maintaining backward compatibility. Until the new engine is properly integrated, the changes will affect experiments and tests that were using the default engine from `color-engine`, which should instead use the specific mechanisms in `classes/` and `services/` to use `color-engine-2026-01-30` to create baselines and test for regressions. Tests that are affected by the API changes but remain relevant to the new API need to have both the color-engine-2026-01-30 and the color-engine-2026-02-14 tests running, other tests that are no longer needed for `color-engine-2026-02-14` should be rewired to use `color-engine-2026-01-30` instead of `color-engine`. In all cases, tests that use specific color engine versions should be clearly suffixed with the `(color-engine-YYYY-MM-DD)` or `(color-engine-YYYY-MM-DD and older)` to make sure there is clarity to decide when tests need more revisions for future color-engine iterations.

Draft the `experiments/2026-02-12-COLOR-ENGINE-2026-02-14-INTEGRATION-PROGRESS.md` progress document, conducting and documenting all aspects that are necessary to create a plan. This includes making and reverting changes to tests to use the correct color-engine version (both `classes/` and `services/` imeplementions provide a specific API to use a non-default color-engine) and make sure you also run the `experiments/` that support the color-engine flag to see if they work. Document all the changes that were needed to get the tests and experiments to work, and make sure you revert all changes you made (I staged or commited `classes/**/*`, `services/**/*`, `tests/**/*` and `experiments/*` not `experiments/scripts/**/*` — CRITICAL if you use `git` be careful not to mess up the staged files) afterwards. Once this is done, I will review and will engage planning mode when ready.

---

2026-02-08-002

First, I need the above in the new 2026-02-08-CROSS-MATCHED-STATISTICS-PROGRESS.md progress document.

Then I need you to explain to me what I am supposed to be looking at here:

```
Cross-Matched Reference Colors (Delta-E by position)
  ┌─────────┬─────────────────┬────────┬──────────┬──────────┬─────────┬────────┬────────┬────────┬───────────┬──────────┬──────────┐
  │ (index) │ Lab             │ Pixels │ Overlaps │ Variants │ Mean ΔE │ Min ΔE │ Max ΔE │ StdDev │ Mean ΔEin │ Min ΔEin │ Max ΔEin │
  ├─────────┼─────────────────┼────────┼──────────┼──────────┼─────────┼────────┼────────┼────────┼───────────┼──────────┼──────────┤
  │ 1       │ [ 94.79, 0, 0 ] │ 911519 │ 911519   │ 1        │ 0.752   │ 0.751  │ 0.752  │ 0      │ 0         │ 0        │ 0.009    │
  │ 2       │ [ 100, 0, 0 ]   │ 424376 │ 424376   │ 1        │ 0.594   │ 0.594  │ 0.594  │ 0      │ 0         │ 0        │ 0        │
  │ 3       │ [ 0, 0, 0 ]     │ 77628  │ 77628    │ 1        │ 1.625   │ 1.625  │ 1.625  │ 0      │ 0         │ 0        │ 0        │
  │ 4       │ [ 90.59, 0, 0 ] │ 17014  │ 17014    │ 1        │ 0.714   │ 0.712  │ 0.72   │ 0.003  │ 0.004     │ 0.002    │ 0.008    │
  │ 5       │ [ 92, 0, 0 ]    │ 14996  │ 14996    │ 1        │ 0.693   │ 0.693  │ 0.694  │ 0      │ 0.002     │ 0.001    │ 0.005    │
  │ 6       │ [ 91.64, 0, 0 ] │ 14751  │ 14751    │ 1        │ 0.699   │ 0.698  │ 0.699  │ 0.001  │ 0.003     │ 0.001    │ 0.007    │
  │ 7       │ [ 88.82, 0, 0 ] │ 14275  │ 14275    │ 1        │ 0.735   │ 0.734  │ 0.736  │ 0.001  │ 0.003     │ 0.001    │ 0.007    │
  │ 8       │ [ 76.97, 0, 0 ] │ 13769  │ 13769    │ 1        │ 0.739   │ 0.735  │ 0.74   │ 0.002  │ 0.003     │ 0.002    │ 0.008    │
  │ 9       │ [ 89.18, 0, 0 ] │ 13748  │ 13748    │ 1        │ 0.736   │ 0.735  │ 0.737  │ 0.001  │ 0.003     │ 0.001    │ 0.007    │
  │ 10      │ [ 92.7, 0, 0 ]  │ 13638  │ 13638    │ 1        │ 0.697   │ 0.697  │ 0.697  │ 0      │ 0.001     │ 0.001    │ 0.005    │
  ├─────────┴─────────────────┴────────┴──────────┴──────────┴─────────┴────────┴────────┴────────┴───────────┴──────────┴──────────┤
  │ • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • │
  ├─────────┬─────────────────┬────────┬──────────┬──────────┬─────────┬────────┬────────┬────────┬───────────┬──────────┬──────────┤
  │ 9992    │ [ 6.19, 0, 0 ]  │ 55     │ 55       │ 1        │ 0.83    │ 0.826  │ 0.831  │ 0.002  │ 0.004     │ 0.003    │ 0.006    │
  │ 9993    │ [ 7.11, 0, 0 ]  │ 54     │ 54       │ 1        │ 0.846   │ 0.846  │ 0.846  │ 0      │ 0.002     │ 0        │ 0.003    │
  │ 9994    │ [ 22.04, 0, 0 ] │ 54     │ 54       │ 1        │ 0.792   │ 0.79   │ 0.796  │ 0.002  │ 0.004     │ 0.002    │ 0.007    │
  │ 9995    │ [ 23.08, 0, 0 ] │ 54     │ 54       │ 1        │ 0.802   │ 0.802  │ 0.802  │ 0      │ 0.002     │ 0        │ 0.003    │
  │ 9996    │ [ 6.75, 0, 0 ]  │ 54     │ 54       │ 1        │ 0.847   │ 0.847  │ 0.847  │ 0      │ 0.002     │ 0        │ 0.003    │
  │ 9997    │ [ 22.55, 0, 0 ] │ 54     │ 54       │ 1        │ 0.789   │ 0.786  │ 0.791  │ 0.003  │ 0.005     │ 0.004    │ 0.005    │
  │ 9998    │ [ 22.87, 0, 0 ] │ 53     │ 53       │ 1        │ 0.797   │ 0.797  │ 0.797  │ 0      │ 0.001     │ 0.001    │ 0.002    │
  │ 9999    │ [ 22.94, 0, 0 ] │ 52     │ 52       │ 1        │ 0.798   │ 0.796  │ 0.802  │ 0.003  │ 0.004     │ 0.003    │ 0.006    │
  │ 10000   │ [ 22.29, 0, 0 ] │ 51     │ 51       │ 1        │ 0.791   │ 0.791  │ 0.791  │ 0      │ 0.002     │ 0        │ 0.003    │
  │ 10001   │ [ 23.2, 0, 0 ]  │ 49     │ 49       │ 1        │ 0.804   │ 0.802  │ 0.807  │ 0.003  │ 0.004     │ 0.003    │ 0.005    │
  └─────────┴─────────────────┴────────┴──────────┴──────────┴─────────┴────────┴────────┴────────┴───────────┴──────────┴──────────┘

Cross-Matched Sample Variability (Highest Coverage)
  ┌─────────┬─────────────────┬────────────────┬────────┬──────────┬──────────┬──────────┬─────────┬────────┬────────┬────────┬───────────┬──────────┬──────────┐
  │ (index) │ Reference Lab   │ Sample Lab     │ Pixels │ Overlaps │ Variants │ Coverage │ Mean ΔE │ Min ΔE │ Max ΔE │ StdDev │ Mean ΔEin │ Min ΔEin │ Max ΔEin │
  ├─────────┼─────────────────┼────────────────┼────────┼──────────┼──────────┼──────────┼─────────┼────────┼────────┼────────┼───────────┼──────────┼──────────┤
  │ 1       │ [ 94.79, 0, 0 ] │ [ 95, 0, -1 ]  │ 911519 │ 911519   │ 1        │ 1        │ 0.752   │ 0.751  │ 0.752  │ 0      │ 0         │ 0        │ 0.009    │
  │ 2       │ [ 100, 0, 0 ]   │ [ 100, 0, 0 ]  │ 424376 │ 424376   │ 1        │ 1        │ 0.594   │ 0.594  │ 0.594  │ 0      │ 0         │ 0        │ 0        │
  │ 3       │ [ 0, 0, 0 ]     │ [ 1, -1, -1 ]  │ 77628  │ 77628    │ 1        │ 1        │ 1.625   │ 1.625  │ 1.625  │ 0      │ 0         │ 0        │ 0        │
  │ 4       │ [ 90.59, 0, 0 ] │ [ 91, 0, -1 ]  │ 17014  │ 17014    │ 1        │ 1        │ 0.714   │ 0.712  │ 0.72   │ 0.003  │ 0.004     │ 0.002    │ 0.008    │
  │ 5       │ [ 92, 0, 0 ]    │ [ 92, 0, -1 ]  │ 14996  │ 14996    │ 1        │ 1        │ 0.693   │ 0.693  │ 0.694  │ 0      │ 0.002     │ 0.001    │ 0.005    │
  │ 6       │ [ 91.64, 0, 0 ] │ [ 92, 0, -1 ]  │ 14751  │ 14751    │ 1        │ 1        │ 0.699   │ 0.698  │ 0.699  │ 0.001  │ 0.003     │ 0.001    │ 0.007    │
  │ 7       │ [ 88.82, 0, 0 ] │ [ 89, 0, -1 ]  │ 14275  │ 14275    │ 1        │ 1        │ 0.735   │ 0.734  │ 0.736  │ 0.001  │ 0.003     │ 0.001    │ 0.007    │
  │ 8       │ [ 76.97, 0, 0 ] │ [ 77, -1, -1 ] │ 13769  │ 13769    │ 1        │ 1        │ 0.739   │ 0.735  │ 0.74   │ 0.002  │ 0.003     │ 0.002    │ 0.008    │
  │ 9       │ [ 89.18, 0, 0 ] │ [ 89, 0, -1 ]  │ 13748  │ 13748    │ 1        │ 1        │ 0.736   │ 0.735  │ 0.737  │ 0.001  │ 0.003     │ 0.001    │ 0.007    │
  │ 10      │ [ 92.7, 0, 0 ]  │ [ 93, 0, -1 ]  │ 13638  │ 13638    │ 1        │ 1        │ 0.697   │ 0.697  │ 0.697  │ 0      │ 0.001     │ 0.001    │ 0.005    │
  └─────────┴─────────────────┴────────────────┴────────┴──────────┴──────────┴──────────┴─────────┴────────┴────────┴────────┴───────────┴──────────┴──────────┘

Cross-Matched Sample Variability (Lowest Coverage)
  ┌─────────┬─────────────────┬────────────────┬────────┬──────────┬──────────┬──────────┬─────────┬────────┬────────┬────────┬───────────┬──────────┬──────────┐
  │ (index) │ Reference Lab   │ Sample Lab     │ Pixels │ Overlaps │ Variants │ Coverage │ Mean ΔE │ Min ΔE │ Max ΔE │ StdDev │ Mean ΔEin │ Min ΔEin │ Max ΔEin │
  ├─────────┼─────────────────┼────────────────┼────────┼──────────┼──────────┼──────────┼─────────┼────────┼────────┼────────┼───────────┼──────────┼──────────┤
  │ 9992    │ [ 69.2, 0, 0 ]  │ [ 69, -1, -1 ] │ 3479   │ 1769     │ 2        │ 0.5085   │ 0.722   │ 0.719  │ 0.725  │ 0.003  │ 0.005     │ 0.004    │ 0.006    │
  │ 9993    │ [ 18.19, 0, 0 ] │ [ 18, -1, 0 ]  │ 124    │ 63       │ 2        │ 0.5081   │ 0.761   │ 0.759  │ 0.764  │ 0.003  │ 0.005     │ 0.004    │ 0.007    │
  │ 9994    │ [ 3.23, 0, 0 ]  │ [ 3, -1, -1 ]  │ 361    │ 183      │ 2        │ 0.5069   │ 0.727   │ 0.724  │ 0.73   │ 0.003  │ 0.005     │ 0.004    │ 0.006    │
  │ 9995    │ [ 66.05, 0, 0 ] │ [ 66, 0, -1 ]  │ 2086   │ 1056     │ 2        │ 0.5062   │ 0.711   │ 0.708  │ 0.714  │ 0.003  │ 0.006     │ 0.004    │ 0.007    │
  │ 9996    │ [ 3.7, 0, 0 ]   │ [ 4, -1, -1 ]  │ 567    │ 287      │ 2        │ 0.5062   │ 0.75    │ 0.748  │ 0.753  │ 0.003  │ 0.005     │ 0.004    │ 0.006    │
  │ 9997    │ [ 66.09, 0, 0 ] │ [ 66, 0, 0 ]   │ 2104   │ 1061     │ 2        │ 0.5043   │ 0.711   │ 0.708  │ 0.714  │ 0.003  │ 0.006     │ 0.004    │ 0.008    │
  │ 9998    │ [ 69.52, 0, 0 ] │ [ 70, -1, -1 ] │ 2814   │ 1418     │ 2        │ 0.5039   │ 0.716   │ 0.713  │ 0.719  │ 0.003  │ 0.005     │ 0.004    │ 0.006    │
  │ 9999    │ [ 11.44, 0, 0 ] │ [ 11, -1, -1 ] │ 301    │ 151      │ 2        │ 0.5017   │ 0.834   │ 0.831  │ 0.837  │ 0.003  │ 0.005     │ 0.004    │ 0.006    │
  │ 10000   │ [ 69.81, 0, 0 ] │ [ 70, -1, -1 ] │ 2614   │ 1307     │ 2        │ 0.5      │ 0.716   │ 0.713  │ 0.718  │ 0.003  │ 0.005     │ 0.004    │ 0.007    │
  │ 10001   │ [ 99.58, 0, 0 ] │ [ 100, 0, -1 ] │ 244    │ 69       │ 4        │ 0.2828   │ 0.754   │ 0.751  │ 0.757  │ 0.003  │ 0.005     │ 0.004    │ 0.006    │
  └─────────┴─────────────────┴────────────────┴────────┴──────────┴──────────┴──────────┴─────────┴────────┴────────┴────────┴───────────┴──────────┴──────────┘
```

Observations:

- First of all, I don't like the fact that Sample Lab is rounded to 0 significant figures, even when I introduced the `const CROSS_MATCH_ROUNDING_DECIMALS = 2`.

  - I expected setting a Cross-Match rounding to 2 decimal places will result in more Variants, but from what I see, I suspect that Sample Lab is always rounded to the nearest whole number, which defeats the point of adjustable rounding.

- Even if we assume the sorting is the only difference, with `--top=0` I see the whole 10001 rows (which I trimmed above) in the top table and the top/bottom 10 rows in the lower ones, so how on earth can there be one cross-matched dataset of 10001 rows and yet somehow it has two distinct and seemingly unrelated values same columns across two different Cross-Matched table formats.

  - I get that the dataset may be the same, but I cannot glean this when I inspect the output visually as a human-being, I don't see correlations, I see Lab in one table and Reference and Sample Lab in another, at best I can see the top 10 in both tables are very similar.

  - This is made worse when right above the Cross-Matched tables, I get a tables of the top N Reference / Sample  Colors with very different columns, separated L, a, b, and Count and Match, the meaning of which is lost to me.

I need to work on improving those two aspects:

- Make sure that the `CROSS_MATCH_ROUNDING_DECIMALS` is always respected in the computations, without it actually rounding the values themselves.
- Make sure that the `LAB_COLUMN_ROUNDING_DECIMALS` is always respected only in the presentation of the Sample and Reference Lab columns in tables are rounded, without actually rounding the values themselves.
- Make sure that the `DELTA_E_COLUMN_ROUNDING_DECIMALS` is always respected only in the presentation of the various ∆E columns, without actually rounding the values themselves.
- Implement a footnote layer to tables (using supercased numbers suffixes in the table's column heading) and using console, logs for each applicable footnote — currently footnotes for columns being rounded, the same rounding (i.e. Lab, Delta-E… etc) condition for multiple columns as a single footnote rounding for respective columns
- Combine the Top N Reference and Sample Colors Tables, use the same column naming (Pixels not Count) and rounding convetions, with footnotes.
- Where relevant, include a footnote to explain Pixels, one to explain Match, one combined footnote explaining Overlaps, Variants and Coverage combined.

---

2026-02-08-001

The tiff-diff tool was designed to be self-contained, but at this point, it provides the most complete and accurate implementation of cross-matched variability statistic.

I decided to rethink `tiff-diff` entierly.

The core logic will be moved into the new `color-diff` library/CLI so that it can be used directly as a Node/Deno CLI tool with Lab tiff inputs, and used as a library anywhere, iincluding the browser.

---

2026-02-06-002

A bug was introduced before `c83b6e7` in content stream parsing or rewrite. The bug results in a discrepancy which affects a specific path consistently. I noticed it in the '©' symbol which is rendered part of the copyright text overlayed on top of 3 images.

It is consistent to the point that it shows up in the 3 variants of the same elements (`sRGB`, `sGray` and `Lab`), and it affects main thread, workers, refactored (`classes/`) and legacy (`services/`), color-engines (both `2026-01-30` and `2025-12-19`), even both 16-bit (`2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 (8-bit).pdf`) and 8-bit (`2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 (8-bit).pdf`) versions of the test form.

However, there is one combination where this anomaly does not occure, when using the refactored (`classes/`) with the older color-engine (`2025-12-19`).

Apart from that, I can't sure if this problem is affecting other aspects. It was too subtle, I missed it since January 9, 2026, when `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf` was first used. I do know that the copyright symbol is not the culprit, the same composite layering and copyright text is used in several other places in the other files.

I used the following command to generate all the different permutations for the different code paths:

```bash
node testing/iso/ptf/2025/experiments/scripts/generate-verification-matrix.mjs --using-diagnostics --config=testing/iso/ptf/2025/experiments/configurations/2026-02-02-REFACTOR-FIXTURES-BASELINE-ENGINES.json
```

The bug affects all the output PDFs in `testing/iso/ptf/2025/experiments/output/2026-02-06-003`, except for the following:

- `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - FIPS_WIDE_28T-TYPEavg - Relative Colorimetric - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-06-003).pdf`
- `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - FIPS_WIDE_28T-TYPEavg - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-06-003).pdf`
- `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - K-Only GCR - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-06-003).pdf`
- `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - K-Only GCR - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-06-003).pdf`
- `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - Relative Colorimetric - Refactored - 7 Workers - Color-Engine 2025-12-19 (2026-02-06-003).pdf`
- `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-06-003).pdf`

**Task**:

- Create nd use the new progress document `2026-02-06-COPYRIGHT-BUG-PROGRESS.md`

- Identify the root cause of this visible anomaly, using existing tools in `experiments/` and `experiments/scripts/` and if necessary, without breaking existing behaviour, extending the functionality if the most relevnt tool for the job as long as the introduced functionality is opt-in only behind a practical flag following flag conventions in `experiments/`.

  To aid in the iteration process, I created a minimal configuration with only the two color-engines, which I tested with the following command:

  ```bash
  node testing/iso/ptf/2025/experiments/scripts/generate-verification-matrix.mjs --using-diagnostics --config=testing/iso/ptf/2025/experiments/configurations/2026-02-02-REFACTOR-FIXTURES-MINIMAL-ENGINES.json
  ```

  The bug affects the `Color-Engine 2026-01-30` PDF output in `testing/iso/ptf/2025/experiments/output/2026-02-06-004`, but not the `Color-Engine 2025-12-19`.

- The root cause will likely be evident when comparing the content streams of the original input and unaffected outputs to the ones that are affected.

- Once the root cause is confirmed, provide me with your recommendations on different ways to address this, at which point we will coordinate the work so I can provide you with visual confirmation from the outputs.

---

2026-02-06-001

I am working with claude in CE to analyze sources of noise, for that to work, Initial attempts in CE to replicate the noisiness that is encountered in TFG leads to concerns that there may be other sources of noise in TFG, since only few input/output permutations resulted in noise so far. This is problematic, but it is too early to make conclusive deductions.

To be able to actually investigate the sources of noise, I need `2026-02-06-TFG-COLOR-TRANSFORMS.md` with all the different color transformations used in our classes-based implementation, with clear outlines of the class operations involved and the ultimate color-engine operations for each permutation of inputs and outputs, including permutations that are known to have issue, for instance 16-bit big endian to float.

This docment needs to be very thorough and accurate. No room for cutting corners. No room for mistaking endianness by making assumptions that contradict the fundamental truth that endianness is about the format of the input and/or output buffers.

Use at least 3 subagents, sequentially, not in parallel, and in highly involved and informed capacity, with access and instructions on all relevant documentation and code sources, to review, refine, and revise all aspects of the process and the document.
