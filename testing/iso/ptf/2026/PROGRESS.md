# ISO PTF 2026 — Beta Release — PROGRESS

**Created:** 2026-03-18  
**Last Updated:** 2026-03-31  
**Status:** Beta Development

---

## Table of Contents

1. [Context and Background](#1-context-and-background)
2. [Temporary Commit Cleanup Plan](#2-temporary-commit-cleanup-plan)
3. [Clean Commit Plan](#3-clean-commit-plan)
4. [Roadmap](#4-roadmap)
5. [Current Status](#5-current-status)
6. [Resolved Questions](#6-resolved-questions)
7. ~~Open Questions~~
8. [Activity Log](#8-activity-log)

---

## 1. Context and Background

### State of Master

Master currently has 20 temporary commits (`f0ef7c2`..`5df1228`) stacked on top of the last clean commit `9c17c5d` (2025-04-22, `feat(generator): partial PDF/X-4 conformance`). These temporary commits span 2025-12-04 to 2026-03-18 and represent a major development arc:

| Phase                               | Commits | Dates                   | Summary                                                                       |
| ----------------------------------- | ------- | ----------------------- | ----------------------------------------------------------------------------- |
| Color Engine Integration            | 1–3     | 2025-12-04 — 2026-01-08 | Initial Color Engine integration, services, tests, CLAUDE.md, documentation   |
| Converter Classes Development       | 4–10    | 2026-01-21 — 2026-01-31 | `classes/` ecosystem: converter hierarchy, diagnostics, policies, worker pool |
| Comparison and Verification Tooling | 11–15   | 2026-02-02 — 2026-02-06 | Verification matrix, tiff-diff, pdf-diff, comparison infrastructure           |
| Generator and Staging               | 16–20   | 2026-02-12 — 2026-03-18 | Generator prototype, baseline classes, staging sync, workflows                |

### Uncommitted Working Tree Changes

**Tracked modifications (30 files):**

| Category                                 | Files    | Nature                                                                                           |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| Deleted `classes/` files                 | 21 files | All non-baseline class files deleted from `classes/` root — moved to `classes/root/` (untracked) |
| `pdf-lib` vendored update                | 1 file   | `packages/pdf-lib/pdf-lib.esm.js` — whitespace/reformatting (39404→39403 lines)                  |
| Generator fix                            | 1 file   | `test-form-pdf-document-generator.js` — removed redundant progress callback                      |
| `helpers.js` fix                         | 1 file   | Fixed `pako` import path to `./packages/pako/dist/pako.mjs`                                      |
| `Color-Engine-Integration-User-Notes.md` | 1 file   | Added session references and workflow notes                                                      |
| `CE-CLAUDE.md`                           | 1 file   | Deleted (was Color Engine workspace instructions)                                                |
| `.claude/settings.local.json`            | 1 file   | Permission updates                                                                               |
| tiff-diff fixture                        | 1 file   | JSON format change (object → array)                                                              |
| `test-color-engine-noise.js`             | 1 file   | Deleted experiment script                                                                        |

**Untracked files (~92):**

| Category                  | Count | Notes                                                   |
| ------------------------- | ----- | ------------------------------------------------------- |
| Experiment/debug scripts  | ~50   | `experiments/scripts/debug-*.mjs`, `test-*.mjs`, etc.   |
| Root-level session docs   | ~8    | `CLAUDE-CODE-*.md`, `*-STATE-*.md` — scratch documents  |
| `classes/root/`           | ~19   | Copies of class files (superset of `classes/baseline/`) |
| `classes/configurations/` | 1     | `color-conversion-rules.1.json`                         |
| `pdf-lib-upstream/`       | 2     | Upstream pdf-lib for comparison                         |
| Test fixtures             | ~5    | Additional PDF fixtures                                 |
| Other                     | ~7    | `experiments/backup/`, `jsconfig.json.x`, etc.          |

### `classes/` Import Analysis

**Who imports what:**

| Consumer                                                | Imports From                          | Notes                                                        |
| ------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `generator/classes/asset-page-pre-converter.js`         | `classes/baseline/`                   | Dynamic imports of `PDFDocumentColorConverter`, `WorkerPool` |
| `generator/classes/test-form-pdf-document-generator.js` | No `classes/` imports                 | Uses services and generator-local classes only               |
| `services/PDFService.js`                                | `classes/diagnostics/`                | `NO_OP_DIAGNOSTICS` from `diagnostics-collector.js`          |
| `experiments/convert-pdf-color.js`                      | `classes/diagnostics/`                | `DiagnosticsCollector`, `MainDiagnosticsCollector`           |
| `experiments/compare-pdf-outputs.js`                    | `classes/pdf-image-color-sampler.js`  | Root-level class import (BROKEN — file deleted)              |
| `experiments/classes/image-lab-converter.mjs`           | `classes/color-engine-provider.js`    | Root-level class import (BROKEN — file deleted)              |
| ~15 untracked debug/test scripts                        | Various `classes/` root files         | All reference deleted root-level classes                     |
| Staging `conres.io-staging`                             | `classes/` root + `classes/baseline/` | Root files differ from baseline — staging has its own copies |

**Key finding:** The `classes/` root-level files were deleted from the working tree but are still needed by:

1. **`experiments/compare-pdf-outputs.js`** (committed) — imports `PDFImageColorSampler` from `classes/`
2. **`experiments/classes/image-lab-converter.mjs`** (committed) — imports `ColorEngineProvider` from `classes/`
3. **`services/PDFService.js`** — imports from `classes/diagnostics/` (these files exist in `classes/diagnostics/`, NOT the deleted root files)
4. **Staging** — has its own copies of root-level class files that differ from both `root/` and `baseline/`

**Conclusion on `classes/root/`:** The root-level class files need to exist at `classes/` for the committed experiment scripts. Two options:

- **Option A:** Restore `classes/root/` files to `classes/` root (undo the deletion)
- **Option B:** Update the experiment scripts to import from `classes/baseline/` instead, and keep root deleted

### `pdf-lib` Patch Analysis

Comparing the three versions (ignoring whitespace):

| Comparison               | Result                      |
| ------------------------ | --------------------------- |
| HEAD vs upstream         | Identical (whitespace only) |
| Working tree vs upstream | 2 functional differences    |

**Functional patches in working tree (not in HEAD):**

1. `console.trace('[pdf-lib] arrayAsString called...')` — debug trace in upstream (should NOT be kept)
2. `buffer.set(contents, offset)` replaced with element-by-element loop — performance/compatibility fix (should be kept)

**Action:** The working tree `pdf-lib.esm.js` is a reformatted version of upstream with a functional patch (buffer copy fix). For the clean commits, we need to apply ONLY the buffer copy patch to the HEAD version (which preserves original formatting). The `console.trace` is in upstream, not our patch.

### Key Architecture

The `classes/` directory has three tiers:

| Tier            | Path                   | Purpose                                                                                                     |
| --------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Baseline**    | `classes/baseline/`    | Production-ready converter classes (committed in temporary commit 17)                                       |
| **Root**        | `classes/root/`        | Development copies — superset of baseline + `create-document-color-converter.js`, `PDFImageColorSampler.md` |
| **Legacy**      | `classes/legacy/`      | Previous implementation preserved for comparison                                                            |
| **Diagnostics** | `classes/diagnostics/` | Shared diagnostics classes used by services and experiments                                                 |

The **generator prototype** (`generator/`) is the primary consumer, using `classes/baseline/` for in-browser color conversion.

### Staging Deployment

Deployment uses `../conres.io-staging` with two tools:

- `sync-generator-to-staging.mjs` — Parent-commit-protected file sync
- `trace-dependencies.mjs` — Runtime dependency graph tracer

The parent commit for staging protection is `9c17c5d`.

---

## 2. Temporary Commit Cleanup Plan

### Goal

Replace the 20 temporary commits on `master` with a clean, coherent commit history while preserving the temporary commits on a reference branch.

### Constraint: Git History Preservation for `git mv`

The user intends to `git mv` files from `2025/` to `2026/` to retain file history. This means the clean commits must be on `master` (not a separate branch that gets merged), and the files must exist in committed state on `master` before the `git mv` operation.

### Branch Strategy

| Branch                            | Purpose                                                 | Base                              |
| --------------------------------- | ------------------------------------------------------- | --------------------------------- |
| `test-for-generator/2025/dev`     | Preserve temporary commits + final snapshot             | Current `master` HEAD (`5df1228`) |
| `test-for-generator/2025/clean`   | Build clean commit history in a worktree                | `9c17c5d` (last clean commit)     |
| `test-for-generator/2025/dev-NNN` | Intermediate worktrees for layering code across commits | As needed                         |

### Step-by-Step Procedure

**Phase A — Preserve Current State**

- [ ] `A1` Create branch `test-for-generator/2025/dev` at current `HEAD` (includes all 20 temporary commits)
- [ ] `A2` Stage and commit final temporary commit (21) on `test-for-generator/2025/dev` with all uncommitted changes that should be preserved
- [ ] `A3` Verify the branch contains all 21 temporary commits

**Phase B — Build Clean History in Worktree**

- [ ] `B1` Create branch `test-for-generator/2025/clean` from `9c17c5d`
- [ ] `B2` Add worktree for `test-for-generator/2025/clean`
- [ ] `B3` Build clean commits in the worktree per the [Clean Commit Plan](#3-clean-commit-plan)
- [ ] `B4` Use additional `test-for-generator/2025/dev-NNN` worktrees as needed to cherry-pick/layer code at correct historical points
- [ ] `B5` Revise progress/tracking documents to ensure historical accuracy with their respective commits

**Phase C — Swap Master**

- [ ] `C1` Point `master` at `test-for-generator/2025/clean` HEAD
- [ ] `C2` Verify final tree matches expected state

**Phase D — Verify**

- [ ] `D1` `git diff test-for-generator/2025/dev master` — confirm only intentionally excluded files differ
- [ ] `D2` Run `yarn test` to confirm tests pass
- [ ] `D3` Verify generator works: load `index.html`, confirm no import errors

**Phase E — Cleanup (after user review)**

- [ ] `E1` Delete `test-for-generator/2025/clean` branch (history is now on master)
- [ ] `E2` Delete any `test-for-generator/2025/dev-NNN` worktree branches
- [ ] `E3` Keep `test-for-generator/2025/dev` as permanent reference

### 2.1 Final Temporary Commit (21) Staging Plan

**Stage (tracked changes):**

| File                                                    | Reason                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| `helpers.js`                                            | Bug fix — pako import path                                   |
| `generator/classes/test-form-pdf-document-generator.js` | Cleanup — removed redundant progress callback                |
| `experiments/fixtures/tiff-diff/...Lab.tif.json`        | Fixture format update                                        |
| `Color-Engine-Integration-User-Notes.md`                | Session references and workflow notes (user wants committed) |

**Stage (deletions):**

| File                                     | Reason                                                        |
| ---------------------------------------- | ------------------------------------------------------------- |
| `CE-CLAUDE.md`                           | Color Engine workspace instructions — belongs in CE workspace |
| `experiments/test-color-engine-noise.js` | Experiment completed                                          |

**Do NOT stage in temporary commit 21:**

| File                              | Reason                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `.claude/settings.local.json`     | Local settings — revert to HEAD                                                 |
| `packages/pdf-lib/pdf-lib.esm.js` | Whitespace reformatting — will apply only the functional patch in clean commits |
| 21 deleted `classes/` root files  | Decision pending — see [Q1](#q1-classes-root-level-files)                       |

---

## 3. Clean Commit Plan

### Proposed Commit Structure

The 20+ temporary commits collapse into logical, coherent commits. Progress/tracking documents are moved to `progress/` with standardized names and revised for historical accuracy.

**Draft commit sequence (from `9c17c5d`):**

| #   | Scope                | Summary                                                | Key Content                                                                                                                                                                                                             |
| --- | -------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `chore`              | Project configuration and CLAUDE.md                    | CLAUDE.md, `.claude/settings.local.json`, .gitattributes, .gitignore, package.json                                                                                                                                      |
| 2   | `feat(color-engine)` | Vendored Color Engine packages                         | `packages/color-engine-2025-12-15/`, `…-2025-12-19/`, `…-2026-01-07/`, `…-2026-01-21/`, `…-2026-01-30/`, `…-2026-02-14/`                                                                                                |
| 3   | `feat(services)`     | Service layer updates for Color Engine integration     | `services/ColorEngineService.js`, `ColorConversionUtils.js`, `ColorSpaceUtils.js`, `StreamTransformWorker.js`, `WorkerColorConversion.js`, `WorkerPool.js`, `PDFService.js`, `helpers/pdf-lib.js`, `helpers/runtime.js` |
| 4   | `feat(classes)`      | Converter class hierarchy — baseline and diagnostics   | `classes/baseline/`, `classes/diagnostics/`, `classes/configurations/`, `classes/documentation/`, `classes/legacy/`, `classes/create-document-color-converter.js`                                                       |
| 5   | `feat(experiments)`  | Experiment and verification tooling                    | `experiments/*.js`, `experiments/classes/`, `experiments/scripts/generate-verification-matrix.mjs`, `experiments/scripts/matrix-benchmark.js`, etc.                                                                     |
| 6   | `feat(assets)`       | Test form assets and profiles                          | `assets/testforms/`, `testing/iso/ptf/assets/`, PDF fixtures, ICC profile symlinks                                                                                                                                      |
| 7   | `feat(generator)`    | Generator prototype — in-browser color conversion      | `generator/` (all files)                                                                                                                                                                                                |
| 8   | `feat(tests)`        | Test suite — classes, generator, legacy updates        | `tests/classes/`, `tests/generator/`, `tests/legacy/`, `tests/run-tests.js`                                                                                                                                             |
| 9   | `chore(docs)`        | Documentation, integration notes, and progress history | `progress/` (standardized from various locations), root-level `*.md`                                                                                                                                                    |
| 10  | `chore(staging)`     | Staging deployment tooling                             | `STAGING.md`, `experiments/tools/sync-generator-to-staging.mjs`, `experiments/tools/trace-dependencies.mjs`                                                                                                             |
| 11  | `fix(pdf-lib)`       | Patch vendored pdf-lib — buffer copy compatibility fix | `packages/pdf-lib/pdf-lib.esm.js` (single functional patch, no reformatting)                                                                                                                                            |

### Progress Document Consolidation

All progress/tracking documents will be moved to `progress/` at the repository root with standardized filenames. Documents will be revised to ensure historical accuracy.

**Document categories:**

| Category                     | Documents                                                                                                                                                                                                               | Action                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Color Engine Integration** | `Color-Engine-Integration-Notes.md`, `…-Progress.md`, `…-User-Notes.md`, `ConRes-Color-Engine-For-PDF-Processing.md`, `Convert-PDF-Colors-Progress.md`                                                                  | Consolidate into `progress/2025-12-color-engine-integration.md` and `progress/2025-12-color-engine-api-reference.md` |
| **Cross-Workspace Reports**  | `CE-CROSS-WORKSPACE-REPORT.md`, `TFG-CROSS-WORKSPACE-REPORT.md`, `CONSOLIDATED-CROSS-WORKSPACE-REPORT.md`, `CE-Black-Point-Clamping-Optimization-Report.md`, `CE-PERFORMANCE-ANALYSIS.md`, `CE-Color-Engine-Changes.md` | Consolidate into `progress/2025-12-cross-workspace-reports.md`                                                       |
| **Classes Development**      | 8 files in `experiments/2026-01-26-CLASSES-*`                                                                                                                                                                           | Consolidate into `progress/2026-01-26-classes-development.md`                                                        |
| **Declauding/Refactoring**   | 5 files in `experiments/2026-01-28-DECLAUDING-*`                                                                                                                                                                        | Consolidate into `progress/2026-01-28-declauding-refactor.md`                                                        |
| **Diagnostics**              | `2026-01-27-DIAGNOSTICS-*`, `2026-01-31-DIAGNOSTICS-*`                                                                                                                                                                  | Consolidate into `progress/2026-01-27-diagnostics.md`                                                                |
| **Regression**               | `2026-01-27-REGRESSION-*`                                                                                                                                                                                               | Consolidate into `progress/2026-01-27-regression-investigation.md`                                                   |
| **Comparisons and Sampling** | `2026-02-02-COMPARISONS-*`, `2026-02-03-*`, `2026-02-05-*`                                                                                                                                                              | Consolidate into `progress/2026-02-02-comparisons-and-sampling.md`                                                   |
| **Bug Reports**              | `2026-02-02-REFACTOR-ENDIANNESS-*`, `2026-02-06-COPYRIGHT-BUG-*`, `2026-02-06-LAB-COERCE-*`, `2026-02-12-PDF-IMAGE-MASKS-*`                                                                                             | Consolidate into `progress/2026-02-bug-reports.md`                                                                   |
| **Color Engine Update**      | `2026-02-12-COLOR-ENGINE-*`, `2026-02-14-COLOR-ENGINE-*`, `2026-02-08-TFG-ADAPTIVE-*`                                                                                                                                   | Consolidate into `progress/2026-02-12-color-engine-update.md`                                                        |
| **Baseline Classes**         | `2026-02-13-BASELINE-*`, `2026-02-15-BASELINE-*`, `2026-02-16-CONCURRENCY-*`                                                                                                                                            | Consolidate into `progress/2026-02-13-baseline-classes.md`                                                           |
| **Generator**                | `generator/PROGRESS.md`, `2026-02-15-MEMORY-MANAGEMENT-*`, `2026-02-17-WORKFLOWS-*`                                                                                                                                     | Consolidate into `progress/2026-02-15-generator.md`                                                                  |
| **Tool Documentation**       | `tiff-diff.js.md`, `tiff-diff-r1.js.md`, `COMPARISON-PROCEDURE.md`                                                                                                                                                      | Consolidate into `progress/2026-02-tool-documentation.md`                                                            |
| **Handoff**                  | `2026-01-07-HANDOFF.md`                                                                                                                                                                                                 | Move to `progress/2026-01-07-handoff.md`                                                                             |
| **Session Artifacts**        | `CLAUDE-CODE-*.md`, `CLAUDE-2026-01-14-001.md`, `2026-02-17-*.md/.txt`                                                                                                                                                  | Do NOT commit — session scratch documents                                                                            |

### Notes

- Documents will be revised so their content accurately reflects the state of code at the commit they are included in
- The exact consolidation boundaries may be adjusted during implementation
- The `pdf-lib` patch (commit 11) is isolated because it is a targeted functional fix with no dependencies on other changes

---

## 4. Roadmap

### Phase 0 — Cleanup Master ✅

- [x] Resolved remaining open questions
- [x] Created branch structure and preserved temporary commits
- [x] Built clean commit history
- [x] Swapped master to clean history
- [x] Applied pdf-lib buffer copy patch (`e7bffaf`)
- [x] Updated test imports from `classes/` to `classes/baseline/` (`69913fe`)

### Phase 1 — Create `2026/` Directory Structure ✅

- [x] `git mv` files from `2025/` to `2026/` with history preservation (`cf2158c`)
- [x] Restored `2025/` alongside `2026/` copies (`2923211`)
- [x] Established `2026/` directory layout with `classes/baseline/` as canonical
- [x] Removed `classes/root/` copies, replaced 8-bit asset folders with symlinks (`9a1699f`)

### Phase 2 — Beta Release Development `IN-PROGRESS`

**Generator (2026-03-20 → 2026-03-31):**

- [x] Customized PDF assembly based on output profile (`658eb74`)
- [x] Firefox 115 `safeDynamicImport` compatibility (`e5a5c69`)
- [x] F9f and F10a test form assets (`fd6165d`, `c9bccbe`)
- [x] Docket PDF generation replacing metadata.json (`2bf223c`)
- [x] R2 UI layout with debugging and validation support (`325160a`)
- [x] Generate/cancel button, UI lock, and wake lock (`379dabc`)
- [x] Docket slug format, layout, and cache freshness (`7a0c405`)
- [x] PDF/X-4 conformance fixes to post-processing (`e780c01`, `e2f1e72`, `56c5b41`)
- [x] ICC profile filename via `/AF` and unified docket post-processing (`5c142ff`)
- [x] Font embedding and validation improvements (`5ce6382`)
- [ ] Gray profile category support (WIP — uncommitted)

**Color Engine Integration (2026-03-27):**

- [x] Added `color-engine-2026-03-27` package (`c09cdd0`)
- [x] Enabled Lab K-Only GCR policy rules for new engine (`39a7a53`)
- [x] Replaced hardcoded Lab K-Only GCR workarounds with policy evaluation (`eb6c072`)
- [ ] Lab 16-bit K-Only GCR neutral fix — CE-side pipeline concatenation (CE fix applied, TFG no changes needed)
  - See: `packages/color-engine-2026-03-27/documentation/Lab-K-Only-Neutrals.md`

**Helpers Refactor (2026-03-29):**

- [x] Split `import-helpers.js` into `helpers/imports.js`, `helpers/streams.js`, `helpers/buffers.js` (`a0d22f7`)
- [x] Rewrote TC39 base64/hex polyfill cleanly with proper attribution
- [x] Added `readableStreamAsyncIterable` for Safari compatibility
- [x] Added `collectUint8ArrayChunks` for Compression Streams provider

**Compression Streams API Adoption (2026-03-29):**

- [x] Transitioned compression from pako to native Compression Streams API (`d07d1ae`)
- [x] Verified in Node.js 24.7.0, Chromium 145, Firefox 115, Safari 26.3
- See: `2026-03-29-COMPRESSION-STREAMS-API-ADOPTION-PROGRESS.md`

**Staging and Tools (2026-03-29):**

- [x] Moved staging tools from `experiments/scripts/` to `experiments/tools/` (`3c43ad5`)
- [x] Created `STAGING.md` documenting sync groups and usage
- [x] Added `validator` sync group to staging script (`a6d4bd6`)

**Validator (2026-03-30):**

- [x] Added `preflight-rules.json` for PDF/X-4 validation (`3f17cb1`)
- [x] Added `PDFPreflightValidator` baseline check engine (`bd5c2dd`)
- [x] Added `PDFPreflightFixer` and `PDFPreflightFixerValidator` (`424f900`)
- [x] Added validator UI with drop zone, report, and fix flow (`39756c2`)
- [x] Added `xml-markup-parser` with generator-based streaming architecture (`0387756`)
- [x] Added validator investigation scripts and test suite (`219e7a5`)
- See: `2026-03-28-VALIDATE-PDF-PROGRESS.md`

**Safari OOM Investigation (2026-03-29 → ongoing):**

- [x] Bounded-concurrency image lanes to prevent OOM (`cf09bee`)
- [x] Replaced try/catch with unhandled error listeners in worker (`67bc0c5`)
- [x] Captured Safari OOM logs: crashes at `worker-pool-entrypoint.js:284` and `buffers.js:25` during concurrent image conversion
- [x] Analyzed Safari Web Inspector timeline: peak 9.5 GB, 96% of snapshots >3 GB, page memory (ArrayBuffer allocations) dominates at ~8 GB
- [ ] Confirm which browsers/versions/platforms/architectures are affected
- [ ] Determine if further concurrency reduction or streaming changes are needed
- See: `2026-03-29-SAFARI-OOM-FIX-PROGRESS.md`

---

## 5. Current Status

**Focus:** Beta release development on `test-form-generator/2026/dev` branch.

**Active work streams:**

| Stream                             | Status                                                                                         | Tracking Document                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Generator — Gray profile support   | WIP (uncommitted)                                                                              | —                                                                       |
| Validator — PDF/X-4 preflight      | Committed, iterating                                                                           | `2026-03-28-VALIDATE-PDF-PROGRESS.md`                                   |
| Compression Streams API adoption   | Steps 1-3 complete, transition committed                                                       | `2026-03-29-COMPRESSION-STREAMS-API-ADOPTION-PROGRESS.md`               |
| Safari OOM investigation           | Ongoing — bounded concurrency committed, root cause under investigation                        | `2026-03-29-SAFARI-OOM-FIX-PROGRESS.md`                                 |
| Color Engine 2026-03-27 Lab K-Only | CE fix applied, TFG policy changes committed, awaiting updated CE build for image verification | `packages/color-engine-2026-03-27/documentation/Lab-K-Only-Neutrals.md` |
| Legacy Acrobat compatibility       | Waiting on Franz's test results                                                                | `2026-03-29-RESOLVE-LEGACY-COMPATIBILITY-PROGRESS.md`                   |

**Branch:** `test-form-generator/2026/dev` — 60+ commits ahead of master since `cf2158c` (2026-03-19)

**Browsers verified (2026-03-29):** Chromium 145, Firefox 115, Safari 26.3 (macOS) — all produce correct output. Safari OOM intermittent on 1.5 GB asset PDFs.

---

## 6. Resolved Questions

### R1: `pdf-lib` Vendored Update

**Resolution:** The working tree file is a reformatted upstream with one functional patch (`buffer.set` → element-by-element loop). The clean commit will apply only the functional patch to the unformatted file. The `console.trace` line is an upstream debug artifact, not our patch.

### R2: `Color-Engine-Integration-User-Notes.md`

**Resolution:** Commit as-is with the session notes.

### R3: Root-Level Scratch Documents

**Resolution:** `CLAUDE-CODE-*.md`, `CLAUDE-2026-01-14-001.md`, `2026-02-17-*.md/.txt` are session artifacts. Do NOT commit.

### R4: `.claude/settings.local.json`

**Resolution:** Include in clean commit 1 (project configuration). The file is already tracked.

### R5: Progress/Tracking Documents

**Resolution:** Move all relevant documents to `progress/` root folder with standardized `YYYY-MM-DD-substance.md` filenames. Revise for historical accuracy. Session artifacts excluded.

---

## 7. Resolved — `classes/` Root Files (Option B Confirmed)

### Resolution: Delete Root, Use Baseline

### Q1: `classes/` — Which Set Is Canonical?

Per `Color-Engine-Integration-User-Notes.md` (lines 233–236), the user documented this hierarchy on 2026-02-16:

| Tier         | Path                          | Status                                  | Consumers                                                                      |
| ------------ | ----------------------------- | --------------------------------------- | ------------------------------------------------------------------------------ |
| **Baseline** | `classes/baseline/`           | Core implementation                     | `generator/`, `experiments/*-baseline.js`, `experiments/scripts/*-baseline.js` |
| **Root**     | `classes/` (root-level files) | **On hold** — many gaps and regressions | `experiments/` and `experiments/scripts/` (non-baseline)                       |
| **Legacy**   | `classes/legacy/`             | **On hold** — many gaps and regressions | `experiments/legacy/`, `experiments/scripts/legacy/`                           |

**Analysis:**

The root-level `classes/` files (now deleted from working tree, preserved in `classes/root/`) are an **older, on-hold iteration** with known gaps. `classes/baseline/` is the canonical, actively maintained set. The root files differ from baseline in:

- **Import paths**: Root uses `../packages/…` (depth 1), baseline uses `../../packages/…` (depth 2) — because root lived at `classes/` while baseline is at `classes/baseline/`
- **API differences**: Root has older constant names (`cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING` vs baseline's `cmsFLAGS_MULTIPROFILE_BPC_SCALING`), missing features (`profileBufferCache`, `CONTEXT_PREFIX` logging, `useAdaptiveBPCClamping` config)
- **Extra files in root**: `create-document-color-converter.js` (factory helper), `PDFImageColorSampler.md` (documentation)

**Committed experiments that import from `classes/` root:**

- `experiments/compare-pdf-outputs.js` → `classes/pdf-image-color-sampler.js`
- `experiments/classes/image-lab-converter.mjs` → `classes/color-engine-provider.js`

**Committed services that import from `classes/`:**

- `services/PDFService.js` → `classes/diagnostics/diagnostics-collector.js` (these are in `classes/diagnostics/`, NOT the deleted root files — this import is fine)

**Decision needed:** Since `classes/baseline/` is the canonical set and `classes/` root is on hold with gaps:

| Option | Description                                                                                                | Trade-off                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **A**  | Keep `classes/` root files for backward compatibility with non-baseline experiments                        | Two sets of classes in the committed tree — confusing, maintenance burden               |
| **B**  | Delete `classes/` root files, update the 2 committed experiment scripts to import from `classes/baseline/` | Cleaner tree, but need to verify the 2 experiments work with baseline's API differences |
| **C**  | Keep `classes/` root files as thin re-exports from `classes/baseline/`                                     | Bridge approach — experiments work, single source of truth                              |

**Decision:** Option B confirmed by user — delete root, use baseline as the single authoritative set.

**CRITICAL FINDING — Scope is much larger than initially identified:**

ALL 15 class test files (`tests/classes/*.test.js`) have runtime `await import('../../classes/...')` pointing to root-level class files. Zero test files reference `classes/baseline/`. The tests were written to test the root-level classes, and since the root files are deleted from the working tree, **these tests are already broken**.

**Full inventory of files requiring import path updates:**

| File                                                       | Import Target                                                              | Context                                                                                        | Count |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----- |
| `tests/classes/buffer-registry.test.js`                    | `../../classes/buffer-registry.js`                                         | Node.js `await import()`                                                                       | 1     |
| `tests/classes/color-conversion-policy.test.js`            | `../../classes/color-conversion-policy.js`                                 | Node.js static `import`                                                                        | 1     |
| `tests/classes/color-converter-classes.test.js`            | `../../classes/*.js` (9 classes)                                           | Playwright `page.evaluate` + `await import()`                                                  | 9     |
| `tests/classes/color-converter.test.js`                    | `../../classes/color-converter.js`, `color-engine-provider.js`             | Node.js `await import()`                                                                       | 2     |
| `tests/classes/image-color-converter.test.js`              | `../../classes/color-converter.js`, `image-color-converter.js`             | Node.js `await import()`                                                                       | 2     |
| `tests/classes/lookup-table-color-converter.test.js`       | `../../classes/color-converter.js`, `lookup-table-color-converter.js`      | Node.js `await import()`                                                                       | 2     |
| `tests/classes/pdf-content-stream-color-converter.test.js` | `../../classes/lookup-table-*.js`, `pdf-content-stream-*.js`               | Node.js `await import()`                                                                       | 2     |
| `tests/classes/pdf-document-color-converter.test.js`       | `../../classes/color-converter.js`, `profile-pool.js`, `pdf-document-*.js` | Node.js `await import()`                                                                       | 3     |
| `tests/classes/pdf-image-color-converter.test.js`          | `../../classes/image-*.js`, `pdf-image-*.js`                               | Node.js `await import()`                                                                       | 2     |
| `tests/classes/pdf-page-color-converter.test.js`           | `../../classes/color-converter.js`, `pdf-page-*.js`                        | Node.js `await import()`                                                                       | 2     |
| `tests/classes/profile-pool.test.js`                       | `../../classes/profile-pool.js`                                            | Node.js `await import()`                                                                       | 1     |
| `tests/classes/color-engine-provider.test.js`              | `../classes/color-engine-provider.js`                                      | Playwright `page.evaluate`                                                                     | ~1    |
| `experiments/compare-pdf-outputs.js`                       | `../classes/pdf-image-color-sampler.js`                                    | Node.js static `import`                                                                        | 1     |
| `experiments/classes/image-lab-converter.mjs`              | `../../../classes/color-engine-provider.js`                                | Node.js static `import` (NOTE: path is wrong — resolves to `ptf/classes/` not `2025/classes/`) | 1     |

Additionally, the Playwright tests in `color-converter-classes.test.js` use `page.evaluate` imports like `../classes/pdf-document-color-converter.js` — these resolve relative to the browser base URL (the test page's `index.html`), not the Node.js file system.

**Browser-context import paths (Playwright `page.evaluate`):**

- `../classes/pdf-document-color-converter.js` — relative to `tests/index.html`, resolves to `2025/classes/pdf-document-color-converter.js`
- These would need to become `../classes/baseline/pdf-document-color-converter.js`

**API compatibility (diff analysis):**

Baseline is a **superset** of root. All methods and configs used by tests exist in baseline. The differences are:

| Aspect                                     | Root                      | Baseline                                                            |
| ------------------------------------------ | ------------------------- | ------------------------------------------------------------------- |
| Import paths                               | `../packages/…` (depth 1) | `../../packages/…` (depth 2) — correct for `classes/baseline/`      |
| `useAdaptiveBPCClamping`                   | absent                    | present (additive)                                                  |
| `loadProfile()` method                     | absent                    | present (additive)                                                  |
| `#profileBufferCache`                      | absent                    | present (additive)                                                  |
| `createMultiprofileTransform`              | `intents` (array)         | `intent` (single) — tests may need update                           |
| `cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING` | present                   | renamed `cmsFLAGS_MULTIPROFILE_BPC_SCALING` — tests may need update |
| Static version methods                     | present                   | absent — tests using these will break                               |
| `CONTEXT_PREFIX` logging                   | absent                    | present (cosmetic)                                                  |

**Pre-existing bug found:** `experiments/classes/image-lab-converter.mjs` uses `../../../classes/color-engine-provider.js` which resolves to `testing/iso/ptf/classes/` (not `2025/classes/`). This import has always been broken — 3 levels up from `experiments/classes/` goes to `ptf/`, not `2025/`. Correct path should be `../../classes/baseline/color-engine-provider.js`.

### Test Architecture Analysis

**Test types:**

| Type                     | Files                                                                                                   | Import Context                                                          | Import Path Pattern                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| **Playwright (browser)** | `color-converter-classes.test.js`, `color-engine-provider.test.js`, `composite-color-converter.test.js` | `page.evaluate` — browser context, paths relative to `tests/index.html` | `../classes/…` → `2025/classes/` (root)    |
| **Node-only**            | All other 12 test files                                                                                 | Node.js ESM — paths relative to `tests/classes/`                        | `../../classes/…` → `2025/classes/` (root) |

**ALL tests import from `classes/` root — none reference `classes/baseline/`.**

**The test files are committed and were designed to test the root-level classes.** These tests exercise the "on-hold" root implementation. To switch to baseline, every import path needs updating AND the tests need verification against baseline's slightly different API.

### Color Engine Version Handling Pattern

From `Color-Engine-Integration-User-Notes.md` (line 597) and `2026-02-12-COLOR-ENGINE-2026-02-14-INTEGRATION-PROGRESS.md`:

**Required pattern for tests:**

- Tests affected by engine API changes but still relevant need BOTH `color-engine-2026-01-30` and `color-engine-2026-02-14` variants
- Tests no longer needed for `2026-02-14` should use `color-engine-2026-01-30` explicitly
- Test names must be suffixed with `(color-engine-YYYY-MM-DD)` or `(color-engine-YYYY-MM-DD and older)` for clarity

**Engine version mechanism in classes:**

- `ColorEngineProvider` accepts `options.enginePath` to select specific engine version
- `ColorConversionPolicy` accepts `options.engineVersion` for policy rule matching
- Default engine resolved via symlink: `packages/color-engine → color-engine-2026-02-14`
- Current engine (2026-02-14) provides deprecated re-exports of renamed constants for backward compatibility

**Constant name evolution:**

| Old Name (used in baseline)         | New Name (used in root)                    | Engine 2026-02-14                          | Status                                               |
| ----------------------------------- | ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------- |
| `cmsFLAGS_MULTIPROFILE_BPC_SCALING` | `cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING` | Exports both (old is deprecated re-export) | Baseline uses old name — works via deprecated export |
| (not present)                       | `cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING` | Present                                    | Root has it, baseline does not                       |

**Key insight:** Baseline was updated for `color-engine-2026-01-30` compatibility and received specific bug fixes (`2026-02-13-BASELINE-CLASSES-FIXES-PROGRESS.md`), but was NOT updated for the `color-engine-2026-02-14` API renames. It works only because `2026-02-14` provides deprecated re-exports. Root was updated to use the new names but has "many gaps and regressions."

### Test Fix Strategy

The tests need to:

1. **Import from `classes/baseline/`** — the canonical, actively maintained set
2. **Respect the two import contexts:**
   - Node-only tests: `../../classes/baseline/…` (from `tests/classes/`)
   - Playwright tests (browser): `../classes/baseline/…` (from `tests/index.html`)
3. **Update JSDoc type references** — these are types-only but should match the import paths
4. **Verify engine version compatibility** — tests currently pass `engineVersion: 'color-engine-2025-12-19'` and `'color-engine-2026-01-30'` to `ColorConversionPolicy` — these must continue to work with baseline
5. **Add version-specific test suffixes** where applicable per the user's documented convention

### `classes/legacy/` Dependency Analysis

**ALL 6 committed `classes/legacy/` files are BROKEN** — they import from `classes/` root via `../` and those files are deleted.

**Dependency map:**

| Legacy File                                    | Root-Level Imports (DELETED)                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `legacy-pdf-document-color-converter.js`       | `../pdf-document-color-converter.js`, `../color-engine-provider.js`         |
| `legacy-pdf-content-stream-color-converter.js` | `../pdf-content-stream-color-converter.js`, `../color-conversion-policy.js` |
| `legacy-pdf-image-color-converter.js`          | `../pdf-image-color-converter.js`, `../color-conversion-policy.js`          |
| `legacy-pdf-page-color-converter.js`           | `../composite-color-converter.js`                                           |
| `legacy-worker-pool-entrypoint.js`             | `../color-engine-provider.js` (dynamic)                                     |
| `legacy-color-converter-helpers.js`            | (none — pure utility exports)                                               |

**Who uses `classes/legacy/`:**

| Consumer                                          | Status                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `classes/root/create-document-color-converter.js` | UNTRACKED — factory that dispatches between baseline and legacy          |
| `experiments/`                                    | No references                                                            |
| `tests/legacy/`                                   | No references — legacy tests only test `services/` layer                 |
| `experiments/legacy/convert-pdf-color.js`         | No references — imports from `classes/diagnostics/` and `packages/` only |
| `experiments/scripts/legacy/`                     | No references — standalone CLI tools with dynamic engine path            |

**Conclusion:** `classes/legacy/` is committed but:

1. Entirely broken (imports from deleted root-level classes)
2. Not imported by any other committed code
3. Only referenced by the untracked `classes/root/create-document-color-converter.js`

**Options:**

| Option | Description                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------- |
| **L1** | Update `classes/legacy/` imports to use `../baseline/` — makes legacy classes extend baseline instead of root           |
| **L2** | Delete `classes/legacy/` entirely — nobody uses it, and it was documented as "on hold due to many gaps and regressions" |
| **L3** | Leave broken — document as on-hold, fix later if needed                                                                 |

**Decision:** L2 — delete `classes/legacy/` from clean commits. Nobody imports it, and the code is broken. Git history preserves it.

### Corrected Definitive Import Analysis

**Earlier analysis of `experiments/classes/image-lab-converter.mjs` was WRONG.** The committed version already imports from `classes/baseline/`, not `classes/` root. The `../../../classes/` path I identified earlier was from a stale read.

**100% confirmed: NOTHING imports from `classes/root/` or `classes/legacy/` outside of those directories themselves.**

**Definitive list of committed files that import from `classes/` ROOT (12 files total):**

| Category           | Files                                                                                                                                                                                                                                                                                                                                                                                      | Import Pattern                          | Count         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------- |
| Tests (Node.js)    | `buffer-registry.test.js`, `color-conversion-policy.test.js`, `color-converter-classes.test.js`, `color-converter.test.js`, `image-color-converter.test.js`, `lookup-table-color-converter.test.js`, `pdf-content-stream-color-converter.test.js`, `pdf-document-color-converter.test.js`, `pdf-image-color-converter.test.js`, `pdf-page-color-converter.test.js`, `profile-pool.test.js` | `../../classes/*.js`                    | 11            |
| Tests (Playwright) | `color-converter-classes.test.js`, `color-engine-provider.test.js`                                                                                                                                                                                                                                                                                                                         | `../classes/*.js` (browser)             | 2 (1 overlap) |
| Experiments        | `compare-pdf-outputs.js`                                                                                                                                                                                                                                                                                                                                                                   | `../classes/pdf-image-color-sampler.js` | 1             |

**Files that do NOT need changes (confirmed correct):**

- `experiments/classes/image-lab-converter.mjs` — already uses `../../classes/baseline/` ✓
- `experiments/scripts/generate-verification-matrix.mjs` — imports from `../classes/` = `experiments/classes/` (NOT root) ✓
- `experiments/scripts/generate-verification-matrix-baseline.mjs` — same ✓
- `generator/bootstrap-worker-entrypoint.js` — imports from `./classes/` = `generator/classes/` ✓
- `generator/elements/test-form-generator-app-element.js` — imports from `../classes/` = `generator/classes/` ✓
- `services/PDFService.js` — imports from `../classes/diagnostics/` ✓
- `experiments/convert-pdf-color.js` — imports from `../classes/diagnostics/` ✓

### Revised Clean Commit Plan Impact

Since `classes/` root and `classes/legacy/` have zero external consumers:

1. **Do NOT commit `classes/` root-level files** — they are not imported by any committed code that should continue working (the 12 files above will be updated to use `classes/baseline/`)
2. **Do NOT commit `classes/legacy/`** — zero consumers, broken imports, documented as on-hold
3. **Do NOT commit `classes/root/`** — development-only copies, not referenced by committed code
4. **Commit `classes/baseline/`** as the sole class implementation
5. **Commit `classes/diagnostics/`** — used by `services/` and `experiments/`
6. **Update the 12 files** to import from `classes/baseline/` instead of `classes/`
7. **All tests must pass** against `classes/baseline/` after the import path updates

### Q2: Staging Class Files (Deferred)

**Resolution:** Will address after creating `2026/` copies with history. The plan is to revert `2025/` files to match staging once the user is ready. No action needed before cleanup.

---

## 8. Activity Log

### References

- **PDF/X-4 Output Intent and ICC Profile Naming**: https://share.google/aimode/cniS49dy27zNZLxZ3
  - Per ISO 32000: profile name stored in `OutputConditionIdentifier`, `Info`, ICC `desc` tag, stream `/Metadata` XMP, and `/AF` (PDF 2.0 Associated Files)
  - Validator reads ICC `desc` tag as primary source for download filename
  - Generator should store original filename via `/AF` (PDF 2.0) and/or in manifest metadata

---

### 2026-03-18

- **Created** this PROGRESS document
- **Analyzed** all 20 temporary commits (f0ef7c2..5df1228, 2025-12-04 to 2026-03-18)
- **Catalogued** uncommitted working tree changes: 30 tracked modifications, ~92 untracked files
- **Mapped** all `classes/` imports across workspace and staging
- **Analyzed** `pdf-lib.esm.js` — identified single functional patch vs whitespace reformatting
- **Inventoried** all progress/tracking documents: 41 committed in experiments/, 3 in generator/, 1 in classes/baseline/, 11 committed at root, 8 untracked at root
- **Resolved** 5 of 7 open questions per user direction
- **Drafted** clean commit plan with 11 commits and progress document consolidation strategy
- **Drafted** worktree-based execution plan using `test-for-generator/2025/*` branches

### 2026-03-18 → 2026-03-19

- **Executed** Phase 0 — cleaned up master, applied pdf-lib patch, updated test imports
- **Executed** Phase 1 — `git mv` 2025→2026, restored 2025 alongside, established 2026 layout

### 2026-03-19 → 2026-03-26

- **Generator development**: customized PDF assembly, docket generation, UI layout, F9f/F10a assets
- **Compatibility**: Firefox 115 `safeDynamicImport`, color conversion policy disabled flag support
- **Assets**: added LFS transition for non-LFS assets

### 2026-03-27

- **Color Engine**: added `color-engine-2026-03-27` with Lab K-Only GCR neutral fix
- **Policy**: enabled `relative-colorimetric-lab-fallback` for old engines, replaced hardcoded Lab K-Only GCR workarounds with policy-driven evaluation in `PDFImageColorConverter` and `StreamTransformWorker`
- **Experiments**: copied/refactored 2025 experiments to 2026

### 2026-03-29

- **Compression Streams API**: completed audit of pako usage (181 code hits, 27 files), transitioned compression from pako to native API
- **Helpers refactor**: split `import-helpers.js` into `imports.js`, `streams.js`, `buffers.js`; rewrote TC39 base64/hex polyfill
- **Safari OOM**: implemented bounded-concurrency image lanes (`cf09bee`), replaced try/catch with unhandled error listeners in worker
- **Staging tools**: moved from `experiments/scripts/` to `experiments/tools/`, created `STAGING.md`
- **Browser testing**: verified generation in Chrome 145, Firefox 115, Safari 26.3 — captured Safari timeline (peak 9.5 GB, `page` memory dominates at ~8 GB from ArrayBuffer allocations)
- **Safari OOM logs captured**: crashes at `worker-pool-entrypoint.js:284` (image processing) and `buffers.js:25` (`Uint8Array` allocation) — `RangeError: Out of memory`

### 2026-03-30

- **Generator**: docket slug format improvements, PDF/X-4 conformance fixes, cache freshness, documentation modal, error alerts, single timestamp across generation session
- **Validator**: `PDFPreflightValidator`, `PDFPreflightFixer`, validator UI, `xml-markup-parser`, `preflight-rules.json`, investigation scripts
- **Assets**: corrected F10a manifest asset order

### 2026-03-31

- **Generator**: ICC profile filename via `/AF`, font embedding, Ghostscript WASM update, Gray color space GS arguments, docket PDF/X-4 conformance improvements
- **Validator**: Download Profile button with ICC desc tag extraction
- **Staging**: added `validator` sync group to staging script
- **Safari OOM**: investigation ongoing — need to confirm affected browsers/versions/platforms before concluding
