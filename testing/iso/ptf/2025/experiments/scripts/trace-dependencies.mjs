#!/usr/bin/env node
// @ts-check
/**
 * trace-dependencies.mjs
 *
 * Uses TypeScript's `tsc --explainFiles` to trace the static dependency graph
 * from specified entry points, then scans for dynamic `import()` calls in the
 * resolved files.
 *
 * This is useful for determining exactly which files a module (e.g., the
 * generator) depends on, so you know what needs to be deployed and what can
 * be safely excluded.
 *
 * How it works:
 *   1. Runs `yarn tsc --noEmit --explainFiles --allowJs --noCheck` with entry points
 *   2. Parses the output to build a dependency graph (which file imported which)
 *   3. Scans resolved files for dynamic `import()` calls (when --dynamic is passed)
 *   4. Reports the full dependency tree
 *
 * Usage:
 *   node .../trace-dependencies.mjs [options] <entry-point> [entry-point...]
 *
 * Options:
 *   --tree                  Show the dependency tree (default: flat list)
 *   --dynamic               Also scan for dynamic import() calls in resolved files
 *   --filter=PATH           Only show dependencies under this path prefix
 *   --workspaceRoot=PATH    Workspace root for resolving entry points and running tsc
 *                           (default: this script's project root)
 *   --runtime-only          Exclude type-only imports (JSDoc @type/@param references)
 *
 * Examples:
 *   # Trace generator dependencies
 *   node .../trace-dependencies.mjs testing/iso/ptf/2025/generator/generator.js
 *
 *   # Trace with dynamic imports and filter to project files
 *   node .../trace-dependencies.mjs --dynamic \
 *     testing/iso/ptf/2025/generator/generator.js
 *
 *   # Trace against staging repo for comparison
 *   node .../trace-dependencies.mjs --tree \
 *     --workspaceRoot=../conres.io-staging \
 *     testing/iso/ptf/2025/generator/generator.js
 *
 * @module trace-dependencies
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_PROJECT_ROOT = resolve(SCRIPT_DIR, '../../../../../..');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const rawArgs = process.argv.slice(2).filter(arg => arg !== '');
const showTree = rawArgs.includes('--tree');
const scanDynamic = rawArgs.includes('--dynamic');
const runtimeOnly = rawArgs.includes('--runtime-only');
const filterArg = rawArgs.find(a => a.startsWith('--filter='));
const filterPrefix = filterArg ? filterArg.slice('--filter='.length) : null;
const workspaceRootArg = rawArgs.find(a => a.startsWith('--workspaceRoot='));
const PROJECT_ROOT = workspaceRootArg
    ? resolve(workspaceRootArg.slice('--workspaceRoot='.length))
    : DEFAULT_PROJECT_ROOT;
const entryPoints = rawArgs.filter(a => !a.startsWith('--'));

if (entryPoints.length === 0) {
    console.error('Usage: trace-dependencies.mjs [options] <entry-point> [entry-point...]');
    console.error('');
    console.error('Options:');
    console.error('  --tree                  Show dependency tree instead of flat list');
    console.error('  --dynamic               Scan for dynamic import() calls in resolved files');
    console.error('  --filter=PATH           Only show dependencies under this path prefix');
    console.error('  --workspaceRoot=PATH    Workspace root for resolving paths and running tsc');
    console.error('  --runtime-only          Exclude type-only imports (JSDoc references)');
    process.exit(1);
}

// Resolve entry points relative to the workspace root
const resolvedEntryPoints = entryPoints.map(ep => resolve(PROJECT_ROOT, ep));
for (const ep of resolvedEntryPoints) {
    if (!existsSync(ep)) {
        console.error(`Entry point not found: ${ep}`);
        if (workspaceRootArg) console.error(`  (workspace root: ${PROJECT_ROOT})`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Phase 1: Run tsc --explainFiles
// ---------------------------------------------------------------------------

/** @type {string} */
let tscOutput;
try {
    // Pass flags directly to tsc — no temp tsconfig needed.
    // --noCheck skips type checking (we only care about the module graph).
    const entryArgs = resolvedEntryPoints.map(ep => `"${ep}"`).join(' ');
    tscOutput = execSync(
        `yarn tsc --noEmit --explainFiles --allowJs --noCheck --skipLibCheck --removeComments --importsNotUsedAsValues remove --verbatimModuleSyntax ${entryArgs} 2>&1`,
        { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30000 },
    );
} catch (error) {
    // tsc exits non-zero on type errors, but still outputs explainFiles data
    tscOutput = /** @type {any} */ (error).stdout || '';
    if (!tscOutput) {
        console.error('tsc failed without output. Check TypeScript installation (yarn tsc --version).');
        console.error(/** @type {any} */ (error).stderr || '');
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Phase 2: Parse tsc --explainFiles output
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   absolutePath: string,
 *   relativePath: string,
 *   importedBy: Set<string>,
 * }} ResolvedFile
 */

/** @type {Map<string, ResolvedFile>} relativePath -> file info */
const resolvedFiles = new Map();

/** @type {Map<string, string>} "imported\0importer" -> specifier used in the import */
const edgeSpecifiers = new Map();

const lines = tscOutput.split('\n');
/** @type {string | null} */
let currentFile = null;

for (const line of lines) {
    // Lines starting without indent are file paths
    // Lines starting with spaces are explanations (e.g., "  Imported via './foo.js' from file '/path/bar.js'")
    if (!line.startsWith(' ') && line.trim().length > 0 && !line.includes('error TS')) {
        const rawPath = line.trim();
        // Skip TypeScript lib files and node_modules
        if (rawPath.includes('node_modules/') || rawPath.includes('typescript/lib/')) {
            currentFile = null;
            continue;
        }
        // Resolve to absolute — tsc may emit relative (from CWD) or absolute paths
        const absPath = resolve(PROJECT_ROOT, rawPath);
        const relPath = relative(PROJECT_ROOT, absPath);
        if (relPath.startsWith('..')) {
            currentFile = null;
            continue;
        }
        currentFile = relPath;
        if (!resolvedFiles.has(relPath)) {
            resolvedFiles.set(relPath, {
                absolutePath: absPath,
                relativePath: relPath,
                importedBy: new Set(),
            });
        }
    } else if (currentFile && line.includes('Imported via')) {
        // Parse "  Imported via './foo.js' from file 'path/bar.js'"
        // The path may be absolute or relative depending on tsc version/config.
        const viaMatch = line.match(/Imported via '([^']+)'/);
        const fromMatch = line.match(/from file '([^']+)'/);
        if (fromMatch) {
            const fromRaw = fromMatch[1];
            const fromRel = relative(PROJECT_ROOT, resolve(PROJECT_ROOT, fromRaw));
            const entry = resolvedFiles.get(currentFile);
            if (entry && !fromRel.startsWith('..')) {
                entry.importedBy.add(fromRel);
                if (viaMatch) {
                    edgeSpecifiers.set(`${currentFile}\0${fromRel}`, viaMatch[1]);
                }
            }
        }
    }
}

// Entry point relative paths (used by Phase 2.5 and Phase 4)
const entryPointRelPaths = new Set(resolvedEntryPoints.map(ep => relative(PROJECT_ROOT, ep)));

// ---------------------------------------------------------------------------
// Phase 2.5: Filter type-only imports (--runtime-only)
// ---------------------------------------------------------------------------

if (runtimeOnly) {
    /**
     * Strips block comments (including JSDoc) and line comments from source.
     * @param {string} source
     * @returns {string}
     */
    function stripComments(source) {
        return source
            .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
            .replace(/\/\/.*$/gm, '');            // line comments
    }

    /** @type {Map<string, string>} cached file contents (comment-stripped) */
    const strippedCache = new Map();

    /** @param {string} relPath */
    function getStrippedSource(relPath) {
        if (strippedCache.has(relPath)) return strippedCache.get(relPath) ?? '';
        const absPath = resolve(PROJECT_ROOT, relPath);
        let source = '';
        try { source = stripComments(readFileSync(absPath, 'utf-8')); } catch { /* skip */ }
        strippedCache.set(relPath, source);
        return source;
    }

    // For each edge, check if the specifier only appears in comments
    for (const [relPath, entry] of resolvedFiles) {
        const typeOnlyImporters = [];
        for (const importer of entry.importedBy) {
            const specifier = edgeSpecifiers.get(`${relPath}\0${importer}`);
            if (!specifier) continue;

            const stripped = getStrippedSource(importer);
            // Check if the specifier appears in the comment-stripped source
            if (!stripped.includes(specifier)) {
                typeOnlyImporters.push(importer);
            }
        }
        for (const importer of typeOnlyImporters) {
            entry.importedBy.delete(importer);
        }
    }

    // Remove files that are no longer reachable from any entry point
    const reachable = new Set(entryPointRelPaths);
    let changed = true;
    while (changed) {
        changed = false;
        for (const [relPath, entry] of resolvedFiles) {
            if (reachable.has(relPath)) continue;
            for (const importer of entry.importedBy) {
                if (reachable.has(importer)) {
                    reachable.add(relPath);
                    changed = true;
                    break;
                }
            }
        }
    }
    for (const relPath of [...resolvedFiles.keys()]) {
        if (!reachable.has(relPath)) {
            resolvedFiles.delete(relPath);
        }
    }
}

// ---------------------------------------------------------------------------
// Phase 3: Scan for dynamic imports
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   file: string,
 *   line: number,
 *   specifier: string,
 *   resolvedPath: string | null,
 *   hasFallback: boolean,
 * }} DynamicImport
 */

/** @type {DynamicImport[]} */
const dynamicImports = [];

if (scanDynamic) {
    // Scan all resolved project files for dynamic import() patterns
    const filesToScan = new Set([...resolvedFiles.keys()]);
    // Also scan entry points (they're already in resolvedFiles but just to be safe)
    for (const ep of resolvedEntryPoints) {
        filesToScan.add(relative(PROJECT_ROOT, ep));
    }

    const importPattern = /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

    for (const relPath of filesToScan) {
        const absPath = resolve(PROJECT_ROOT, relPath);
        if (!existsSync(absPath)) continue;

        let content;
        try { content = readFileSync(absPath, 'utf-8'); } catch { continue; }

        const fileLines = content.split('\n');
        for (let i = 0; i < fileLines.length; i++) {
            const fileLine = fileLines[i];
            let match;
            importPattern.lastIndex = 0;
            while ((match = importPattern.exec(fileLine)) !== null) {
                const specifier = match[1];
                // Skip bare specifiers (packages like 'pako', 'pdf-lib')
                const isRelative = specifier.startsWith('./') || specifier.startsWith('../');

                let resolvedPath = null;
                if (isRelative) {
                    const candidate = resolve(dirname(absPath), specifier);
                    resolvedPath = relative(PROJECT_ROOT, candidate);
                }

                // Check if the import is inside a try/catch (simple heuristic)
                const contextStart = Math.max(0, i - 5);
                const context = fileLines.slice(contextStart, i + 1).join('\n');
                const hasFallback = /try\s*\{/.test(context) || /catch\s*[\({]/.test(context)
                    || /\.catch\s*\(/.test(fileLine);

                dynamicImports.push({
                    file: relPath,
                    line: i + 1,
                    specifier,
                    resolvedPath,
                    hasFallback,
                });
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Phase 4: Report
// ---------------------------------------------------------------------------

// Apply filter
const filteredFiles = filterPrefix
    ? new Map([...resolvedFiles].filter(([path]) => path.startsWith(filterPrefix)))
    : resolvedFiles;

// Separate by category

/** @type {string[]} */
const projectFiles = [];
for (const [relPath] of filteredFiles) {
    projectFiles.push(relPath);
}
projectFiles.sort();

console.log(`\nDependency trace from ${entryPoints.length} entry point(s):`);
for (const ep of entryPoints) {
    console.log(`  ${ep}`);
}
console.log('');

if (showTree) {
    // Tree view — top-down from entry points showing what each file imports.
    // Build forward edges: importer -> Set<imported>
    /** @type {Map<string, Set<string>>} */
    const forwardEdges = new Map();
    for (const [relPath, entry] of resolvedFiles) {
        for (const importer of entry.importedBy) {
            if (!forwardEdges.has(importer)) forwardEdges.set(importer, new Set());
            forwardEdges.get(importer)?.add(relPath);
        }
    }

    console.log('Static dependencies (tree):\n');

    /** @type {Set<string>} */
    const visited = new Set();

    /**
     * @param {string} file
     * @param {string} prefix
     * @param {boolean} isLast
     */
    function printTree(file, prefix, isLast) {
        const connector = prefix === '' ? '' : (isLast ? '└── ' : '├── ');
        const childPrefix = prefix === '' ? '  ' : prefix + (isLast ? '    ' : '│   ');

        // Apply filter — skip files outside the filter prefix but still recurse
        const passesFilter = !filterPrefix || file.startsWith(filterPrefix);

        if (visited.has(file)) {
            if (passesFilter) console.log(`${prefix}${connector}${file} (cycle)`);
            return;
        }
        visited.add(file);

        if (passesFilter) console.log(`${prefix}${connector}${file}`);

        const children = forwardEdges.get(file);
        if (!children) return;
        const sorted = [...children].sort();
        for (let i = 0; i < sorted.length; i++) {
            printTree(sorted[i], passesFilter ? childPrefix : prefix, i === sorted.length - 1);
        }
    }

    for (const epRel of entryPointRelPaths) {
        printTree(epRel, '', true);
    }
} else {
    // Flat list grouped by directory
    console.log('Static dependencies:\n');

    /** @type {Map<string, string[]>} */
    const byDir = new Map();
    for (const relPath of projectFiles) {
        const dir = dirname(relPath);
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir)?.push(relPath);
    }

    for (const [dir, files] of [...byDir].sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`  ${dir}/`);
        for (const file of files) {
            const isEntry = entryPointRelPaths.has(file);
            console.log(`    ${file.slice(dir.length + 1)}${isEntry ? ' [entry]' : ''}`);
        }
    }
}

console.log(`\n  Total: ${projectFiles.length} project file(s)\n`);

// Dynamic imports — deduplicated by file + specifier
if (scanDynamic && dynamicImports.length > 0) {
    /** @type {Map<string, { specifier: string, resolvedPath: string | null, hasFallback: boolean, lines: number[] }>} */
    const uniqueDynamic = new Map();
    for (const di of dynamicImports) {
        const key = `${di.file}\0${di.specifier}`;
        const existing = uniqueDynamic.get(key);
        if (existing) {
            existing.lines.push(di.line);
            if (di.hasFallback) existing.hasFallback = true;
        } else {
            uniqueDynamic.set(key, {
                specifier: di.specifier,
                resolvedPath: di.resolvedPath,
                hasFallback: di.hasFallback,
                lines: [di.line],
            });
        }
    }

    /** @type {Map<string, typeof uniqueDynamic>} */
    const byFile = new Map();
    for (const [key, info] of uniqueDynamic) {
        const file = key.split('\0')[0];
        if (!byFile.has(file)) byFile.set(file, new Map());
        byFile.get(file)?.set(key, info);
    }

    console.log('Dynamic imports found:\n');
    for (const [file, imports] of [...byFile].sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`  ${file}`);
        for (const [, info] of imports) {
            const fallback = info.hasFallback ? ' [fallback]' : '';
            const resolved = info.resolvedPath ? ` -> ${info.resolvedPath}` : '';
            console.log(`    import('${info.specifier}')${resolved}${fallback}`);
        }
    }
    console.log(`\n  Total: ${uniqueDynamic.size} unique dynamic import(s)\n`);
} else if (scanDynamic) {
    console.log('No dynamic imports found.\n');
}
