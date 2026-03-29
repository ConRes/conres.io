# Staging Deployment

Deployment uses `../conres.io-staging` with two tools in `experiments/tools/`:

- **`sync-generator-to-staging.mjs`** — Parent-commit-protected file sync. Enumerates the parent commit's file set in the staging repo, classifies each source file (NEW, CHANGED, UNCHANGED, PROTECTED, EXTRA), and copies only safe files. Protected files (pre-existing in the parent commit) are reported for manual review.
- **`trace-dependencies.mjs`** — Runtime dependency graph tracer. Resolves `import` and dynamic `import()` chains from entry points to produce a dependency tree or flat file list, used to verify staging completeness.

## Usage

```bash
# Preview all changes (dry run)
node experiments/tools/sync-generator-to-staging.mjs --dry-run 9c17c5dc ../conres.io-staging

# Sync specific groups
node experiments/tools/sync-generator-to-staging.mjs 9c17c5dc ../conres.io-staging generator classes

# Sync all safe files
node experiments/tools/sync-generator-to-staging.mjs 9c17c5dc ../conres.io-staging

# Trace runtime dependencies from an entry point
node experiments/tools/trace-dependencies.mjs testing/iso/ptf/2026/generator/generator.js

# Trace with dynamic imports included
node experiments/tools/trace-dependencies.mjs --dynamic testing/iso/ptf/2026/generator/generator.js
```

## Parent Commit

The parent commit for staging protection is `9c17c5d`. Files present at this commit in the staging repo are PROTECTED and will not be auto-synced.

## Sync Groups

| Group | Path (relative to project root) |
| --- | --- |
| generator | `testing/iso/ptf/2026/generator/` |
| assets | `testing/iso/ptf/assets/` |
| classes | `testing/iso/ptf/2026/classes/` |
| packages | `testing/iso/ptf/2026/packages/` |
| services | `testing/iso/ptf/2026/services/` |
| helpers | `testing/iso/ptf/2026/helpers/` |
| resources | `testing/iso/ptf/2026/resources/` |

## Applies To

Both `2025/` and `2026/` have copies of these tools at `experiments/tools/`. The 2025 version is retained for its own staging workflow; the 2026 version extends it with additional sync groups.
