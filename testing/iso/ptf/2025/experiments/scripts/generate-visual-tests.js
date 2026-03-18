#!/usr/bin/env node
// @ts-check
/**
 * Generate Visual Test PDFs for Gate Step Inspection
 *
 * Generates 8 PDFs for visual inspection (Phase 11.1.1):
 * - 2 inputs: Type Sizes and Lissajou, Interlaken Map
 * - 2 profiles: eciCMYK v2 (K-Only), FIPS_WIDE_28T-TYPEavg (Relative Colorimetric)
 * - 2 methods: Main Thread, Worker Thread
 *
 * Output follows naming convention:
 *   <original-filename> - <profile-name> - <intent> - <Main|Worker> (YYYY-MM-DD-XXX).pdf
 *
 * IMPORTANT: Run from testing/iso/ptf/2025/experiments/
 *
 * Usage:
 *   node scripts/generate-visual-tests.js
 *   node scripts/generate-visual-tests.js --workers-only --color-engine=../packages/color-engine-2025-12-19
 *
 * Options:
 *   --output-dir=<path>     Output directory (default: auto-numbered output/YYYY-MM-DD-XXX/) [CWD-relative]
 *   --workers-only          Only generate Worker Thread outputs (skip Main Thread)
 *   --main-only             Only generate Main Thread outputs (skip Worker Thread)
 *   --color-engine=<path>   Path to color-engine package [CWD-relative]
 */

// =============================================================================
// AGENT RESTRICTIONS - READ BEFORE MODIFYING
// =============================================================================
//
// PATH RESOLUTION RULES:
//
// 1. HARDCODED FIXTURES (TEST_INPUTS, TEST_PROFILES):
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
import { PDFDocument } from 'pdf-lib';

// Script location - used for finding package-internal resources
const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICES_DIR = join(__dirname, '..', '..', 'services');
const FIXTURES_DIR = join(__dirname, '..', '..', 'tests', 'fixtures');

// Test inputs - paths relative to __dirname (hardcoded fixtures)
const TEST_INPUTS = [
    {
        name: 'Type Sizes and Lissajou',
        path: join(FIXTURES_DIR, 'pdfs', '2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou.pdf'),
        baseName: '2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou',
    },
    {
        name: 'Interlaken Map',
        path: join(FIXTURES_DIR, 'pdfs', '2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map.pdf'),
        baseName: '2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map',
    },
];

// Test profiles - paths relative to __dirname (hardcoded fixtures)
const TEST_PROFILES = [
    {
        name: 'eciCMYK v2',
        path: join(FIXTURES_DIR, 'profiles', 'eciCMYK v2.icc'),
        intent: 'K-Only',
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
    },
    {
        name: 'FIPS RGB',
        path: join(FIXTURES_DIR, 'profiles', 'FIPS_WIDE_28T-TYPEavg.icc'),
        intent: 'Relative Colorimetric',
        renderingIntent: 'relative-colorimetric',
    },
];

// Conversion methods
const METHODS = [
    { name: 'Main', useWorkers: false },
    { name: 'Worker', useWorkers: true },
];

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
                // Extract number: 2026-01-08-001 -> 001
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
    return {
        dir: join(outputBase, `${today}-${nextNum}`),
        folderId: `${today}-${nextNum}`,
    };
}

// ============================================================================
// CLI Argument Parsing (Node.js parseArgs)
// ============================================================================

const { values: options } = parseArgs({
    // Filter out empty strings that may come from shell argument parsing edge cases
    args: process.argv.slice(2).filter(arg => arg.length > 0),
    options: {
        'output-dir': { type: 'string' },
        'workers-only': { type: 'boolean', default: false },
        'main-only': { type: 'boolean', default: false },
        'color-engine': { type: 'string' },
        'help': { type: 'boolean', short: 'h', default: false },
    }
});

/**
 * Load services with optional custom color engine package
 * @param {object} options
 * @param {string | null} [options.colorEngine] - Path to color-engine package (CWD-relative)
 */
async function loadServices(options = {}) {
    const { colorEngine = null } = options;

    // Services are package-internal (relative to script)
    const { PDFService } = await import(join(SERVICES_DIR, 'PDFService.js'));
    const { ColorEngineService } = await import(join(SERVICES_DIR, 'ColorEngineService.js'));
    const { ICCService } = await import(join(SERVICES_DIR, 'ICCService.js'));
    const { WorkerPool } = await import(join(SERVICES_DIR, 'WorkerPool.js'));

    // If a custom color engine package path is specified, load and create engine instance
    let colorEngineInstance = null;
    if (colorEngine) {
        // Resolve the path relative to CWD
        const absolutePath = resolve(process.cwd(), colorEngine, 'src', 'index.js');
        if (!existsSync(absolutePath)) {
            throw new Error(
                `Color engine not found: ${colorEngine}\n` +
                `  Resolved to: ${absolutePath}\n` +
                `  CWD: ${process.cwd()}\n` +
                `  Hint: Run from testing/iso/ptf/2025/experiments/`
            );
        }
        const LittleCMS = await import(absolutePath);
        colorEngineInstance = await LittleCMS.createEngine();
        console.log(`Loaded color engine from: ${colorEngine}`);
    }

    return { PDFService, ColorEngineService, ICCService, WorkerPool, colorEngineInstance };
}

/**
 * Convert a PDF using specified method (main thread or workers)
 */
async function convertPDF(pdfBytes, profileBytes, renderingIntent, useWorkers, services, workerPool) {
    const { PDFService, ColorEngineService, colorEngineInstance } = services;
    const pdfDocument = await PDFDocument.load(pdfBytes);

    // Create ColorEngineService with optional custom engine instance
    const colorEngineService = new ColorEngineService({
        defaultRenderingIntent: renderingIntent,
        colorEngineInstance: colorEngineInstance, // Use custom engine if loaded
    });

    await PDFService.convertColorInPDFDocument(pdfDocument, {
        destinationProfile: profileBytes.buffer.slice(
            profileBytes.byteOffset,
            profileBytes.byteOffset + profileBytes.byteLength
        ),
        renderingIntent: renderingIntent,
        convertImages: true,
        convertContentStreams: true,
        blackPointCompensation: true,
        verbose: false,
        colorEngineService: colorEngineService,
        useWorkers: useWorkers,
        workerPool: useWorkers ? workerPool : null,
    });

    return pdfDocument;
}

/**
 * Apply full workflow (transparency blending + output intent)
 */
async function applyFullWorkflow(pdfDocument, profileBytes, profileName, services) {
    const { PDFService, ICCService } = services;

    // Get output color space from profile
    const destHeader = ICCService.parseICCHeaderFromSource(profileBytes);
    const outputColorSpace = destHeader.colorSpace ?? 'CMYK';

    // Update transparency blending
    await PDFService.replaceTransarencyBlendingSpaceInPDFDocument(pdfDocument, outputColorSpace);

    // Set output intent
    PDFService.setOutputIntentForPDFDocument(pdfDocument, {
        subType: 'GTS_PDFX',
        iccProfile: profileBytes,
        identifier: profileName,
        info: profileName,
    });

    return pdfDocument;
}

async function main() {
    console.log('Generate Visual Tests');
    console.log('=====================');
    console.log(`CWD: ${process.cwd()}`);
    console.log('');

    // Show help if requested
    if (options['help']) {
        console.log(`
Usage:
  node scripts/generate-visual-tests.js [options]

Options:
  --output-dir=<path>     Output directory [CWD-relative] (default: auto-numbered)
  --workers-only          Only generate Worker Thread outputs (skip Main Thread)
  --main-only             Only generate Main Thread outputs (skip Worker Thread)
  --color-engine=<path>   Path to color-engine package [CWD-relative]
  -h, --help              Show this help message
`);
        process.exit(0);
    }

    // Determine output directory (CWD-relative)
    let outputDir, folderId;
    if (options['output-dir']) {
        outputDir = resolve(process.cwd(), options['output-dir']);
        folderId = basename(outputDir);
    } else {
        const nextDir = await getNextOutputDir();
        outputDir = nextDir.dir;
        folderId = nextDir.folderId;
    }

    // Determine which methods to run
    let methodsToRun = METHODS;
    if (options['workers-only']) {
        methodsToRun = METHODS.filter(m => m.useWorkers);
    } else if (options['main-only']) {
        methodsToRun = METHODS.filter(m => !m.useWorkers);
    }

    // Extract package name for display
    const colorEngine = options['color-engine'];
    const packageName = colorEngine
        ? basename(colorEngine)
        : 'default (symlinked)';

    console.log('Configuration:');
    console.log(`  Output: ${outputDir}`);
    console.log(`  Folder ID: ${folderId}`);
    console.log(`  Methods: ${methodsToRun.map(m => m.name).join(', ')}`);
    console.log(`  Package: ${packageName}`);
    console.log('');

    // Create output directory
    await mkdir(outputDir, { recursive: true });

    // Set up logging
    const logPath = join(outputDir, 'visual-tests.log');
    const logStream = createWriteStream(logPath);
    const log = (msg) => {
        console.log(msg);
        logStream.write(msg + '\n');
    };

    // Load services with optional custom color engine
    log('Loading services...');
    const services = await loadServices({ colorEngine });
    log('Services loaded');

    // Create worker pool (for worker method)
    let workerPool = null;
    if (methodsToRun.some(m => m.useWorkers)) {
        log('Creating worker pool...');
        workerPool = new services.WorkerPool();
        await workerPool.initialize();
        log(`Worker pool initialized with ${workerPool.workerCount} workers`);
    }

    const results = [];
    let testNum = 0;
    const totalTests = TEST_INPUTS.length * TEST_PROFILES.length * methodsToRun.length;

    for (const input of TEST_INPUTS) {
        // input.path is already absolute (via FIXTURES_DIR)
        if (!existsSync(input.path)) {
            log(`\nSkipping ${input.name}: File not found`);
            log(`  Path: ${input.path}`);
            continue;
        }

        // Load input PDF
        const pdfBytes = await readFile(input.path);
        log(`\nLoaded: ${input.name} (${(pdfBytes.length / 1024 / 1024).toFixed(2)} MB)`);

        for (const profile of TEST_PROFILES) {
            // profile.path is already absolute (via FIXTURES_DIR)
            if (!existsSync(profile.path)) {
                log(`  Skipping profile ${profile.name}: File not found`);
                log(`    Path: ${profile.path}`);
                continue;
            }

            // Load profile
            const profileBytes = await readFile(profile.path);

            for (const method of methodsToRun) {
                testNum++;
                log(`\n- Test ${testNum}/${totalTests}: ${input.name} + ${profile.name} (${profile.intent}) + ${method.name} -`);

                try {
                    const startTime = performance.now();

                    // Convert using specified method
                    const pdfDocument = await convertPDF(
                        pdfBytes,
                        profileBytes,
                        profile.renderingIntent,
                        method.useWorkers,
                        services,
                        workerPool
                    );

                    // Apply full workflow
                    await applyFullWorkflow(
                        pdfDocument,
                        profileBytes,
                        profile.name,
                        services
                    );

                    const elapsed = performance.now() - startTime;

                    // Generate output filename following convention:
                    // <original-filename> - <profile-name> - <intent> - <Main|Worker> (YYYY-MM-DD-XXX).pdf
                    const outputFilename = `${input.baseName} - ${profile.name} - ${profile.intent} - ${method.name} (${folderId}).pdf`;
                    const outputPath = join(outputDir, outputFilename);

                    // Save
                    const outputBytes = await pdfDocument.save();
                    await writeFile(outputPath, outputBytes);

                    const result = {
                        testNum,
                        input: input.name,
                        profile: profile.name,
                        intent: profile.intent,
                        method: method.name,
                        filename: outputFilename,
                        size: outputBytes.length,
                        elapsed: Math.round(elapsed),
                        success: true,
                    };
                    results.push(result);

                    log(`  Time: ${Math.round(elapsed)}ms`);
                    log(`  Size: ${(outputBytes.length / 1024 / 1024).toFixed(2)} MB`);
                    log(`  Output: ${outputFilename}`);

                } catch (error) {
                    log(`  Error: ${error.message}`);
                    results.push({
                        testNum,
                        input: input.name,
                        profile: profile.name,
                        intent: profile.intent,
                        method: method.name,
                        error: error.message,
                        success: false,
                    });
                }
            }
        }
    }

    // Cleanup worker pool
    if (workerPool) {
        log('\nShutting down worker pool...');
        await workerPool.terminate();
    }

    // Summary
    log('\n' + '='.repeat(60));
    log('Summary');
    log('='.repeat(60));

    const successCount = results.filter(r => r.success).length;
    log(`\nGenerated ${successCount}/${totalTests} PDFs:`);

    for (const r of results) {
        if (r.success) {
            log(`  [OK] #${r.testNum}: ${r.input} + ${r.profile} + ${r.method} (${r.elapsed}ms)`);
        } else {
            log(`  [FAIL] #${r.testNum}: ${r.input} + ${r.profile} + ${r.method}: ${r.error}`);
        }
    }

    // Save results JSON
    const resultsPath = join(outputDir, 'visual-tests-results.json');
    await writeFile(resultsPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        folderId,
        totalTests,
        successCount,
        results,
    }, null, 2));

    log(`\nResults saved to: ${resultsPath}`);
    log(`Log saved to: ${logPath}`);

    logStream.end();

    console.log('\n' + '='.repeat(60));
    if (successCount === totalTests) {
        console.log('All PDFs generated successfully');
    } else {
        console.log(`${totalTests - successCount} PDFs failed`);
    }
    console.log('='.repeat(60));
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
