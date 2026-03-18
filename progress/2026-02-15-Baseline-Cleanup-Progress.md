# 2026-02-15 — Baseline Classes Cleanup

## Overview

Audit and cleanup of hardcoded values and behavioral changes in `classes/baseline/` introduced by Claude during the 2026-02-14 color engine integration session.

Reference backup restored from Time Machine at `classes/baseline-backup/`.

## Roadmap

- [x] **Fix 1: Pako hardcoded path** — Replace hardcoded `../../packages/pako/dist/pako.mjs` with `pakoPackageEntrypoint` config option resolved via `import.meta.resolve()` `DONE`
- [x] **Fix 2: Shared profile stripping safety** — Ensure `task.destinationProfile` is only stripped when it matches the shared profile (currently strips unconditionally) `DONE`
- [x] **Fix 3: Transferable ArrayBuffer neutering audit** — Verify no main-thread code re-reads image buffers after `submitTask` transfers them `DONE — SAFE`
- [x] **Audit: Worker count reporting mismatch** — `convert-pdf-color-baseline.js` reports `availableParallelism()` but `WorkerPool` uses `cpus().length / 2` `DONE`

## Current Status

**Focus:** All fixes complete
**Last Updated:** 2026-02-15

## Detailed Findings

### Files Changed Between Backup and Current (8 files)

| File | Changes |
|------|---------|
| `color-converter.js` | Added `intermediateProfiles` config; bypassed legacy service init; added multiprofile config precedence; changed `createMultiprofileTransform` from intents array to single intent |
| `color-engine-provider.js` | Changed `createMultiprofileTransform(profiles, inputFormat, outputFormat, intents, flags)` to `..., intent, flags)` |
| `pdf-content-stream-color-converter.js` | Propagates `destinationColorSpace`, `verbose`, `intermediateProfiles` through config |
| `pdf-document-color-converter.js` | Added `pages` filter; `onPageConverted` callback; propagates `outputBitsPerComponent`/`outputEndianness`/`intermediateProfiles`; `broadcastSharedProfiles` |
| `pdf-image-color-converter.js` | Hardcoded pako fallback path; propagates `verbose`/`intermediateProfiles` |
| `pdf-page-color-converter.js` | Propagates `outputBitsPerComponent`/`outputEndianness`/`intermediateProfiles`; rewrote indexed image conversion; strips shared profiles from worker tasks |
| `worker-pool-entrypoint.js` | Added `sharedConfig` cache; changed `verbose: false` to `task.verbose ?? false`; added shared config fallback |
| `worker-pool.js` | Added `#collectTransferables` for zero-copy transfer; `broadcastSharedProfiles()`/`hasSharedProfiles` |

### Behavioral Impact on `convert-pdf-color-baseline.js`

| # | Change | Category | Impact |
|---|--------|----------|--------|
| 1 | `verbose: false` hardcoded in worker entrypoint → `task.verbose ?? false` | **Bug fix** | Tool's `--verbose` flag was being silently ignored in workers |
| 2 | `outputBitsPerComponent`/`outputEndianness` now propagated document→page→image | **Bug fix** | Tool's `--output-bits`/`--output-endianness` were silently dropped at document→page boundary |
| 3 | Indexed image conversion uses `config.destinationColorSpace` instead of hardcoded CMYK | **Bug fix** | Non-CMYK destinations now get correct indexed image conversion |
| 4 | Shared profile stripping in worker tasks (unconditional) | **Latent risk** | If page overrides provide different `destinationProfile`, wrong profile used silently. Tool doesn't use page overrides currently. |
| 5 | `#collectTransferables` — zero-copy ArrayBuffer transfer | **Performance** | After transfer, main-thread ArrayBuffer is neutered. Risk if any code re-reads buffer after task submission. |
| 6 | Legacy service init bypass (`Promise.resolve()`) when `colorEngineProvider` passed | **No impact** | Tool doesn't pass `colorEngineProvider` — follows `#initialize()` path |
| 7 | `createMultiprofileTransform` API: intents array → single intent | **Internal** | Coordinated change between `color-converter.js` and `color-engine-provider.js` |

### Hardcoded Values Found

| # | File:Line | Value | Status |
|---|-----------|-------|--------|
| 1 | `pdf-image-color-converter.js:165` | `../../packages/pako/dist/pako.mjs` | Hardcoded relative path to pako (consumer-layout-dependent) |
| 2 | `worker-pool-entrypoint.js:118` | `../../packages/pako/dist/pako.mjs` | Same hardcoded path in worker entrypoint |
| 3 | `worker-pool.js:205` | `cachedCpuCount = 8` | Fallback when `os.cpus()` fails — unchanged from backup |
| 4 | `worker-pool.js:196` | `(navigator.hardwareConcurrency \|\| 4) / 2` | Browser worker count fallback — unchanged from backup |

### Pre-Existing Issues (unchanged from backup)

- `WorkerPool.getDefaultWorkerCount()` uses `os.cpus().length / 2` but `convert-pdf-color-baseline.js` reports `os.availableParallelism()` without dividing — reported worker count is always double actual
- No `workerCount` option on `PDFDocumentColorConverterConfiguration` — tool's `--workers=N` flag is validation-only, cannot control actual count

## Activity Log

- **2026-02-15** — Initial audit completed. Identified 8 changed files, 7 behavioral impacts, 4 hardcoded values. Fix 1 (pako entrypoint) plan written.
- **2026-02-15** — Fix 1 completed. Root cause: `worker-pool-entrypoint.js` `handleMessage` for `'shared-config'` was not extracting `pakoPackageEntrypoint` from the broadcast message. The document converter already resolved pako via `import.meta.resolve()` and included it in `broadcastSharedProfiles()`, and the worker code at lines 122 and 232 already used `sharedConfig?.pakoPackageEntrypoint` — but the property was never cached. Added `pakoPackageEntrypoint: task.pakoPackageEntrypoint` to the sharedConfig extraction and updated the typedef.
- **2026-02-15** — Fix 2 completed. Changed `pdf-page-color-converter.js` lines 421-428: profile stripping now conditional — only strips `destinationProfile`/`intermediateProfiles` when the task's value is the same reference (`===`) as the page-level shared configuration. Per-image overrides (via `getConfigurationFor`) that provide different profiles are preserved and sent to the worker.
- **2026-02-15** — Fix 3 audit completed. Code is SAFE. `prepareWorkerTask` in `pdf-image-color-converter.js:769` creates `.buffer.slice()` copies of ArrayBuffers before transfer. After `submitImage` transfers the buffer, results use `result.pixelBuffer` (worker output at `pdf-page-color-converter.js:455`). No main-thread code re-reads transferred buffers. Zero-copy transfer works correctly.
- **2026-02-15** — Worker count mismatch fixed. `convert-pdf-color-baseline.js` line 642 was using `os.availableParallelism()` (returns full CPU count) but `WorkerPool.getDefaultWorkerCount()` uses `os.cpus().length / 2`. Changed to use `Math.max(1, Math.floor(os.cpus().length / 2))` to match the actual pool calculation.
