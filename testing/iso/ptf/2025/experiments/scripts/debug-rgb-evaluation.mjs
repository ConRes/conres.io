#!/usr/bin/env node
// @ts-check
/**
 * Debug what evaluateConversion returns for RGB → Lab
 */

import { readFileSync } from 'fs';
import { ColorConversionPolicy } from '../../classes/color-conversion-policy.js';

const PROFILES_DIR = '/Users/daflair/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles';
const RGB_PROFILE = readFileSync(`${PROFILES_DIR}/sRGB IEC61966-2.1.icc`);

async function main() {
    const policy = new ColorConversionPolicy();

    console.log('Debugging evaluateConversion for RGB 16-bit → Lab Float32\n');

    const conversionDescriptor = {
        sourceColorSpace: 'RGB',
        destinationColorSpace: 'Lab',
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        sourceProfile: RGB_PROFILE.buffer.slice(0),
        destinationProfile: 'Lab',
    };

    const evaluationResult = policy.evaluateConversion(conversionDescriptor);

    console.log('Evaluation result:');
    console.log(JSON.stringify(evaluationResult, null, 2));

    // Check key flags
    console.log('\nKey flags:');
    console.log(`  requiresMultiprofileTransform: ${evaluationResult.overrides?.requiresMultiprofileTransform}`);
    console.log(`  intermediateProfiles: ${JSON.stringify(evaluationResult.overrides?.intermediateProfiles)}`);

    // Also check CMYK, Gray, Lab for comparison
    const testCases = [
        { sourceColorSpace: 'CMYK', destinationColorSpace: 'Lab' },
        { sourceColorSpace: 'Gray', destinationColorSpace: 'Lab' },
        { sourceColorSpace: 'Lab', destinationColorSpace: 'Lab' },
    ];

    console.log('\n--- Other color spaces for comparison ---\n');

    for (const tc of testCases) {
        const desc = {
            ...conversionDescriptor,
            sourceColorSpace: tc.sourceColorSpace,
            destinationColorSpace: tc.destinationColorSpace,
        };
        const result = policy.evaluateConversion(desc);
        console.log(`${tc.sourceColorSpace} → ${tc.destinationColorSpace}:`);
        console.log(`  requiresMultiprofileTransform: ${result.overrides?.requiresMultiprofileTransform}`);
    }

    console.log('\nDone.');
}

main().catch(console.error);
