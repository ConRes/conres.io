#!/usr/bin/env node
// @ts-check
/**
 * Compare preflight report text files across all test variants.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFile, readdir } from 'fs/promises';
import { resolve, join } from 'path';

const ROOT = '2026-03-29 - Test Form Generator - Tests - Compatibility 1A - Acrobat Legacy';

const folders = (await readdir(ROOT, { withFileTypes: true }))
    .filter(d => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

/** @type {Map<string, Map<string, Set<string>>>} */
const allErrors = new Map(); // variantName → Map<errorKey, Set<details>>

/** @type {Set<string>} */
const allErrorKeys = new Set();

for (const folder of folders) {
    const folderPath = join(ROOT, folder.name);
    const files = await readdir(folderPath);
    const reportFile = files.find(f => f.endsWith('_report.txt'));
    if (!reportFile) {
        console.error(`No report found in ${folder.name}`);
        continue;
    }

    const text = await readFile(join(folderPath, reportFile), 'utf-8');
    const errors = new Map();

    // Parse error lines — Acrobat preflight text reports have patterns like:
    // "Error: <description>" or lines following "Results" section
    const lines = text.split('\n');
    let inResults = false;
    let currentError = '';

    for (const line of lines) {
        const trimmed = line.trim();

        // Detect different preflight text report formats
        // Format: "  Error:  Description here"
        // Or: lines that start with specific error patterns
        if (/^\s*(Error|Warning|Info)\s*[:]/i.test(trimmed)) {
            const match = trimmed.match(/^\s*(Error|Warning|Info)\s*[:]\s*(.+)/i);
            if (match) {
                const severity = match[1];
                const description = match[2].trim();
                const key = `${severity}: ${description}`;
                allErrorKeys.add(key);
                if (!errors.has(key)) errors.set(key, new Set());
            }
        }

        // Also catch lines like "Page does not have TrimBox or ArtBox" etc.
        // that appear as standalone findings
        if (/^\s+\d+\s+/.test(line)) {
            // Numbered finding like "  1  Page does not have TrimBox..."
            const match = line.match(/^\s+\d+\s+(.+)/);
            if (match) {
                const desc = match[1].trim();
                if (desc && !desc.startsWith('Page') && !desc.match(/^\d/)) {
                    // Skip page references
                }
            }
        }
    }

    allErrors.set(folder.name, errors);
}

// If the simple parsing didn't find much, dump raw content for comparison
console.log('='.repeat(100));
console.log('PREFLIGHT REPORT COMPARISON');
console.log('='.repeat(100));

for (const folder of folders) {
    const folderPath = join(ROOT, folder.name);
    const files = await readdir(folderPath);
    const reportFile = files.find(f => f.endsWith('_report.txt'));
    if (!reportFile) continue;

    const text = await readFile(join(folderPath, reportFile), 'utf-8');

    console.log('\n' + '-'.repeat(100));
    console.log(`VARIANT: ${folder.name}`);
    console.log('-'.repeat(100));
    console.log(text);
}
