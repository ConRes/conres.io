#!/usr/bin/env node
import { readFile } from 'fs/promises';
import { argv } from 'process';

const jsonPath = argv.slice(2).find(a => a.endsWith('.json'));
if (!jsonPath) { console.log('Usage: node inspect-diagnostics.mjs <file.json>'); process.exit(1); }

const data = JSON.parse(await readFile(jsonPath, 'utf8'));

console.log('Top-level keys:', Object.keys(data));

if (data.spans) {
    console.log('Spans count:', data.spans.length);
    const names = [...new Set(data.spans.map(s => s.name))];
    console.log('Unique span names:', names);
    // Show first 3 spans
    for (const span of data.spans.slice(0, 3)) {
        console.log('Span:', JSON.stringify(span, null, 2).slice(0, 500));
    }
    // Show any span mentioning 'stream' or 'content'
    const streamSpans = data.spans.filter(s =>
        (s.name && (s.name.includes('stream') || s.name.includes('content'))) ||
        (s.attributes && Object.keys(s.attributes).some(k => k.includes('stream') || k.includes('content') || k.includes('replacement')))
    );
    console.log('\nStream/content related spans:', streamSpans.length);
    for (const s of streamSpans.slice(0, 5)) {
        console.log(JSON.stringify(s, null, 2).slice(0, 500));
    }
}

if (data.counters) {
    console.log('\nCounters:', JSON.stringify(data.counters, null, 2));
}
