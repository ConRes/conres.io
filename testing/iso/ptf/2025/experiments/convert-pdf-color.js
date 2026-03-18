#!/usr/bin/env node
// @ts-check
/**
 * PDF Color Conversion CLI Tool
 *
 * Converts colors in a PDF document from ICC-based/device color spaces to a destination profile.
 *
 * Uses the new class-based implementation by default.
 * Use --legacy flag for the original procedural implementation.
 *
 * @module convert-pdf-color
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { argv, exit } from 'process';
import { DiagnosticsCollector } from '../classes/diagnostics/diagnostics-collector.js';
import { MainDiagnosticsCollector } from '../classes/diagnostics/main-diagnostics-collector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Constants
// ============================================================================

const RENDERING_INTENT_ALIASES = {
    // K-Only GCR (default)
    'k-only': 'preserve-k-only-relative-colorimetric-gcr',
    'k-only-gcr': 'preserve-k-only-relative-colorimetric-gcr',
    'preserve-k-only': 'preserve-k-only-relative-colorimetric-gcr',
    'preserve-k-only-relative-colorimetric-gcr': 'preserve-k-only-relative-colorimetric-gcr',
    '20': 'preserve-k-only-relative-colorimetric-gcr',
    // Perceptual
    'perceptual': 'perceptual',
    '0': 'perceptual',
    // Relative Colorimetric
    'relative': 'relative-colorimetric',
    'relative-colorimetric': 'relative-colorimetric',
    '1': 'relative-colorimetric',
    // Saturation
    'saturation': 'saturation',
    '2': 'saturation',
    // Absolute Colorimetric
    'absolute': 'absolute-colorimetric',
    'absolute-colorimetric': 'absolute-colorimetric',
    '3': 'absolute-colorimetric',
};

// ============================================================================
// Argument Parsing
// ============================================================================

function printUsage() {
    console.log(`
PDF Color Conversion CLI Tool (Class-Based Implementation)

Usage:
  node convert-pdf-color.js <input.pdf> <profile.icc> <output.pdf> [options]

Profile Assignment Mode:
  --assign-profile-only             Assign profile without converting colors.
                                    Replaces Device* color spaces with ICCBased
                                    referencing the provided profile.

Rendering Intent Options:
  --rendering-intent=<intent>, --intent=<intent>
    k-only, k-only-gcr (default)
    perceptual
    relative, relative-colorimetric
    saturation
    absolute, absolute-colorimetric

Black Point Compensation:
  --bpc, --with-bpc                   Enable BPC (default for K-Only)
  --no-bpc, --without-bpc             Disable BPC

Image/Content Stream Options:
  --images, --no-images               Enable/disable image conversion (default: enabled)
  --content-streams, --no-content-streams  Enable/disable content stream conversion (default: enabled)

Worker Options:
  --workers=<N>                       Use N worker threads (0 = main thread only)
  --workers, --use-workers            Enable worker threads (default: enabled)
  --no-workers, --main-thread         Disable workers (main thread only)

Diagnostics Options:
  --show-diagnostics                  Show hierarchical diagnostics summary after conversion
  --show-traces                       Show flat event trace log after conversion
  --save-diagnostics=<file.json>      Save raw diagnostics JSON to file

Color Engine Options:
  --color-engine=<path>               Path to color engine package (CWD-relative or absolute)
                                      e.g., ../packages/color-engine-2026-01-30

Output Format Options:
  --output-bits=<8|16|32>             Output bits per component (default: 8)
  --output-endianness=<big|little>    Output endianness for 16-bit (default: big)

Other Options:
  --verbose                           Enable verbose output
  --legacy                            Use legacy procedural implementation
  --help, -h                          Show this help message

Examples:
  node convert-pdf-color.js input.pdf profile.icc output.pdf
  node convert-pdf-color.js input.pdf profile.icc output.pdf --relative-colorimetric --no-bpc
  node convert-pdf-color.js input.pdf profile.icc output.pdf --legacy
`);
}

function parseArgs(args) {
    const positional = [];
    const options = {
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        blackPointCompensation: null, // null = auto based on intent
        convertImages: true,
        convertContentStreams: true,
        useWorkers: true,
        expectedWorkerCount: undefined, // undefined = no validation, number = validate
        verbose: false,
        useLegacy: false,
        showDiagnostics: false,
        showTraces: false,
        saveDiagnostics: null,
        assignProfileOnly: false,
        colorEnginePath: null, // null = use default bundled engine
        overrides: {}, // outputBitsPerComponent, outputEndianness
    };

    for (const arg of args) {
        // Help
        if (arg === '--help' || arg === '-h') {
            printUsage();
            exit(0);
        }

        // Legacy flag
        if (arg === '--legacy') {
            options.useLegacy = true;
            continue;
        }

        // Rendering intent with value
        if (arg.startsWith('--rendering-intent=') || arg.startsWith('--intent=')) {
            const value = arg.split('=')[1].toLowerCase();
            options.renderingIntent = RENDERING_INTENT_ALIASES[value] || value;
            continue;
        }

        // Rendering intent shortcuts
        if (arg === '--k-only' || arg === '--k-only-gcr' || arg === '--preserve-k-only') {
            options.renderingIntent = 'preserve-k-only-relative-colorimetric-gcr';
            continue;
        }
        if (arg === '--perceptual') {
            options.renderingIntent = 'perceptual';
            continue;
        }
        if (arg === '--relative' || arg === '--relative-colorimetric') {
            options.renderingIntent = 'relative-colorimetric';
            continue;
        }
        if (arg === '--saturation') {
            options.renderingIntent = 'saturation';
            continue;
        }
        if (arg === '--absolute' || arg === '--absolute-colorimetric') {
            options.renderingIntent = 'absolute-colorimetric';
            continue;
        }

        // Black point compensation
        if (arg === '--bpc' || arg === '--with-bpc' || arg === '--blackpoint-compensation') {
            options.blackPointCompensation = true;
            continue;
        }
        if (arg === '--no-bpc' || arg === '--without-bpc' || arg === '--no-blackpoint-compensation') {
            options.blackPointCompensation = false;
            continue;
        }

        // Images
        if (arg === '--images') {
            options.convertImages = true;
            continue;
        }
        if (arg === '--no-images') {
            options.convertImages = false;
            continue;
        }

        // Content streams
        if (arg === '--content-streams') {
            options.convertContentStreams = true;
            continue;
        }
        if (arg === '--no-content-streams') {
            options.convertContentStreams = false;
            continue;
        }

        // Workers - accept --workers=N format
        if (arg.startsWith('--workers=')) {
            const count = parseInt(arg.split('=')[1], 10);
            options.useWorkers = count > 0;
            options.expectedWorkerCount = count;
            continue;
        }
        if (arg === '--workers' || arg === '--use-workers') {
            options.useWorkers = true;
            continue;
        }
        if (arg === '--no-workers' || arg === '--main-thread') {
            options.useWorkers = false;
            options.expectedWorkerCount = 0;
            continue;
        }

        // Verbose
        if (arg === '--verbose') {
            options.verbose = true;
            continue;
        }

        // Assign profile only mode
        if (arg === '--assign-profile-only') {
            options.assignProfileOnly = true;
            continue;
        }

        // Diagnostics flags
        if (arg === '--show-diagnostics') {
            options.showDiagnostics = true;
            continue;
        }
        if (arg === '--show-traces') {
            options.showTraces = true;
            continue;
        }
        if (arg.startsWith('--save-diagnostics=')) {
            options.saveDiagnostics = arg.split('=')[1];
            continue;
        }

        // Color engine path (CWD-relative or absolute)
        if (arg.startsWith('--color-engine=')) {
            options.colorEnginePath = arg.split('=')[1];
            continue;
        }

        // Output format overrides
        if (arg.startsWith('--output-bits=')) {
            const bits = parseInt(arg.split('=')[1], 10);
            if (![8, 16, 32].includes(bits)) {
                console.error(`Invalid output bits: ${bits}. Must be 8, 16, or 32.`);
                exit(1);
            }
            options.overrides.outputBitsPerComponent = bits;
            continue;
        }
        if (arg.startsWith('--output-endianness=')) {
            const endianness = arg.split('=')[1].toLowerCase();
            if (!['big', 'little'].includes(endianness)) {
                console.error(`Invalid output endianness: ${endianness}. Must be 'big' or 'little'.`);
                exit(1);
            }
            options.overrides.outputEndianness = endianness;
            continue;
        }

        // Positional arguments
        if (!arg.startsWith('-')) {
            positional.push(arg);
        }
    }

    // Auto-enable BPC for K-Only intent if not explicitly set
    if (options.blackPointCompensation === null) {
        options.blackPointCompensation = options.renderingIntent === 'preserve-k-only-relative-colorimetric-gcr';
    }

    return { positional, options };
}

// ============================================================================
// Profile Assignment Mode
// ============================================================================

/**
 * Assigns an ICC profile to matching Device* color spaces without converting colors.
 *
 * This function:
 * 1. Detects the ICC profile's color space (Gray, RGB, CMYK)
 * 2. Finds images and content stream color space definitions using matching Device* color spaces
 * 3. Embeds the ICC profile in the PDF (or reuses existing identical profile)
 * 4. Replaces Device* references with ICCBased referencing the embedded profile
 *
 * @param {import('pdf-lib').PDFDocument} pdfDocument - The PDF document to modify
 * @param {Uint8Array} profileBytes - The ICC profile bytes
 * @param {object} options - Options
 * @param {boolean} options.processImages - Whether to process images
 * @param {boolean} options.processContentStreams - Whether to process content streams
 * @param {boolean} options.verbose - Whether to log verbose output
 * @returns {Promise<{
 *   imagesAssigned: number,
 *   contentStreamColorSpacesAssigned: number,
 *   profileEmbedded: boolean,
 *   profileRef: import('pdf-lib').PDFRef | null,
 *   errors: string[],
 * }>}
 */
async function assignProfileToDocument(pdfDocument, profileBytes, options) {
    const { PDFName, PDFArray, PDFDict, PDFRef, PDFRawStream } = await import('pdf-lib');
    const { ICCService } = await import('../services/ICCService.js');

    /** @type {string[]} */
    const errors = [];
    let imagesAssigned = 0;
    let contentStreamColorSpacesAssigned = 0;

    // Parse ICC profile header to determine color space
    const profileHeader = ICCService.parseICCHeaderFromSource(profileBytes);
    const profileColorSpace = /** @type {string} */ (profileHeader.colorSpace); // 'GRAY', 'RGB', or 'CMYK'

    // Map ICC color space to Device* color space name
    /** @type {Record<string, string>} */
    const deviceColorSpaceMap = {
        'GRAY': 'DeviceGray',
        'RGB': 'DeviceRGB',
        'CMYK': 'DeviceCMYK',
    };
    const targetDeviceColorSpace = deviceColorSpaceMap[profileColorSpace];

    if (!targetDeviceColorSpace) {
        errors.push(`Unsupported ICC profile color space: ${profileColorSpace}`);
        return { imagesAssigned, contentStreamColorSpacesAssigned, profileEmbedded: false, profileRef: null, errors };
    }

    // Determine N value for ICCBased color space
    /** @type {Record<string, number>} */
    const nValueMap = {
        'DeviceGray': 1,
        'DeviceRGB': 3,
        'DeviceCMYK': 4,
    };
    const nValue = nValueMap[targetDeviceColorSpace];

    if (options.verbose) {
        console.log(`[assignProfileToDocument] Profile color space: ${profileColorSpace}`);
        console.log(`[assignProfileToDocument] Target Device* color space: ${targetDeviceColorSpace}`);
        console.log(`[assignProfileToDocument] N value: ${nValue}`);
    }

    const pdfContext = pdfDocument.context;

    // Embed the ICC profile as a stream
    // Create the ICC profile stream with required /N parameter
    const iccStreamDict = pdfContext.obj({
        N: nValue,
        Filter: 'FlateDecode',
    });

    // Compress the profile bytes
    const pako = await import('pako');
    const compressedProfileBytes = pako.deflate(profileBytes);

    // Create the stream and register it
    const iccStream = PDFRawStream.of(iccStreamDict, compressedProfileBytes);
    const iccProfileRef = pdfContext.register(iccStream);

    if (options.verbose) {
        console.log(`[assignProfileToDocument] Embedded ICC profile as ${iccProfileRef.toString()}`);
    }

    // Create the ICCBased color space array: [/ICCBased <profile-ref>]
    const iccBasedColorSpace = pdfContext.obj([
        PDFName.of('ICCBased'),
        iccProfileRef,
    ]);
    const iccBasedColorSpaceRef = pdfContext.register(iccBasedColorSpace);

    // Process images if enabled
    if (options.processImages) {
        const pages = pdfDocument.getPages();

        for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
            const page = pages[pageIndex];
            const pageDict = pdfContext.lookup(page.ref);

            if (!(pageDict instanceof PDFDict)) continue;

            // Get Resources/XObject dictionary
            const resources = pageDict.get(PDFName.of('Resources'));
            if (!resources) continue;

            const resourcesDict = resources instanceof PDFRef
                ? pdfContext.lookup(resources)
                : resources;
            if (!(resourcesDict instanceof PDFDict)) continue;

            const xobject = resourcesDict.get(PDFName.of('XObject'));
            if (!xobject) continue;

            const xobjectDict = xobject instanceof PDFRef
                ? pdfContext.lookup(xobject)
                : xobject;
            if (!(xobjectDict instanceof PDFDict)) continue;

            // Iterate through XObjects to find images
            for (const [name, ref] of xobjectDict.entries()) {
                if (!(ref instanceof PDFRef)) continue;

                const obj = pdfContext.lookup(ref);
                if (!(obj instanceof PDFRawStream)) continue;

                const subtype = obj.dict.get(PDFName.of('Subtype'));
                if (!(subtype instanceof PDFName) || subtype.asString() !== '/Image') continue;

                // Check the ColorSpace
                const colorSpace = obj.dict.get(PDFName.of('ColorSpace'));
                if (!colorSpace) continue;

                let currentColorSpaceName = null;
                if (colorSpace instanceof PDFName) {
                    currentColorSpaceName = colorSpace.asString().replace(/^\//, '');
                } else if (colorSpace instanceof PDFRef) {
                    const csObj = pdfContext.lookup(colorSpace);
                    if (csObj instanceof PDFName) {
                        currentColorSpaceName = csObj.asString().replace(/^\//, '');
                    }
                }

                // Check if it matches our target Device* color space
                if (currentColorSpaceName === targetDeviceColorSpace) {
                    // Replace with ICCBased reference
                    obj.dict.set(PDFName.of('ColorSpace'), iccBasedColorSpaceRef);
                    imagesAssigned++;

                    if (options.verbose) {
                        console.log(`[assignProfileToDocument] Page ${pageIndex + 1}: Image ${name.asString()} - replaced ${currentColorSpaceName} with ICCBased`);
                    }
                }
            }
        }
    }

    // Process content stream color space definitions if enabled
    if (options.processContentStreams) {
        const pages = pdfDocument.getPages();

        for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
            const page = pages[pageIndex];
            const pageDict = pdfContext.lookup(page.ref);

            if (!(pageDict instanceof PDFDict)) continue;

            // Get Resources dictionary
            const resources = pageDict.get(PDFName.of('Resources'));
            if (!resources) continue;

            const resourcesDict = resources instanceof PDFRef
                ? pdfContext.lookup(resources)
                : resources;
            if (!(resourcesDict instanceof PDFDict)) continue;

            // Get ColorSpace dictionary from Resources
            const colorSpaceEntry = resourcesDict.get(PDFName.of('ColorSpace'));
            if (!colorSpaceEntry) continue;

            const colorSpaceDict = colorSpaceEntry instanceof PDFRef
                ? pdfContext.lookup(colorSpaceEntry)
                : colorSpaceEntry;
            if (!(colorSpaceDict instanceof PDFDict)) continue;

            // Iterate through color space definitions
            for (const [csName, csValue] of colorSpaceDict.entries()) {
                let currentColorSpaceName = null;
                let csValueResolved = csValue;

                if (csValue instanceof PDFRef) {
                    const resolved = pdfContext.lookup(csValue);
                    if (resolved) csValueResolved = resolved;
                }

                if (csValueResolved instanceof PDFName) {
                    currentColorSpaceName = csValueResolved.asString().replace(/^\//, '');
                } else if (csValueResolved instanceof PDFArray && csValueResolved.size() > 0) {
                    // Check first element of array (e.g., [/DeviceRGB] or [/ICCBased ...])
                    const firstElement = csValueResolved.get(0);
                    if (firstElement instanceof PDFName) {
                        currentColorSpaceName = firstElement.asString().replace(/^\//, '');
                    }
                }

                // Check if it matches our target Device* color space
                if (currentColorSpaceName === targetDeviceColorSpace) {
                    // Replace with ICCBased reference
                    colorSpaceDict.set(csName, iccBasedColorSpaceRef);
                    contentStreamColorSpacesAssigned++;

                    if (options.verbose) {
                        console.log(`[assignProfileToDocument] Page ${pageIndex + 1}: ColorSpace ${csName.asString()} - replaced ${currentColorSpaceName} with ICCBased`);
                    }
                }
            }
        }
    }

    return {
        imagesAssigned,
        contentStreamColorSpacesAssigned,
        profileEmbedded: true,
        profileRef: iccProfileRef,
        errors,
    };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    const args = argv.slice(2);
    const { positional, options } = parseArgs(args);

    // Handle legacy flag
    if (options.useLegacy) {
        // Remove --legacy from argv (legacy script doesn't need this flag)
        const filteredArgv = argv.filter(arg => arg !== '--legacy');
        process.argv = filteredArgv;
        console.log('[convert-pdf-color] Delegating to legacy implementation');
        await import(join(__dirname, 'legacy', 'convert-pdf-color.js'));
        return;
    }

    // Validate positional arguments
    if (positional.length < 3) {
        console.error('Error: Missing required arguments.');
        console.error('Usage: node convert-pdf-color.js <input.pdf> <profile.icc> <output.pdf> [options]');
        console.error('Use --help for more options.');
        exit(1);
    }

    const [inputPath, profilePath, outputPath] = positional;

    // Special profile identifiers that use built-in profiles (no file needed)
    const SPECIAL_PROFILE_IDENTIFIERS = ['Lab'];
    const isSpecialProfile = SPECIAL_PROFILE_IDENTIFIERS.includes(profilePath);

    // Validate files exist
    if (!existsSync(inputPath)) {
        console.error(`Error: Input PDF not found: ${inputPath}`);
        exit(1);
    }
    if (!isSpecialProfile && !existsSync(profilePath)) {
        console.error(`Error: ICC profile not found: ${profilePath}`);
        exit(1);
    }

    // ========================================================================
    // Profile Assignment Mode (--assign-profile-only)
    // ========================================================================
    if (options.assignProfileOnly) {
        if (isSpecialProfile) {
            console.error(`Error: --assign-profile-only cannot be used with special profile identifier '${profilePath}'`);
            exit(1);
        }
        const { PDFDocument } = await import('pdf-lib');

        if (options.verbose) {
            console.log('[convert-pdf-color] Profile assignment mode (--assign-profile-only)');
        }

        // Load input files
        if (options.verbose) {
            console.log(`Loading PDF: ${inputPath}`);
        }
        const pdfBytes = await readFile(inputPath);
        const pdfDocument = await PDFDocument.load(pdfBytes, {
            updateMetadata: false,
        });

        if (options.verbose) {
            console.log(`Loading ICC profile: ${profilePath}`);
        }
        const profileBytes = await readFile(profilePath);

        // Detect profile color space for logging
        const { ICCService } = await import('../services/ICCService.js');
        const profileHeader = ICCService.parseICCHeaderFromSource(profileBytes);

        if (options.verbose) {
            console.log(`Profile color space: ${profileHeader.colorSpace}`);
            console.log(`Profile description: ${profileHeader.description || 'N/A'}`);
            console.log(`Process images: ${options.convertImages}`);
            console.log(`Process content streams: ${options.convertContentStreams}`);
        }

        const startTime = performance.now();

        // Assign profile to matching Device* color spaces
        const result = await assignProfileToDocument(pdfDocument, profileBytes, {
            processImages: options.convertImages,
            processContentStreams: options.convertContentStreams,
            verbose: options.verbose,
        });

        const elapsed = performance.now() - startTime;

        // Report results
        console.log(`Profile assignment complete in ${elapsed.toFixed(0)}ms`);
        console.log(`  Images assigned: ${result.imagesAssigned}`);
        console.log(`  Content stream color spaces assigned: ${result.contentStreamColorSpacesAssigned}`);
        console.log(`  Profile embedded: ${result.profileEmbedded}`);

        if (result.errors.length > 0) {
            console.log(`  Errors: ${result.errors.length}`);
            for (const error of result.errors) {
                console.log(`    - ${error}`);
            }
        }

        // Save output
        if (options.verbose) {
            console.log(`Saving output: ${outputPath}`);
        }
        const outputBytes = await pdfDocument.save();
        await writeFile(outputPath, outputBytes);
        console.log(`Output saved: ${outputPath}`);

        return;
    }

    // ========================================================================
    // Color Conversion Mode (default)
    // ========================================================================

    // Log and validate worker configuration
    if (options.useWorkers) {
        const { availableParallelism } = await import('os');
        const actualWorkerCount = availableParallelism?.() || 4;
        const expectedCount = options.expectedWorkerCount;

        if (expectedCount !== undefined && expectedCount !== actualWorkerCount) {
            // Warning only - workers are being used, just different count
            console.warn(`[convert-pdf-color] WARNING: Worker count differs - expected ${expectedCount}, actual ${actualWorkerCount}`);
        }
        console.log(`[convert-pdf-color] Workers enabled: ${actualWorkerCount} workers`);
    } else {
        // Workers disabled - check if they were expected
        const expectedCount = options.expectedWorkerCount;
        if (expectedCount !== undefined && expectedCount > 0) {
            // ERROR - workers expected but not used
            console.error(`[convert-pdf-color] ERROR: Workers expected (${expectedCount}) but not used (main thread mode)`);
            exit(1);
        }
        console.log('[convert-pdf-color] Workers disabled: 0 workers (main thread mode)');
    }

    // Load dependencies
    const { PDFDocument } = await import('pdf-lib');
    const { createDocumentColorConverter } = await import('../classes/create-document-color-converter.js');

    // Create diagnostics collector early so we can track file I/O
    // Use MainDiagnosticsCollector when workers are enabled to receive worker diagnostics
    const diagnosticsEnabled = options.showDiagnostics || options.showTraces || options.saveDiagnostics;
    const diagnostics = diagnosticsEnabled
        ? (options.useWorkers ? new MainDiagnosticsCollector() : new DiagnosticsCollector())
        : undefined;

    // Load input files with timing
    if (options.verbose) {
        console.log(`Loading PDF: ${inputPath}`);
    }

    const readPdfSpan = diagnostics?.startSpan('read-pdf', { path: inputPath });
    const pdfBytes = await readFile(inputPath);
    if (diagnostics && readPdfSpan) {
        diagnostics.endSpan(readPdfSpan, { bytes: pdfBytes.length });
    }

    const loadPdfSpan = diagnostics?.startSpan('load-pdf', { bytes: pdfBytes.length });
    const pdfDocument = await PDFDocument.load(pdfBytes, {
        updateMetadata: false,
    });
    if (diagnostics && loadPdfSpan) {
        diagnostics.endSpan(loadPdfSpan, { pages: pdfDocument.getPageCount() });
    }

    /** @type {ArrayBuffer | 'Lab'} */
    let destinationProfile;
    /** @type {'CMYK' | 'RGB' | 'Lab'} */
    let destinationColorSpace;
    /** @type {Buffer | null} */
    let profileBytes = null;
    /** @type {{ colorSpace: string, description?: string } | null} */
    let profileHeader = null;

    if (isSpecialProfile) {
        // Special profile identifier (e.g., 'Lab') - use built-in profile
        if (options.verbose) {
            console.log(`Using built-in profile: ${profilePath}`);
        }
        destinationProfile = /** @type {'Lab'} */ (profilePath);
        destinationColorSpace = /** @type {'Lab'} */ (profilePath);
    } else {
        // Load ICC profile from file
        if (options.verbose) {
            console.log(`Loading ICC profile: ${profilePath}`);
        }

        const readProfileSpan = diagnostics?.startSpan('read-profile', { path: profilePath });
        profileBytes = await readFile(profilePath);
        if (diagnostics && readProfileSpan) {
            diagnostics.endSpan(readProfileSpan, { bytes: profileBytes.length });
        }

        destinationProfile = profileBytes.buffer.slice(
            profileBytes.byteOffset,
            profileBytes.byteOffset + profileBytes.byteLength
        );

        // Detect destination color space from ICC profile header
        const { ICCService } = await import('../services/ICCService.js');
        profileHeader = ICCService.parseICCHeaderFromSource(profileBytes);
        destinationColorSpace = profileHeader.colorSpace === 'RGB' ? 'RGB' : 'CMYK';
    }

    // Extract engine version from color engine path (e.g., "../packages/color-engine-2026-01-30" → "color-engine-2026-01-30")
    let engineVersion = undefined;
    let colorEnginePath = undefined;
    if (options.colorEnginePath) {
        colorEnginePath = options.colorEnginePath;
        // Extract version from directory name (last component of path)
        const dirName = basename(options.colorEnginePath);
        // Match "color-engine-YYYY-MM-DD" pattern
        const versionMatch = dirName.match(/^(color-engine-\d{4}-\d{2}-\d{2})$/);
        if (versionMatch) {
            engineVersion = versionMatch[1];
        } else {
            console.warn(`[convert-pdf-color] WARNING: Could not extract version from color engine path: ${options.colorEnginePath}`);
        }
    }

    // Create converter
    if (options.verbose) {
        console.log('Creating PDFDocumentColorConverter...');
        console.log(`  Destination color space: ${destinationColorSpace}`);
        console.log(`  Rendering intent: ${options.renderingIntent}`);
        console.log(`  Black point compensation: ${options.blackPointCompensation}`);
        console.log(`  Convert images: ${options.convertImages}`);
        console.log(`  Convert content streams: ${options.convertContentStreams}`);
        console.log(`  Use workers: ${options.useWorkers}`);
        console.log(`  Color engine: ${colorEnginePath ?? '(default bundled)'}`);
        console.log(`  Engine version: ${engineVersion ?? '(default)'}`);
        if (options.overrides.outputBitsPerComponent) {
            console.log(`  Output bits per component: ${options.overrides.outputBitsPerComponent}`);
        }
        if (options.overrides.outputEndianness) {
            console.log(`  Output endianness: ${options.overrides.outputEndianness}`);
        }
    }

    const converter = await createDocumentColorConverter({
        renderingIntent: /** @type {any} */ (options.renderingIntent),
        blackPointCompensation: Boolean(options.blackPointCompensation),
        useAdaptiveBPCClamping: true,
        destinationProfile: /** @type {ArrayBuffer} */ (destinationProfile),
        destinationColorSpace,
        convertImages: options.convertImages,
        convertContentStreams: options.convertContentStreams,
        useWorkers: options.useWorkers,
        verbose: options.verbose,
        diagnostics,
        colorEnginePath,
        engineVersion,
        // Output format overrides
        outputBitsPerComponent: options.overrides.outputBitsPerComponent,
        outputEndianness: options.overrides.outputEndianness,
    });

    try {
        await converter.ensureReady();

        // Convert
        if (options.verbose) {
            console.log(`Converting ${pdfDocument.getPageCount()} pages...`);
        }

        const startTime = performance.now();
        const result = await converter.convertColor({ pdfDocument }, {});
        const elapsed = performance.now() - startTime;

        // Report results
        console.log(`Conversion complete in ${elapsed.toFixed(0)}ms`);
        console.log(`  Pages processed: ${result.pagesProcessed}`);
        console.log(`  Images converted: ${result.imagesConverted}`);
        console.log(`  Content streams converted: ${result.contentStreamsConverted}`);

        if (result.errors.length > 0) {
            console.log(`  Errors: ${result.errors.length}`);
            for (const error of result.errors) {
                console.log(`    - ${error}`);
            }
        }

        // Apply full workflow: transparency blending space and output intent
        const { PDFService } = await import('../services/PDFService.js');

        // Replace transparency blending color space to match output
        await PDFService.replaceTransarencyBlendingSpaceInPDFDocument(
            pdfDocument,
            destinationColorSpace // 'CMYK', 'RGB', or 'GRAY'
        );
        if (options.verbose) {
            console.log(`  Transparency blending: updated to ${destinationColorSpace}`);
        }

        // Set output intent with the destination profile (skip for special profiles like 'Lab')
        if (!isSpecialProfile && profileHeader && profileBytes) {
            const profileName = profileHeader.description || basename(profilePath).replace(/\.icc$/i, '');
            PDFService.setOutputIntentForPDFDocument(pdfDocument, {
                subType: 'GTS_PDFX',
                iccProfile: profileBytes,
                identifier: profileName,
                info: profileName,
            });
            if (options.verbose) {
                console.log(`  Output intent: set to ${profileName}`);
            }
        } else if (options.verbose) {
            console.log(`  Output intent: skipped (special profile '${profilePath}')`);
        }

        // Save output
        if (options.verbose) {
            console.log(`Saving output: ${outputPath}`);
        }

        const serializePdfSpan = diagnostics?.startSpan('serialize-pdf', { path: outputPath });
        const outputBytes = await pdfDocument.save();
        if (diagnostics && serializePdfSpan) {
            diagnostics.endSpan(serializePdfSpan, { bytes: outputBytes.length });
        }

        const writePdfSpan = diagnostics?.startSpan('write-pdf', { path: outputPath, bytes: outputBytes.length });
        await writeFile(outputPath, outputBytes);
        if (diagnostics && writePdfSpan) {
            diagnostics.endSpan(writePdfSpan, {});
        }

        console.log(`Output saved: ${outputPath}`);

        // Output diagnostics if requested
        if (diagnostics) {
            if (options.showDiagnostics) {
                console.log('\n=== Diagnostics ===');
                console.log(diagnostics.toText());
            }
            if (options.showTraces) {
                console.log('\n=== Trace Log ===');
                console.log(diagnostics.toTraceLog());
            }
            if (options.saveDiagnostics) {
                const diagnosticsJson = JSON.stringify(diagnostics.toJSON(), null, 2);
                await writeFile(options.saveDiagnostics, diagnosticsJson);
                console.log(`Diagnostics saved to: ${options.saveDiagnostics}`);
            }
        }
    } finally {
        converter.dispose();
    }
}

main().catch(error => {
    console.error('Error:', error.message);
    if (process.env.DEBUG) {
        console.error(error.stack);
    }
    exit(1);
});
