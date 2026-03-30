#!/usr/bin/env node
// @ts-check
/**
 * Compare preflight reports between original and fixed PDFs from validator tests.
 * Shows what was fixed, what remains, and what was introduced.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';

const TEST_DIR = process.argv[2] || join('..', '..', '..', '..', '..', '..', 'temp', 'Validator Tests');

const files = await readdir(TEST_DIR);
const xmlFiles = files.filter(f => f.endsWith('.xml')).sort();

/**
 * @param {string} xml
 * @returns {{ hits: Map<string, { ruleId: string, displayName: string, hitCount: number }>, profile: string }}
 */
function parseReport(xml) {
    const hits = new Map();
    const profileMatch = xml.match(/<profile_name>([^<]+)<\/profile_name>/);
    const profile = profileMatch?.[1] ?? 'unknown';

    const hitsRegex = /<hits\s+rule_id="(RUL\d+)"\s+severity="(\w+)">([\s\S]*?)<\/hits>/g;
    let match;
    while ((match = hitsRegex.exec(xml))) {
        const ruleId = match[1];
        const hitCount = (match[3].match(/<hit\s/g) ?? []).length;
        const ruleDefRegex = new RegExp(`<rule\\s+id="${ruleId}"[^>]*>\\s*<display_name>([^<]*)<\\/display_name>`);
        const nameMatch = xml.match(ruleDefRegex);
        const displayName = (nameMatch?.[1] ?? ruleId).replace(/&apos;/g, "'").replace(/&amp;/g, '&');
        hits.set(ruleId, { ruleId, displayName, hitCount });
    }
    return { hits, profile };
}

// Group by base name (before " - Fixed")
/** @type {Map<string, { original?: string, fixed?: string }>} */
const pairs = new Map();

for (const f of xmlFiles) {
    const isFixed = f.includes(' - Fixed');
    const baseName = isFixed
        ? f.replace(/ - Fixed[^.]*\.xml$/, '')
        : f.replace(/\.xml$/, '');

    if (!pairs.has(baseName)) pairs.set(baseName, {});
    const pair = pairs.get(baseName);
    if (isFixed) pair.fixed = f;
    else pair.original = f;
}

for (const [baseName, { original, fixed }] of pairs) {
    console.log('\n' + '='.repeat(100));
    console.log(`BASE: ${baseName}`);
    console.log('='.repeat(100));

    if (original) {
        const xml = await readFile(join(TEST_DIR, original), 'utf-8');
        const { hits, profile } = parseReport(xml);
        console.log(`\nORIGINAL (${profile}):`);
        for (const [, h] of [...hits.entries()].sort((a, b) => b[1].hitCount - a[1].hitCount)) {
            console.log(`  ${h.ruleId}: ${h.displayName} (${h.hitCount}x)`);
        }
        console.log(`  Total: ${hits.size} rules, ${[...hits.values()].reduce((s, h) => s + h.hitCount, 0)} hits`);

        if (fixed) {
            const fixedXml = await readFile(join(TEST_DIR, fixed), 'utf-8');
            const fixedParsed = parseReport(fixedXml);

            console.log(`\nFIXED (${fixedParsed.profile}):`);
            for (const [, h] of [...fixedParsed.hits.entries()].sort((a, b) => b[1].hitCount - a[1].hitCount)) {
                console.log(`  ${h.ruleId}: ${h.displayName} (${h.hitCount}x)`);
            }
            console.log(`  Total: ${fixedParsed.hits.size} rules, ${[...fixedParsed.hits.values()].reduce((s, h) => s + h.hitCount, 0)} hits`);

            // Delta
            console.log('\nDELTA:');
            for (const [ruleId, h] of hits) {
                if (!fixedParsed.hits.has(ruleId)) {
                    console.log(`  FIXED:      ${ruleId}: ${h.displayName} (was ${h.hitCount}x)`);
                } else {
                    const fh = fixedParsed.hits.get(ruleId);
                    if (fh.hitCount !== h.hitCount) {
                        console.log(`  CHANGED:    ${ruleId}: ${h.displayName} (${h.hitCount}x → ${fh.hitCount}x)`);
                    }
                }
            }
            for (const [ruleId, h] of fixedParsed.hits) {
                if (!hits.has(ruleId)) {
                    console.log(`  INTRODUCED: ${ruleId}: ${h.displayName} (${h.hitCount}x)`);
                }
            }
        }
    } else if (fixed) {
        const fixedXml = await readFile(join(TEST_DIR, fixed), 'utf-8');
        const fixedParsed = parseReport(fixedXml);
        console.log(`\nFIXED ONLY (${fixedParsed.profile}):`);
        for (const [, h] of [...fixedParsed.hits.entries()].sort((a, b) => b[1].hitCount - a[1].hitCount)) {
            console.log(`  ${h.ruleId}: ${h.displayName} (${h.hitCount}x)`);
        }
    }
}
