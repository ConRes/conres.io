#!/usr/bin/env node
// @ts-check
/**
 * Compare PDF/X-4 XML preflight reports across test variants.
 * Finds report XMLs next to PDFs in variant folders.
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
 * @param {string} xml
 * @returns {{ profile: string, hits: Map<string, { ruleId: string, severity: string, displayName: string, hitCount: number }> }}
 */
function parseReport(xml) {
    const hits = new Map();
    const profileMatch = xml.match(/<profile_name>([^<]+)<\/profile_name>/);
    const profile = profileMatch?.[1] ?? 'unknown';

    const hitsRegex = /<hits\s+rule_id="(RUL\d+)"\s+severity="(\w+)">([\s\S]*?)<\/hits>/g;
    let match;
    while ((match = hitsRegex.exec(xml))) {
        const ruleId = match[1];
        const severity = match[2];
        const hitCount = (match[3].match(/<hit\s/g) ?? []).length;

        const ruleDefRegex = new RegExp(`<rule\\s+id="${ruleId}"[^>]*>\\s*<display_name>([^<]*)<\\/display_name>`);
        const nameMatch = xml.match(ruleDefRegex);
        const displayName = nameMatch?.[1] ?? ruleId;

        hits.set(ruleId, { ruleId, severity, displayName, hitCount });
    }
    return { profile, hits };
}

/** @type {Map<string, ReturnType<typeof parseReport>>} */
const reports = new Map();

for (const folder of folders) {
    const files = await readdir(join(ROOT, folder.name));
    const reportFile = files.find(f => f.endsWith('_report.xml'));
    if (!reportFile) continue;

    const xml = await readFile(join(ROOT, folder.name, reportFile), 'utf-8');
    const variantNum = folder.name.slice(0, 2);
    reports.set(variantNum, parseReport(xml));
}

const variantNums = [...reports.keys()].sort();
const allRuleIds = new Set();
for (const [, report] of reports) for (const ruleId of report.hits.keys()) allRuleIds.add(ruleId);

const sortedRuleIds = [...allRuleIds].sort((a, b) =>
    parseInt(a.replace('RUL', '')) - parseInt(b.replace('RUL', ''))
);

console.log(`Profile: ${reports.get(variantNums[0])?.profile}\n`);
console.log(`${'Rule'.padEnd(8)} ${'Display Name'.padEnd(62)} ${variantNums.map(v => v.padStart(5)).join(' ')}`);
console.log('-'.repeat(8) + ' ' + '-'.repeat(62) + ' ' + variantNums.map(() => '-----').join(' '));

for (const ruleId of sortedRuleIds) {
    let displayName = ruleId;
    for (const [, report] of reports) {
        const hit = report.hits.get(ruleId);
        if (hit?.displayName && hit.displayName !== ruleId) { displayName = hit.displayName; break; }
    }
    const truncName = displayName.length > 60 ? displayName.slice(0, 57) + '...' : displayName;
    const cells = variantNums.map(v => {
        const hit = reports.get(v)?.hits.get(ruleId);
        if (!hit) return '  .  ';
        return hit.hitCount > 1 ? String(hit.hitCount).padStart(3) + 'x ' : '  X  ';
    });
    console.log(`${ruleId.padEnd(8)} ${truncName.padEnd(62)} ${cells.join(' ')}`);
}

// Delta from baseline
const baseline = reports.get('00');
if (baseline) {
    console.log('\nDELTA FROM BASELINE (00)');
    console.log('-'.repeat(100));
    for (const v of variantNums) {
        if (v === '00') continue;
        const report = reports.get(v);
        if (!report) continue;
        const fixed = [];
        const added = [];
        for (const [ruleId, hit] of baseline.hits) {
            if (!report.hits.has(ruleId)) fixed.push(`  FIXED: ${ruleId} — ${hit.displayName}`);
        }
        for (const [ruleId, hit] of report.hits) {
            if (!baseline.hits.has(ruleId)) added.push(`  NEW:   ${ruleId} — ${hit.displayName}`);
        }
        console.log(`\n${v}:`);
        if (!fixed.length && !added.length) console.log('  No change');
        for (const l of fixed) console.log(l);
        for (const l of added) console.log(l);
    }
}
