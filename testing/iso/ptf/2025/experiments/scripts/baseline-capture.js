#!/usr/bin/env node
// @ts-check
/**
 * Baseline Capture Script
 *
 * Captures test results, benchmarks, and conversion values for a specified color-engine package.
 * Used to establish baselines for comparison between package versions.
 *
 * Usage:
 *   node scripts/baseline-capture.js --color-engine=../packages/color-engine-2025-12-19
 *   node scripts/baseline-capture.js --color-engine=../packages/color-engine-2025-12-19 --output-dir=output/baseline-001
 *
 * Options:
 *   --color-engine=<path>  Path to color-engine package [CWD-relative] (required)
 *   --output-dir=<path>    Output directory for JSON + logs [CWD-relative] (default: auto-numbered)
 *   --skip-tests           Skip running yarn test
 */

// =============================================================================
// AGENT RESTRICTIONS - READ BEFORE MODIFYING
// =============================================================================
//
// PATH RESOLUTION RULES:
//
// 1. HARDCODED FIXTURES (profiles, services):
//    → Resolve relative to __dirname (known project structure)
//    → Use: join(FIXTURES_DIR, 'subdir', 'file')
//
// 2. USER CLI ARGUMENTS (--output-dir, --color-engine):
//    → Resolve relative to CWD (standard CLI behavior)
//    → Use: resolve(process.cwd(), userPath)
//
// DO NOT add magic path resolution patterns:
// - Fallback resolution (try CWD, then try fixtures, then try assets...)
// - Short name resolution (e.g., "eciCMYK" → full path)
// - Any resolution that differs from standard shell behavior
//
// =============================================================================

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, basename } from 'path';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';

// Script location - used for finding package-internal resources
const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICES_DIR = join(__dirname, '..', '..', 'services');
const FIXTURES_DIR = join(__dirname, '..', '..', 'tests', 'fixtures');

// ============================================================================
// CLI Argument Parsing (Node.js parseArgs)
// ============================================================================

const { values: options } = parseArgs({
    // Filter out empty strings that may come from shell argument parsing edge cases
    args: process.argv.slice(2).filter(arg => arg.length > 0),
    options: {
        'color-engine': { type: 'string' },
        'output-dir': { type: 'string' },
        'skip-tests': { type: 'boolean', default: false },
        'help': { type: 'boolean', short: 'h', default: false },
    }
});

/**
 * Create a ColorEngineService with a custom engine instance
 * @param {string} colorEnginePath - Absolute path to color-engine package
 * @param {object} serviceOptions - Options for ColorEngineService
 */
async function createColorEngineService(colorEnginePath, serviceOptions = {}) {
    // Load the ColorEngineService class (from SERVICES_DIR)
    const { ColorEngineService } = await import(join(SERVICES_DIR, 'ColorEngineService.js'));

    // Load the custom color engine module
    const absolutePath = join(colorEnginePath, 'src', 'index.js');
    const LittleCMS = await import(absolutePath);
    const colorEngineInstance = await LittleCMS.createEngine();

    return new ColorEngineService({
        ...serviceOptions,
        colorEngineInstance,
    });
}

/**
 * Test Gray(128) → CMYK conversion
 * @param {import('../../services/ColorEngineService.js').ColorEngineService} colorEngine
 * @param {ArrayBuffer} destProfile
 */
async function testGrayConversion(colorEngine, destProfile) {
    const result = await colorEngine.convertColor(
        { type: 'Gray', values: [128] },
        {
            sourceProfile: 'sGray',
            destinationProfile: destProfile,
            renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
            blackPointCompensation: true,
        }
    );

    return {
        input: { type: 'Gray', value: 128 },
        output: {
            type: result.output.type,
            values: result.output.values.map(v => Math.round(v)),
        },
        expected: { type: 'CMYK', values: [0, 0, 0, 158] }, // Expected K-only output
    };
}

/**
 * Test Lab(50,0,0) → CMYK conversion
 * @param {import('../../services/ColorEngineService.js').ColorEngineService} colorEngine
 * @param {ArrayBuffer} destProfile
 */
async function testLabConversion(colorEngine, destProfile) {
    // Lab values: L=50 (mid gray), a*=0, b*=0 (neutral)
    // In Lab8 format: L=128, a=128, b=128
    const result = await colorEngine.convertColor(
        { type: 'Lab', values: [128, 128, 128] },
        {
            sourceProfile: 'Lab',
            destinationProfile: destProfile,
            renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
            blackPointCompensation: true,
        }
    );

    return {
        input: { type: 'Lab', values: [50, 0, 0], encoded: [128, 128, 128] },
        output: {
            type: result.output.type,
            values: result.output.values.map(v => Math.round(v)),
        },
        expected: { type: 'CMYK', values: [0, 0, 0, 128] }, // Expected K-only output (approximately)
    };
}

/**
 * Run performance benchmark
 * @param {import('../../services/ColorEngineService.js').ColorEngineService} colorEngine
 * @param {ArrayBuffer} destProfile
 */
async function runBenchmark(colorEngine, destProfile) {
    const iterations = 100;
    const pixelCount = 10000; // 10k pixels

    // Generate test data
    const rgbPixels = new Uint8Array(pixelCount * 3);
    for (let i = 0; i < rgbPixels.length; i++) {
        rgbPixels[i] = Math.floor(Math.random() * 256);
    }

    // Warm up
    await colorEngine.convertPixelBuffer(rgbPixels, {
        sourceProfile: 'sRGB',
        destinationProfile: destProfile,
        inputType: 'RGB',
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
    });

    // Benchmark
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        await colorEngine.convertPixelBuffer(rgbPixels, {
            sourceProfile: 'sRGB',
            destinationProfile: destProfile,
            inputType: 'RGB',
            renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        });
    }
    const elapsed = performance.now() - start;

    const totalPixels = pixelCount * iterations;
    const pixelsPerMs = totalPixels / elapsed;

    return {
        iterations,
        pixelCount,
        totalMs: Math.round(elapsed),
        avgMsPerIteration: (elapsed / iterations).toFixed(2),
        pixelsPerMs: Math.round(pixelsPerMs),
        megapixelsPerSecond: (pixelsPerMs * 1000 / 1000000).toFixed(2),
    };
}

/**
 * Get next sequential output directory
 */
async function getNextOutputDir() {
    const outputBase = resolve(process.cwd(), 'output');
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // Find existing directories for today
    let maxNum = 0;
    try {
        const entries = await readdir(outputBase);
        for (const entry of entries) {
            if (entry.startsWith(today)) {
                const match = entry.match(new RegExp(`^${today}-(\\d+)`));
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxNum) maxNum = num;
                }
            }
        }
    } catch {
        // Directory doesn't exist yet
    }

    const nextNum = String(maxNum + 1).padStart(3, '0');
    return join(outputBase, `${today}-${nextNum}`);
}

async function main() {
    // Show help if requested
    if (options['help']) {
        console.log(`
Usage:
  node scripts/baseline-capture.js --color-engine=<path> [options]

Options:
  --color-engine=<path>  Path to color-engine package [CWD-relative] (required)
  --output-dir=<path>    Output directory [CWD-relative] (default: auto-numbered)
  --skip-tests           Skip running yarn test
  -h, --help             Show this help message
`);
        process.exit(0);
    }

    const colorEngine = options['color-engine'];
    if (!colorEngine) {
        console.error('Error: --color-engine is required');
        console.error('Usage: node scripts/baseline-capture.js --color-engine=../packages/color-engine-2026-01-21');
        process.exit(1);
    }

    // Resolve color engine path (CWD-relative)
    const colorEnginePath = resolve(process.cwd(), colorEngine);
    if (!existsSync(colorEnginePath)) {
        console.error(`Error: Color engine not found: ${colorEngine}`);
        console.error(`  Resolved to: ${colorEnginePath}`);
        console.error(`  CWD: ${process.cwd()}`);
        process.exit(1);
    }

    // Resolve output directory (CWD-relative or auto-numbered)
    const outputDir = options['output-dir']
        ? resolve(process.cwd(), options['output-dir'])
        : await getNextOutputDir();

    console.log('═'.repeat(80));
    console.log('Baseline Capture');
    console.log('═'.repeat(80));
    console.log(`CWD: ${process.cwd()}`);
    console.log(`\nPackage: ${colorEngine}`);
    console.log(`Output: ${outputDir}`);

    // Create output directory
    await mkdir(outputDir, { recursive: true });

    // Set up log capture
    const logPath = join(outputDir, `baseline-${basename(colorEngine)}.log`);
    const logStream = createWriteStream(logPath);
    const originalLog = console.log;
    const originalError = console.error;

    // Capture verbose output to file
    const capturedLogs = [];
    console.log = (...args) => {
        const msg = args.join(' ');
        capturedLogs.push(msg);
        logStream.write(msg + '\n');
        originalLog.apply(console, args);
    };
    console.error = (...args) => {
        const msg = args.join(' ');
        capturedLogs.push('[ERROR] ' + msg);
        logStream.write('[ERROR] ' + msg + '\n');
        originalError.apply(console, args);
    };

    const baseline = {
        timestamp: new Date().toISOString(),
        colorEngine: colorEngine,
        conversions: {},
        benchmark: {},
        tests: { passed: 0, failed: 0, skipped: options['skip-tests'] },
    };

    try {
        // Load destination profile (from FIXTURES_DIR)
        const profilePath = join(FIXTURES_DIR, 'profiles', 'eciCMYK v2.icc');
        console.log(`\nLoading profile: ${profilePath}`);
        const profileBuffer = await readFile(profilePath);
        const destProfile = profileBuffer.buffer.slice(
            profileBuffer.byteOffset,
            profileBuffer.byteOffset + profileBuffer.byteLength
        );

        // Create ColorEngineService with custom package
        console.log('\nInitializing ColorEngineService...');
        const colorEngineService = await createColorEngineService(colorEnginePath, {
            defaultRenderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        });
        console.log('ColorEngineService initialized');

        // Test Gray conversion
        console.log('\n─ Gray(128) → CMYK Conversion ─');
        const grayResult = await testGrayConversion(colorEngineService, destProfile);
        baseline.conversions.gray = grayResult;
        console.log(`Input: Gray(${grayResult.input.value})`);
        console.log(`Output: CMYK(${grayResult.output.values.join(', ')})`);
        console.log(`Expected: CMYK(${grayResult.expected.values.join(', ')})`);

        // Test Lab conversion
        console.log('\n─ Lab(50,0,0) → CMYK Conversion ─');
        const labResult = await testLabConversion(colorEngineService, destProfile);
        baseline.conversions.lab = labResult;
        console.log(`Input: Lab(${labResult.input.values.join(', ')})`);
        console.log(`Output: CMYK(${labResult.output.values.join(', ')})`);
        console.log(`Expected: CMYK(${labResult.expected.values.join(', ')}) (approximately)`);

        // Run benchmark
        console.log('\n─ Performance Benchmark ─');
        const benchmarkResult = await runBenchmark(colorEngineService, destProfile);
        baseline.benchmark = benchmarkResult;
        console.log(`Iterations: ${benchmarkResult.iterations}`);
        console.log(`Pixels per iteration: ${benchmarkResult.pixelCount}`);
        console.log(`Total time: ${benchmarkResult.totalMs}ms`);
        console.log(`Avg per iteration: ${benchmarkResult.avgMsPerIteration}ms`);
        console.log(`Throughput: ${benchmarkResult.megapixelsPerSecond} MP/s`);

        // Save baseline
        const outputPath = join(outputDir, `baseline-${basename(colorEngine)}.json`);
        await writeFile(outputPath, JSON.stringify(baseline, null, 2));
        console.log(`\n─ Baseline Saved ─`);
        console.log(`Output: ${outputPath}`);
        console.log(`Log: ${logPath}`);

    } catch (error) {
        console.error('\nError:', error.message);
        baseline.error = error.message;
    } finally {
        // Restore console
        console.log = originalLog;
        console.error = originalError;
        logStream.end();
    }

    console.log('\n' + '═'.repeat(80));
    console.log('Done');
    console.log('═'.repeat(80));

    return baseline;
}

main().catch(console.error);
