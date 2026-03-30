#!/usr/bin/env node
// @ts-check
/**
 * Extract all PDF/X-4 rules from the most comprehensive preflight report XML
 * and classify each by: category, checkability, fixability, relevance to our generator.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFile } from 'fs/promises';

// Use the report with the most errors (2026 K-Only GCR full PDF)
const REPORT_PATH = '2026-03-30 - ConRes - ISO PTF - CR1 (F10a) Assets - Canon iPR C10000VP series Coated MGCR v1.2 - K-Only GCR with Blackpoint Compensation - Report.xml';

const xml = await readFile(REPORT_PATH, 'utf-8');

// Extract all rule definitions
const ruleRegex = /<rule\s+id="(RUL\d+)"\s+creator_id="[^"]*"\s+dict_key="([^"]*)">\s*<display_name>([^<]*)<\/display_name>\s*<display_comment>([^<]*)<\/display_comment>/g;

/** @type {{ id: string, dictKey: string, displayName: string, comment: string }[]} */
const rules = [];
let match;
while ((match = ruleRegex.exec(xml))) {
    rules.push({
        id: match[1],
        dictKey: match[2],
        displayName: match[3],
        comment: match[4].replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
    });
}

// Extract which ruleset each rule belongs to (RS1 = PDF/X-4p profile, RS2 = syntax checks)
const rulesetRegex = /<rule\s+id="(RUL\d+)"[\s\S]*?<ruleset\s+ruleset_id="(RS\d+)">\s*<severity>(\w+)<\/severity>/g;
/** @type {Map<string, { ruleset: string, severity: string }>} */
const rulesetMap = new Map();
while ((match = rulesetRegex.exec(xml))) {
    rulesetMap.set(match[1], { ruleset: match[2], severity: match[3] });
}

// Extract conditions associated with each rule
const conditionRegex = /<condition\s+id="(CND\d+)"\s+creator_id="[^"]*"\s+property_key="([^"]*)">/g;
/** @type {Map<string, string>} */
const conditionProperties = new Map();
while ((match = conditionRegex.exec(xml))) {
    conditionProperties.set(match[1], match[2]);
}

// Map rules to their conditions
const ruleCondRegex = /<condition\s+id="(CND\d+)"[^>]*>[\s\S]*?<rules>([\s\S]*?)<\/rules>/g;
/** @type {Map<string, Set<string>>} */
const ruleToConditions = new Map();
while ((match = ruleCondRegex.exec(xml))) {
    const condId = match[1];
    const rulesBlock = match[2];
    const ruleRefs = rulesBlock.matchAll(/<rule\s+id="(RUL\d+)">/g);
    for (const ref of ruleRefs) {
        if (!ruleToConditions.has(ref[1])) ruleToConditions.set(ref[1], new Set());
        ruleToConditions.get(ref[1]).add(condId);
    }
}

// Categorize by property key prefix
function categorize(propertyKeys) {
    const keys = [...propertyKeys];
    if (keys.some(k => k.startsWith('PAGE::HasTrimBox') || k.startsWith('PAGE::HasArtBox') || k.includes('BleedBox') || k.includes('CropBox'))) return 'Page Geometry';
    if (keys.some(k => k.startsWith('OUTINTENTS::') || k.includes('OutputIntent') || k.includes('DOPR'))) return 'Output Intent';
    if (keys.some(k => k.startsWith('CSCOLOR::') || k.includes('ColorSpace') || k.includes('DeviceCMYK') || k.includes('DeviceRGB') || k.includes('DeviceGray'))) return 'Color Space';
    if (keys.some(k => k.startsWith('CSIMAGE::') || k.includes('Image'))) return 'Image';
    if (keys.some(k => k.startsWith('FONT::') || k.startsWith('FNT') || k.includes('Font') || k.includes('font'))) return 'Font';
    if (keys.some(k => k.startsWith('DOCXMP::') || k.startsWith('DOC::HasXMP') || k.includes('XMP') || k.includes('Metadata'))) return 'XMP Metadata';
    if (keys.some(k => k.startsWith('DOCINFO::') || k.includes('DocInfo'))) return 'Document Info';
    if (keys.some(k => k.startsWith('DOC::') || k.includes('Document'))) return 'Document Structure';
    if (keys.some(k => k.includes('OCG') || k.includes('OptionalContent') || k.includes('Layer'))) return 'Optional Content';
    if (keys.some(k => k.startsWith('ANNOT::') || k.includes('Annot'))) return 'Annotations';
    if (keys.some(k => k.startsWith('ACROFORM::') || k.includes('Form'))) return 'Form Fields';
    if (keys.some(k => k.includes('Transparency') || k.includes('BlendMode') || k.includes('TransGrp'))) return 'Transparency';
    if (keys.some(k => k.startsWith('PAGE::'))) return 'Page Structure';
    if (keys.some(k => k.includes('Encrypt') || k.includes('Security'))) return 'Security';
    if (keys.some(k => k.includes('Syntax') || k.includes('Stream') || k.includes('Indirect'))) return 'Syntax';
    return 'Other';
}

// Output as markdown table
console.log('| Rule | Category | Display Name | Conditions |');
console.log('|------|----------|-------------|------------|');

const sorted = rules.sort((a, b) => {
    const numA = parseInt(a.id.replace('RUL', ''));
    const numB = parseInt(b.id.replace('RUL', ''));
    return numA - numB;
});

for (const rule of sorted) {
    const conditions = ruleToConditions.get(rule.id) ?? new Set();
    const propertyKeys = new Set();
    for (const condId of conditions) {
        const pk = conditionProperties.get(condId);
        if (pk) propertyKeys.add(pk);
    }
    const category = categorize(propertyKeys);
    const condStr = [...propertyKeys].join(', ');

    const name = rule.displayName.length > 70 ? rule.displayName.slice(0, 67) + '...' : rule.displayName;
    console.log(`| ${rule.id} | ${category} | ${name} | ${condStr} |`);
}

// Summary by category
console.log('\n\n## Summary by Category\n');
const categoryCounts = new Map();
for (const rule of sorted) {
    const conditions = ruleToConditions.get(rule.id) ?? new Set();
    const propertyKeys = new Set();
    for (const condId of conditions) {
        const pk = conditionProperties.get(condId);
        if (pk) propertyKeys.add(pk);
    }
    const category = categorize(propertyKeys);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
}

console.log('| Category | Count |');
console.log('|----------|-------|');
for (const [cat, count] of [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`| ${cat} | ${count} |`);
}
