#!/usr/bin/env node
// @ts-check
/**
 * Trace PDF Conversion Script
 *
 * Traces PDF color conversion pipeline, showing values at each step.
 * Useful for debugging the full conversion flow.
 *
 * IMPORTANT: This script behaves like a standard CLI tool.
 * - All paths are resolved RELATIVE TO CWD
 * - Run from the experiments directory: testing/iso/ptf/2025/experiments/
 *
 * Example (from experiments/):
 *   node scripts/trace-pdf-conversion.js \
 *       "../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf" \
 *       --color-engine ../packages/color-engine-2026-01-21 \
 *       --profile "../tests/fixtures/profiles/eciCMYK v2.icc" \
 *       --page 1
 */

// =============================================================================
// AGENT RESTRICTIONS - READ BEFORE MODIFYING
// =============================================================================
//
// This script intentionally uses SIMPLE CWD-RELATIVE path resolution.
// DO NOT add any of the following "magic" path resolution patterns:
//
// FORBIDDEN PATTERNS:
// - Resolving paths relative to __dirname, experimentsDir, testingDir, etc.
// - Fallback resolution (try CWD, then try fixtures, then try assets...)
// - Short name resolution
// - Basename-only matching
//
// CORRECT BEHAVIOR:
// - All user-provided paths resolve relative to process.cwd()
// - If a path doesn't exist, throw an error with the exact path that failed
// - Script-internal paths (services) use __dirname (package structure)
//
// =============================================================================

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, basename, extname } from 'path';
import { PDFDocument, PDFName, PDFRef, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

// Script location - used ONLY for finding package-internal resources
const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICES_DIR = join(__dirname, '..', '..', '..', 'services');

// ============================================================================
// CLI Argument Parsing
// ============================================================================

const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter(arg => arg.length > 0),
    allowPositionals: true,
    options: {
        'color-engine': { type: 'string' },
        'profile': { type: 'string' },
        'page': { type: 'string', default: '1' },
        'intent': { type: 'string', default: 'k-only-gcr' },
        'convert-images': { type: 'boolean', default: false },
        'output': { type: 'string' },
        'trace-colors': { type: 'boolean', default: true },
        'trace-transforms': { type: 'boolean', default: false },
        'use-workers': { type: 'boolean', default: false },
        'verbose': { type: 'boolean', short: 'v', default: false },
        'help': { type: 'boolean', short: 'h', default: false },
    }
});

const pdfPath = positionals[0];
const colorEnginePath = values['color-engine'];
const profilePath = values['profile'];
const targetPage = parseInt(values['page'] ?? '1', 10);
const intentSpec = values['intent'] ?? 'k-only-gcr';
const convertImages = values['convert-images'] ?? false;
const outputPath = values['output'];
const traceColors = values['trace-colors'] ?? true;
const traceTransforms = values['trace-transforms'] ?? false;
const useWorkers = values['use-workers'] ?? false;
const verbose = values['verbose'] ?? false;

// ============================================================================
// Help
// ============================================================================

if (values.help || !pdfPath || !colorEnginePath || !profilePath) {
    console.log(`
Trace PDF Conversion Script

Traces PDF color conversion pipeline, showing values at each step.

Usage:
  node scripts/trace-pdf-conversion.js <pdf> \\
      --color-engine <path> \\
      --profile <path> \\
      [options]

Arguments:
  <pdf>                     Input PDF path (required)

Options:
  --color-engine <path>     Color engine package path (required)
  --profile <path>          Destination ICC profile (required)
  --page <n>                Page to trace (1-indexed, default: 1)
  --intent <name>           Rendering intent (default: k-only-gcr):
                            - perceptual
                            - relative-colorimetric
                            - k-only-gcr
  --convert-images          Also convert images (default: false for faster tracing)
  --output <path>           Save converted PDF to this path
  --trace-colors            Show color value transformations (default: true)
  --trace-transforms        Show detailed transform operations (default: false)
  --use-workers             Use worker-based conversion (default: false)
  --verbose, -v             Show all conversion steps
  --help, -h                Show this help message

Examples:
  # Trace content stream conversion on page 1
  node scripts/trace-pdf-conversion.js \\
      "../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf" \\
      --color-engine ../packages/color-engine-2026-01-21 \\
      --profile "../tests/fixtures/profiles/eciCMYK v2.icc" \\
      --page 1 \\
      --verbose

  # Full conversion with output
  node scripts/trace-pdf-conversion.js \\
      "../tests/fixtures/pdfs/source.pdf" \\
      --color-engine ../packages/color-engine-2026-01-21 \\
      --profile "../tests/fixtures/profiles/eciCMYK v2.icc" \\
      --convert-images \\
      --output "./output/traced-output.pdf"
`);
    process.exit(values.help ? 0 : 1);
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Resolve a user-provided path relative to CWD.
 * @param {string} userPath
 * @param {string} pathType
 * @returns {string}
 */
function resolvePath(userPath, pathType) {
    const absolutePath = resolve(process.cwd(), userPath);
    if (!existsSync(absolutePath)) {
        throw new Error(
            `${pathType} not found: ${userPath}\n` +
            `  Resolved to: ${absolutePath}\n` +
            `  CWD: ${process.cwd()}`
        );
    }
    return absolutePath;
}

// ============================================================================
// Rendering Intent Mapping
// ============================================================================

/**
 * Map intent name to PDFService intent string
 * @param {string} intentName
 * @returns {string}
 */
function getIntentString(intentName) {
    const lower = intentName.toLowerCase().replace(/-/g, '');
    switch (lower) {
        case 'perceptual': return 'perceptual';
        case 'relativecolorimetric': return 'relative-colorimetric';
        case 'saturation': return 'saturation';
        case 'absolutecolorimetric': return 'absolute-colorimetric';
        case 'konlygcr':
        case 'preservekonlyrelativecolorimetricgcr':
            return 'preserve-k-only-relative-colorimetric-gcr';
        default: return intentName;
    }
}

/**
 * Get intent display name
 * @param {string} intentName
 * @returns {string}
 */
function getIntentDisplayName(intentName) {
    const lower = intentName.toLowerCase().replace(/-/g, '');
    switch (lower) {
        case 'perceptual': return 'Perceptual';
        case 'relativecolorimetric': return 'Relative Colorimetric';
        case 'saturation': return 'Saturation';
        case 'absolutecolorimetric': return 'Absolute Colorimetric';
        case 'konlygcr':
        case 'preservekonlyrelativecolorimetricgcr':
            return 'K-Only GCR Relative Colorimetric';
        default: return intentName;
    }
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Analyze output PDF content stream for CMYK colors
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {number} pageIndex
 * @returns {Promise<{ kOnly: number, nonKOnly: number, samples: Array<{c: number, m: number, y: number, k: number}> }>}
 */
async function analyzeOutputColors(pdfDoc, pageIndex) {
    const page = pdfDoc.getPage(pageIndex);
    const context = pdfDoc.context;

    const contents = page.node.get(PDFName.of('Contents'));
    /** @type {PDFRef[]} */
    const streamRefs = [];

    if (contents instanceof PDFRef) {
        streamRefs.push(contents);
    } else if (contents instanceof PDFArray) {
        for (let i = 0; i < contents.size(); i++) {
            const ref = contents.get(i);
            if (ref instanceof PDFRef) {
                streamRefs.push(ref);
            }
        }
    }

    let kOnly = 0;
    let nonKOnly = 0;
    /** @type {Array<{c: number, m: number, y: number, k: number}>} */
    const samples = [];

    for (const ref of streamRefs) {
        const stream = context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) continue;

        try {
            const decoded = decodePDFRawStream(stream).decode();
            const text = new TextDecoder().decode(decoded);

            // Match all DeviceCMYK k/K operations
            const kPattern = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(k|K)/g;
            for (const m of text.matchAll(kPattern)) {
                const c = parseFloat(m[1]);
                const mVal = parseFloat(m[2]);
                const y = parseFloat(m[3]);
                const k = parseFloat(m[4]);

                const isKOnlyColor = c < 0.01 && mVal < 0.01 && y < 0.01;
                if (isKOnlyColor) {
                    kOnly++;
                } else {
                    nonKOnly++;
                    if (samples.length < 10) {
                        samples.push({ c, m: mVal, y, k });
                    }
                }
            }
        } catch (e) {
            // Ignore decode errors
        }
    }

    return { kOnly, nonKOnly, samples };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    const resolvedPDFPath = resolvePath(pdfPath, 'PDF');
    const resolvedEnginePath = resolvePath(colorEnginePath, 'Color engine');
    const resolvedProfilePath = resolvePath(profilePath, 'Profile');

    console.log('═'.repeat(80));
    console.log('PDF Color Conversion Trace');
    console.log('═'.repeat(80));
    console.log('');
    console.log('Configuration:');
    console.log(`  PDF: ${basename(resolvedPDFPath)}`);
    console.log(`  Profile: ${basename(resolvedProfilePath)}`);
    console.log(`  Engine: ${basename(resolvedEnginePath)}`);
    console.log(`  Intent: ${getIntentDisplayName(intentSpec)}`);
    console.log(`  Page: ${targetPage}`);
    console.log(`  Convert images: ${convertImages}`);
    console.log(`  Use workers: ${useWorkers}`);
    console.log('');

    // Load PDF
    const pdfBytes = await readFile(resolvedPDFPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();

    console.log(`PDF loaded: ${pageCount} pages`);
    console.log('');

    if (targetPage < 1 || targetPage > pageCount) {
        throw new Error(`Invalid page number: ${targetPage} (PDF has ${pageCount} pages)`);
    }

    // Load profile
    const profileBytes = await readFile(resolvedProfilePath);
    const destinationProfile = profileBytes.buffer.slice(
        profileBytes.byteOffset,
        profileBytes.byteOffset + profileBytes.byteLength
    );

    // Import services
    const { ColorEngineService } = await import(join(SERVICES_DIR, 'ColorEngineService.js'));
    const { PDFService } = await import(join(SERVICES_DIR, 'PDFService.js'));

    // Initialize color engine
    const colorEngine = new ColorEngineService();

    // Initialize worker pool if needed
    let workerPool = null;
    if (useWorkers) {
        const { WorkerPool } = await import(join(SERVICES_DIR, 'WorkerPool.js'));
        workerPool = new WorkerPool({ workerCount: 4 });
        await workerPool.initialize();
        console.log('Worker pool initialized (4 workers)');
    }

    console.log('─'.repeat(80));
    console.log('Running Conversion');
    console.log('─'.repeat(80));
    console.log('');

    const startTime = performance.now();

    // Run conversion
    await PDFService.convertColorInPDFDocument(pdfDoc, {
        destinationProfile,
        renderingIntent: getIntentString(intentSpec),
        convertImages,
        convertContentStreams: true,
        verbose: verbose,
        colorEngineService: colorEngine,
        useWorkers,
        workerPool,
    });

    const elapsedTime = performance.now() - startTime;

    // Cleanup worker pool
    if (workerPool) {
        await workerPool.terminate();
    }

    console.log('');
    console.log(`Conversion completed in ${elapsedTime.toFixed(0)}ms`);
    console.log('');

    // Analyze output
    if (traceColors) {
        console.log('─'.repeat(80));
        console.log(`Analyzing Output (Page ${targetPage})`);
        console.log('─'.repeat(80));
        console.log('');

        const analysis = await analyzeOutputColors(pdfDoc, targetPage - 1);

        console.log('DeviceCMYK colors found:');
        console.log(`  K-only (C=M=Y≈0): ${analysis.kOnly}`);
        console.log(`  Non-K-only: ${analysis.nonKOnly}`);

        if (analysis.samples.length > 0) {
            console.log('');
            console.log('Non-K-only samples (potential issues):');
            for (const s of analysis.samples) {
                console.log(`  CMYK[${s.c.toFixed(3)}, ${s.m.toFixed(3)}, ${s.y.toFixed(3)}, ${s.k.toFixed(3)}]`);
            }
        }

        console.log('');
    }

    // Save output if requested
    if (outputPath) {
        const resolvedOutputPath = resolve(process.cwd(), outputPath);
        const outputBytes = await pdfDoc.save();

        // Ensure output directory exists
        await mkdir(dirname(resolvedOutputPath), { recursive: true });
        await writeFile(resolvedOutputPath, outputBytes);

        console.log(`Output saved: ${resolvedOutputPath}`);
        console.log(`Output size: ${(outputBytes.length / (1024 * 1024)).toFixed(2)} MB`);
    }

    // Test individual color transforms if requested
    if (traceTransforms) {
        console.log('');
        console.log('─'.repeat(80));
        console.log('Transform Trace (Sample Colors)');
        console.log('─'.repeat(80));
        console.log('');

        // Test some common gray values
        const testColors = [
            { rgb: [0, 0, 0], label: 'Black' },
            { rgb: [255, 255, 255], label: 'White' },
            { rgb: [242, 242, 242], label: '95% gray' },
            { rgb: [128, 128, 128], label: '50% gray' },
            { rgb: [26, 26, 26], label: '10% gray' },
        ];

        const colors = testColors.map(({ rgb }) => ({
            type: /** @type {const} */ ('RGB'),
            values: rgb,
        }));

        const results = await colorEngine.convertColors(colors, {
            sourceProfile: 'sRGB',
            destinationProfile,
            renderingIntent: getIntentString(intentSpec),
        });

        console.log('sRGB → CMYK Transform Results:');
        console.log('Input                    → Output                   Status');
        console.log('─'.repeat(65));

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const [c, m, y, k] = result.output.values;
            const isKOnly = c < 0.02 && m < 0.02 && y < 0.02;
            const status = isKOnly ? '✓ K-only' : '(colored)';

            console.log(
                `RGB[${testColors[i].rgb.map(v => v.toString().padStart(3)).join(', ')}] ${testColors[i].label.padEnd(10)} → ` +
                `CMYK[${c.toFixed(3)}, ${m.toFixed(3)}, ${y.toFixed(3)}, ${k.toFixed(3)}] ${status}`
            );
        }
    }

    console.log('');
    console.log('Done.');
}

main().catch(err => {
    console.error('Error:', err.message);
    if (verbose) {
        console.error(err.stack);
    }
    process.exit(1);
});
