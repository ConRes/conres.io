#!/usr/bin/env node
// @ts-check
/**
 * Extract and compare error summaries from preflight text reports.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

const ROOT = '2026-03-29 - Test Form Generator - Tests - Compatibility 1A - Acrobat Legacy';

const folders = (await readdir(ROOT, { withFileTypes: true }))
    .filter(d => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Extract unique top-level problem descriptions from a preflight text report.
 * These appear as indented lines under "Problems" → "Document" or "Page: N" sections.
 * @param {string} text
 * @returns {{ documentErrors: string[], pageErrors: Map<string, string[]>, profile: string }}
 */
function parseReport(text) {
    const lines = text.split('\n');
    const documentErrors = [];
    const pageErrors = new Map();
    let profile = '';
    let currentSection = '';
    let currentError = '';
    let indent = 0;

    for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed) continue;

        // Leading tab count determines hierarchy
        const tabCount = (line.match(/^\t*/)?.[0] ?? '').length;

        const profileMatch = trimmed.match(/Used profile:\s*"(.+)"/);
        if (profileMatch) {
            profile = profileMatch[1];
            continue;
        }

        // Section headers at tab level 2
        if (tabCount === 2 && !trimmed.match(/^\t*\t/)) {
            // This might be "Document" or "Page: N"
        }

        if (/^\t\tDocument\s*$/.test(line)) {
            currentSection = 'document';
            continue;
        }

        const pageMatch = line.match(/^\t\tPage:\s*(\d+)/);
        if (pageMatch) {
            currentSection = `page-${pageMatch[1]}`;
            continue;
        }

        // Error names are at tab level 3 (3 tabs)
        if (tabCount === 3 && currentSection) {
            currentError = trimmed.trim();
            if (currentSection === 'document') {
                if (!documentErrors.includes(currentError)) {
                    documentErrors.push(currentError);
                }
            } else {
                if (!pageErrors.has(currentSection)) pageErrors.set(currentSection, []);
                const arr = pageErrors.get(currentSection);
                if (!arr.includes(currentError)) arr.push(currentError);
            }
        }
    }

    return { documentErrors, pageErrors, profile };
}

/** @type {Map<string, ReturnType<typeof parseReport>>} */
const reports = new Map();

for (const folder of folders) {
    const files = await readdir(join(ROOT, folder.name));
    const reportFile = files.find(f => f.endsWith('_report.txt'));
    if (!reportFile) continue;
    const text = await readFile(join(ROOT, folder.name, reportFile), 'utf-8');
    reports.set(folder.name, parseReport(text));
}

// Get baseline errors
const baseline = reports.get('00 - Original Docket');
if (!baseline) { console.error('No baseline report found'); process.exit(1); }

console.log(`Preflight profile: ${baseline.profile}\n`);

// Collect all unique document-level errors across all variants
const allDocErrors = new Set();
for (const [, report] of reports) {
    for (const err of report.documentErrors) allDocErrors.add(err);
}

// Collect all unique page-level errors (from page-1 only, they repeat)
const allPageErrors = new Set();
for (const [, report] of reports) {
    const page1 = report.pageErrors.get('page-1') ?? [];
    for (const err of page1) allPageErrors.add(err);
}

// Print document-level comparison
console.log('DOCUMENT-LEVEL ERRORS');
console.log('='.repeat(120));

const variantNames = [...reports.keys()];
const shortNames = variantNames.map(n => n.slice(0, 2));

// Header
console.log(`${'Error'.padEnd(70)} ${shortNames.map(s => s.padStart(4)).join(' ')}`);
console.log('-'.repeat(70) + ' ' + shortNames.map(() => '----').join(' '));

for (const err of allDocErrors) {
    const cells = variantNames.map(name => {
        const report = reports.get(name);
        return report.documentErrors.includes(err) ? '  X ' : '  . ';
    });
    const displayErr = err.length > 68 ? err.slice(0, 65) + '...' : err;
    console.log(`${displayErr.padEnd(70)} ${cells.join(' ')}`);
}

// Print page-level comparison (page 1 only — they're the same per page)
console.log('\n\nPAGE-LEVEL ERRORS (Page 1)');
console.log('='.repeat(120));
console.log(`${'Error'.padEnd(70)} ${shortNames.map(s => s.padStart(4)).join(' ')}`);
console.log('-'.repeat(70) + ' ' + shortNames.map(() => '----').join(' '));

for (const err of allPageErrors) {
    const cells = variantNames.map(name => {
        const report = reports.get(name);
        const page1 = report.pageErrors.get('page-1') ?? [];
        return page1.includes(err) ? '  X ' : '  . ';
    });
    const displayErr = err.length > 68 ? err.slice(0, 65) + '...' : err;
    console.log(`${displayErr.padEnd(70)} ${cells.join(' ')}`);
}

// Summary counts
console.log('\n\nSUMMARY');
console.log('='.repeat(120));
for (const [name, report] of reports) {
    const pageErrorCount = [...report.pageErrors.values()].reduce((sum, arr) => sum + arr.length, 0);
    const uniquePageErrors = new Set();
    for (const [, arr] of report.pageErrors) for (const e of arr) uniquePageErrors.add(e);
    console.log(`${name}: ${report.documentErrors.length} document errors, ${uniquePageErrors.size} unique page errors (${report.pageErrors.size} pages with errors)`);
}
