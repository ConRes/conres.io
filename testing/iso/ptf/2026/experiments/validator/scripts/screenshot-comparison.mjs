#!/usr/bin/env node
// @ts-check
/**
 * Take screenshots of generator and validator for visual comparison.
 * Saves to /tmp/ for quick review.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { chromium } from 'playwright-chromium';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
    args: process.argv.slice(2).filter(a => a.length > 0),
    strict: true,
    options: {
        'output': { type: 'string', short: 'o', default: '/tmp' },
        'port': { type: 'string', short: 'p', default: '8080' },
        'docket': { type: 'string', short: 'd' },
        'help': { type: 'boolean', short: 'h' },
    },
});

if (values.help) {
    console.log('Usage: node screenshot-comparison.mjs [--output /tmp] [--port 8080] [--docket path/to/docket.pdf]');
    process.exit(0);
}

const BASE_URL = `http://localhost:${values.port}`;
const OUTPUT = values.output;
const DOCKET = values.docket || '/Users/daflair/Projects/conres/conres.io/temp/Generator Tests/2026-03-30 - ConRes - ISO PTF - CR1 (F10a) Assets - Canon iPR C10000VP series Coated MGCR v1.2 - Docket.pdf';

const browser = await chromium.launch({ headless: true });

try {
    // Generator
    console.log('Taking generator screenshot...');
    const genPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await genPage.goto(`${BASE_URL}/testing/iso/ptf/2026/generator/index.html`);
    await genPage.waitForTimeout(1000);
    await genPage.screenshot({ path: `${OUTPUT}/generator-current.png`, fullPage: true });
    console.log(`  → ${OUTPUT}/generator-current.png`);
    await genPage.close();

    // Validator empty state
    console.log('Taking validator empty screenshot...');
    const valPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await valPage.goto(`${BASE_URL}/testing/iso/ptf/2026/validator/index.html`);
    await valPage.waitForTimeout(1000);
    await valPage.screenshot({ path: `${OUTPUT}/validator-empty.png`, fullPage: true });
    console.log(`  → ${OUTPUT}/validator-empty.png`);

    // Validator with loaded PDF
    console.log('Loading docket PDF and validating...');
    await valPage.click('#debugging-details summary');
    await valPage.uncheck('#bootstrap-worker-checkbox');
    await (await valPage.$('#pdf-input')).setInputFiles(DOCKET);
    await valPage.click('#validate-button');
    await valPage.waitForSelector('#summary-fieldset:not([hidden])', { timeout: 30000 });
    await valPage.waitForTimeout(500);
    await valPage.screenshot({ path: `${OUTPUT}/validator-report.png`, fullPage: true });
    console.log(`  → ${OUTPUT}/validator-report.png`);

    // After fix
    console.log('Applying fixes...');
    await valPage.click('#fix-all-button');
    await valPage.waitForSelector('#changelog-fieldset:not([hidden])', { timeout: 30000 });
    await valPage.waitForTimeout(500);
    await valPage.screenshot({ path: `${OUTPUT}/validator-fixed.png`, fullPage: true });
    console.log(`  → ${OUTPUT}/validator-fixed.png`);

    await valPage.close();
} finally {
    await browser.close();
}

console.log('\nDone. Review screenshots:');
console.log(`  open ${OUTPUT}/generator-current.png`);
console.log(`  open ${OUTPUT}/validator-empty.png`);
console.log(`  open ${OUTPUT}/validator-report.png`);
console.log(`  open ${OUTPUT}/validator-fixed.png`);
