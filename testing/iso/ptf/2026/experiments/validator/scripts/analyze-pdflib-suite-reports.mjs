#!/usr/bin/env node
// @ts-check
/**
 * Analyze Acrobat preflight reports for the pdf-lib validation suite.
 * Matches by display_name (not rule ID — those are profile-specific).
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

const SUITE_DIR = 'pdf-lib-validation-suite';

const files = (await readdir(SUITE_DIR)).filter(f => f.endsWith('_report.xml')).sort();

// Expected findings per test case — by display name substring, not rule ID
const expected = {
    'pg-01-no-trimbox': ['TrimBox or ArtBox'],
    'pg-02-both-trimbox-artbox': ['TrimBox and ArtBox'],
    'pg-03-no-mediabox': ['MediaBox'],
    'pg-04-bad-nesting': ['boxes not nested', 'Page boxes'],
    'ds-01-no-doc-id': ['Document ID'],
    'ds-05-has-javascript': ['JavaScript'],
    'ds-06-encrypted': [],
    'xm-01-no-xmp': ['Metadata missing'],
    'xm-02-xmp-present': [],
    'oi-01-no-output-intent': ['OutputIntent'],
    'oi-02-bare-icc-stream': [],
    'oi-03-proper-icc-stream': [],
    'oc-01-ocg-no-name': ['optional content group', 'OCG', 'name'],
    'oc-02-occd-no-name': ['optional content configuration', 'Name entry'],
    'fn-01-unembedded-font': ['Font not embedded', 'font'],
    'fn-02-widths-mismatch': ['Widths', 'width'],
    'cs-01-unknown-operator': ['Unknown operator', 'operator', 'command'],
    'cs-02-deeply-nested-q': ['nested', 'graphic state'],
    'mr-01-missing-xobject': ['Missing XObject', 'missing', 'XObject'],
    'mr-02-missing-font': ['Missing font', 'font'],
    'mr-03-missing-extgstate': ['Missing', 'ExtGState', 'Graphic State'],
    'fx-01-no-bbox': ['BBox'],
};

/**
 * @param {string} xml
 * @returns {{ ruleId: string, displayName: string, hitCount: number }[]}
 */
function extractHits(xml) {
    const hits = [];
    const hitsRegex = /<hits\s+rule_id="(RUL\d+)"\s+severity="(\w+)">([\s\S]*?)<\/hits>/g;
    let match;
    while ((match = hitsRegex.exec(xml))) {
        const ruleId = match[1];
        const hitCount = (match[3].match(/<hit\s/g) ?? []).length;
        const ruleDefRegex = new RegExp(`<rule\\s+id="${ruleId}"[^>]*>\\s*<display_name>([^<]*)<\\/display_name>`);
        const nameMatch = xml.match(ruleDefRegex);
        const displayName = (nameMatch?.[1] ?? ruleId).replace(/&apos;/g, "'").replace(/&amp;/g, '&');
        hits.push({ ruleId, displayName, hitCount });
    }
    return hits;
}

// Collect all results
/** @type {Map<string, { ruleId: string, displayName: string, hitCount: number }[]>} */
const allResults = new Map();

for (const file of files) {
    const xml = await readFile(join(SUITE_DIR, file), 'utf-8');
    const testId = file.replace('_report.xml', '');
    allResults.set(testId, extractHits(xml));
}

// Identify baseline errors from control cases
const controlCases = ['oi-03-proper-icc-stream', 'ds-06-encrypted'];
const baselineNames = new Set();
for (const ctrl of controlCases) {
    const hits = allResults.get(ctrl);
    if (hits) for (const h of hits) baselineNames.add(h.displayName);
}

console.log('# pdf-lib Validation Suite — Acrobat Preflight Analysis\n');
console.log('## Baseline Errors (present in all minimal pdf-lib PDFs)\n');
for (const name of [...baselineNames].sort()) console.log(`- ${name}`);

console.log('\n## Per-Test Results\n');

for (const [testId, hits] of [...allResults.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const expectedPatterns = expected[testId] ?? [];
    const nonBaseline = hits.filter(h => !baselineNames.has(h.displayName));
    const isControl = expectedPatterns.length === 0;

    // Check if expected patterns appear in ANY hit (baseline or not)
    const matchedExpected = [];
    const unmatchedExpected = [];
    for (const pattern of expectedPatterns) {
        const found = hits.some(h => h.displayName.toLowerCase().includes(pattern.toLowerCase()));
        if (found) matchedExpected.push(pattern);
        else unmatchedExpected.push(pattern);
    }

    // Determine status
    let status;
    if (isControl && nonBaseline.length === 0) {
        status = 'CONTROL — baseline only';
    } else if (isControl && nonBaseline.length > 0) {
        status = 'CONTROL + EXTRAS';
    } else if (matchedExpected.length > 0 && unmatchedExpected.length === 0) {
        status = 'CONFIRMED';
    } else if (matchedExpected.length > 0 && unmatchedExpected.length > 0) {
        status = 'PARTIAL';
    } else {
        status = 'NOT DETECTED';
    }

    console.log(`### ${testId} — ${status}`);
    if (expectedPatterns.length > 0) {
        console.log(`  Expected: ${expectedPatterns.join(' + ')}`);
        if (matchedExpected.length > 0) console.log(`  Matched: ${matchedExpected.join(', ')}`);
        if (unmatchedExpected.length > 0) console.log(`  Unmatched: ${unmatchedExpected.join(', ')}`);
    }
    if (nonBaseline.length > 0) {
        console.log(`  Non-baseline hits:`);
        for (const h of nonBaseline) console.log(`    ${h.ruleId}: ${h.displayName} (${h.hitCount}x)`);
    } else if (!isControl) {
        console.log(`  Only baseline errors found`);
    }
    console.log();
}

// Summary
let confirmed = 0, partial = 0, notDetected = 0, control = 0;
for (const [testId, hits] of allResults) {
    const ep = expected[testId] ?? [];
    if (ep.length === 0) { control++; continue; }
    const matched = ep.filter(p => hits.some(h => h.displayName.toLowerCase().includes(p.toLowerCase())));
    if (matched.length === ep.length) confirmed++;
    else if (matched.length > 0) partial++;
    else notDetected++;
}
console.log('## Summary\n');
console.log(`- Confirmed: ${confirmed}`);
console.log(`- Partial: ${partial}`);
console.log(`- Not detected by Acrobat: ${notDetected}`);
console.log(`- Control cases: ${control}`);
console.log(`- Not testable: ds-02, ds-03, ds-04 (load failures), fx-02 (Acrobat crash)`);
