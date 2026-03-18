#!/usr/bin/env node
// @ts-check
/**
 * Comprehensive Profile Conversion Test
 *
 * Tests color conversion with:
 * 1. CMYK output profile (eciCMYK v2) - K-Only GCR rendering intent
 *    - Separation colors should pass through unchanged
 *    - DeviceCMYK should pass through unchanged
 *    - sGray/Lab colors ARE converted
 *
 * 2. RGB output profile (FIPS_WIDE_28T-TYPEavg) - Relative Colorimetric + BPC
 *    - All colors are converted to RGB
 *
 * Test PDFs:
 * - Type Sizes and Lissajou (pages 19-22 with sGray and Separation K)
 * - Interlaken Map (3 pages with images)
 *
 * Naming convention:
 * <original-filename> - <profile-name> - <intent> (<folder-id>).pdf
 *
 * TODO: This script has MAGIC PATH RESOLUTION that needs normalization.
 * Run from: testing/iso/ptf/2025/experiments/
 */

// =============================================================================
// AGENT RESTRICTIONS - READ BEFORE MODIFYING
// =============================================================================
//
// TODO: This script needs path normalization to be CWD-relative.
// Currently uses __dirname-based paths which is MAGIC.
//
// DO NOT add more magic path resolution patterns.
// If you actively use this script, normalize it first.
//
// =============================================================================

import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { readdirSync } from 'fs';
import { PDFDocument } from 'pdf-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const experimentsDir = join(__dirname, '..');
const testingDir = join(__dirname, '..', '..');
const fixturesDir = join(testingDir, '..', 'fixtures');
const outputDir = join(experimentsDir, 'output');

// Source PDFs - preserving full original filenames
const SOURCE_PDFS = {
    typeSizes: {
        path: join(outputDir, '2025-12-17-Acrobat', '2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou.pdf'),
        baseName: '2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou',
    },
    interlaken: {
        path: join(outputDir, '2025-12-17-Acrobat', '2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map.pdf'),
        baseName: '2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map',
    },
    fullTestForm: {
        path: join(__dirname, '..', '..', '..', '..', '..', '..', 'assets', 'testforms', '2025-08-15 - ConRes - ISO PTF - CR1.pdf'),
        baseName: '2025-08-15 - ConRes - ISO PTF - CR1',
    },
};

// Profiles
const PROFILES = {
    eciCMYK: {
        path: join(fixturesDir, 'profiles', 'eciCMYK v2.icc'),
        name: 'eciCMYK v2',
        intent: 'K-Only GCR',
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        expectedColorSpace: 'CMYK',
    },
    fipsRGB: {
        path: join(fixturesDir, 'profiles', 'FIPS_WIDE_28T-TYPEavg.icc'),
        name: 'FIPS_WIDE_28T-TYPEavg',
        intent: 'Relative Colorimetric',
        renderingIntent: 'relative-colorimetric', // Will be overridden by PDFService for RGB output
        expectedColorSpace: 'RGB',
    },
};

async function getNextOutputFolder() {
    const today = new Date().toISOString().slice(0, 10);

    const existing = readdirSync(outputDir)
        .filter(f => f.startsWith(today))
        .map(f => {
            const match = f.match(/^(\d{4}-\d{2}-\d{2})-(\d{3})/);
            return match ? parseInt(match[2], 10) : 0;
        });

    const next = Math.max(0, ...existing) + 1;
    return join(outputDir, `${today}-${String(next).padStart(3, '0')}`);
}

/**
 * Generate output filename following naming conventions
 * @param {string} sourceBaseName - Original source filename (without extension)
 * @param {string} profileName - Profile name (e.g., "eciCMYK v2")
 * @param {string} intent - Rendering intent (e.g., "K-Only GCR")
 * @param {string} folderId - Folder ID (e.g., "2025-12-19-001")
 * @returns {string} Full output filename
 */
function generateOutputFilename(sourceBaseName, profileName, intent, folderId) {
    return `${sourceBaseName} - ${profileName} - ${intent} (${folderId}).pdf`;
}

/**
 * @param {Object} options
 * @param {string} options.pdfKey - Key from SOURCE_PDFS
 * @param {string} options.profileKey - Key from PROFILES
 * @param {string} options.outputFolder - Full path to output folder
 * @param {string} options.folderId - Folder ID for filename
 * @param {boolean} [options.verbose=false] - Verbose output
 * @param {boolean} [options.useWorkers=true] - Use workers for conversion
 */
async function runConversion({ pdfKey, profileKey, outputFolder, folderId, verbose = false, useWorkers = true }) {
    const source = SOURCE_PDFS[pdfKey];
    const profile = PROFILES[profileKey];

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Converting: ${source.baseName}`);
    console.log(`Profile: ${profile.name} (${profile.expectedColorSpace})`);
    console.log(`Intent: ${profile.intent}`);
    console.log(`Workers: ${useWorkers ? 'enabled' : 'disabled'}`);
    console.log('─'.repeat(80));

    // Load services
    const { PDFService } = await import(join(testingDir, 'services', 'PDFService.js'));
    const { ICCService } = await import(join(testingDir, 'services', 'ICCService.js'));

    // Load PDF
    const pdfBytes = await readFile(source.path);
    const pdfDocument = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDocument.getPageCount();
    console.log(`Pages: ${pageCount}`);

    // Load profile
    const profileBytes = await readFile(profile.path);
    const destinationProfile = profileBytes.buffer.slice(
        profileBytes.byteOffset,
        profileBytes.byteOffset + profileBytes.byteLength
    );

    // Convert
    const startTime = Date.now();
    await PDFService.convertColorInPDFDocument(pdfDocument, {
        destinationProfile,
        renderingIntent: profile.renderingIntent,
        convertContentStreams: true,
        convertImages: true,
        verbose,
        useWorkers,
    });

    // Full workflow: transparency blending space and output intent
    const destHeader = ICCService.parseICCHeaderFromSource(profileBytes);
    const outputColorSpace = destHeader.colorSpace ?? 'CMYK';

    // Replace transparency blending color space to match output
    await PDFService.replaceTransarencyBlendingSpaceInPDFDocument(pdfDocument, outputColorSpace);
    console.log(`Transparency blending: updated to ${outputColorSpace}`);

    // Set output intent with the destination profile
    const profileName = destHeader.description || profile.name;
    PDFService.setOutputIntentForPDFDocument(pdfDocument, {
        subType: 'GTS_PDFX',
        iccProfile: profileBytes,
        identifier: profileName,
        info: profileName,
    });
    console.log(`Output intent: set to ${profileName}`);

    const elapsed = Date.now() - startTime;

    // Generate output filename following naming conventions
    const outputFilename = generateOutputFilename(source.baseName, profile.name, profile.intent, folderId);
    const outputPath = join(outputFolder, outputFilename);

    // Save
    const outputBytes = await pdfDocument.save();
    await writeFile(outputPath, outputBytes);

    const sizeMB = (outputBytes.length / 1024 / 1024).toFixed(2);
    console.log(`Output: ${outputFilename}`);
    console.log(`Size: ${sizeMB} MB`);
    console.log(`Time: ${elapsed}ms (${(elapsed / pageCount).toFixed(0)}ms/page)`);

    return {
        filename: outputFilename,
        size: outputBytes.length,
        elapsed,
        pageCount,
    };
}

async function main() {
    console.log('═'.repeat(80));
    console.log('Comprehensive Profile Conversion Test');
    console.log('═'.repeat(80));

    // Create output folder
    const outputFolder = await getNextOutputFolder();
    const folderId = basename(outputFolder);
    await mkdir(outputFolder, { recursive: true });
    console.log(`\nOutput folder: ${folderId}`);

    const results = [];

    // Test 1: Type Sizes with eciCMYK v2 (CMYK output, K-Only GCR)
    console.log('\n\n' + '═'.repeat(80));
    console.log('TEST 1: Type Sizes + eciCMYK v2 (CMYK output, K-Only GCR)');
    console.log('Expected: Separation Black and DeviceCMYK pass through unchanged');
    console.log('═'.repeat(80));

    results.push(await runConversion({
        pdfKey: 'typeSizes',
        profileKey: 'eciCMYK',
        outputFolder,
        folderId,
        verbose: false,
        useWorkers: true,
    }));

    // Test 2: Type Sizes with FIPS RGB (RGB output, Relative Colorimetric + BPC)
    console.log('\n\n' + '═'.repeat(80));
    console.log('TEST 2: Type Sizes + FIPS_WIDE_28T-TYPEavg (RGB output)');
    console.log('Expected: All colors converted to RGB');
    console.log('═'.repeat(80));

    results.push(await runConversion({
        pdfKey: 'typeSizes',
        profileKey: 'fipsRGB',
        outputFolder,
        folderId,
        verbose: false,
        useWorkers: true,
    }));

    // Test 3: Interlaken Map with eciCMYK v2
    console.log('\n\n' + '═'.repeat(80));
    console.log('TEST 3: Interlaken Map + eciCMYK v2 (CMYK output, K-Only GCR)');
    console.log('═'.repeat(80));

    results.push(await runConversion({
        pdfKey: 'interlaken',
        profileKey: 'eciCMYK',
        outputFolder,
        folderId,
        verbose: false,
        useWorkers: true,
    }));

    // Test 4: Interlaken Map with FIPS RGB
    console.log('\n\n' + '═'.repeat(80));
    console.log('TEST 4: Interlaken Map + FIPS_WIDE_28T-TYPEavg (RGB output)');
    console.log('═'.repeat(80));

    results.push(await runConversion({
        pdfKey: 'interlaken',
        profileKey: 'fipsRGB',
        outputFolder,
        folderId,
        verbose: false,
        useWorkers: true,
    }));

    // Test 5: Type Sizes with eciCMYK v2 (no workers)
    console.log('\n\n' + '═'.repeat(80));
    console.log('TEST 5: Type Sizes + eciCMYK v2 (NO WORKERS)');
    console.log('═'.repeat(80));

    results.push({ ...await runConversion({
        pdfKey: 'typeSizes',
        profileKey: 'eciCMYK',
        outputFolder,
        folderId: folderId + '-no-workers',
        verbose: false,
        useWorkers: false,
    }), noWorkers: true });

    // Test 6: Type Sizes with FIPS RGB (no workers)
    console.log('\n\n' + '═'.repeat(80));
    console.log('TEST 6: Type Sizes + FIPS_WIDE (NO WORKERS)');
    console.log('═'.repeat(80));

    results.push({ ...await runConversion({
        pdfKey: 'typeSizes',
        profileKey: 'fipsRGB',
        outputFolder,
        folderId: folderId + '-no-workers',
        verbose: false,
        useWorkers: false,
    }), noWorkers: true });

    // Test 7: Interlaken Map with eciCMYK v2 (no workers)
    console.log('\n\n' + '═'.repeat(80));
    console.log('TEST 7: Interlaken Map + eciCMYK v2 (NO WORKERS)');
    console.log('═'.repeat(80));

    results.push({ ...await runConversion({
        pdfKey: 'interlaken',
        profileKey: 'eciCMYK',
        outputFolder,
        folderId: folderId + '-no-workers',
        verbose: false,
        useWorkers: false,
    }), noWorkers: true });

    // Test 8: Interlaken Map with FIPS RGB (no workers)
    console.log('\n\n' + '═'.repeat(80));
    console.log('TEST 8: Interlaken Map + FIPS_WIDE (NO WORKERS)');
    console.log('═'.repeat(80));

    results.push({ ...await runConversion({
        pdfKey: 'interlaken',
        profileKey: 'fipsRGB',
        outputFolder,
        folderId: folderId + '-no-workers',
        verbose: false,
        useWorkers: false,
    }), noWorkers: true });

    // Summary
    console.log('\n\n' + '═'.repeat(80));
    console.log('SUMMARY');
    console.log('═'.repeat(80));
    console.log('\nResults:');
    for (const r of results) {
        const workerNote = r.noWorkers ? ' (no workers)' : '';
        console.log(`  ${r.filename}${workerNote}`);
        console.log(`    Size: ${(r.size / 1024 / 1024).toFixed(2)} MB, Time: ${r.elapsed}ms`);
    }

    console.log(`\nAll files saved to: ${outputFolder}`);
    console.log('\n' + '═'.repeat(80));
    console.log('Test Complete');
    console.log('═'.repeat(80));
}

main().catch(console.error);
