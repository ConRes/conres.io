#!/usr/bin/env node
// @ts-check
/**
 * Color Conversion Script
 *
 * Converts colors using the new class-based ImageColorConverter.
 * Use --legacy flag for the original implementation.
 *
 * @module convert-colors
 */
import { argv, exit } from 'process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const hasLegacyFlag = argv.includes('--legacy');

if (hasLegacyFlag) {
    // Remove --legacy from argv and delegate to legacy implementation
    const filteredArgv = argv.filter(arg => arg !== '--legacy');
    process.argv = filteredArgv;

    // Dynamic import of legacy implementation
    await import(join(__dirname, 'legacy', 'convert-colors.js'));
} else {
    // New class-based implementation
    const args = argv.slice(2);

    // Parse arguments
    const profilePath = args.find(a => a.endsWith('.icc'));
    const verbose = args.includes('--verbose');

    if (!profilePath) {
        console.log(`
Color Conversion Script (Class-Based Implementation)

Usage:
  node convert-colors.js <profile.icc> [options]

Options:
  --verbose         Enable verbose output
  --legacy          Use legacy implementation

Examples:
  node convert-colors.js profile.icc --verbose
  node convert-colors.js profile.icc --legacy
`);
        exit(1);
    }

    if (!existsSync(profilePath)) {
        console.error(`Error: ICC profile not found: ${profilePath}`);
        exit(1);
    }

    // Load dependencies
    const { ImageColorConverter } = await import('../../classes/image-color-converter.js');

    // Load profile
    const profileBytes = await readFile(profilePath);
    const destinationProfile = /** @type {ArrayBuffer} */ (profileBytes.buffer.slice(
        profileBytes.byteOffset,
        profileBytes.byteOffset + profileBytes.byteLength
    ));

    // Create converter
    const converter = new ImageColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile,
        destinationColorSpace: 'CMYK',
        inputType: 'RGB',
        verbose,
    });

    try {
        await converter.ensureReady();

        // Demo conversion: RGB red pixel
        const rgbPixels = new Uint8Array([255, 0, 0]); // Pure red

        console.log('Converting RGB red (255, 0, 0) to CMYK...');
        console.log(`  Rendering intent: relative-colorimetric`);
        console.log(`  Black point compensation: true`);

        const result = await converter.convertImageColor({
            pixelBuffer: rgbPixels,
            width: 1,
            height: 1,
            colorSpace: 'RGB',
            bitsPerComponent: 8,
        }, {});

        const cmyk = result.pixelBuffer;
        console.log(`  Result: C=${cmyk[0]}, M=${cmyk[1]}, Y=${cmyk[2]}, K=${cmyk[3]}`);
        console.log(`  Pixel count: ${result.pixelCount}`);

    } finally {
        converter.dispose();
    }
}
