#!/usr/bin/env node
// @ts-check
/**
 * Transform Methods Benchmark Script
 *
 * Benchmarks different transform methods for color conversion.
 * Uses the new class-based ImageColorConverter.
 * Use --legacy flag for the original implementation.
 *
 * @module benchmark-transform-methods
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
    await import(join(__dirname, 'legacy', 'benchmark-transform-methods.js'));
} else {
    // New class-based implementation
    const args = argv.slice(2);

    // Parse arguments
    const profilePath = args.find(a => a.endsWith('.icc'));
    const iterations = parseInt(args.find(a => a.startsWith('--iterations='))?.split('=')[1] || '100', 10);
    const pixelCount = parseInt(args.find(a => a.startsWith('--pixels='))?.split('=')[1] || '10000', 10);

    if (!profilePath) {
        console.log(`
Transform Methods Benchmark Script (Class-Based Implementation)

Usage:
  node benchmark-transform-methods.js <profile.icc> [options]

Options:
  --iterations=N    Number of iterations (default: 100)
  --pixels=N        Number of pixels per iteration (default: 10000)
  --legacy          Use legacy implementation

Examples:
  node benchmark-transform-methods.js profile.icc --iterations=50 --pixels=100000
  node benchmark-transform-methods.js profile.icc --legacy
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
    console.log(`Loading ICC profile: ${profilePath}`);
    const profileBytes = await readFile(profilePath);
    const destinationProfile = /** @type {ArrayBuffer} */ (profileBytes.buffer.slice(
        profileBytes.byteOffset,
        profileBytes.byteOffset + profileBytes.byteLength
    ));

    // Generate test pixels
    const rgbPixels = new Uint8Array(pixelCount * 3);
    for (let i = 0; i < rgbPixels.length; i++) {
        rgbPixels[i] = (i * 37) % 256;
    }

    console.log(`\nTransform Methods Benchmark`);
    console.log(`===========================`);
    console.log(`Profile: ${profilePath}`);
    console.log(`Pixels: ${pixelCount.toLocaleString()}`);
    console.log(`Iterations: ${iterations}`);
    console.log('');

    // Benchmark different rendering intents
    const intents = [
        { name: 'K-Only GCR', intent: 'preserve-k-only-relative-colorimetric-gcr', bpc: true },
        { name: 'Relative Colorimetric + BPC', intent: 'relative-colorimetric', bpc: true },
        { name: 'Relative Colorimetric', intent: 'relative-colorimetric', bpc: false },
        { name: 'Perceptual + BPC', intent: 'perceptual', bpc: true },
    ];

    for (const { name, intent, bpc } of intents) {
        const converter = new ImageColorConverter({
            renderingIntent: /** @type {any} */ (intent),
            blackPointCompensation: bpc,
            useAdaptiveBPCClamping: true,
            destinationProfile,
            destinationColorSpace: 'CMYK',
            inputType: 'RGB',
            verbose: false,
        });

        try {
            await converter.ensureReady();

            const times = [];

            for (let i = 0; i < iterations; i++) {
                const startTime = performance.now();
                await converter.convertImageColor({
                    pixelBuffer: rgbPixels,
                    width: Math.sqrt(pixelCount) | 0,
                    height: Math.sqrt(pixelCount) | 0,
                    colorSpace: 'RGB',
                    bitsPerComponent: 8,
                }, {});
                const elapsed = performance.now() - startTime;
                times.push(elapsed);
            }

            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const pixelsPerSec = (pixelCount / (avgTime / 1000)).toLocaleString(undefined, { maximumFractionDigits: 0 });

            console.log(`${name.padEnd(30)} avg: ${avgTime.toFixed(2)}ms  (${pixelsPerSec} pixels/sec)`);
        } finally {
            converter.dispose();
        }
    }

    console.log('\nBenchmark complete.');
}
