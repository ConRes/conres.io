#!/usr/bin/env node
// @ts-check
/**
 * Unit tests for ContentStreamColorExtractor class.
 *
 * Tests:
 * 1. extractColors() - Extract color operations from PDF
 * 2. findMatchingColors() - Find colors matching a specification
 * 3. Helper methods - normalizeColorSpaceType, getDisplayColorspace, valuesMatchWithinTolerance
 */

import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { ContentStreamColorExtractor } from '../classes/content-stream-color-extractor.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../../tests/fixtures/pdfs');
const testPdf = path.join(fixturesDir, '2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log(`   PASS: ${message}`);
    } else {
        failed++;
        console.log(`   FAIL: ${message}`);
    }
}

console.log('Testing ContentStreamColorExtractor...\n');

// ============================================================================
// Test 1: Helper Methods - normalizeColorSpaceType
// ============================================================================

console.log('1. normalizeColorSpaceType()');
console.log('   ' + '-'.repeat(50));

assert(
    ContentStreamColorExtractor.normalizeColorSpaceType('Gray') === 'sGray',
    'Gray -> sGray'
);
assert(
    ContentStreamColorExtractor.normalizeColorSpaceType('DeviceGray') === 'sGray',
    'DeviceGray -> sGray'
);
assert(
    ContentStreamColorExtractor.normalizeColorSpaceType('RGB') === 'sRGB',
    'RGB -> sRGB'
);
assert(
    ContentStreamColorExtractor.normalizeColorSpaceType('DeviceRGB') === 'sRGB',
    'DeviceRGB -> sRGB'
);
assert(
    ContentStreamColorExtractor.normalizeColorSpaceType('CMYK') === 'CMYK',
    'CMYK -> CMYK'
);
assert(
    ContentStreamColorExtractor.normalizeColorSpaceType('DeviceCMYK') === 'CMYK',
    'DeviceCMYK -> CMYK'
);
assert(
    ContentStreamColorExtractor.normalizeColorSpaceType('Lab') === 'Lab',
    'Lab -> Lab'
);
assert(
    ContentStreamColorExtractor.normalizeColorSpaceType('Separation') === 'Separation',
    'Separation -> Separation'
);
assert(
    ContentStreamColorExtractor.normalizeColorSpaceType('CustomSpace') === 'CustomSpace',
    'CustomSpace -> CustomSpace (passthrough)'
);
console.log('');

// ============================================================================
// Test 2: Helper Methods - getDisplayColorspace
// ============================================================================

console.log('2. getDisplayColorspace()');
console.log('   ' + '-'.repeat(50));

assert(
    ContentStreamColorExtractor.getDisplayColorspace('sRGB') === 'ICCBasedRGB',
    'sRGB -> ICCBasedRGB'
);
assert(
    ContentStreamColorExtractor.getDisplayColorspace('sGray') === 'ICCBasedGray',
    'sGray -> ICCBasedGray'
);
assert(
    ContentStreamColorExtractor.getDisplayColorspace('CMYK') === 'ICCBasedCMYK',
    'CMYK -> ICCBasedCMYK'
);
assert(
    ContentStreamColorExtractor.getDisplayColorspace('Lab') === 'Lab',
    'Lab -> Lab'
);
assert(
    ContentStreamColorExtractor.getDisplayColorspace('Separation') === 'Separation',
    'Separation -> Separation'
);
assert(
    ContentStreamColorExtractor.getDisplayColorspace('') === 'Unknown',
    'empty -> Unknown'
);
console.log('');

// ============================================================================
// Test 3: Helper Methods - valuesMatchWithinTolerance
// ============================================================================

console.log('3. valuesMatchWithinTolerance()');
console.log('   ' + '-'.repeat(50));

assert(
    ContentStreamColorExtractor.valuesMatchWithinTolerance([0.5, 0.5], [0.5, 0.5], [0, 0]) === true,
    'Exact match with zero tolerance'
);
assert(
    ContentStreamColorExtractor.valuesMatchWithinTolerance([0.5, 0.5], [0.51, 0.49], [0.02, 0.02]) === true,
    'Match within tolerance'
);
assert(
    ContentStreamColorExtractor.valuesMatchWithinTolerance([0.5, 0.5], [0.6, 0.5], [0.05, 0.05]) === false,
    'Outside tolerance'
);
assert(
    ContentStreamColorExtractor.valuesMatchWithinTolerance([0.5], [0.5, 0.5], [0, 0]) === false,
    'Different lengths'
);
assert(
    ContentStreamColorExtractor.valuesMatchWithinTolerance([0.1, 0.2, 0.3, 0.4], [0.1, 0.2, 0.3, 0.4], [0, 0, 0, 0]) === true,
    'CMYK exact match'
);
assert(
    ContentStreamColorExtractor.valuesMatchWithinTolerance(
        [0.1, 0.2, 0.3, 0.4],
        [0.11, 0.21, 0.31, 0.41],
        [0.02, 0.02, 0.02, 0.02]
    ) === true,
    'CMYK within tolerance'
);
console.log('');

// ============================================================================
// Test 4: findMatchingColors
// ============================================================================

console.log('4. findMatchingColors()');
console.log('   ' + '-'.repeat(50));

/** @type {import('../classes/content-stream-color-extractor.mjs').ColorMatch[]} */
const testColors = [
    { pageNum: 1, streamIndex: 0, operatorIndex: 0, operator: 'g', colorspace: 'DeviceGray', values: [0.0], index: 0 },
    { pageNum: 1, streamIndex: 0, operatorIndex: 1, operator: 'g', colorspace: 'DeviceGray', values: [0.5], index: 10 },
    { pageNum: 1, streamIndex: 0, operatorIndex: 2, operator: 'rg', colorspace: 'DeviceRGB', values: [1.0, 0.0, 0.0], index: 20 },
    { pageNum: 1, streamIndex: 0, operatorIndex: 3, operator: 'k', colorspace: 'DeviceCMYK', values: [0.0, 0.0, 0.0, 1.0], index: 30 },
    { pageNum: 1, streamIndex: 0, operatorIndex: 4, operator: 'scn', colorspace: 'ICCBasedGray', values: [0.0], index: 40 },
    { pageNum: 2, streamIndex: 0, operatorIndex: 0, operator: 'g', colorspace: 'DeviceGray', values: [0.0], index: 0 },
];

// Test: Find DeviceGray 0.0
const grayMatches = ContentStreamColorExtractor.findMatchingColors(testColors, {
    colorspace: 'DeviceGray',
    values: [0.0],
});
assert(grayMatches.length === 2, `Found ${grayMatches.length} DeviceGray 0.0 matches (expected 2)`);
assert(grayMatches[0].pageNum === 1 && grayMatches[1].pageNum === 2, 'Matches on pages 1 and 2');

// Test: Find DeviceRGB red
const rgbMatches = ContentStreamColorExtractor.findMatchingColors(testColors, {
    colorspace: 'DeviceRGB',
    values: [1.0, 0.0, 0.0],
});
assert(rgbMatches.length === 1, `Found ${rgbMatches.length} DeviceRGB red match (expected 1)`);

// Test: Find DeviceCMYK black
const cmykMatches = ContentStreamColorExtractor.findMatchingColors(testColors, {
    colorspace: 'DeviceCMYK',
    values: [0.0, 0.0, 0.0, 1.0],
});
assert(cmykMatches.length === 1, `Found ${cmykMatches.length} DeviceCMYK black match (expected 1)`);

// Test: No match for non-existent color
const noMatches = ContentStreamColorExtractor.findMatchingColors(testColors, {
    colorspace: 'DeviceGray',
    values: [0.75],
});
assert(noMatches.length === 0, `Found ${noMatches.length} matches for non-existent color (expected 0)`);

// Test: Colorspace must match exactly
const wrongCsMatches = ContentStreamColorExtractor.findMatchingColors(testColors, {
    colorspace: 'ICCBasedGray',  // Different from DeviceGray even with same value
    values: [0.5],
});
assert(wrongCsMatches.length === 0, 'Colorspace must match exactly (ICCBasedGray vs DeviceGray)');

console.log('');

// ============================================================================
// Test 5: extractColors (requires fixture PDF)
// ============================================================================

console.log('5. extractColors() - Real PDF');
console.log('   ' + '-'.repeat(50));

if (!existsSync(testPdf)) {
    console.log(`   SKIP: Fixture PDF not found: ${testPdf}`);
} else {
    try {
        const colors = await ContentStreamColorExtractor.extractColors(testPdf);

        assert(Array.isArray(colors), 'Returns an array');
        assert(colors.length > 0, `Extracted ${colors.length} color operations`);

        // Check structure of first color
        if (colors.length > 0) {
            const first = colors[0];
            assert(typeof first.pageNum === 'number', 'Has pageNum (number)');
            assert(typeof first.streamIndex === 'number', 'Has streamIndex (number)');
            assert(typeof first.operatorIndex === 'number', 'Has operatorIndex (number)');
            assert(typeof first.operator === 'string', 'Has operator (string)');
            assert(typeof first.colorspace === 'string', 'Has colorspace (string)');
            assert(Array.isArray(first.values), 'Has values (array)');
            assert(typeof first.index === 'number', 'Has index (number)');
        }

        // Check for expected colorspaces in fixture
        const colorspaces = new Set(colors.map(c => c.colorspace));
        console.log(`   Found colorspaces: ${[...colorspaces].join(', ')}`);

        // Count by page
        const pageGroups = colors.reduce((acc, c) => {
            acc[c.pageNum] = (acc[c.pageNum] || 0) + 1;
            return acc;
        }, /** @type {Record<number, number>} */ ({}));
        console.log(`   Colors per page: ${JSON.stringify(pageGroups)}`);

    } catch (error) {
        failed++;
        console.log(`   FAIL: extractColors threw: ${error.message}`);
    }
}

console.log('');

// ============================================================================
// Summary
// ============================================================================

console.log('='.repeat(60));
console.log(`Summary: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
