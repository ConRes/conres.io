# STAGING.md

Instructions for safely syncing changes from `conres.io` (development) to `conres.io-staging` (deployment testing).

---

## Quick Reference

```bash
# 1. Compare dependency trees (BEFORE syncing)
node testing/iso/ptf/2025/experiments/scripts/trace-dependencies.mjs \
  --runtime-only --filter=testing/iso/ptf/2025 \
  testing/iso/ptf/2025/generator/generator.js
node testing/iso/ptf/2025/experiments/scripts/trace-dependencies.mjs \
  --runtime-only --filter=testing/iso/ptf/2025 \
  --workspaceRoot=../conres.io-staging \
  testing/iso/ptf/2025/generator/generator.js

# 2. Preview what would be synced
node testing/iso/ptf/2025/experiments/scripts/sync-generator-to-staging.mjs \
  --dry-run 9c17c5dc42d4ff5935fd5058683bfea98f94b108 \
  ../conres.io-staging \
  generator assets classes

# 3. Sync the safe groups
node testing/iso/ptf/2025/experiments/scripts/sync-generator-to-staging.mjs \
  9c17c5dc42d4ff5935fd5058683bfea98f94b108 \
  ../conres.io-staging \
  generator assets classes

# 4. Copy individual files outside safe groups (if changed)
/bin/cp testing/iso/ptf/2025/services/helpers/pdf-lib.js \
  ../conres.io-staging/testing/iso/ptf/2025/services/helpers/pdf-lib.js
```

---

## Overview

The `conres.io-staging` repository is the deployment target for testing the 2025/generator prototype. Its baseline state is the parent commit `9c17c5dc42d4ff5935fd5058683bfea98f94b108`, which preserves pre-existing implementations. Development changes are layered on top — but files in the parent commit are PROTECTED and never auto-synced.

Two tools support this workflow:

| Tool | Purpose |
|------|---------|
| `sync-generator-to-staging.mjs` | Copy changed files from development to staging with parent-commit protection |
| `trace-dependencies.mjs` | Trace the runtime dependency graph from an entry point to determine what files are actually needed |

Both are located in `testing/iso/ptf/2025/experiments/scripts/`.

---

## Tools

### `sync-generator-to-staging.mjs`

Copies files from the working tree to staging, classifying each as:

| Status | Meaning | Action |
|--------|---------|--------|
| NEW | Not in parent commit, not in staging | Copied |
| CHANGED | Not in parent commit, differs from staging | Copied |
| UNCHANGED | Identical in both repositories | Skipped |
| PROTECTED | Exists in the parent commit | NOT copied (manual review required) |
| EXTRA | In staging but not in source | Reported (not deleted) |

**Sync groups** (paths relative to project root):

| Group | Path | Notes |
|-------|------|-------|
| `generator` | `testing/iso/ptf/2025/generator/` | Generator prototype UI and logic |
| `assets` | `testing/iso/ptf/assets/` | Asset PDFs, manifests, profiles |
| `classes` | `testing/iso/ptf/2025/classes/` | Shared ecosystem classes (baseline and non-baseline) |
| `packages` | `testing/iso/ptf/2025/packages/` | Vendored dependencies |
| `services` | `testing/iso/ptf/2025/services/` | Service modules |

**Usage:**

```bash
node testing/iso/ptf/2025/experiments/scripts/sync-generator-to-staging.mjs \
  [--dry-run] [--verbose] \
  <parent-commit> <staging-path> [groups...]
```

**Arguments:**

- `<parent-commit>` — Git commitish for the staging repo's baseline state (currently `9c17c5dc42d4ff5935fd5058683bfea98f94b108`)
- `<staging-path>` — Path to the staging repository (typically `../conres.io-staging`)
- `[groups...]` — Limit to specific sync groups. If omitted, all groups are synced.

**Options:**

- `--dry-run` — Show the plan without writing any files
- `--verbose` — Include unchanged and protected-unchanged files in output

### `trace-dependencies.mjs`

Uses TypeScript's `tsc --explainFiles` to trace the static dependency graph from entry points. Helps determine exactly which files a module depends on at runtime.

**Usage:**

```bash
node testing/iso/ptf/2025/experiments/scripts/trace-dependencies.mjs \
  [--tree] [--dynamic] [--runtime-only] \
  [--filter=PATH] [--workspaceRoot=PATH] \
  <entry-point> [entry-point...]
```

**Options:**

- `--tree` — Show top-down dependency tree from entry points (default: flat list)
- `--dynamic` — Also scan for dynamic `import()` calls in resolved files
- `--runtime-only` — Exclude type-only imports (JSDoc `@type`/`@param` references that have zero runtime effect)
- `--filter=PATH` — Only show dependencies under this path prefix
- `--workspaceRoot=PATH` — Workspace root for resolving entry points (default: this script's project root). Use this to compare dependency graphs between repos.

---

## Standard Procedure

### Step 1: Compare dependency trees BEFORE syncing

The development and staging repos have different dependency trees because PROTECTED files (e.g., `PDFService.js`) differ between repos. The dev version may import NEW files that staging's parent-commit version does not. **Always compare BEFORE deciding what to sync.**

```bash
# Development repo
node testing/iso/ptf/2025/experiments/scripts/trace-dependencies.mjs \
  --runtime-only --filter=testing/iso/ptf/2025 \
  testing/iso/ptf/2025/generator/generator.js

# Staging repo
node testing/iso/ptf/2025/experiments/scripts/trace-dependencies.mjs \
  --runtime-only --filter=testing/iso/ptf/2025 \
  --workspaceRoot=../conres.io-staging \
  testing/iso/ptf/2025/generator/generator.js
```

Files that appear in dev but NOT in staging fall into two categories:

| Category | Action |
|----------|--------|
| Downstream of a PROTECTED file that differs between repos | **Do NOT sync** — staging's PROTECTED version does not import them |
| Genuinely new files needed by synced groups | **Sync** — staging will fail without them |

### Step 2: Dry-run the sync

Preview what would be copied for the safe groups:

```bash
node testing/iso/ptf/2025/experiments/scripts/sync-generator-to-staging.mjs \
  --dry-run 9c17c5dc42d4ff5935fd5058683bfea98f94b108 \
  ../conres.io-staging \
  generator assets classes
```

Review the output:
- Confirm all CHANGED/NEW files are expected
- Confirm PROTECTED files are already in staging (no manual action needed)
- Confirm no unintended files are included

### Step 3: Execute the sync

```bash
node testing/iso/ptf/2025/experiments/scripts/sync-generator-to-staging.mjs \
  9c17c5dc42d4ff5935fd5058683bfea98f94b108 \
  ../conres.io-staging \
  generator assets classes
```

### Step 4: Sync individual files outside safe groups

Some files live in non-safe groups but are dependencies of safe groups. Copy these individually:

```bash
# Example: services/helpers/pdf-lib.js is imported by classes/baseline/pdf-page-color-converter.js
/bin/cp testing/iso/ptf/2025/services/helpers/pdf-lib.js \
  ../conres.io-staging/testing/iso/ptf/2025/services/helpers/pdf-lib.js
```

Use `/bin/cp` to bypass shell aliases that add interactive confirmation.

**How to identify these files:** Compare the Step 1 dependency traces. Any file in staging's tree that lives outside the safe sync groups AND has changed needs manual copying.

### Step 5: Verify in staging

Re-run the staging dependency trace to confirm it resolves correctly:

```bash
node testing/iso/ptf/2025/experiments/scripts/trace-dependencies.mjs \
  --runtime-only --filter=testing/iso/ptf/2025 \
  --workspaceRoot=../conres.io-staging \
  testing/iso/ptf/2025/generator/generator.js
```

All files in staging's tree should be present and unchanged relative to their dev counterparts.

---

## Which Groups to Sync

Not all groups need syncing every time. Use the dependency trace to decide.

### Groups that are safe to sync routinely

| Group | Rationale |
|-------|-----------|
| `generator` | Generator UI and logic — always sync when generator code changes |
| `assets` | Asset PDFs and manifests — sync when assets are added or updated |
| `classes` | Shared ecosystem classes — sync when baseline class behavior changes |

### Groups that must NOT be synced as a whole

| Group | Why NOT | What to do instead |
|-------|---------|-------------------|
| `packages` | Contains ALL vendored package versions (500+ files). Only `color-engine`, `pako`, and `ghostscript-wasm` are used at runtime — all typically already in staging. | Copy individual changed packages manually. |
| `services` | **DANGEROUS.** The dev `PDFService.js` imports NEW service files that staging's PROTECTED parent-commit version does NOT import. Syncing the group copies files that are unreachable in staging and pollutes the deployment. The only file in `services/` that is a runtime dependency of the safe groups is `services/helpers/pdf-lib.js` (imported by `classes/baseline/pdf-page-color-converter.js`). | Copy `services/helpers/pdf-lib.js` individually in Step 4. Never sync `services` as a group. |

### Symlinks and deployment

Symlinks (e.g., `assets/profiles`) do not resolve correctly when deployed. If the sync tool reports a symlink error (EPERM), verify that the target directory already exists in staging as a real folder with the correct contents. Do not force-overwrite deployed symlink replacements.

---

## Key Facts

- **Parent commit:** `9c17c5dc42d4ff5935fd5058683bfea98f94b108` — the staging repo's baseline state. Files in this commit are PROTECTED.
- **Dev and staging have divergent dependency trees.** The dev `PDFService.js` imports `ColorEngineService.js`, `ColorSpaceUtils.js`, `ProfileSelectionService.js`, `WorkerColorConversion.js`, `WorkerPool.js`, and `classes/diagnostics-collector.js`. Staging's PROTECTED parent-commit `PDFService.js` does not. Dev traces 36 runtime files; staging traces 30. The 6 extra files in dev are ALL downstream of the PROTECTED `PDFService.js`.
- **`services/helpers/pdf-lib.js`** is a baseline class dependency (imported by `classes/baseline/pdf-page-color-converter.js`), NOT a services dependency. It lives in the `services/` directory but belongs to the `classes` dependency subtree. This is the only file in `services/` that needs syncing when baseline classes change.
- **`services/ColorEngineService.js`** is referenced by baseline classes via JSDoc `@type` annotations only — zero runtime effect. The `--runtime-only` flag on `trace-dependencies.mjs` correctly excludes it.
- **The generator uses `ColorEngineProvider`** (new API) — it never triggers the deprecated `#initializeLegacyServiceIfNeeded()` path in `color-converter.js`.
- **`packages/color-engine`** is a symlink to the current version directory (e.g., `color-engine-2026-02-14`). The symlink and its target must both exist in staging.
