#!/usr/bin/env node
// @ts-check
/**
 * Debug runner for the RGB-output-intent sourceProfile loss regression.
 *
 * Drives the generator with:
 *   - A user-specified RGB output profile
 *   - A user-specified subset of layouts (default: 6 small layouts)
 *
 * Relies on DEBUG trace points added in:
 *   - pdf-document-color-converter.js  (trace-1 #getImageColorSpaceInfo)
 *   - pdf-image-color-converter.js     (trace-2 prepareWorkerTask)
 *   - worker-pool-entrypoint.js        (trace-3 processImage-preConvert)
 *
 * Also benefits from enriched error logging + worker-level uncaught-error
 * hooks in worker-pool-entrypoint.js (stack + task context for every throw).
 *
 * Usage:
 *   node testing/iso/ptf/2026/experiments/scripts/debug-rgb-profile-loss.mjs \
 *        --profile-path=temp/FIPS_WIDE_28T-TYPEavg.icc
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runGenerator } from './generator-run.mjs';

const { values: args } = parseArgs({
    options: {
        'profile-path': { type: 'string' },
        'port':         { type: 'string', default: '80' },
        'headed':       { type: 'boolean', default: false },
        'out-dir':      { type: 'string' },
        'layouts':      { type: 'string', multiple: true },
    },
    strict: true,
    allowPositionals: false,
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, '../../../../..');

const profilePath = args['profile-path'];
if (!profilePath) {
    console.error('Missing required --profile-path');
    process.exit(2);
}

const outputDir = args['out-dir']
    ? path.resolve(process.cwd(), args['out-dir'])
    : path.join(WORKSPACE, 'temp', 'debug-rgb-170');

const enabledLayoutNames = args.layouts && args.layouts.length > 0
    ? args.layouts
    : [
        'P-31 Interlaken Map',
        'P-32 Interlaken Aerial',
        'P-40 Type Sizes',
        'P-45 Lissajou',
        'P-CR21-1 ConRes TV25 vs TV75',
        'P-CR21-2 ConRes CR21 vs CR20',
    ];

await mkdir(outputDir, { recursive: true });

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Debug RGB Profile Loss');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Profile:  ${profilePath}`);
console.log(`  Layouts:  ${enabledLayoutNames.length} — ${enabledLayoutNames.join(', ')}`);
console.log(`  Port:     ${args.port}`);
console.log(`  Headed:   ${args.headed}`);
console.log(`  Out dir:  ${outputDir}`);
console.log('═══════════════════════════════════════════════════════════════');

const fingerprint = await runGenerator({
    browserName: 'chromium',
    outputDir,
    port: args.port,
    headed: args.headed,
    profilePath,
    enabledLayoutNames,
});

await writeFile(
    path.join(outputDir, 'fingerprint.json'),
    JSON.stringify(fingerprint, null, 2),
);

console.log('\nDone. Inspect:');
console.log(`  Logs:        ${path.join(outputDir, 'chromium.log')}`);
console.log(`  Fingerprint: ${path.join(outputDir, 'fingerprint.json')}`);
