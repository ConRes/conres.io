#!/usr/bin/env node
// @ts-check
/**
 * sync-generator-to-staging.mjs
 *
 * Safely propagates working tree changes from conres.io (2026/) to
 * conres.io-staging for deployment testing, with parent commit protection.
 *
 * Background:
 *   The conres.io-staging repository provides a deployment target for testing
 *   the generator prototype. Its baseline state preserves pre-existing
 *   implementations from a known parent commit. The 2026/ directory is entirely
 *   new — no files exist in the parent commit — so nothing will be PROTECTED.
 *   The protection logic is retained for safety and consistency with the 2025
 *   sync script.
 *
 * How it works:
 *   The script operates in three phases:
 *
 *   Phase 0 — Parent commit enumeration:
 *     Runs `git ls-tree` against the parent commit in the staging repo to
 *     build the set of files that belong to the pre-existing implementation.
 *     Any file in this set is PROTECTED and will not be auto-synced.
 *
 *   Phase 1 — Preparation:
 *     Enumerates all files in the configured sync groups, compares each source
 *     file against its staging counterpart, and classifies operations as:
 *       NEW       — not in parent commit, not in staging (will be added)
 *       CHANGED   — not in parent commit, in staging but differs (will be updated)
 *       UNCHANGED — identical in both (skipped)
 *       PROTECTED — exists in parent commit (NOT auto-synced, reported for manual action)
 *       EXTRA     — in staging but not in source (reported, not deleted)
 *     The full plan is displayed before any files are written.
 *
 *   Phase 2 — Execution:
 *     Copies only NEW and CHANGED files (those NOT in the parent commit).
 *     PROTECTED files are listed separately so the human or agent can copy
 *     them manually after reviewing the implications.
 *
 * Sync groups (paths relative to project root):
 *   generator  — testing/iso/ptf/2026/generator/  (generator prototype UI)
 *   assets     — testing/iso/ptf/assets/           (asset PDFs, manifests, profiles)
 *   classes    — testing/iso/ptf/2026/classes/     (shared ecosystem classes)
 *   packages   — testing/iso/ptf/2026/packages/    (vendored dependencies)
 *   services   — testing/iso/ptf/2026/services/    (service modules)
 *   helpers    — testing/iso/ptf/2026/helpers/      (polyfills)
 *   resources  — testing/iso/ptf/2026/resources/    (symlinks to assets/profiles)
 *
 * Usage:
 *   node .../sync-generator-to-staging.mjs [options] <parent-commit> <staging-path> [groups...]
 *
 * Required arguments:
 *   <parent-commit>   Git commitish for the staging repo's baseline state
 *   <staging-path>    Path to the staging repository
 *
 * Options:
 *   --dry-run         Show the plan without writing any files
 *   --verbose         Include unchanged and protected-unchanged files in output
 *
 * Optional arguments:
 *   groups...         Limit sync to specific groups (e.g., "classes generator").
 *                     If omitted, all groups are synced.
 *
 * Examples:
 *   # Preview all changes against parent commit
 *   node .../sync-generator-to-staging.mjs --dry-run 9c17c5dc ../conres.io-staging
 *
 *   # Sync generator and its class dependencies
 *   node .../sync-generator-to-staging.mjs 9c17c5dc ../conres.io-staging generator classes
 *
 *   # Sync everything that is safe to sync
 *   node .../sync-generator-to-staging.mjs 9c17c5dc ../conres.io-staging
 *
 * @module sync-generator-to-staging
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import {
    existsSync, readFileSync, statSync, readdirSync, readlinkSync,
    cpSync, mkdirSync, symlinkSync, unlinkSync,
} from 'node:fs';
import { resolve, join, dirname, matchesGlob } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '../../../../../..');

/** @type {{ name: string, path: string }[]} */
const ALL_SYNC_GROUPS = [
    { name: 'generator', path: 'testing/iso/ptf/2026/generator' },
    { name: 'validator', path: 'testing/iso/ptf/2026/validator' },
    { name: 'assets', path: 'testing/iso/ptf/assets' },
    { name: 'classes', path: 'testing/iso/ptf/2026/classes' },
    { name: 'packages', path: 'testing/iso/ptf/2026/packages' },
    { name: 'services', path: 'testing/iso/ptf/2026/services' },
    { name: 'helpers', path: 'testing/iso/ptf/2026/helpers' },
    { name: 'resources', path: 'testing/iso/ptf/2026/resources' },
];

/** Filenames to exclude from sync. */
const EXCLUDE_NAMES = new Set(['.DS_Store', 'Thumbs.db', '.gitkeep']);

/**
 * File/directory name suffixes to exclude from sync.
 * - PROGRESS.md: tracking documents, not deployment content
 * - -backup: local backup directories (e.g., baseline-backup/)
 * - -backup.zip: local backup archives
 */
const EXCLUDE_SUFFIXES = ['PROGRESS.md', '-backup', '-backup.zip'];

/** Directory names to exclude entirely from sync. */
const EXCLUDE_DIRS = new Set(['[Trash]', '[trash]', 'node_modules', '.git']);

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2).filter(arg => arg !== '');
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');
const trackedOnly = args.includes('--tracked-only');

/** @type {string[]} */
const excludePatterns = [];
for (const arg of args) {
    if (arg.startsWith('--exclude=')) {
        excludePatterns.push(arg.slice('--exclude='.length));
    }
}

const positionalArgs = args.filter(arg => !arg.startsWith('--'));

if (positionalArgs.length < 2) {
    console.error('Usage: sync-generator-to-staging.mjs [options] <parent-commit> <staging-path> [groups...]');
    console.error('');
    console.error('Required:');
    console.error('  <parent-commit>   Git commitish for the staging baseline (e.g., 9c17c5dc)');
    console.error('  <staging-path>    Path to staging repository (e.g., ../conres.io-staging)');
    console.error('');
    console.error('Options:');
    console.error('  --dry-run              Preview without writing files');
    console.error('  --verbose              Show all files including unchanged');
    console.error('  --tracked-only         Only sync files tracked by git in the source repo');
    console.error('  --exclude=<glob>       Exclude files matching glob (repeatable)');
    console.error('                         Matched against group-relative path (e.g., "*.1.json", "[Trash]/**")');
    console.error('');
    const validNames = ALL_SYNC_GROUPS.map(g => g.name).join(', ');
    console.error(`Groups: ${validNames}`);
    process.exit(1);
}

const [parentCommit, stagingPath, ...groupFilters] = positionalArgs;
const stagingRoot = resolve(stagingPath);

// Validate commitish format to prevent command injection
if (!/^[a-zA-Z0-9._\-/~^@{}]+$/.test(parentCommit)) {
    console.error(`Invalid parent commit format: ${parentCommit}`);
    process.exit(1);
}

const requestedGroups = groupFilters.length > 0
    ? ALL_SYNC_GROUPS.filter(g => groupFilters.includes(g.name))
    : ALL_SYNC_GROUPS;

if (groupFilters.length > 0 && requestedGroups.length === 0) {
    const validNames = ALL_SYNC_GROUPS.map(g => g.name).join(', ');
    console.error(`No valid sync groups specified. Valid groups: ${validNames}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

if (!existsSync(PROJECT_ROOT)) {
    console.error(`Source project not found: ${PROJECT_ROOT}`);
    process.exit(1);
}

if (!existsSync(stagingRoot)) {
    console.error(`Staging repository not found: ${stagingRoot}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Tracked files enumeration (for --tracked-only)
// ---------------------------------------------------------------------------

/** @type {Set<string> | null} — All tracked file paths in the source repo (relative to repo root) */
let trackedFiles = null;
if (trackedOnly) {
    try {
        const output = execSync('git ls-files', {
            cwd: PROJECT_ROOT,
            encoding: 'utf-8',
            maxBuffer: 50 * 1024 * 1024,
        });
        trackedFiles = new Set(output.trim().split('\n').filter(Boolean));
    } catch {
        console.error('Failed to enumerate tracked files. Is this a git repository?');
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Exclude glob matching
// ---------------------------------------------------------------------------

/**
 * Whether a group-relative path matches any --exclude pattern.
 * Uses Node's built-in `path.matchesGlob()` for standard glob semantics.
 *
 * @param {string} relPath — Path relative to the sync group root
 * @returns {boolean}
 */
function isExcluded(relPath) {
    for (const pattern of excludePatterns) {
        if (matchesGlob(relPath, pattern)) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Phase 0: Parent commit enumeration
// ---------------------------------------------------------------------------

/** @type {Set<string>} — All file paths in the parent commit (relative to repo root) */
let parentCommitFiles;
try {
    const output = execSync(`git ls-tree -r --name-only ${parentCommit}`, {
        cwd: stagingRoot,
        encoding: 'utf-8',
    });
    parentCommitFiles = new Set(output.trim().split('\n').filter(Boolean));
} catch {
    console.error(`Failed to resolve parent commit '${parentCommit}' in ${stagingRoot}`);
    console.error(`Verify that the commit exists: git -C ${stagingPath} log --oneline ${parentCommit}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Whether a filename should be excluded from sync.
 * @param {string} name — Filename (not full path)
 * @returns {boolean}
 */
function shouldExclude(name) {
    if (EXCLUDE_NAMES.has(name)) return true;
    if (EXCLUDE_DIRS.has(name)) return true;
    for (const suffix of EXCLUDE_SUFFIXES) {
        if (name.endsWith(suffix)) return true;
    }
    return false;
}

/**
 * Walk a directory tree and collect files and symlinks separately.
 * Symlinks are recorded as entries (not followed into), so a symlink to a
 * directory appears as a single symlink entry rather than being recursed.
 *
 * When `groupPath` is provided:
 * - `--tracked-only` filters to files tracked by git (using `trackedFiles` set)
 * - `--exclude` patterns are matched against group-relative paths
 *
 * @param {string} rootPath — Absolute path to the directory to walk
 * @param {string} [prefix=''] — Relative path prefix for recursion
 * @param {string} [groupPath] — Group path prefix for tracked/exclude checks (e.g., 'testing/iso/ptf/2026/generator')
 * @returns {{ files: string[], symlinks: Map<string, string> }}
 */
function walkDirectory(rootPath, prefix = '', groupPath) {
    /** @type {string[]} */
    const files = [];
    /** @type {Map<string, string>} relativePath -> symlink target */
    const symlinks = new Map();

    if (!existsSync(rootPath)) return { files, symlinks };

    for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
        if (shouldExclude(entry.name)) continue;

        const relPath = prefix ? join(prefix, entry.name) : entry.name;
        const fullPath = join(rootPath, entry.name);

        // Apply --exclude patterns against group-relative path
        if (groupPath && isExcluded(relPath)) continue;

        // Apply --tracked-only against repo-relative path
        if (groupPath && trackedFiles) {
            const repoRelPath = join(groupPath, relPath);
            if (entry.isSymbolicLink()) {
                if (!trackedFiles.has(repoRelPath)) continue;
            } else if (entry.isFile()) {
                if (!trackedFiles.has(repoRelPath)) continue;
            }
            // Directories are always entered — tracked files inside will pass individually
        }

        if (entry.isSymbolicLink()) {
            symlinks.set(relPath, readlinkSync(fullPath));
        } else if (entry.isFile()) {
            files.push(relPath);
        } else if (entry.isDirectory()) {
            const sub = walkDirectory(fullPath, relPath, groupPath);
            files.push(...sub.files);
            for (const [k, v] of sub.symlinks) symlinks.set(k, v);
        }
    }

    return { files, symlinks };
}

/**
 * Compare two files by size first, then by content if sizes match.
 *
 * @param {string} pathA
 * @param {string} pathB
 * @returns {boolean}
 */
function filesAreIdentical(pathA, pathB) {
    const statA = statSync(pathA);
    const statB = statSync(pathB);
    if (statA.size !== statB.size) return false;
    if (statA.size === 0) return true;
    return readFileSync(pathA).equals(readFileSync(pathB));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {'new' | 'changed' | 'unchanged' | 'extra'} OperationType
 *
 * @typedef {{
 *   relativePath: string,
 *   operation: OperationType,
 *   kind: 'file' | 'symlink',
 *   protected: boolean,
 *   symlinkTarget?: string,
 * }} SyncEntry
 *
 * @typedef {{
 *   name: string,
 *   path: string,
 *   entries: SyncEntry[],
 *   syncable: number,
 *   protectedChanged: number,
 *   protectedTotal: number,
 *   unchanged: number,
 *   extra: number,
 * }} SyncGroupResult
 */

// ---------------------------------------------------------------------------
// Phase 1: Preparation
// ---------------------------------------------------------------------------

/** @type {SyncGroupResult[]} */
const results = [];

for (const group of requestedGroups) {
    const sourceDir = join(PROJECT_ROOT, group.path);
    const targetDir = join(stagingRoot, group.path);

    const source = walkDirectory(sourceDir, '', group.path);
    const target = walkDirectory(targetDir);

    const targetFileSet = new Set(target.files);
    const sourceFileSet = new Set(source.files);

    /** @type {SyncEntry[]} */
    const entries = [];

    // Classify source files
    for (const relPath of source.files) {
        const fullRelPath = join(group.path, relPath);
        const isProtected = parentCommitFiles.has(fullRelPath);
        const srcFile = join(sourceDir, relPath);
        const tgtFile = join(targetDir, relPath);

        if (targetFileSet.has(relPath)) {
            const identical = filesAreIdentical(srcFile, tgtFile);
            entries.push({
                relativePath: relPath,
                operation: identical ? 'unchanged' : 'changed',
                kind: 'file',
                protected: isProtected,
            });
        } else {
            entries.push({
                relativePath: relPath,
                operation: 'new',
                kind: 'file',
                protected: isProtected,
            });
        }
    }

    // Classify source symlinks
    for (const [relPath, sourceTarget] of source.symlinks) {
        const fullRelPath = join(group.path, relPath);
        const isProtected = parentCommitFiles.has(fullRelPath);

        if (target.symlinks.has(relPath)) {
            const identical = sourceTarget === target.symlinks.get(relPath);
            entries.push({
                relativePath: relPath,
                operation: identical ? 'unchanged' : 'changed',
                kind: 'symlink',
                protected: isProtected,
                symlinkTarget: sourceTarget,
            });
        } else {
            entries.push({
                relativePath: relPath,
                operation: 'new',
                kind: 'symlink',
                protected: isProtected,
                symlinkTarget: sourceTarget,
            });
        }
    }

    // Detect extra files in staging (not in source)
    for (const relPath of target.files) {
        if (!sourceFileSet.has(relPath)) {
            const fullRelPath = join(group.path, relPath);
            const inParent = parentCommitFiles.has(fullRelPath);
            // Extra files from the parent commit are expected — only flag others
            if (!inParent || verbose) {
                entries.push({
                    relativePath: relPath,
                    operation: 'extra',
                    kind: 'file',
                    protected: inParent,
                });
            }
        }
    }

    for (const [relPath, targetTarget] of target.symlinks) {
        if (!source.symlinks.has(relPath)) {
            const fullRelPath = join(group.path, relPath);
            const inParent = parentCommitFiles.has(fullRelPath);
            if (!inParent || verbose) {
                entries.push({
                    relativePath: relPath,
                    operation: 'extra',
                    kind: 'symlink',
                    protected: inParent,
                    symlinkTarget: targetTarget,
                });
            }
        }
    }

    // Sort for stable, scannable output
    entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    // Compute counts
    let syncable = 0;
    let protectedChanged = 0;
    let protectedTotal = 0;
    let unchanged = 0;
    let extra = 0;

    for (const entry of entries) {
        if (entry.operation === 'extra') {
            extra++;
        } else if (entry.operation === 'unchanged') {
            unchanged++;
        } else if (entry.protected) {
            protectedTotal++;
            if (entry.operation === 'changed' || entry.operation === 'new') {
                protectedChanged++;
            }
        } else {
            // Non-protected NEW or CHANGED — will be auto-synced
            syncable++;
        }
    }

    // Also count protected-unchanged entries
    for (const entry of entries) {
        if (entry.protected && entry.operation === 'unchanged') {
            protectedTotal++;
        }
    }

    results.push({
        name: group.name,
        path: group.path,
        entries,
        syncable,
        protectedChanged,
        protectedTotal,
        unchanged,
        extra,
    });
}

// ---------------------------------------------------------------------------
// Phase 2: Report
// ---------------------------------------------------------------------------

const shortCommit = parentCommit.length > 12 ? parentCommit.slice(0, 12) : parentCommit;
const groupLabel = requestedGroups.map(g => g.name).join(', ');

console.log(`\nSync: conres.io (2026) -> ${stagingPath}`);
console.log(`Parent commit: ${shortCommit} (${parentCommitFiles.size} files)`);
console.log(`Groups: ${groupLabel}`);
if (dryRun) console.log(`Mode: dry-run (no files will be written)`);
console.log('');

let totalSyncable = 0;
let totalProtectedChanged = 0;
let totalProtectedTotal = 0;
let totalUnchanged = 0;
let totalExtra = 0;

/** @type {{ group: string, path: string, operation: string }[]} */
const protectedChangedList = [];

for (const group of results) {
    const parts = [];
    if (group.syncable > 0) parts.push(`${group.syncable} to sync`);
    if (group.protectedChanged > 0) parts.push(`${group.protectedChanged} protected`);
    if (group.extra > 0) parts.push(`${group.extra} extra`);
    const detail = parts.length > 0 ? parts.join(', ') : 'no changes';

    console.log(`-- ${group.name}/ (${group.entries.length} files, ${detail}) --`);

    for (const entry of group.entries) {
        // Skip unchanged entries unless verbose
        if (entry.operation === 'unchanged' && !entry.protected && !verbose) continue;
        if (entry.operation === 'unchanged' && entry.protected && !verbose) continue;

        // Determine display label
        let label;
        if (entry.protected && entry.operation !== 'extra') {
            const state = entry.operation === 'unchanged' ? 'in sync' : entry.operation;
            label = `PROTECTED  (${state})`.padEnd(24);

            if (entry.operation === 'changed' || entry.operation === 'new') {
                protectedChangedList.push({
                    group: group.name,
                    path: join(group.path, entry.relativePath),
                    operation: entry.operation,
                });
            }
        } else if (entry.operation === 'extra' && entry.protected) {
            label = 'EXTRA      (parent)'.padEnd(24);
        } else {
            label = entry.operation.toUpperCase().padEnd(24);
        }

        const suffix = entry.kind === 'symlink'
            ? ` -> ${entry.symlinkTarget ?? '?'} [symlink]`
            : '';

        console.log(`  ${label} ${entry.relativePath}${suffix}`);
    }

    if (group.syncable === 0 && group.protectedChanged === 0 && group.extra === 0 && !verbose) {
        console.log(`  (all files unchanged)`);
    }

    totalSyncable += group.syncable;
    totalProtectedChanged += group.protectedChanged;
    totalProtectedTotal += group.protectedTotal;
    totalUnchanged += group.unchanged;
    totalExtra += group.extra;

    console.log('');
}

// Summary
const summaryParts = [];
if (totalSyncable > 0) summaryParts.push(`${totalSyncable} to sync`);
if (totalProtectedChanged > 0) summaryParts.push(`${totalProtectedChanged} protected (changed)`);
if (totalProtectedTotal - totalProtectedChanged > 0) summaryParts.push(`${totalProtectedTotal - totalProtectedChanged} protected (in sync)`);
summaryParts.push(`${totalUnchanged} unchanged`);
if (totalExtra > 0) summaryParts.push(`${totalExtra} extra`);
console.log(`Summary: ${summaryParts.join(', ')}`);

// Protected files warning
if (protectedChangedList.length > 0) {
    console.log(`\nPROTECTED files with changes (exist in parent commit ${shortCommit}, NOT auto-synced):`);
    console.log(`  The following ${protectedChangedList.length} file(s) differ between source and staging.`);
    console.log(`  They must be copied manually if you want to update them:\n`);
    for (const item of protectedChangedList) {
        console.log(`    ${item.path}`);
    }
}

if (totalSyncable === 0) {
    console.log('\nNothing to auto-sync.');
    process.exit(protectedChangedList.length > 0 ? 2 : 0);
}

if (dryRun) {
    console.log(`\nDry run complete. ${totalSyncable} file(s) would be synced.`);
    process.exit(protectedChangedList.length > 0 ? 2 : 0);
}

// ---------------------------------------------------------------------------
// Phase 3: Execution
// ---------------------------------------------------------------------------

console.log(`\nSyncing ${totalSyncable} file(s)...\n`);

let copiedCount = 0;
let errorCount = 0;

for (const group of results) {
    const sourceDir = join(PROJECT_ROOT, group.path);
    const targetDir = join(stagingRoot, group.path);

    for (const entry of group.entries) {
        // Only sync non-protected NEW and CHANGED entries
        if (entry.protected) continue;
        if (entry.operation !== 'new' && entry.operation !== 'changed') continue;

        const srcPath = join(sourceDir, entry.relativePath);
        const tgtPath = join(targetDir, entry.relativePath);

        try {
            mkdirSync(dirname(tgtPath), { recursive: true });

            if (entry.kind === 'symlink') {
                if (existsSync(tgtPath)) unlinkSync(tgtPath);
                symlinkSync(/** @type {string} */ (entry.symlinkTarget), tgtPath);
            } else {
                cpSync(srcPath, tgtPath, { force: true });
            }

            console.log(`  SYNCED   ${group.name}/${entry.relativePath}`);
            copiedCount++;
        } catch (error) {
            console.error(`  ERROR    ${group.name}/${entry.relativePath}: ${/** @type {Error} */ (error).message}`);
            errorCount++;
        }
    }
}

console.log(`\nDone. ${copiedCount} file(s) synced${errorCount > 0 ? `, ${errorCount} error(s)` : ''}.`);

if (protectedChangedList.length > 0) {
    console.log(`\nReminder: ${protectedChangedList.length} protected file(s) require manual action (see above).`);
}

if (errorCount > 0) {
    process.exit(1);
}
