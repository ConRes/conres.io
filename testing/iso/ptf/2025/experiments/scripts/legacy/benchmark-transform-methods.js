#!/usr/bin/env node
// @ts-check
/**
 * Benchmark Transform Methods Script
 *
 * Compares direct createTransform vs createMultiprofileTransform for:
 * - Gray → K-Only CMYK
 * - Lab → K-Only CMYK
 *
 * Usage:
 *   node scripts/benchmark-transform-methods.js --color-engine=../packages/color-engine-2026-01-21
 *
 * Options:
 *   --color-engine=<path>  Path to color-engine package [CWD-relative] (required)
 *   --output-dir=<path>    Output directory [CWD-relative] (default: auto-numbered)
 *   --iterations=<n>       Iterations per benchmark (default: 1000)
 */

// =============================================================================
// AGENT RESTRICTIONS - READ BEFORE MODIFYING
// =============================================================================
//
// PATH RESOLUTION RULES:
//
// 1. HARDCODED FIXTURES (profiles):
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
        'iterations': { type: 'string', default: '1000' },
        'help': { type: 'boolean', short: 'h', default: false },
    }
});

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

/**
 * Load the color engine module
 * @param {string} colorEnginePath - Absolute path to color-engine package
 */
async function loadColorEngine(colorEnginePath) {
    const absolutePath = join(colorEnginePath, 'src', 'index.js');
    const LittleCMS = await import(absolutePath);
    return await LittleCMS.createEngine();
}

/**
 * Benchmark a transform method
 */
function benchmarkTransform(engine, createFn, transformFn, iterations, pixelCount) {
    // Measure creation time
    const createStart = performance.now();
    const transform = createFn();
    const createTime = performance.now() - createStart;

    if (!transform) {
        return { error: 'Transform creation failed', createTime };
    }

    // Prepare test data
    const input = transformFn.inputData(pixelCount);
    const output = transformFn.outputData(pixelCount);

    // Warm up
    engine.doTransform(transform, input, output, pixelCount);

    // Benchmark transform execution
    const execStart = performance.now();
    for (let i = 0; i < iterations; i++) {
        engine.doTransform(transform, input, output, pixelCount);
    }
    const execTime = performance.now() - execStart;

    // Capture sample output
    const sampleOutput = Array.from(output.slice(0, 4));

    engine.deleteTransform(transform);

    return {
        createTime: createTime.toFixed(3),
        execTime: execTime.toFixed(2),
        avgExecTime: (execTime / iterations).toFixed(4),
        pixelsPerMs: Math.round((pixelCount * iterations) / execTime),
        sampleOutput,
    };
}

async function main() {
    // Show help if requested
    if (options['help']) {
        console.log(`
Usage:
  node scripts/benchmark-transform-methods.js --color-engine=<path> [options]

Options:
  --color-engine=<path>  Path to color-engine package [CWD-relative] (required)
  --output-dir=<path>    Output directory [CWD-relative] (default: auto-numbered)
  --iterations=<n>       Iterations per benchmark (default: 1000)
  -h, --help             Show this help message
`);
        process.exit(0);
    }

    const colorEngine = options['color-engine'];
    const iterations = parseInt(options['iterations'] || '1000', 10);

    if (!colorEngine) {
        console.error('Error: --color-engine is required');
        console.error('Usage: node scripts/benchmark-transform-methods.js --color-engine=../packages/color-engine-2026-01-21');
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
    console.log('Transform Methods Benchmark');
    console.log('═'.repeat(80));
    console.log(`CWD: ${process.cwd()}`);
    console.log(`\nPackage: ${colorEngine}`);
    console.log(`Output: ${outputDir}`);
    console.log(`Iterations: ${iterations}`);

    // Create output directory
    await mkdir(outputDir, { recursive: true });

    // Set up logging
    const logPath = join(outputDir, `benchmark-${basename(colorEngine)}.log`);
    const logStream = createWriteStream(logPath);
    const log = (msg) => {
        console.log(msg);
        logStream.write(msg + '\n');
    };

    const results = {
        timestamp: new Date().toISOString(),
        colorEngine: colorEngine,
        iterations: iterations,
        pixelCount: 1000,
        benchmarks: {},
    };

    try {
        // Load color engine
        log('\nLoading color engine...');
        const engine = await loadColorEngine(colorEnginePath);
        log('Color engine loaded');

        // Load destination profile (from FIXTURES_DIR)
        const profilePath = join(FIXTURES_DIR, 'profiles', 'eciCMYK v2.icc');
        const profileBuffer = await readFile(profilePath);
        const cmykProfile = engine.openProfileFromMem(new Uint8Array(profileBuffer));
        log(`Loaded profile: eciCMYK v2`);

        // Create standard profiles
        const srgbProfile = engine.createSRGBProfile();
        const grayProfile = engine.createGray2Profile();
        const labProfile = engine.createLab4Profile();

        // Constants
        const TYPE_GRAY_8 = 0x30009;
        const TYPE_RGB_8 = 0x40019;
        const TYPE_Lab_8 = 0xa0019;
        const TYPE_CMYK_8 = 0x60021;
        const INTENT_K_ONLY = 20;
        const FLAGS_BPC = 0x2000;

        const pixelCount = results.pixelCount;

        // ─────────────────────────────────────────────────────────────────────
        log('\n─ Gray → CMYK K-Only: Direct vs Multiprofile ─');
        // ─────────────────────────────────────────────────────────────────────

        // Direct: Gray → CMYK (uses new direct K-Only support)
        log('\n1. Direct: createTransform(Gray, CMYK, K-Only)');
        const grayDirectResult = benchmarkTransform(
            engine,
            () => engine.createTransform(grayProfile, TYPE_GRAY_8, cmykProfile, TYPE_CMYK_8, INTENT_K_ONLY, FLAGS_BPC),
            {
                inputData: (n) => new Uint8Array(n).fill(128), // 50% gray
                outputData: (n) => new Uint8Array(n * 4),
            },
            iterations,
            pixelCount
        );
        log(`   Create: ${grayDirectResult.createTime}ms`);
        log(`   Exec: ${grayDirectResult.execTime}ms (avg ${grayDirectResult.avgExecTime}ms)`);
        log(`   Sample: CMYK(${grayDirectResult.sampleOutput.join(', ')})`);
        results.benchmarks.grayDirect = grayDirectResult;

        // Multiprofile: Gray → sRGB → CMYK
        log('\n2. Multiprofile: createMultiprofileTransform([Gray, sRGB, CMYK], K-Only)');
        const grayMultiResult = benchmarkTransform(
            engine,
            () => engine.createMultiprofileTransform(
                [grayProfile, srgbProfile, cmykProfile],
                TYPE_GRAY_8,
                TYPE_CMYK_8,
                INTENT_K_ONLY,
                FLAGS_BPC
            ),
            {
                inputData: (n) => new Uint8Array(n).fill(128),
                outputData: (n) => new Uint8Array(n * 4),
            },
            iterations,
            pixelCount
        );
        log(`   Create: ${grayMultiResult.createTime}ms`);
        log(`   Exec: ${grayMultiResult.execTime}ms (avg ${grayMultiResult.avgExecTime}ms)`);
        log(`   Sample: CMYK(${grayMultiResult.sampleOutput.join(', ')})`);
        results.benchmarks.grayMultiprofile = grayMultiResult;

        // ─────────────────────────────────────────────────────────────────────
        log('\n─ Lab → CMYK K-Only: Direct vs Multiprofile ─');
        // ─────────────────────────────────────────────────────────────────────

        // Direct: Lab → CMYK (uses new direct K-Only support)
        log('\n3. Direct: createTransform(Lab, CMYK, K-Only)');
        const labDirectResult = benchmarkTransform(
            engine,
            () => engine.createTransform(labProfile, TYPE_Lab_8, cmykProfile, TYPE_CMYK_8, INTENT_K_ONLY, FLAGS_BPC),
            {
                inputData: (n) => {
                    const data = new Uint8Array(n * 3);
                    for (let i = 0; i < n; i++) {
                        data[i * 3] = 128;     // L = 50%
                        data[i * 3 + 1] = 128; // a* = 0
                        data[i * 3 + 2] = 128; // b* = 0
                    }
                    return data;
                },
                outputData: (n) => new Uint8Array(n * 4),
            },
            iterations,
            pixelCount
        );
        log(`   Create: ${labDirectResult.createTime}ms`);
        log(`   Exec: ${labDirectResult.execTime}ms (avg ${labDirectResult.avgExecTime}ms)`);
        log(`   Sample: CMYK(${labDirectResult.sampleOutput.join(', ')})`);
        results.benchmarks.labDirect = labDirectResult;

        // Multiprofile: Lab → sRGB → CMYK
        log('\n4. Multiprofile: createMultiprofileTransform([Lab, sRGB, CMYK], K-Only)');
        const labMultiResult = benchmarkTransform(
            engine,
            () => engine.createMultiprofileTransform(
                [labProfile, srgbProfile, cmykProfile],
                TYPE_Lab_8,
                TYPE_CMYK_8,
                INTENT_K_ONLY,
                FLAGS_BPC
            ),
            {
                inputData: (n) => {
                    const data = new Uint8Array(n * 3);
                    for (let i = 0; i < n; i++) {
                        data[i * 3] = 128;
                        data[i * 3 + 1] = 128;
                        data[i * 3 + 2] = 128;
                    }
                    return data;
                },
                outputData: (n) => new Uint8Array(n * 4),
            },
            iterations,
            pixelCount
        );
        log(`   Create: ${labMultiResult.createTime}ms`);
        log(`   Exec: ${labMultiResult.execTime}ms (avg ${labMultiResult.avgExecTime}ms)`);
        log(`   Sample: CMYK(${labMultiResult.sampleOutput.join(', ')})`);
        results.benchmarks.labMultiprofile = labMultiResult;

        // ─────────────────────────────────────────────────────────────────────
        log('\n─ Summary ─');
        // ─────────────────────────────────────────────────────────────────────

        const graySpeedup = (parseFloat(grayMultiResult.execTime) / parseFloat(grayDirectResult.execTime)).toFixed(2);
        const labSpeedup = (parseFloat(labMultiResult.execTime) / parseFloat(labDirectResult.execTime)).toFixed(2);

        log(`\nGray K-Only:`);
        log(`  Direct creates in ${grayDirectResult.createTime}ms, executes ${iterations}x in ${grayDirectResult.execTime}ms`);
        log(`  Multiprofile creates in ${grayMultiResult.createTime}ms, executes ${iterations}x in ${grayMultiResult.execTime}ms`);
        log(`  Direct/Multiprofile ratio: ${graySpeedup}x`);

        log(`\nLab K-Only:`);
        log(`  Direct creates in ${labDirectResult.createTime}ms, executes ${iterations}x in ${labDirectResult.execTime}ms`);
        log(`  Multiprofile creates in ${labMultiResult.createTime}ms, executes ${iterations}x in ${labMultiResult.execTime}ms`);
        log(`  Direct/Multiprofile ratio: ${labSpeedup}x`);

        // Check K-Only output
        const isGrayKOnly = grayDirectResult.sampleOutput[0] === 0 &&
                           grayDirectResult.sampleOutput[1] === 0 &&
                           grayDirectResult.sampleOutput[2] === 0 &&
                           grayDirectResult.sampleOutput[3] > 100;

        const isLabKOnly = labDirectResult.sampleOutput[0] === 0 &&
                          labDirectResult.sampleOutput[1] === 0 &&
                          labDirectResult.sampleOutput[2] === 0 &&
                          labDirectResult.sampleOutput[3] > 100;

        log(`\nK-Only Output Verification:`);
        log(`  Gray direct produces K-only: ${isGrayKOnly ? 'YES' : 'NO'} (K=${grayDirectResult.sampleOutput[3]})`);
        log(`  Lab direct produces K-only: ${isLabKOnly ? 'YES' : 'NO'} (K=${labDirectResult.sampleOutput[3]})`);

        results.verification = {
            grayDirectKOnly: isGrayKOnly,
            labDirectKOnly: isLabKOnly,
            graySpeedup: parseFloat(graySpeedup),
            labSpeedup: parseFloat(labSpeedup),
        };

        // Clean up
        engine.closeProfile(cmykProfile);
        engine.closeProfile(srgbProfile);
        engine.closeProfile(grayProfile);
        engine.closeProfile(labProfile);

    } catch (error) {
        log(`\nError: ${error.message}`);
        results.error = error.message;
    }

    // Save results
    const jsonPath = join(outputDir, `benchmark-${basename(colorEngine)}.json`);
    await writeFile(jsonPath, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to: ${jsonPath}`);
    console.log(`Log saved to: ${logPath}`);

    logStream.end();

    console.log('\n' + '═'.repeat(80));
    console.log('Done');
    console.log('═'.repeat(80));
}

main().catch(console.error);
