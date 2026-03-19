#!/usr/bin/env node
// @ts-check
/**
 * Check diagnostics for content stream replacement counts.
 *
 * Usage: node check-diagnostics-replacements.mjs <diagnostics-a.json> <diagnostics-b.json>
 */
import { readFile } from 'fs/promises';
import { argv, exit } from 'process';
import { basename } from 'path';

const args = argv.slice(2).filter(arg => arg !== '');
const jsonPaths = args.filter(a => a.endsWith('.json'));

if (jsonPaths.length < 1) {
    console.log('Usage: node check-diagnostics-replacements.mjs <diagnostics-a.json> [diagnostics-b.json]');
    exit(1);
}

for (const jsonPath of jsonPaths) {
    const data = JSON.parse(await readFile(jsonPath, 'utf8'));
    const label = basename(jsonPath);
    console.log(`=== ${label} ===`);

    const spans = data.spans || [];

    // Find content stream related spans
    const parseSpans = spans.filter(s => s.name === 'parse');
    const convertSpans = spans.filter(s => s.name === 'convert');
    const rebuildSpans = spans.filter(s => s.name === 'rebuild');

    console.log(`  parse spans: ${parseSpans.length}`);
    for (const s of parseSpans) {
        const attrs = s.attributes || {};
        console.log(`    ref=${attrs.ref || '?'}, streamLength=${attrs.streamLength || '?'}, operations=${attrs.operations || '?'}`);
    }

    console.log(`  convert spans: ${convertSpans.length}`);
    for (const s of convertSpans) {
        const attrs = s.attributes || {};
        console.log(`    ref=${attrs.ref || '?'}, totalColors=${attrs.totalColors || '?'}, uniqueColors=${attrs.uniqueColors || '?'}, lookupTableSize=${attrs.lookupTableSize || '?'}`);
    }

    console.log(`  rebuild spans: ${rebuildSpans.length}`);
    for (const s of rebuildSpans) {
        const attrs = s.attributes || {};
        console.log(`    ref=${attrs.ref || '?'}, replacements=${attrs.replacements || '?'}, originalLength=${attrs.originalLength || '?'}, newLength=${attrs.newLength || '?'}`);
    }

    // Also look for any span that mentions replacements or content-stream
    const contentStreamRelated = spans.filter(s =>
        (s.name && s.name.includes('stream')) ||
        (s.attributes && (s.attributes.replacements !== undefined || s.attributes.replacementCount !== undefined))
    );
    if (contentStreamRelated.length > 0 && contentStreamRelated.length !== parseSpans.length + convertSpans.length + rebuildSpans.length) {
        console.log(`  Other content-stream related spans:`);
        for (const s of contentStreamRelated) {
            if (!['parse', 'convert', 'rebuild'].includes(s.name)) {
                console.log(`    ${s.name}: ${JSON.stringify(s.attributes)}`);
            }
        }
    }

    console.log('');
}
