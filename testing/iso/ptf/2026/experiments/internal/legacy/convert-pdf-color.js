#!/usr/bin/env node

/**
 * PDF Color Conversion CLI Tool
 *
 * Converts colors in a PDF document from ICC-based/device color spaces to a destination profile.
 * Also supports extraction of images and content streams for debugging.
 *
 * Usage:
 *   node convert-pdf-color.js <input.pdf> <profile.icc> <output.pdf> [options]
 *   node convert-pdf-color.js <input.pdf> <output-dir> --extract-images-only [options]
 *   node convert-pdf-color.js <input.pdf> <output-dir> --extract-content-streams-only [options]
 *   node convert-pdf-color.js <input.pdf> --generate-document-structure [options]
 *
 * See --help for full options.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, basename, extname } from 'path';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFRawStream, PDFPageLeaf, decodePDFRawStream } from '../../../packages/pdf-lib/pdf-lib.esm.js';
import { DiagnosticsCollector } from '../../classes/diagnostics/diagnostics-collector.js';

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

const TRUTHY_VALUES = new Set(['true', 'yes', 'enabled', 'on', '1']);
const FALSEY_VALUES = new Set(['false', 'no', 'disabled', 'off', '0']);

// ============================================================================
// Argument Parsing
// ============================================================================

function isTruthy(value) {
    if (value === undefined || value === true) return true;
    return TRUTHY_VALUES.has(String(value).toLowerCase());
}

function isFalsey(value) {
    if (value === false) return true;
    return FALSEY_VALUES.has(String(value).toLowerCase());
}

function parseVerbosity(value) {
    if (value === undefined || value === true) return 1;
    const lower = String(value).toLowerCase();
    if (lower === 'limited' || lower === '1') return 1;
    if (lower === 'moderate' || lower === '2') return 2;
    if (lower === 'exhaustive' || lower === 'exaughstive' || lower === '3') return 3;
    if (isTruthy(lower)) return 1;
    if (isFalsey(lower)) return 0;
    return parseInt(value, 10) || 0;
}

function printUsage() {
    console.log(`
PDF Color Conversion CLI Tool

Usage:
  node convert-pdf-color.js <input.pdf> <profile.icc> <output.pdf> [options]
  node convert-pdf-color.js <input.pdf> <output-dir> --extract-images-only [options]
  node convert-pdf-color.js <input.pdf> <output-dir> --extract-content-streams-only [options]
  node convert-pdf-color.js <input.pdf> --generate-document-structure [options]

Rendering Intent Options:
  --rendering-intent=<intent>, --intent=<intent>, --<intent>
    Aliases:
      k-only, k-only-gcr, preserve-k-only, preserve-k-only-relative-colorimetric-gcr (default)
      perceptual (or --rendering-intent=0)
      relative, relative-colorimetric (or --rendering-intent=1)
      saturation (or --rendering-intent=2)
      absolute, absolute-colorimetric (or --rendering-intent=3)

Black Point Compensation:
  --bpc, --with-bpc, --blackpoint-compensation           Enable BPC
  --no-bpc, --without-bpc, --no-blackpoint-compensation  Disable BPC
  --bpc=<true|false|yes|no|enabled|disabled|on|off>       Set BPC explicitly
  Default: enabled for K-Only intent, disabled otherwise

Image/Content Stream Options:
  --images, --no-images                     Enable/disable image conversion
  --content-streams, --no-content-streams   Enable/disable content stream conversion
  --images-only                             Convert images only (implies --no-content-streams)
  --content-streams-only                    Convert content streams only (implies --no-images)
  --indexing-for-images                     Use indexed color approach (extract unique colors, convert, map back)

Extraction Options (Debug):
  --extract-images-only                     Extract images as PDFs (default: one combined PDF)
  --extract-content-streams-only            Extract content streams as PDFs (default: one combined PDF)

  Extraction Output Modes:
    --images=combined                       All pages' images in one PDF (default)
    --images=pages                          One PDF per page with all images on that page
    --images=separate                       Each image as a separate PDF
    --content-streams=combined              All pages' content in one PDF (default)
    --content-streams=pages                 One PDF per page (current behavior)

  Extraction with Conversion (Not Yet Implemented):
    --extract-and-convert-images-only       Extract and convert images (requires profile)
    --extract-and-convert-content-streams-only Extract and convert content streams (requires profile)

Verbosity Options:
  --no-verbose, --verbose=false             Disable verbose output (default)
  --verbose, --verbose=1, --limited-verbosity         Level 1 (limited)
  --verbose=2, --moderate-verbosity         Level 2 (moderate)
  --verbose=3, --exhaustive-verbosity       Level 3 (exhaustive)

Workflow Options:
  --transform-only                          Only transform colors (skip transparency blending and output intent)
  --no-transform-only, --full-workflow      Full workflow with transparency blending and output intent (default)

Color Engine:
  --color-engine=<path>                     Path to color-engine package (CWD-relative or absolute)
                                            Default: packages/color-engine (symlink)
                                            Example: --color-engine=../packages/color-engine-2026-01-21

Transform Method (for Gray ICC → CMYK K-Only):
  --transform-method=<method>               Transform method for Gray ICC images with K-Only GCR
                                            Values: multiprofile (default), direct
                                            multiprofile: Gray ICC → CMYK (Multi) with K-Only GCR
                                            direct: Gray ICC → sRGB (Direct), sRGB → CMYK (Direct)

Other Options:
  --generate-document-structure             Generate a .pdf.md document structure file
  --no-generate-document-structure          Disable auto-generation of .pdf.md files
  --help, -h                                Show this help message

Note: Document structure files (.pdf.md) are automatically generated for extraction
      operations. Use --no-generate-document-structure to disable this behavior.

Examples:
  node convert-pdf-color.js input.pdf profile.icc output.pdf --k-only --bpc
  node convert-pdf-color.js input.pdf ./output --extract-images-only --verbose
  node convert-pdf-color.js input.pdf --generate-document-structure
`);
}

function parseArgs(args) {
    const positional = [];
    const options = {
        // Rendering intent
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        // Black point compensation (null = auto based on intent)
        blackPointCompensation: null,
        // Conversion flags
        convertImages: true,
        convertContentStreams: true,
        // Operation mode
        mode: 'convert', // 'convert', 'extract-images', 'extract-content-streams', 'extract-convert-images', 'extract-convert-content-streams', 'structure-only'
        // Verbosity (0=none, 1=limited, 2=moderate, 3=exhaustive)
        verbosity: 0,
        // Document structure generation (null = auto, true/false = explicit)
        generateDocumentStructure: null,
        // Extraction output mode: 'combined' (one file for all pages), 'pages' (one file per page), 'separate' (one file per item)
        // Default is 'combined' for both images and content streams
        extractionMode: {
            images: 'combined',       // 'combined' | 'pages' | 'separate'
            contentStreams: 'combined', // 'combined' | 'pages'
        },
        // Legacy: Extract images separately (deprecated, use extractionMode.images = 'separate')
        extractImagesSeparately: false,
        // Use indexed color approach for images (extract unique colors, convert, map back)
        useIndexedImages: false,
        // Transform only mode (skip transparency blending space and output intent)
        transformOnly: false,
        // Custom color-engine package path (null = use default symlink)
        colorEnginePackagePath: null,
        // Transform method for Gray ICC → CMYK K-Only conversion
        // 'multiprofile' = createMultiprofileTransform([Gray, CMYK]) - recommended
        // 'direct' = use existing two-step workaround (Gray → sRGB → CMYK)
        transformMethod: 'multiprofile',
        // Diagnostics options
        showDiagnostics: false,
        showTraces: false,
        saveDiagnostics: null,
        // Worker options
        useWorkers: false,
        expectedWorkerCount: undefined,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        // Help
        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
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
        if (arg === '--bpc' || arg === '--with-bpc' || arg === '--blackpoint-compensation' || arg === '--with-blackpoint-compensation') {
            options.blackPointCompensation = true;
            continue;
        }
        if (arg === '--no-bpc' || arg === '--without-bpc' || arg === '--no-blackpoint-compensation' || arg === '--without-blackpoint-compensation') {
            options.blackPointCompensation = false;
            continue;
        }
        if (arg.startsWith('--bpc=') || arg.startsWith('--blackpoint-compensation=')) {
            const value = arg.split('=')[1];
            options.blackPointCompensation = isTruthy(value);
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
        if (arg.startsWith('--images=')) {
            const value = arg.split('=')[1].toLowerCase();
            if (value === 'separate') {
                // For extraction mode: extract each image as a separate PDF
                options.extractionMode.images = 'separate';
                options.extractImagesSeparately = true; // Legacy support
            } else if (value === 'pages') {
                // For extraction mode: one PDF per page (all images on that page)
                options.extractionMode.images = 'pages';
                options.extractImagesSeparately = false;
            } else if (value === 'combined' || value === 'merged') {
                // For extraction mode: one PDF for all pages (default)
                options.extractionMode.images = 'combined';
                options.extractImagesSeparately = false;
            } else {
                // For conversion mode: enable/disable image conversion
                options.convertImages = isTruthy(value);
            }
            continue;
        }
        if (arg === '--images-only') {
            options.convertImages = true;
            options.convertContentStreams = false;
            continue;
        }

        // Indexed image conversion
        if (arg === '--indexing-for-images' || arg === '--indexed-images' || arg === '--use-indexed-images') {
            options.useIndexedImages = true;
            continue;
        }
        if (arg === '--no-indexing-for-images' || arg === '--no-indexed-images') {
            options.useIndexedImages = false;
            continue;
        }
        if (arg.startsWith('--indexing-for-images=') || arg.startsWith('--indexed-images=')) {
            const value = arg.split('=')[1];
            options.useIndexedImages = isTruthy(value);
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
        if (arg.startsWith('--content-streams=')) {
            const value = arg.split('=')[1].toLowerCase();
            if (value === 'pages') {
                // For extraction mode: one PDF per page
                options.extractionMode.contentStreams = 'pages';
            } else if (value === 'combined' || value === 'merged') {
                // For extraction mode: one PDF for all pages (default)
                options.extractionMode.contentStreams = 'combined';
            } else {
                // For conversion mode: enable/disable content stream conversion
                options.convertContentStreams = isTruthy(value);
            }
            continue;
        }
        if (arg === '--content-streams-only') {
            options.convertContentStreams = true;
            options.convertImages = false;
            continue;
        }

        // Extraction modes
        if (arg === '--extract-images-only') {
            options.mode = 'extract-images';
            continue;
        }
        if (arg === '--extract-content-streams-only') {
            options.mode = 'extract-content-streams';
            continue;
        }
        if (arg === '--extract-and-convert-images-only') {
            options.mode = 'extract-convert-images';
            continue;
        }
        if (arg === '--extract-and-convert-content-streams-only') {
            options.mode = 'extract-convert-content-streams';
            continue;
        }

        // Verbosity
        if (arg === '--no-verbose') {
            options.verbosity = 0;
            continue;
        }
        if (arg === '--verbose') {
            options.verbosity = 1;
            continue;
        }
        if (arg.startsWith('--verbose=')) {
            options.verbosity = parseVerbosity(arg.split('=')[1]);
            continue;
        }
        if (arg.startsWith('--verbosity=')) {
            options.verbosity = parseVerbosity(arg.split('=')[1]);
            continue;
        }
        if (arg === '--limited-verbosity') {
            options.verbosity = 1;
            continue;
        }
        if (arg === '--moderate-verbosity') {
            options.verbosity = 2;
            continue;
        }
        if (arg === '--exhaustive-verbosity' || arg === '--exaughstive-verbosity') {
            options.verbosity = 3;
            continue;
        }

        // Document structure
        if (arg === '--generate-document-structure') {
            options.generateDocumentStructure = true;
            continue;
        }
        if (arg === '--no-generate-document-structure' || arg === '--no-doc-structure') {
            options.generateDocumentStructure = false;
            continue;
        }
        if (arg.startsWith('--generate-document-structure=')) {
            options.generateDocumentStructure = isTruthy(arg.split('=')[1]);
            continue;
        }

        // Transform only mode (skip transparency blending space and output intent)
        if (arg === '--transform-only') {
            options.transformOnly = true;
            continue;
        }
        if (arg === '--no-transform-only' || arg === '--full-workflow') {
            options.transformOnly = false;
            continue;
        }
        if (arg.startsWith('--transform-only=')) {
            options.transformOnly = isTruthy(arg.split('=')[1]);
            continue;
        }

        // Color engine package path
        if (arg.startsWith('--color-engine=') || arg.startsWith('--color-engine-package=') || arg.startsWith('--using-color-engine-package=')) {
            options.colorEnginePackagePath = arg.split('=')[1];
            continue;
        }

        // Transform method for Gray ICC → CMYK K-Only
        if (arg.startsWith('--transform-method=')) {
            const value = arg.split('=')[1].toLowerCase();
            if (value === 'multiprofile' || value === 'multi') {
                options.transformMethod = 'multiprofile';
            } else if (value === 'direct') {
                options.transformMethod = 'direct';
            } else {
                console.warn(`Warning: Unknown transform method '${value}', using 'multiprofile'`);
                options.transformMethod = 'multiprofile';
            }
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

        // Positional arguments
        if (!arg.startsWith('-')) {
            positional.push(arg);
            continue;
        }

        // Unknown option
        console.warn(`Warning: Unknown option '${arg}'`);
    }

    // Apply BPC default based on rendering intent
    if (options.blackPointCompensation === null) {
        options.blackPointCompensation = options.renderingIntent === 'preserve-k-only-relative-colorimetric-gcr';
    }

    // Auto-enable document structure generation for extraction modes (unless explicitly disabled)
    // This can be disabled with --generate-document-structure=false or --no-generate-document-structure
    if (options.generateDocumentStructure === null) {
        // Not explicitly set - auto-enable for extraction modes
        if (options.mode.startsWith('extract')) {
            options.generateDocumentStructure = true;
        } else {
            options.generateDocumentStructure = false;
        }
    }
    // If explicitly set to true or false, keep that value

    // Determine if we're in structure-only mode
    if (options.generateDocumentStructure && positional.length <= 1 && options.mode === 'convert') {
        options.mode = 'structure-only';
    }

    return { positional, options };
}

// ============================================================================
// Service Loading
// ============================================================================

/**
 * Load services with optional custom color engine package path
 * @param {object} [options]
 * @param {string | null} [options.colorEnginePackagePath] - Custom path to color-engine package
 * @returns {Promise<{
 *   PDFService: typeof import('../../services/PDFService.js').PDFService,
 *   ColorEngineService: typeof import('../../services/ColorEngineService.js').ColorEngineService,
 *   analyzeColorSpaces: typeof import('../../services/ColorSpaceUtils.js').analyzeColorSpaces,
 *   analyzePageColors: typeof import('../../services/ColorSpaceUtils.js').analyzePageColors,
 *   extractImageMetadata: typeof import('../../services/ColorSpaceUtils.js').extractImageMetadata,
 *   extractImagePixels: typeof import('../../services/ColorSpaceUtils.js').extractImagePixels,
 *   ICCService: typeof import('../../services/ICCService.js').ICCService,
 *   colorEngineInstance: any | null,
 * }>}
 */
async function loadServices(options = {}) {
    const { colorEnginePackagePath = null } = options;

    const { PDFService } = await import('../../services/PDFService.js');
    const { ColorEngineService } = await import('../../services/ColorEngineService.js');
    const { analyzeColorSpaces, analyzePageColors, extractImageMetadata, extractImagePixels } = await import('../../services/ColorSpaceUtils.js');
    const { ICCService } = await import('../../services/ICCService.js');

    // If a custom color engine package path is specified, load and create engine instance
    let colorEngineInstance = null;
    if (colorEnginePackagePath) {
        // Resolve the path relative to the experiments directory (where this script runs)
        const absolutePath = resolve(__dirname, '..', colorEnginePackagePath, 'src', 'index.js');
        const LittleCMS = await import(absolutePath);
        colorEngineInstance = await LittleCMS.createEngine();
        console.log(`Loaded color engine from: ${colorEnginePackagePath}`);
    }

    return {
        PDFService,
        ColorEngineService,
        analyzeColorSpaces,
        analyzePageColors,
        extractImageMetadata,
        extractImagePixels,
        ICCService,
        colorEngineInstance,
    };
}

// ============================================================================
// Document Structure Generation
// ============================================================================

/**
 * Computes SHA-256 hash of data using globalThis.crypto (works in both Node and browser)
 * @param {Uint8Array | ArrayBuffer} data - Data to hash
 * @returns {Promise<string>} - Hex string hash
 */
async function computeHash(data) {
    const buffer = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extracts Lab values from a Separation color space tintTransform (if present)
 * @param {PDFArray} colorSpaceArray - The Separation color space array
 * @param {import('pdf-lib').PDFContext} context - PDF context for lookups
 * @returns {{ L: number, a: number, b: number } | null}
 */
function extractLabFromSeparation(colorSpaceArray, context) {
    // Separation format: [/Separation /Name /AlternateCS tintTransform]
    // Lab appearance is typically stored in a sampled function or can be derived
    // Look for alternate colorspace that is Lab, or extract from function dict
    try {
        const alternateCS = colorSpaceArray.get(2);
        let alternateArray = alternateCS;

        if (alternateCS instanceof PDFRef) {
            alternateArray = context.lookup(alternateCS);
        }

        // If alternate is Lab, the tintTransform provides Lab values directly
        if (alternateArray instanceof PDFArray) {
            const csType = alternateArray.get(0);
            if (csType?.toString?.() === '/Lab') {
                // For Lab alternate, check the function for L*a*b* values
                const tintTransform = colorSpaceArray.get(3);
                let funcDict = tintTransform;
                if (tintTransform instanceof PDFRef) {
                    funcDict = context.lookup(tintTransform);
                }

                if (funcDict instanceof PDFRawStream) {
                    const dict = funcDict.dict;
                    const c1 = dict.get(PDFName.of('C1'));

                    // C1 typically contains the "full" color in Lab
                    if (c1 instanceof PDFArray && c1.size() >= 3) {
                        return {
                            L: parseFloat(c1.get(0)?.toString() || '0'),
                            a: parseFloat(c1.get(1)?.toString() || '0'),
                            b: parseFloat(c1.get(2)?.toString() || '0'),
                        };
                    }
                } else if (funcDict instanceof PDFDict) {
                    const c1 = funcDict.get(PDFName.of('C1'));
                    if (c1 instanceof PDFArray && c1.size() >= 3) {
                        return {
                            L: parseFloat(c1.get(0)?.toString() || '0'),
                            a: parseFloat(c1.get(1)?.toString() || '0'),
                            b: parseFloat(c1.get(2)?.toString() || '0'),
                        };
                    }
                }
            }
        }
    } catch (e) {
        // Ignore extraction errors
    }
    return null;
}

/**
 * Extracts alternate color space values from a Separation color space
 * @param {PDFArray} colorSpaceArray - The Separation color space array
 * @param {import('pdf-lib').PDFContext} context - PDF context for lookups
 * @returns {{ colorSpace: string, values: number[] } | null}
 */
function extractAlternateFromSeparation(colorSpaceArray, context) {
    try {
        const alternateCS = colorSpaceArray.get(2);
        let alternateResolved = alternateCS;

        if (alternateCS instanceof PDFRef) {
            alternateResolved = context.lookup(alternateCS);
        }

        let colorSpaceName = '';
        if (alternateResolved instanceof PDFName) {
            colorSpaceName = alternateResolved.toString().replace('/', '');
        } else if (alternateResolved instanceof PDFArray) {
            colorSpaceName = alternateResolved.get(0)?.toString?.()?.replace('/', '') || '';
        }

        // Extract tint transform values
        const tintTransform = colorSpaceArray.get(3);
        let funcDict = tintTransform;
        if (tintTransform instanceof PDFRef) {
            funcDict = context.lookup(tintTransform);
        }

        // Look for C1 values (the "full" color values)
        let values = [];
        if (funcDict instanceof PDFRawStream) {
            const c1 = funcDict.dict.get(PDFName.of('C1'));
            if (c1 instanceof PDFArray) {
                values = Array.from({ length: c1.size() }, (_, i) =>
                    parseFloat(c1.get(i)?.toString() || '0')
                );
            }
        } else if (funcDict instanceof PDFDict) {
            const c1 = funcDict.get(PDFName.of('C1'));
            if (c1 instanceof PDFArray) {
                values = Array.from({ length: c1.size() }, (_, i) =>
                    parseFloat(c1.get(i)?.toString() || '0')
                );
            }
        }

        if (colorSpaceName) {
            return { colorSpace: colorSpaceName, values };
        }
    } catch (e) {
        // Ignore extraction errors
    }
    return null;
}

/**
 * @typedef {{
 *   type: 'ICCBased' | 'Separation' | 'DeviceN' | 'Device' | 'Indexed' | 'Pattern' | 'CalGray' | 'CalRGB' | 'Lab',
 *   name?: string,
 *   profileName?: string,
 *   profileHash?: string,
 *   profileRef?: string,
 *   components?: number,
 *   alternate?: string,
 *   labValues?: { L: number, a: number, b: number },
 *   alternateValues?: { colorSpace: string, values: number[] },
 *   imageRefs: Set<string>,
 *   pageRefs: Set<string>,
 *   contentRefs: Set<string>,
 *   raw: any,
 * }} ColorSpaceInfo
 */

/**
 * Generate detailed document structure including color space analysis
 * @param {import('pdf-lib').PDFDocument} pdfDocument
 * @param {string} inputPath
 * @param {string | null} [outputPath]
 */
async function generateDocumentStructure(pdfDocument, inputPath, outputPath = null) {
    const baseName = basename(inputPath, extname(inputPath));
    const mdPath = outputPath || resolve(dirname(inputPath), `${baseName}.pdf.md`);

    const pages = pdfDocument.getPages();
    const pageCount = pages.length;

    let md = `# PDF Document Structure\n\n`;
    md += `**File:** ${basename(inputPath)}  \n`;
    md += `**Pages:** ${pageCount}\n\n`;

    // Enumerate all indirect objects
    const objects = pdfDocument.context.enumerateIndirectObjects();
    const objectsByType = new Map();

    for (const [ref, obj] of objects) {
        let type = obj?.constructor?.name || 'Unknown';

        if (obj instanceof PDFRawStream) {
            const dict = obj.dict;
            const subtype = dict.get(PDFName.of('Subtype'));
            const objType = dict.get(PDFName.of('Type'));
            if (subtype) type = `Stream/${subtype.toString().replace('/', '')}`;
            else if (objType) type = `Stream/${objType.toString().replace('/', '')}`;
            else type = 'Stream';
        } else if (obj instanceof PDFDict) {
            const objType = obj.get(PDFName.of('Type'));
            if (objType) type = `Dict/${objType.toString().replace('/', '')}`;
        } else if (obj instanceof PDFPageLeaf) {
            type = 'Page';
        }

        if (!objectsByType.has(type)) {
            objectsByType.set(type, []);
        }
        objectsByType.get(type).push({ ref, obj });
    }

    md += `## Object Summary\n\n`;
    md += `| Type | Count |\n`;
    md += `|------|-------|\n`;
    for (const [type, objs] of [...objectsByType.entries()].sort((a, b) => b[1].length - a[1].length)) {
        md += `| ${type} | ${objs.length} |\n`;
    }
    md += `\n`;

    // ============================================================================
    // Color Space Analysis
    // ============================================================================

    /** @type {Map<string, ColorSpaceInfo>} - Keyed by unique identifier */
    const colorSpaceInfoMap = new Map();

    /** @type {Map<string, { name: string, ref: string, hash: string, components: number, referencingColorSpaces: Set<string> }>} */
    const iccProfileMap = new Map();

    // Process all ICC profile streams and compute hashes
    for (const [ref, obj] of objects) {
        if (obj instanceof PDFRawStream) {
            const n = obj.dict.get(PDFName.of('N'));
            // ICC profiles have N (number of components) but no Subtype
            if (n && !obj.dict.get(PDFName.of('Subtype'))) {
                try {
                    const bytes = decodePDFRawStream(obj).decode();
                    const hash = await computeHash(bytes);

                    // Parse ICC profile header for name
                    let profileName = 'Unknown';
                    try {
                        const { ICCService } = await loadServices();
                        const header = ICCService.parseICCHeaderFromSource(bytes);
                        profileName = header?.description || header?.deviceModel || header?.manufacturer || 'Unknown';
                    } catch (e) {
                        // Fall back to basic parsing
                        if (bytes.length > 128) {
                            // Profile description is typically in tag data
                            // Try to extract ASCII text from common locations
                            const decoder = new TextDecoder('latin1');
                            const text = decoder.decode(bytes.slice(0, 512));
                            const match = text.match(/[A-Za-z0-9\s._-]{8,64}/);
                            if (match) profileName = match[0].trim();
                        }
                    }

                    const components = parseInt(n.toString(), 10);
                    iccProfileMap.set(ref.toString(), {
                        name: profileName,
                        ref: ref.toString(),
                        hash: hash.slice(0, 16), // First 16 chars for brevity
                        components,
                        referencingColorSpaces: new Set(),
                    });
                } catch (e) {
                    // Skip profiles that can't be decoded
                }
            }
        }
    }

    /**
     * Process a color space descriptor and return info
     * @param {any} descriptor
     * @param {string} sourceType - 'image' | 'page' | 'content'
     * @param {string} sourceRef
     */
    async function processColorSpace(descriptor, sourceType, sourceRef) {
        if (!descriptor) return;

        let resolved = descriptor;
        if (descriptor instanceof PDFRef) {
            resolved = pdfDocument.context.lookup(descriptor);
        }

        let info = null;
        let key = '';

        if (resolved instanceof PDFName) {
            // Device color space
            const name = resolved.toString().replace('/', '');
            key = `Device:${name}`;

            if (!colorSpaceInfoMap.has(key)) {
                colorSpaceInfoMap.set(key, {
                    type: 'Device',
                    name,
                    imageRefs: new Set(),
                    pageRefs: new Set(),
                    contentRefs: new Set(),
                    raw: resolved,
                });
            }
            info = colorSpaceInfoMap.get(key);

        } else if (resolved instanceof PDFArray && resolved.size() > 0) {
            const csType = resolved.get(0)?.toString?.()?.replace('/', '');

            if (csType === 'ICCBased') {
                // ICCBased color space
                const profileRef = resolved.get(1);
                const profileRefStr = profileRef?.toString() || '';
                const profileInfo = iccProfileMap.get(profileRefStr);
                key = `ICCBased:${profileInfo?.hash || profileRefStr}`;

                if (!colorSpaceInfoMap.has(key)) {
                    colorSpaceInfoMap.set(key, {
                        type: 'ICCBased',
                        profileName: profileInfo?.name,
                        profileHash: profileInfo?.hash,
                        profileRef: profileRefStr,
                        components: profileInfo?.components,
                        imageRefs: new Set(),
                        pageRefs: new Set(),
                        contentRefs: new Set(),
                        raw: resolved,
                    });
                }
                info = colorSpaceInfoMap.get(key);

                // Track which color spaces reference this profile
                if (profileInfo) {
                    profileInfo.referencingColorSpaces.add(key);
                }

            } else if (csType === 'Separation') {
                // Separation (spot) color space
                const spotName = resolved.get(1)?.toString?.()?.replace('/', '') || 'Unknown';
                const labValues = extractLabFromSeparation(resolved, pdfDocument.context);
                const alternateValues = extractAlternateFromSeparation(resolved, pdfDocument.context);

                // Key by name for grouping
                key = `Separation:${spotName}`;
                // Add appearance info if available for deduplication
                const appearanceKey = labValues ? `:L${labValues.L.toFixed(1)}a${labValues.a.toFixed(1)}b${labValues.b.toFixed(1)}` : '';
                const fullKey = `${key}${appearanceKey}`;

                if (!colorSpaceInfoMap.has(fullKey)) {
                    colorSpaceInfoMap.set(fullKey, {
                        type: 'Separation',
                        name: spotName,
                        labValues: labValues || undefined,
                        alternateValues: alternateValues || undefined,
                        alternate: alternateValues?.colorSpace,
                        imageRefs: new Set(),
                        pageRefs: new Set(),
                        contentRefs: new Set(),
                        raw: resolved,
                    });
                }
                info = colorSpaceInfoMap.get(fullKey);

            } else if (csType === 'DeviceN') {
                // DeviceN color space
                const names = resolved.get(1);
                let colorNames = [];
                if (names instanceof PDFArray) {
                    colorNames = Array.from({ length: names.size() }, (_, i) =>
                        names.get(i)?.toString?.()?.replace('/', '') || ''
                    );
                }
                key = `DeviceN:${colorNames.join(',')}`;

                if (!colorSpaceInfoMap.has(key)) {
                    colorSpaceInfoMap.set(key, {
                        type: 'DeviceN',
                        name: colorNames.join(', '),
                        imageRefs: new Set(),
                        pageRefs: new Set(),
                        contentRefs: new Set(),
                        raw: resolved,
                    });
                }
                info = colorSpaceInfoMap.get(key);

            } else if (csType === 'Indexed') {
                // Indexed color space - get the base color space
                const baseCS = resolved.get(1);
                let baseName = 'Unknown';
                if (baseCS instanceof PDFName) {
                    baseName = baseCS.toString().replace('/', '');
                } else if (baseCS instanceof PDFRef) {
                    const baseResolved = pdfDocument.context.lookup(baseCS);
                    if (baseResolved instanceof PDFArray) {
                        baseName = baseResolved.get(0)?.toString?.()?.replace('/', '') || 'Array';
                    }
                }
                key = `Indexed:${baseName}`;

                if (!colorSpaceInfoMap.has(key)) {
                    colorSpaceInfoMap.set(key, {
                        type: 'Indexed',
                        name: baseName,
                        imageRefs: new Set(),
                        pageRefs: new Set(),
                        contentRefs: new Set(),
                        raw: resolved,
                    });
                }
                info = colorSpaceInfoMap.get(key);

            } else if (csType === 'CalGray' || csType === 'CalRGB' || csType === 'Lab') {
                // Calibrated color spaces
                key = `${csType}`;

                if (!colorSpaceInfoMap.has(key)) {
                    colorSpaceInfoMap.set(key, {
                        type: /** @type {any} */(csType),
                        imageRefs: new Set(),
                        pageRefs: new Set(),
                        contentRefs: new Set(),
                        raw: resolved,
                    });
                }
                info = colorSpaceInfoMap.get(key);

            } else if (csType === 'Pattern') {
                key = 'Pattern';

                if (!colorSpaceInfoMap.has(key)) {
                    colorSpaceInfoMap.set(key, {
                        type: 'Pattern',
                        imageRefs: new Set(),
                        pageRefs: new Set(),
                        contentRefs: new Set(),
                        raw: resolved,
                    });
                }
                info = colorSpaceInfoMap.get(key);
            }
        }

        // Add reference based on source type
        if (info) {
            if (sourceType === 'image') info.imageRefs.add(sourceRef);
            else if (sourceType === 'page') info.pageRefs.add(sourceRef);
            else if (sourceType === 'content') info.contentRefs.add(sourceRef);
        }
    }

    // Process image color spaces
    const images = objectsByType.get('Stream/Image') || [];
    for (const { ref, obj } of images) {
        const cs = obj.dict.get(PDFName.of('ColorSpace'));
        await processColorSpace(cs, 'image', ref.toString());
    }

    // Process page color spaces
    for (let i = 0; i < pageCount; i++) {
        const page = pages[i];
        const pageRef = page.ref.toString();
        const resources = page.node.Resources();

        if (resources) {
            const colorSpaces = resources.get(PDFName.of('ColorSpace'));
            if (colorSpaces instanceof PDFDict) {
                for (const [, csRef] of colorSpaces.entries()) {
                    await processColorSpace(csRef, 'page', pageRef);
                }
            }
        }
    }

    // ============================================================================
    // Write Color Spaces Section
    // ============================================================================

    if (colorSpaceInfoMap.size > 0) {
        md += `## Color Spaces\n\n`;

        // Group by type
        const byType = new Map();
        for (const [key, info] of colorSpaceInfoMap) {
            const type = info.type;
            if (!byType.has(type)) byType.set(type, []);
            byType.get(type).push({ key, info });
        }

        // ICCBased
        const iccBased = byType.get('ICCBased') || [];
        if (iccBased.length > 0) {
            md += `### ICCBased Color Spaces\n\n`;
            md += `| Profile Name | Hash | Components | Images | Pages |\n`;
            md += `|--------------|------|------------|--------|-------|\n`;
            for (const { info } of iccBased) {
                md += `| ${info.profileName || '-'} | ${info.profileHash || '-'} | ${info.components || '?'} | ${info.imageRefs.size} | ${info.pageRefs.size} |\n`;
            }
            md += `\n`;

            // Show unique ICC profiles with deduplication info
            if (iccProfileMap.size > 0) {
                md += `#### ICC Profile Deduplication\n\n`;

                // Group by hash
                const byHash = new Map();
                for (const [ref, profile] of iccProfileMap) {
                    if (!byHash.has(profile.hash)) byHash.set(profile.hash, []);
                    byHash.get(profile.hash).push({ ref, profile });
                }

                md += `| Hash | Profile Name | Streams | Color Space Defs |\n`;
                md += `|------|--------------|---------|------------------|\n`;
                for (const [hash, profiles] of byHash) {
                    const name = profiles[0].profile.name;
                    const totalRefs = profiles.reduce((sum, p) => sum + p.profile.referencingColorSpaces.size, 0);
                    md += `| ${hash} | ${name} | ${profiles.length} | ${totalRefs} |\n`;
                }
                md += `\n`;
            }
        }

        // Separation (Spot Colors)
        const separations = byType.get('Separation') || [];
        if (separations.length > 0) {
            md += `### Spot Colors (Separation)\n\n`;
            md += `| Name | Alternate | Appearance (Lab) | Images | Pages |\n`;
            md += `|------|-----------|------------------|--------|-------|\n`;
            for (const { info } of separations) {
                const labStr = info.labValues
                    ? `L:${info.labValues.L.toFixed(1)} a:${info.labValues.a.toFixed(1)} b:${info.labValues.b.toFixed(1)}`
                    : '-';
                md += `| ${info.name || '-'} | ${info.alternate || '-'} | ${labStr} | ${info.imageRefs.size} | ${info.pageRefs.size} |\n`;
            }
            md += `\n`;

            // Spot color deduplication analysis
            const byName = new Map();
            const byAppearance = new Map();
            for (const { info } of separations) {
                const name = info.name || 'Unknown';
                if (!byName.has(name)) byName.set(name, []);
                byName.get(name).push(info);

                if (info.labValues) {
                    const labKey = `${info.labValues.L.toFixed(1)},${info.labValues.a.toFixed(1)},${info.labValues.b.toFixed(1)}`;
                    if (!byAppearance.has(labKey)) byAppearance.set(labKey, []);
                    byAppearance.get(labKey).push(info);
                }
            }

            // Show duplicates
            const duplicateNames = [...byName.entries()].filter(([, arr]) => arr.length > 1);
            const duplicateAppearances = [...byAppearance.entries()].filter(([, arr]) => arr.length > 1);

            if (duplicateNames.length > 0 || duplicateAppearances.length > 0) {
                md += `#### Spot Color Deduplication\n\n`;
                md += `- Unique spot color names: ${byName.size}\n`;
                md += `- Definitions sharing same name: ${duplicateNames.length > 0 ? duplicateNames.map(([n, a]) => `${n} (${a.length})`).join(', ') : 'None'}\n`;
                md += `- Definitions sharing same appearance: ${duplicateAppearances.length > 0 ? duplicateAppearances.length : 0}\n\n`;
            }
        }

        // DeviceN
        const deviceN = byType.get('DeviceN') || [];
        if (deviceN.length > 0) {
            md += `### DeviceN Color Spaces\n\n`;
            md += `| Components | Images | Pages |\n`;
            md += `|------------|--------|-------|\n`;
            for (const { info } of deviceN) {
                md += `| ${info.name || '-'} | ${info.imageRefs.size} | ${info.pageRefs.size} |\n`;
            }
            md += `\n`;
        }

        // Device color spaces
        const device = byType.get('Device') || [];
        if (device.length > 0) {
            md += `### Device Color Spaces\n\n`;
            md += `| Name | Images | Pages |\n`;
            md += `|------|--------|-------|\n`;
            for (const { info } of device) {
                md += `| ${info.name} | ${info.imageRefs.size} | ${info.pageRefs.size} |\n`;
            }
            md += `\n`;
        }

        // Other color spaces (Indexed, Pattern, Cal*, Lab)
        const other = [
            ...(byType.get('Indexed') || []),
            ...(byType.get('Pattern') || []),
            ...(byType.get('CalGray') || []),
            ...(byType.get('CalRGB') || []),
            ...(byType.get('Lab') || []),
        ];
        if (other.length > 0) {
            md += `### Other Color Spaces\n\n`;
            md += `| Type | Name | Images | Pages |\n`;
            md += `|------|------|--------|-------|\n`;
            for (const { info } of other) {
                md += `| ${info.type} | ${info.name || '-'} | ${info.imageRefs.size} | ${info.pageRefs.size} |\n`;
            }
            md += `\n`;
        }
    }

    // ============================================================================
    // Page Details
    // ============================================================================

    md += `## Pages\n\n`;
    for (let i = 0; i < pageCount; i++) {
        const page = pages[i];
        const { width, height } = page.getSize();
        md += `### Page ${i + 1}\n\n`;
        md += `- **Size:** ${width.toFixed(2)} x ${height.toFixed(2)} points\n`;
        md += `- **Ref:** ${page.ref.toString()}\n`;

        // Resources
        const resources = page.node.Resources();
        if (resources) {
            const xObjects = resources.get(PDFName.of('XObject'));
            const colorSpaces = resources.get(PDFName.of('ColorSpace'));
            const fonts = resources.get(PDFName.of('Font'));

            if (xObjects instanceof PDFDict) {
                const entries = xObjects.entries();
                const imageCount = entries.filter(([, ref]) => {
                    const obj = pdfDocument.context.lookup(ref);
                    return obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.toString() === '/Image';
                }).length;
                md += `- **XObjects:** ${entries.length} (${imageCount} images)\n`;
            }
            if (colorSpaces instanceof PDFDict) {
                md += `- **ColorSpaces:** ${colorSpaces.entries().length}\n`;
            }
            if (fonts instanceof PDFDict) {
                md += `- **Fonts:** ${fonts.entries().length}\n`;
            }
        }
        md += `\n`;
    }

    // ============================================================================
    // Images
    // ============================================================================

    if (images.length > 0) {
        md += `## Images\n\n`;
        md += `| Ref | Width | Height | BPC | ColorSpace | Filter |\n`;
        md += `|-----|-------|--------|-----|------------|--------|\n`;

        for (const { ref, obj } of images) {
            const dict = obj.dict;
            const width = dict.get(PDFName.of('Width'))?.toString() || '?';
            const height = dict.get(PDFName.of('Height'))?.toString() || '?';
            const bpc = dict.get(PDFName.of('BitsPerComponent'))?.toString() || '?';
            const filter = dict.get(PDFName.of('Filter'))?.toString()?.replace('/', '') || 'None';

            let colorSpace = '?';
            const cs = dict.get(PDFName.of('ColorSpace'));
            if (cs instanceof PDFName) {
                colorSpace = cs.toString().replace('/', '');
            } else if (cs instanceof PDFArray) {
                const csType = cs.get(0);
                colorSpace = csType?.toString()?.replace('/', '') || 'Array';
            } else if (cs instanceof PDFRef) {
                const resolved = pdfDocument.context.lookup(cs);
                if (resolved instanceof PDFArray) {
                    const csType = resolved.get(0);
                    colorSpace = csType?.toString()?.replace('/', '') || 'Ref->Array';
                } else if (resolved instanceof PDFName) {
                    colorSpace = resolved.toString().replace('/', '');
                }
            }

            md += `| ${ref.toString()} | ${width} | ${height} | ${bpc} | ${colorSpace} | ${filter} |\n`;
        }
        md += `\n`;
    }

    // ============================================================================
    // ICC Profiles (Legacy Section - Basic Info)
    // ============================================================================

    const iccProfiles = [];
    for (const [ref, obj] of objects) {
        if (obj instanceof PDFRawStream) {
            const n = obj.dict.get(PDFName.of('N'));
            const alternate = obj.dict.get(PDFName.of('Alternate'));
            if (n && !obj.dict.get(PDFName.of('Subtype'))) {
                iccProfiles.push({ ref, obj, n: n.toString(), alternate: alternate?.toString() });
            }
        }
    }

    if (iccProfiles.length > 0) {
        md += `## ICC Profiles (Raw Streams)\n\n`;
        md += `| Ref | Components | Alternate | Size |\n`;
        md += `|-----|------------|-----------|------|\n`;
        for (const { ref, obj, n, alternate } of iccProfiles) {
            const size = obj.contents?.length || '?';
            md += `| ${ref.toString()} | ${n} | ${alternate || '-'} | ${size} bytes |\n`;
        }
        md += `\n`;
    }

    await writeFile(mdPath, md);
    return mdPath;
}

// ============================================================================
// Resource Deduplication
// ============================================================================

/**
 * Tracks resource objects by hash to enable deduplication during page copying.
 * When copying pages, pdf-lib creates new copies of all referenced objects.
 * This class helps identify and consolidate duplicate resources.
 *
 * @typedef {{
 *   hash: string,
 *   sourceRef: PDFRef,
 *   canonicalRef: PDFRef | null,
 *   type: 'icc-profile' | 'font' | 'color-space' | 'image' | 'other',
 *   size: number,
 * }} DeduplicationEntry
 */
class ResourceDeduplicator {
    /** @type {Map<string, DeduplicationEntry>} - Hash to canonical entry */
    #hashToEntry = new Map();

    /** @type {Map<string, PDFRef>} - Source ref string to canonical ref in target doc */
    #sourceToCanonical = new Map();

    /** @type {WeakMap<PDFRawStream, string>} - Stream to hash cache */
    #streamHashCache = new WeakMap();

    /** @type {import('pdf-lib').PDFDocument} */
    #targetDoc;

    /**
     * @param {import('pdf-lib').PDFDocument} targetDoc - The target document for deduplication
     */
    constructor(targetDoc) {
        this.#targetDoc = targetDoc;
    }

    /**
     * Get or compute hash for a PDFRawStream
     * @param {PDFRawStream} stream
     * @returns {Promise<string>}
     */
    async getStreamHash(stream) {
        let hash = this.#streamHashCache.get(stream);
        if (!hash) {
            const decoded = decodePDFRawStream(stream).decode();
            hash = await computeHash(decoded);
            this.#streamHashCache.set(stream, hash);
        }
        return hash;
    }

    /**
     * Register a source object with its canonical reference in target doc
     * @param {PDFRef} sourceRef - Reference in source document
     * @param {PDFRef} targetRef - Reference in target document
     * @param {string} hash - Object hash
     * @param {'icc-profile' | 'font' | 'color-space' | 'image' | 'other'} type
     * @param {number} size - Size in bytes
     */
    register(sourceRef, targetRef, hash, type, size) {
        const sourceKey = sourceRef.toString();

        if (!this.#hashToEntry.has(hash)) {
            // First occurrence - this becomes the canonical entry
            this.#hashToEntry.set(hash, {
                hash,
                sourceRef,
                canonicalRef: targetRef,
                type,
                size,
            });
        }

        // Map this source ref to the canonical ref
        const canonical = this.#hashToEntry.get(hash);
        this.#sourceToCanonical.set(sourceKey, canonical?.canonicalRef ?? targetRef);
    }

    /**
     * Get canonical ref for a source ref (if registered)
     * @param {PDFRef} sourceRef
     * @returns {PDFRef | undefined}
     */
    getCanonical(sourceRef) {
        return this.#sourceToCanonical.get(sourceRef.toString());
    }

    /**
     * Check if a hash has already been registered
     * @param {string} hash
     * @returns {boolean}
     */
    hasHash(hash) {
        return this.#hashToEntry.has(hash);
    }

    /**
     * Get the canonical ref for a hash
     * @param {string} hash
     * @returns {PDFRef | null}
     */
    getCanonicalForHash(hash) {
        return this.#hashToEntry.get(hash)?.canonicalRef ?? null;
    }

    /**
     * Get deduplication statistics
     * @returns {{ total: number, unique: number, duplicates: number, savedBytes: number }}
     */
    getStats() {
        const byHash = new Map();
        for (const [, entry] of this.#hashToEntry) {
            if (!byHash.has(entry.hash)) {
                byHash.set(entry.hash, { count: 0, size: entry.size });
            }
        }

        let duplicates = 0;
        let savedBytes = 0;

        for (const [sourceKey] of this.#sourceToCanonical) {
            // Count how many source refs map to each canonical
        }

        return {
            total: this.#sourceToCanonical.size,
            unique: this.#hashToEntry.size,
            duplicates: this.#sourceToCanonical.size - this.#hashToEntry.size,
            savedBytes,
        };
    }
}

/**
 * Post-process a PDF document to deduplicate resources.
 * This function identifies duplicate streams (fonts, ICC profiles, etc.) by hash
 * and rewrites references to point to a single canonical copy.
 *
 * @param {PDFDocument} pdfDoc - The PDF document to deduplicate
 * @param {object} options - Options
 * @param {number} [options.verbosity=0] - Verbosity level
 * @returns {Promise<{ deduplicatedFonts: number, deduplicatedICC: number, deduplicatedOther: number }>}
 */
async function deduplicateDocumentResources(pdfDoc, options = {}) {
    const verbosity = options.verbosity || 0;
    const stats = { deduplicatedFonts: 0, deduplicatedICC: 0, deduplicatedOther: 0 };

    // Step 1: Build index of all stream objects by hash
    const streamsByHash = new Map(); // hash -> { refs: PDFRef[], type: string, size: number }
    const refToHash = new Map(); // ref string -> hash

    const context = pdfDoc.context;

    for (const [ref, obj] of context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;

        // Decode and hash the stream
        let decoded;
        try {
            decoded = decodePDFRawStream(obj).decode();
        } catch (e) {
            continue; // Skip streams that can't be decoded
        }

        const hash = await computeHash(decoded);
        const refStr = ref.toString();

        // Determine type
        let type = 'other';
        const subtype = obj.dict.get(PDFName.of('Subtype'))?.toString();
        const n = obj.dict.get(PDFName.of('N'));

        if (subtype === '/Type1C' || subtype === '/CIDFontType0C' || subtype === '/OpenType') {
            type = 'font';
        } else if (n && !subtype) {
            // ICC profile - has /N but no /Subtype
            type = 'icc';
        } else if (subtype === '/Image') {
            type = 'image';
        }

        refToHash.set(refStr, hash);

        if (!streamsByHash.has(hash)) {
            streamsByHash.set(hash, {
                refs: [],
                type,
                size: decoded.length,
                canonical: null,
            });
        }
        streamsByHash.get(hash).refs.push(ref);
    }

    // Step 2: Identify duplicates and pick canonical ref (first occurrence)
    const refReplacements = new Map(); // old ref string -> new ref

    for (const [hash, entry] of streamsByHash) {
        if (entry.refs.length <= 1) continue; // No duplicates

        // First ref becomes canonical
        const canonical = entry.refs[0];
        entry.canonical = canonical;

        // Map all others to canonical
        for (let i = 1; i < entry.refs.length; i++) {
            refReplacements.set(entry.refs[i].toString(), canonical);
            if (entry.type === 'font') stats.deduplicatedFonts++;
            else if (entry.type === 'icc') stats.deduplicatedICC++;
            else stats.deduplicatedOther++;
        }
    }

    if (refReplacements.size === 0) {
        if (verbosity >= 2) {
            console.log('    No duplicates found');
        }
        return stats;
    }

    if (verbosity >= 1) {
        console.log(`    Found ${refReplacements.size} duplicate streams to consolidate`);
    }

    // Step 3: Walk through all objects and replace references
    for (const [ref, obj] of context.enumerateIndirectObjects()) {
        if (obj instanceof PDFDict) {
            rewriteDictRefs(obj, refReplacements);
        } else if (obj instanceof PDFArray) {
            rewriteArrayRefs(obj, refReplacements);
        } else if (obj instanceof PDFRawStream) {
            rewriteDictRefs(obj.dict, refReplacements);
        }
    }

    // Step 4: Delete orphaned duplicate objects
    for (const [oldRefStr] of refReplacements) {
        // Parse the ref string to get object and generation numbers
        const match = oldRefStr.match(/(\d+)\s+(\d+)\s+R/);
        if (match) {
            try {
                // Find the actual ref object
                for (const [ref] of context.enumerateIndirectObjects()) {
                    if (ref.toString() === oldRefStr) {
                        context.delete(ref);
                        break;
                    }
                }
            } catch (e) {
                // Ignore deletion errors
            }
        }
    }

    if (verbosity >= 1) {
        console.log(`    Deduplicated streams: ${stats.deduplicatedFonts} fonts, ${stats.deduplicatedICC} ICC profiles, ${stats.deduplicatedOther} other`);
    }

    // Step 5: Deduplicate Font and FontDescriptor dictionaries
    // After stream deduplication, some dict objects may now have identical structure
    const dictDedup = await deduplicateDictionaries(pdfDoc, options);
    stats.deduplicatedFontDicts = dictDedup.fontDicts;
    stats.deduplicatedDescriptors = dictDedup.descriptors;

    if (verbosity >= 1 && (dictDedup.fontDicts > 0 || dictDedup.descriptors > 0)) {
        console.log(`    Deduplicated dicts: ${dictDedup.fontDicts} Font, ${dictDedup.descriptors} FontDescriptor`);
    }

    return stats;
}

/**
 * Serialize a PDFDict to a canonical string for hashing.
 * Resolves refs to their object numbers for comparison.
 * @param {PDFDict} dict
 * @param {number} depth - Recursion depth limit
 * @returns {string}
 */
function serializeDict(dict, depth = 3) {
    if (depth <= 0) return '[...]';

    const entries = [];
    for (const [key, value] of dict.entries()) {
        entries.push(`${key.toString()}:${serializeValue(value, depth - 1)}`);
    }
    entries.sort(); // Canonical ordering
    return `{${entries.join(',')}}`;
}

/**
 * Serialize a PDF value to string
 * @param {any} value
 * @param {number} depth
 * @returns {string}
 */
function serializeValue(value, depth) {
    if (value === undefined || value === null) return 'null';
    if (value instanceof PDFRef) return value.toString();
    if (value instanceof PDFName) return value.toString();
    if (value instanceof PDFDict) return serializeDict(value, depth);
    if (value instanceof PDFArray) {
        if (depth <= 0) return '[...]';
        const items = [];
        for (let i = 0; i < value.size(); i++) {
            items.push(serializeValue(value.get(i), depth - 1));
        }
        return `[${items.join(',')}]`;
    }
    if (value instanceof PDFRawStream) {
        return `stream:${value.dict.get(PDFName.of('Length'))?.toString() || '?'}`;
    }
    return String(value);
}

/**
 * Deduplicate Font and FontDescriptor dictionary objects
 * @param {PDFDocument} pdfDoc
 * @param {object} options
 * @returns {Promise<{ fontDicts: number, descriptors: number }>}
 */
async function deduplicateDictionaries(pdfDoc, options = {}) {
    const verbosity = options.verbosity || 0;
    const stats = { fontDicts: 0, descriptors: 0 };
    const context = pdfDoc.context;

    // First pass: Deduplicate FontDescriptor objects
    const descriptorsByHash = new Map();

    for (const [ref, obj] of context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFDict)) continue;

        const type = obj.get(PDFName.of('Type'))?.toString();
        if (type !== '/FontDescriptor') continue;

        const serialized = serializeDict(obj);
        const hash = await computeHash(new TextEncoder().encode(serialized));

        if (!descriptorsByHash.has(hash)) {
            descriptorsByHash.set(hash, { refs: [], canonical: null });
        }
        descriptorsByHash.get(hash).refs.push(ref);
    }

    // Build replacement map for FontDescriptors
    const descriptorReplacements = new Map();
    for (const [, entry] of descriptorsByHash) {
        if (entry.refs.length <= 1) continue;

        const canonical = entry.refs[0];
        entry.canonical = canonical;

        for (let i = 1; i < entry.refs.length; i++) {
            descriptorReplacements.set(entry.refs[i].toString(), canonical);
            stats.descriptors++;
        }
    }

    // Apply FontDescriptor replacements
    if (descriptorReplacements.size > 0) {
        for (const [, obj] of context.enumerateIndirectObjects()) {
            if (obj instanceof PDFDict) {
                rewriteDictRefs(obj, descriptorReplacements);
            } else if (obj instanceof PDFArray) {
                rewriteArrayRefs(obj, descriptorReplacements);
            } else if (obj instanceof PDFRawStream) {
                rewriteDictRefs(obj.dict, descriptorReplacements);
            }
        }

        // Delete orphaned descriptors
        for (const [oldRefStr] of descriptorReplacements) {
            for (const [ref] of context.enumerateIndirectObjects()) {
                if (ref.toString() === oldRefStr) {
                    try { context.delete(ref); } catch (e) { /* ignore */ }
                    break;
                }
            }
        }
    }

    // Second pass: Deduplicate Font objects (after FontDescriptor dedup)
    const fontsByHash = new Map();

    for (const [ref, obj] of context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFDict)) continue;

        const type = obj.get(PDFName.of('Type'))?.toString();
        if (type !== '/Font') continue;

        const serialized = serializeDict(obj);
        const hash = await computeHash(new TextEncoder().encode(serialized));

        if (!fontsByHash.has(hash)) {
            fontsByHash.set(hash, { refs: [], canonical: null });
        }
        fontsByHash.get(hash).refs.push(ref);
    }

    // Build replacement map for Fonts
    const fontReplacements = new Map();
    for (const [, entry] of fontsByHash) {
        if (entry.refs.length <= 1) continue;

        const canonical = entry.refs[0];
        entry.canonical = canonical;

        for (let i = 1; i < entry.refs.length; i++) {
            fontReplacements.set(entry.refs[i].toString(), canonical);
            stats.fontDicts++;
        }
    }

    // Apply Font replacements
    if (fontReplacements.size > 0) {
        for (const [, obj] of context.enumerateIndirectObjects()) {
            if (obj instanceof PDFDict) {
                rewriteDictRefs(obj, fontReplacements);
            } else if (obj instanceof PDFArray) {
                rewriteArrayRefs(obj, fontReplacements);
            } else if (obj instanceof PDFRawStream) {
                rewriteDictRefs(obj.dict, fontReplacements);
            }
        }

        // Delete orphaned fonts
        for (const [oldRefStr] of fontReplacements) {
            for (const [ref] of context.enumerateIndirectObjects()) {
                if (ref.toString() === oldRefStr) {
                    try { context.delete(ref); } catch (e) { /* ignore */ }
                    break;
                }
            }
        }
    }

    return stats;
}

/**
 * Recursively rewrite PDFRef values in a PDFDict
 * @param {PDFDict} dict
 * @param {Map<string, PDFRef>} replacements
 */
function rewriteDictRefs(dict, replacements) {
    for (const [key, value] of dict.entries()) {
        if (value instanceof PDFRef) {
            const replacement = replacements.get(value.toString());
            if (replacement) {
                dict.set(key, replacement);
            }
        } else if (value instanceof PDFDict) {
            rewriteDictRefs(value, replacements);
        } else if (value instanceof PDFArray) {
            rewriteArrayRefs(value, replacements);
        }
    }
}

/**
 * Recursively rewrite PDFRef values in a PDFArray
 * @param {PDFArray} arr
 * @param {Map<string, PDFRef>} replacements
 */
function rewriteArrayRefs(arr, replacements) {
    for (let i = 0; i < arr.size(); i++) {
        const value = arr.get(i);
        if (value instanceof PDFRef) {
            const replacement = replacements.get(value.toString());
            if (replacement) {
                arr.set(i, replacement);
            }
        } else if (value instanceof PDFDict) {
            rewriteDictRefs(value, replacements);
        } else if (value instanceof PDFArray) {
            rewriteArrayRefs(value, replacements);
        }
    }
}

// ============================================================================
// Image Extraction
// ============================================================================

/**
 * Extract images from a PDF.
 * Dispatches to combined, pages, or separate extraction based on options.
 */
async function extractImages(pdfDocument, inputPath, outputDir, options) {
    const mode = options.extractionMode.images;
    if (mode === 'separate') {
        return extractImagesSeparate(pdfDocument, inputPath, outputDir, options);
    } else if (mode === 'pages') {
        return extractImagesPerPage(pdfDocument, inputPath, outputDir, options);
    } else {
        // 'combined' - all pages in one PDF
        return extractImagesAllPages(pdfDocument, inputPath, outputDir, options);
    }
}

/**
 * Keep only image-related Do operations in a content stream.
 * Inverse of removeImageDoOperations - removes everything EXCEPT image operations.
 *
 * @param {string} content - The decoded content stream
 * @param {Set<string>} imageNames - Set of image XObject names to keep (e.g., "/Im0")
 * @returns {string} - Modified content stream with only image operations
 */
function keepOnlyImageDoOperations(content, imageNames) {
    if (imageNames.size === 0) return '';

    // Parse the content stream and extract only the graphics state + image Do operations
    // We need to preserve:
    // - q/Q blocks that contain image Do operations
    // - cm (transformation matrix) operations before Do
    // - gs (graphics state) operations
    // - Clipping path operations (re, W, W*, n) - CRITICAL for image placement
    // - The Do operation itself

    const lines = content.split('\n');
    const result = [];

    // Track graphics state depth and whether current block has an image
    let inImageBlock = false;
    let currentBlock = [];
    let depth = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Check for graphics state operators
        if (trimmed === 'q') {
            depth++;
            currentBlock.push(line);
            continue;
        }

        if (trimmed === 'Q') {
            if (depth > 0) {
                currentBlock.push(line);
                depth--;

                // If we're back to top level and had an image, output the block
                if (depth === 0 && inImageBlock) {
                    result.push(...currentBlock);
                    inImageBlock = false;
                }
                if (depth === 0) {
                    currentBlock = [];
                }
            }
            continue;
        }

        // Check for Do operations that reference our images
        const doMatch = trimmed.match(/^(\/\w+)\s+Do\b/);
        if (doMatch) {
            const name = doMatch[1];
            if (imageNames.has(name)) {
                inImageBlock = true;
                currentBlock.push(line);
            }
            continue;
        }

        // Keep cm operations (transformation matrix) within image blocks
        if (depth > 0 && trimmed.match(/^\s*[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+cm\b/)) {
            currentBlock.push(line);
            continue;
        }

        // Keep gs (graphics state) operations that might affect image rendering
        if (depth > 0 && trimmed.match(/^\/\w+\s+gs\b/)) {
            currentBlock.push(line);
            continue;
        }

        // Keep clipping path operations - CRITICAL for image placement
        // These define the clipping region where images are drawn:
        // - re: rectangle path (e.g., "446 104.333 305 390 re")
        // - W / W*: set clipping rule (winding / even-odd)
        // - n: end path without filling/stroking
        if (depth > 0) {
            // Rectangle path: 4 numbers followed by 're'
            if (trimmed.match(/^[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+re\b/)) {
                currentBlock.push(line);
                continue;
            }
            // Clipping operators
            if (trimmed === 'W' || trimmed === 'W*' || trimmed === 'W n' || trimmed === 'W* n') {
                currentBlock.push(line);
                continue;
            }
            // No-op path end
            if (trimmed === 'n') {
                currentBlock.push(line);
                continue;
            }
        }

        // Discard other operations when in a block
        if (depth > 0) {
            continue;
        }
    }

    return result.join('\n');
}

/**
 * Extract all images from all pages as a single combined PDF.
 * Uses pdf-lib's copyPages() with resource deduplication.
 *
 * Output: "{baseName} - Images.pdf" (all pages, images only)
 */
async function extractImagesAllPages(pdfDocument, inputPath, outputDir, options) {
    const baseName = basename(inputPath, extname(inputPath));
    const pages = pdfDocument.getPages();
    const extractedFiles = [];

    await mkdir(outputDir, { recursive: true });

    const outputName = `${baseName} - Images.pdf`;
    const outputPath = join(outputDir, outputName);

    if (options.verbosity >= 1) {
        console.log(`  Creating: ${outputName} (${pages.length} pages)`);
    }

    // Create a new PDF document with resource deduplication
    const newDoc = await PDFDocument.create();
    const deduplicator = new ResourceDeduplicator(newDoc);

    let totalImages = 0;

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const pageNum = String(pageIndex + 1).padStart(2, '0');

        const resources = page.node.Resources();
        if (!resources) continue;

        const xObjects = resources.get(PDFName.of('XObject'));
        if (!(xObjects instanceof PDFDict)) continue;

        // Find all image XObjects on this page
        const imageNames = new Set();
        for (const [name, ref] of xObjects.entries()) {
            const obj = pdfDocument.context.lookup(ref);
            if (!(obj instanceof PDFRawStream)) continue;

            const subtype = obj.dict.get(PDFName.of('Subtype'));
            if (subtype?.toString() !== '/Image') continue;

            imageNames.add(name.toString());
        }

        if (imageNames.size === 0) {
            if (options.verbosity >= 2) {
                console.log(`    Page ${pageNum}: No images`);
            }
            continue;
        }

        totalImages += imageNames.size;

        if (options.verbosity >= 2) {
            console.log(`    Page ${pageNum}: ${imageNames.size} image(s)`);
        }

        // Copy the full page using pdf-lib's copyPages
        const [copiedPage] = await newDoc.copyPages(pdfDocument, [pageIndex]);

        // Get resources from copied page
        const copiedResources = copiedPage.node.Resources();
        if (!copiedResources) continue;

        // Collect refs to delete (non-image XObjects, fonts, etc.)
        const refsToDelete = [];
        const nonImageNames = new Set();

        // Remove non-image XObjects
        const copiedXObjects = copiedResources.get(PDFName.of('XObject'));
        if (copiedXObjects instanceof PDFDict) {
            for (const [name, ref] of copiedXObjects.entries()) {
                const obj = newDoc.context.lookup(ref);
                if (obj instanceof PDFRawStream) {
                    const subtype = obj.dict.get(PDFName.of('Subtype'));
                    if (subtype?.toString() !== '/Image') {
                        nonImageNames.add(name.toString());
                        if (ref instanceof PDFRef) refsToDelete.push(ref);
                    }
                }
            }

            for (const name of nonImageNames) {
                const pdfName = PDFName.of(name.replace(/^\//, ''));
                copiedXObjects.delete(pdfName);
            }
        }

        // Remove fonts entirely
        const fonts = copiedResources.get(PDFName.of('Font'));
        if (fonts instanceof PDFDict) {
            for (const [, ref] of fonts.entries()) {
                if (ref instanceof PDFRef) refsToDelete.push(ref);
            }
            copiedResources.delete(PDFName.of('Font'));
        }

        // Modify content stream to keep only image operations
        const contentStreams = getDecodedContentStreams(copiedPage.node, newDoc);
        if (contentStreams.length > 0) {
            const oldContentRefs = contentStreams
                .filter(s => s.ref instanceof PDFRef)
                .map(s => s.ref);

            // Combine all content streams and keep only image operations
            const combinedContent = contentStreams.map(s => s.content).join('\n');
            const imageOnlyContent = keepOnlyImageDoOperations(combinedContent, imageNames);

            // Create new content stream with only image operations
            const newContentStream = newDoc.context.flateStream(imageOnlyContent);
            const newContentRef = newDoc.context.register(newContentStream);
            copiedPage.node.set(PDFName.of('Contents'), newContentRef);

            // Delete old content streams
            for (const ref of oldContentRefs) {
                if (ref) refsToDelete.push(ref);
            }
        }

        // Clean up ProcSet - keep only image-related entries
        const procSet = copiedResources.get(PDFName.of('ProcSet'));
        if (procSet instanceof PDFArray) {
            const newProcSet = [PDFName.of('PDF')];
            for (let i = 0; i < procSet.size(); i++) {
                const item = procSet.get(i);
                const itemStr = item?.toString();
                if (itemStr === '/ImageC' || itemStr === '/ImageB' || itemStr === '/ImageI') {
                    newProcSet.push(item);
                }
            }
            copiedResources.set(PDFName.of('ProcSet'), newDoc.context.obj(newProcSet));
        }

        // Delete orphaned objects
        for (const ref of refsToDelete) {
            try {
                newDoc.context.delete(ref);
            } catch (e) {
                // Ignore deletion errors
            }
        }

        newDoc.addPage(copiedPage);
    }

    if (totalImages === 0) {
        console.log('  No images found in document');
        return extractedFiles;
    }

    // Deduplicate resources across pages (mainly ICC profiles in images)
    if (options.verbosity >= 1) {
        console.log('  Deduplicating resources...');
    }
    await deduplicateDocumentResources(newDoc, options);

    // Save, reload, and re-save for proper finalization
    const initialBytes = await newDoc.save();
    const verifiedDoc = await PDFDocument.load(initialBytes);
    const pdfBytes = await verifiedDoc.save();

    await writeFile(outputPath, pdfBytes);
    extractedFiles.push(outputPath);

    if (options.verbosity >= 1) {
        const sizeMB = (pdfBytes.length / (1024 * 1024)).toFixed(2);
        console.log(`  Total: ${totalImages} images, ${sizeMB} MB`);
    }

    // Generate document structure if requested
    if (options.generateDocumentStructure) {
        const reloadedDoc = await PDFDocument.load(pdfBytes);
        const mdPath = await generateDocumentStructure(reloadedDoc, outputPath);
        extractedFiles.push(mdPath);
    }

    return extractedFiles;
}

/**
 * Extract all images on each page as a single PDF per page.
 * Uses pdf-lib's copyPages() to properly copy all object references including ICC profiles.
 *
 * Output: "{baseName} - Page XX - Images.pdf" (one per page)
 */
async function extractImagesPerPage(pdfDocument, inputPath, outputDir, options) {
    const baseName = basename(inputPath, extname(inputPath));
    const pages = pdfDocument.getPages();
    const extractedFiles = [];

    await mkdir(outputDir, { recursive: true });

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const pageNum = String(pageIndex + 1).padStart(2, '0');

        const resources = page.node.Resources();
        if (!resources) continue;

        const xObjects = resources.get(PDFName.of('XObject'));
        if (!(xObjects instanceof PDFDict)) continue;

        // Find all image XObjects on this page
        const imageNames = new Set();
        for (const [name, ref] of xObjects.entries()) {
            const obj = pdfDocument.context.lookup(ref);
            if (!(obj instanceof PDFRawStream)) continue;

            const subtype = obj.dict.get(PDFName.of('Subtype'));
            if (subtype?.toString() !== '/Image') continue;

            imageNames.add(name.toString());
        }

        if (imageNames.size === 0) continue;

        const outputName = `${baseName} - Page ${pageNum} - Images.pdf`;
        const outputPath = join(outputDir, outputName);

        if (options.verbosity >= 1) {
            console.log(`  Extracting: ${outputName} (${imageNames.size} image(s))`);
        }

        // Create a new PDF document
        const newDoc = await PDFDocument.create();

        // Copy the full page using pdf-lib's copyPages
        const [copiedPage] = await newDoc.copyPages(pdfDocument, [pageIndex]);

        // Get resources from copied page
        const copiedResources = copiedPage.node.Resources();
        if (!copiedResources) continue;

        // Collect refs to delete
        const refsToDelete = [];
        const nonImageNames = new Set();

        // Remove non-image XObjects
        const copiedXObjects = copiedResources.get(PDFName.of('XObject'));
        if (copiedXObjects instanceof PDFDict) {
            for (const [name, ref] of copiedXObjects.entries()) {
                const obj = newDoc.context.lookup(ref);
                if (obj instanceof PDFRawStream) {
                    const subtype = obj.dict.get(PDFName.of('Subtype'));
                    if (subtype?.toString() !== '/Image') {
                        nonImageNames.add(name.toString());
                        if (ref instanceof PDFRef) refsToDelete.push(ref);
                    }
                }
            }

            for (const name of nonImageNames) {
                const pdfName = PDFName.of(name.replace(/^\//, ''));
                copiedXObjects.delete(pdfName);
            }
        }

        // Remove fonts entirely
        const fonts = copiedResources.get(PDFName.of('Font'));
        if (fonts instanceof PDFDict) {
            for (const [, ref] of fonts.entries()) {
                if (ref instanceof PDFRef) refsToDelete.push(ref);
            }
            copiedResources.delete(PDFName.of('Font'));
        }

        // Modify content stream to keep only image operations
        const contentStreams = getDecodedContentStreams(copiedPage.node, newDoc);
        if (contentStreams.length > 0) {
            const oldContentRefs = contentStreams
                .filter(s => s.ref instanceof PDFRef)
                .map(s => s.ref);

            const combinedContent = contentStreams.map(s => s.content).join('\n');
            const imageOnlyContent = keepOnlyImageDoOperations(combinedContent, imageNames);

            const newContentStream = newDoc.context.flateStream(imageOnlyContent);
            const newContentRef = newDoc.context.register(newContentStream);
            copiedPage.node.set(PDFName.of('Contents'), newContentRef);

            for (const ref of oldContentRefs) {
                if (ref) refsToDelete.push(ref);
            }
        }

        // Clean up ProcSet
        const procSet = copiedResources.get(PDFName.of('ProcSet'));
        if (procSet instanceof PDFArray) {
            const newProcSet = [PDFName.of('PDF')];
            for (let i = 0; i < procSet.size(); i++) {
                const item = procSet.get(i);
                const itemStr = item?.toString();
                if (itemStr === '/ImageC' || itemStr === '/ImageB' || itemStr === '/ImageI') {
                    newProcSet.push(item);
                }
            }
            copiedResources.set(PDFName.of('ProcSet'), newDoc.context.obj(newProcSet));
        }

        // Delete orphaned objects
        for (const ref of refsToDelete) {
            try {
                newDoc.context.delete(ref);
            } catch (e) {
                // Ignore
            }
        }

        newDoc.addPage(copiedPage);

        // Save
        const initialBytes = await newDoc.save();
        const verifiedDoc = await PDFDocument.load(initialBytes);
        const pdfBytes = await verifiedDoc.save();

        await writeFile(outputPath, pdfBytes);
        extractedFiles.push(outputPath);

        // Generate document structure if requested
        if (options.generateDocumentStructure) {
            const reloadedDoc = await PDFDocument.load(pdfBytes);
            const mdPath = await generateDocumentStructure(reloadedDoc, outputPath);
            extractedFiles.push(mdPath);
        }
    }

    return extractedFiles;
}

/**
 * Extract each image from a PDF as a separate single-page PDF.
 * Uses pdf-lib's copyPages() to properly copy all object references including ICC profiles.
 *
 * For each image:
 * 1. Copy the source page using copyPages() (preserves all resources)
 * 2. Modify the content stream to only draw the specific image
 * 3. Clean up unused XObjects
 */
async function extractImagesSeparate(pdfDocument, inputPath, outputDir, options) {
    const baseName = basename(inputPath, extname(inputPath));
    const pages = pdfDocument.getPages();
    const extractedFiles = [];

    await mkdir(outputDir, { recursive: true });

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const pageNum = String(pageIndex + 1).padStart(2, '0');

        const resources = page.node.Resources();
        if (!resources) continue;

        const xObjects = resources.get(PDFName.of('XObject'));
        if (!(xObjects instanceof PDFDict)) continue;

        // Find all image XObjects on this page
        const imageEntries = [];
        for (const [name, ref] of xObjects.entries()) {
            const obj = pdfDocument.context.lookup(ref);
            if (!(obj instanceof PDFRawStream)) continue;

            const subtype = obj.dict.get(PDFName.of('Subtype'));
            if (subtype?.toString() !== '/Image') continue;

            const imageDict = obj.dict;
            const imageWidth = parseInt(imageDict.get(PDFName.of('Width'))?.toString() || '0', 10);
            const imageHeight = parseInt(imageDict.get(PDFName.of('Height'))?.toString() || '0', 10);

            imageEntries.push({ name, ref, imageWidth, imageHeight });
        }

        // Extract each image as a separate PDF
        for (let i = 0; i < imageEntries.length; i++) {
            const { name, imageWidth, imageHeight } = imageEntries[i];
            const imageNum = String(i + 1).padStart(3, '0');
            const outputName = `${baseName} - Page ${pageNum} - Image ${imageNum}.pdf`;
            const outputPath = join(outputDir, outputName);

            if (options.verbosity >= 1) {
                console.log(`  Extracting: ${outputName}`);
            }

            // Create a new PDF document
            const newDoc = await PDFDocument.create();

            // Copy the full page using pdf-lib's copyPages (this properly copies ICC profiles, etc.)
            const [copiedPage] = await newDoc.copyPages(pdfDocument, [pageIndex]);

            // Determine page size based on image dimensions
            const maxDim = 612; // Letter width
            const scale = Math.min(maxDim / imageWidth, maxDim / imageHeight, 1);
            const pageWidth = imageWidth * scale;
            const pageHeight = imageHeight * scale;

            // Set the page size to match the image aspect ratio
            copiedPage.setSize(pageWidth, pageHeight);

            // Create a new content stream that only draws this specific image
            const imageName = name.toString().replace('/', '');
            const contentStream = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /${imageName} Do Q`;

            // Replace the page's content stream
            const contentStreamRef = newDoc.context.stream(contentStream);
            copiedPage.node.set(PDFName.of('Contents'), contentStreamRef);

            // Add the page to the document
            newDoc.addPage(copiedPage);

            const pdfBytes = await newDoc.save();
            await writeFile(outputPath, pdfBytes);
            extractedFiles.push(outputPath);

            // Generate document structure if requested
            if (options.generateDocumentStructure) {
                const reloadedDoc = await PDFDocument.load(pdfBytes);
                const mdPath = await generateDocumentStructure(reloadedDoc, outputPath);
                extractedFiles.push(mdPath);
            }
        }
    }

    return extractedFiles;
}

// ============================================================================
// Content Stream Extraction
// ============================================================================

/**
 * Remove image XObject Do operations from a content stream.
 * Finds patterns like "q ... /ImageName Do ... Q" and removes them.
 *
 * @param {string} content - The decoded content stream
 * @param {Set<string>} imageNames - Set of image XObject names to remove (e.g., "/Im0")
 * @returns {string} - Modified content stream with image operations removed
 */
function removeImageDoOperations(content, imageNames) {
    if (imageNames.size === 0) return content;

    // IMPORTANT: We can't use greedy regex to match q...Do...Q blocks because
    // they may be nested. A greedy match from outer q to inner Q leaves orphaned Q operators.
    //
    // Instead, we just remove the "/ImageName Do" operations themselves.
    // This leaves empty q...Q blocks which are harmless (just graphics state save/restore).

    let result = content;

    for (const imageName of imageNames) {
        // Escape the image name for regex (handle special chars like /)
        const escapedName = imageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Remove the "/ImageName Do" operation (with optional whitespace)
        // This preserves the surrounding q/Q graphics state blocks
        const doPattern = new RegExp(
            `${escapedName}\\s+Do\\b`,
            'g'
        );
        result = result.replace(doPattern, '');
    }

    // Clean up resulting empty lines (but preserve single newlines for readability)
    result = result
        .replace(/\n\s*\n\s*\n/g, '\n\n')  // Collapse multiple blank lines to one
        .trim();

    return result;
}

/**
 * Get and decode content streams from a page.
 * @param {PDFPageLeaf} pageNode - The page node
 * @param {PDFDocument} pdfDocument - The PDF document
 * @returns {Array<{ref: PDFRef | null, content: string, isDirect: boolean}>} - Array of decoded content streams
 */
function getDecodedContentStreams(pageNode, pdfDocument) {
    const contents = pageNode.Contents();
    if (!contents) return [];

    const streams = [];

    // Contents can be:
    // - PDFArray of PDFRefs
    // - Single PDFRef
    // - Direct PDFRawStream (embedded in page dictionary)

    if (contents instanceof PDFArray) {
        // Array of refs
        for (let i = 0; i < contents.size(); i++) {
            const ref = contents.get(i);
            if (!(ref instanceof PDFRef)) continue;

            const stream = pdfDocument.context.lookup(ref);
            if (!(stream instanceof PDFRawStream)) continue;

            try {
                const decoded = decodePDFRawStream(stream).decode();
                const contentString = new TextDecoder('latin1').decode(decoded);
                streams.push({ ref, content: contentString, isDirect: false });
            } catch (err) {
                console.warn(`Warning: Could not decode content stream: ${err.message}`);
            }
        }
    } else if (contents instanceof PDFRef) {
        // Single ref
        const stream = pdfDocument.context.lookup(contents);
        if (stream instanceof PDFRawStream) {
            try {
                const decoded = decodePDFRawStream(stream).decode();
                const contentString = new TextDecoder('latin1').decode(decoded);
                streams.push({ ref: contents, content: contentString, isDirect: false });
            } catch (err) {
                console.warn(`Warning: Could not decode content stream: ${err.message}`);
            }
        }
    } else if (contents instanceof PDFRawStream) {
        // Direct stream embedded in page dictionary
        // We need to extract the content, then clear the original stream data
        try {
            const decoded = decodePDFRawStream(contents).decode();
            const contentString = new TextDecoder('latin1').decode(decoded);

            // Clear the original stream data to prevent it from being serialized
            // @ts-ignore - contents is a PDFRawStream with a contents property
            if (contents.contents) {
                // @ts-ignore
                contents.contents = new Uint8Array(0);
            }

            // No ref to delete for direct streams - we just cleared the data
            streams.push({ ref: null, content: contentString, isDirect: true });
        } catch (err) {
            console.warn(`Warning: Could not decode direct content stream: ${err.message}`);
        }
    }

    return streams;
}

/**
 * Extract content streams (without images) from a PDF as a single combined PDF.
 * Uses pdf-lib's copyPages() to properly copy all object references.
 *
 * Creates one output PDF containing all pages with images removed:
 * - Output: "{baseName} - Contents.pdf"
 *
 * For each page:
 * 1. Copy the source page using copyPages() (preserves all resources)
 * 2. Remove image XObjects from the Resources dictionary
 * 3. Remove image Do operations from content streams
 * 4. Keep fonts, color spaces, graphics states, etc.
 */
async function extractContentStreamsCombined(pdfDocument, inputPath, outputDir, options) {
    const baseName = basename(inputPath, extname(inputPath));
    const pages = pdfDocument.getPages();
    const extractedFiles = [];

    await mkdir(outputDir, { recursive: true });

    const outputName = `${baseName} - Contents.pdf`;
    const outputPath = join(outputDir, outputName);

    if (options.verbosity >= 1) {
        console.log(`  Creating: ${outputName} (${pages.length} pages)`);
    }

    // Create a new PDF document for all pages
    const newDoc = await PDFDocument.create();

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const pageNum = String(pageIndex + 1).padStart(2, '0');

        // Get page content streams
        const contents = page.node.Contents();
        if (!contents) continue;

        if (options.verbosity >= 2) {
            console.log(`    Processing page ${pageNum}...`);
        }

        // Copy the full page using pdf-lib's copyPages (this properly copies all resources)
        const [copiedPage] = await newDoc.copyPages(pdfDocument, [pageIndex]);

        // Collect image XObject names and refs to remove
        const imageNamesToRemove = new Set();
        const imageRefsToDelete = [];
        const copiedResources = copiedPage.node.Resources();

        if (copiedResources) {
            const copiedXObjects = copiedResources.get(PDFName.of('XObject'));
            if (copiedXObjects instanceof PDFDict) {
                // Find image XObjects and collect their names and refs
                for (const [name, ref] of copiedXObjects.entries()) {
                    const obj = newDoc.context.lookup(ref);
                    if (obj instanceof PDFRawStream) {
                        const subtype = obj.dict.get(PDFName.of('Subtype'));
                        if (subtype?.toString() === '/Image') {
                            imageNamesToRemove.add(name.toString());
                            if (ref instanceof PDFRef) {
                                imageRefsToDelete.push(ref);
                            }
                        }
                    }
                }

                // Remove image XObjects from Resources dictionary
                for (const name of imageNamesToRemove) {
                    const pdfName = PDFName.of(name.replace(/^\//, ''));
                    copiedXObjects.delete(pdfName);
                }

                // Delete image objects from context
                for (const ref of imageRefsToDelete) {
                    try {
                        newDoc.context.delete(ref);
                    } catch (e) {
                        // Ignore deletion errors
                    }
                }
            }
        }

        // Modify content streams to remove image Do operations
        if (imageNamesToRemove.size > 0) {
            const contentStreams = getDecodedContentStreams(copiedPage.node, newDoc);

            if (contentStreams.length > 0) {
                const oldContentRefs = contentStreams
                    .filter(s => s.ref instanceof PDFRef)
                    .map(s => s.ref);

                // Combine all content streams, modify, and create a single new stream
                let combinedContent = contentStreams.map(s => s.content).join('\n');
                const modifiedContent = removeImageDoOperations(combinedContent, imageNamesToRemove);

                // Create a new content stream with the modified content
                const newContentStream = newDoc.context.flateStream(modifiedContent);
                const newContentRef = newDoc.context.register(newContentStream);
                copiedPage.node.set(PDFName.of('Contents'), newContentRef);

                // Delete old content streams from context
                for (const ref of oldContentRefs) {
                    try {
                        newDoc.context.delete(ref);
                    } catch (e) {
                        // Ignore deletion errors
                    }
                }
            }
        }

        // Clean up Resources: remove empty XObject dict and image ProcSet entries
        if (copiedResources) {
            const xobjDict = copiedResources.get(PDFName.of('XObject'));
            if (xobjDict instanceof PDFDict && xobjDict.entries().length === 0) {
                copiedResources.delete(PDFName.of('XObject'));
            }

            const procSet = copiedResources.get(PDFName.of('ProcSet'));
            if (procSet instanceof PDFArray) {
                const newProcSet = [];
                for (let i = 0; i < procSet.size(); i++) {
                    const item = procSet.get(i);
                    if (item?.toString() !== '/ImageC' && item?.toString() !== '/ImageB' && item?.toString() !== '/ImageI') {
                        newProcSet.push(item);
                    }
                }
                copiedResources.set(PDFName.of('ProcSet'), newDoc.context.obj(newProcSet));
            }
        }

        // Add the page to the combined document
        newDoc.addPage(copiedPage);
    }

    // Deduplicate resources across pages
    if (options.verbosity >= 1) {
        console.log('  Deduplicating resources...');
    }
    await deduplicateDocumentResources(newDoc, options);

    // Save, reload, and re-save to ensure proper finalization
    const initialBytes = await newDoc.save();
    const verifiedDoc = await PDFDocument.load(initialBytes);
    const pdfBytes = await verifiedDoc.save();

    await writeFile(outputPath, pdfBytes);
    extractedFiles.push(outputPath);

    // Generate document structure if requested
    if (options.generateDocumentStructure) {
        const reloadedDoc = await PDFDocument.load(pdfBytes);
        const mdPath = await generateDocumentStructure(reloadedDoc, outputPath);
        extractedFiles.push(mdPath);
    }

    return extractedFiles;
}

/**
 * Extract content streams (without images) from a PDF as separate single-page PDFs.
 * Uses pdf-lib's copyPages() to properly copy all object references.
 *
 * For each page:
 * 1. Copy the source page using copyPages() (preserves all resources)
 * 2. Remove image XObjects from the Resources dictionary
 * 3. Remove image Do operations from content streams
 * 4. Keep fonts, color spaces, graphics states, etc.
 */
async function extractContentStreamsPerPage(pdfDocument, inputPath, outputDir, options) {
    const baseName = basename(inputPath, extname(inputPath));
    const pages = pdfDocument.getPages();
    const extractedFiles = [];

    await mkdir(outputDir, { recursive: true });

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const pageNum = String(pageIndex + 1).padStart(2, '0');

        // Get page content streams
        const contents = page.node.Contents();
        if (!contents) continue;

        const outputName = `${baseName} - Page ${pageNum} - Contents.pdf`;
        const outputPath = join(outputDir, outputName);

        if (options.verbosity >= 1) {
            console.log(`  Extracting: ${outputName}`);
        }

        // Create a new PDF document
        const newDoc = await PDFDocument.create();

        // Copy the full page using pdf-lib's copyPages (this properly copies all resources)
        const [copiedPage] = await newDoc.copyPages(pdfDocument, [pageIndex]);

        // Collect image XObject names and refs to remove
        const imageNamesToRemove = new Set();
        const imageRefsToDelete = [];  // Refs to delete from context
        const copiedResources = copiedPage.node.Resources();

        if (copiedResources) {
            const copiedXObjects = copiedResources.get(PDFName.of('XObject'));
            if (copiedXObjects instanceof PDFDict) {
                // Find image XObjects and collect their names and refs
                for (const [name, ref] of copiedXObjects.entries()) {
                    const obj = newDoc.context.lookup(ref);
                    if (obj instanceof PDFRawStream) {
                        const subtype = obj.dict.get(PDFName.of('Subtype'));
                        if (subtype?.toString() === '/Image') {
                            imageNamesToRemove.add(name.toString());
                            if (ref instanceof PDFRef) {
                                imageRefsToDelete.push(ref);
                            }
                        }
                    }
                }

                // Remove image XObjects from Resources dictionary
                for (const name of imageNamesToRemove) {
                    const pdfName = PDFName.of(name.replace(/^\//, ''));
                    copiedXObjects.delete(pdfName);
                }

                // Delete image objects from context to prevent orphaned data
                // This is critical for reducing file size
                for (const ref of imageRefsToDelete) {
                    try {
                        newDoc.context.delete(ref);
                    } catch (e) {
                        // Ignore deletion errors (object may not exist or be referenced elsewhere)
                    }
                }
            }
        }

        // Modify content streams to remove image Do operations
        if (imageNamesToRemove.size > 0) {
            const contentStreams = getDecodedContentStreams(copiedPage.node, newDoc);

            if (options.verbosity >= 2) {
                console.log(`    Images to remove: ${imageNamesToRemove.size}, Content streams: ${contentStreams.length}`);
            }

            if (contentStreams.length > 0) {
                // Collect old content stream refs to delete later
                // Note: Direct streams have their data cleared by getDecodedContentStreams
                const oldContentRefs = contentStreams
                    .filter(s => s.ref instanceof PDFRef)
                    .map(s => s.ref);

                const directStreamsCount = contentStreams.filter(s => s.isDirect).length;

                if (options.verbosity >= 2) {
                    console.log(`    Old content refs: ${oldContentRefs.length} (${directStreamsCount} were direct streams)`);
                }

                // Combine all content streams, modify, and create a single new stream
                let combinedContent = contentStreams.map(s => s.content).join('\n');
                const modifiedContent = removeImageDoOperations(combinedContent, imageNamesToRemove);

                if (options.verbosity >= 2) {
                    console.log(`    Removed ${imageNamesToRemove.size} image Do operations`);
                }

                // Create a new content stream with the modified content (FlateDecode compressed)
                // IMPORTANT: Register as indirect object - direct embedding causes PDF reader issues
                const newContentStream = newDoc.context.flateStream(modifiedContent);
                const newContentRef = newDoc.context.register(newContentStream);
                copiedPage.node.set(PDFName.of('Contents'), newContentRef);

                // Delete old content streams from context to prevent orphaned data
                // This is critical for reducing file size when combining multiple streams into one
                for (const ref of oldContentRefs) {
                    try {
                        newDoc.context.delete(ref);
                        if (options.verbosity >= 3) {
                            console.log(`    Deleted old content stream: ${ref?.toString()}`);
                        }
                    } catch (e) {
                        if (options.verbosity >= 2) {
                            console.log(`    Failed to delete ${ref?.toString()}: ${e.message}`);
                        }
                    }
                }
            }
        } else {
            if (options.verbosity >= 2) {
                console.log(`    No images to remove on this page`);
            }
        }

        // Clean up Resources: remove empty XObject dict and /ImageC from ProcSet
        if (copiedResources) {
            // Remove empty XObject dictionary
            const xobjDict = copiedResources.get(PDFName.of('XObject'));
            if (xobjDict instanceof PDFDict && xobjDict.entries().length === 0) {
                copiedResources.delete(PDFName.of('XObject'));
            }

            // Remove /ImageC from ProcSet if no images remain
            const procSet = copiedResources.get(PDFName.of('ProcSet'));
            if (procSet instanceof PDFArray) {
                const newProcSet = [];
                for (let i = 0; i < procSet.size(); i++) {
                    const item = procSet.get(i);
                    if (item?.toString() !== '/ImageC' && item?.toString() !== '/ImageB' && item?.toString() !== '/ImageI') {
                        newProcSet.push(item);
                    }
                }
                copiedResources.set(PDFName.of('ProcSet'), newDoc.context.obj(newProcSet));
            }
        }

        // Add the page to the document
        newDoc.addPage(copiedPage);

        // Save, reload, and re-save to ensure proper finalization
        const initialBytes = await newDoc.save();
        const verifiedDoc = await PDFDocument.load(initialBytes);

        // Verify the document can be properly accessed
        if (verifiedDoc.getPageCount() !== 1) {
            console.warn(`    Warning: Verified doc has ${verifiedDoc.getPageCount()} pages instead of 1`);
        }

        const pdfBytes = await verifiedDoc.save();
        await writeFile(outputPath, pdfBytes);
        extractedFiles.push(outputPath);

        // Generate document structure if requested
        if (options.generateDocumentStructure) {
            const reloadedDoc = await PDFDocument.load(pdfBytes);
            const mdPath = await generateDocumentStructure(reloadedDoc, outputPath);
            extractedFiles.push(mdPath);
        }
    }

    return extractedFiles;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    const args = process.argv.slice(2);
    const { positional, options } = parseArgs(args);

    // Log worker configuration
    if (options.useWorkers) {
        const { availableParallelism } = await import('os');
        const actualWorkerCount = availableParallelism?.() || 4;
        const expectedCount = options.expectedWorkerCount;

        if (expectedCount !== undefined && expectedCount !== actualWorkerCount) {
            // Warning only - workers are being used, just different count
            console.warn(`[convert-pdf-color-legacy] WARNING: Worker count differs - expected ${expectedCount}, actual ${actualWorkerCount}`);
        }
        console.log(`[convert-pdf-color-legacy] Workers enabled: ${actualWorkerCount} workers`);
    } else {
        // Workers disabled - check if they were expected
        const expectedCount = options.expectedWorkerCount;
        if (expectedCount !== undefined && expectedCount > 0) {
            // ERROR - workers expected but not used
            console.error(`[convert-pdf-color-legacy] ERROR: Workers expected (${expectedCount}) but not used (main thread mode)`);
            process.exit(1);
        }
        console.log('[convert-pdf-color-legacy] Workers disabled: 0 workers (main thread mode)');
    }

    console.log('\n' + '═'.repeat(80));
    console.log('PDF Color Conversion Tool');
    console.log('═'.repeat(80));

    // Validate arguments based on mode
    const mode = options.mode;

    if (mode === 'structure-only') {
        // Generate structure only - needs input PDF
        if (positional.length < 1) {
            console.error('Error: Missing input PDF');
            printUsage();
            process.exit(1);
        }

        const inputPath = resolve(positional[0]);
        const outputPath = positional[1] ? resolve(positional[1]) : null;

        console.log(`\nMode: Generate Document Structure`);
        console.log(`Input PDF: ${inputPath}`);
        if (outputPath) console.log(`Output: ${outputPath}`);

        const pdfBuffer = await readFile(inputPath);
        const pdfDocument = await PDFDocument.load(pdfBuffer);

        const mdPath = await generateDocumentStructure(pdfDocument, inputPath, outputPath);
        console.log(`\nGenerated: ${mdPath}`);

    } else if (mode === 'extract-images') {
        // Extract images only
        if (positional.length < 2) {
            console.error('Error: Missing input PDF or output directory');
            printUsage();
            process.exit(1);
        }

        const inputPath = resolve(positional[0]);
        const outputDir = resolve(positional[1]);
        const extractMode = options.extractionMode.images;

        console.log(`\nMode: Extract Images Only`);
        console.log(`Input PDF:   ${inputPath}`);
        console.log(`Output Dir:  ${outputDir}`);
        console.log(`Output Mode: ${extractMode}`);
        console.log(`Verbosity:   ${options.verbosity}`);
        console.log(`Doc Structure: ${options.generateDocumentStructure}`);

        const pdfBuffer = await readFile(inputPath);
        const pdfDocument = await PDFDocument.load(pdfBuffer);

        console.log(`\nPages: ${pdfDocument.getPageCount()}`);

        // Generate input document structure if requested
        if (options.generateDocumentStructure) {
            const mdPath = await generateDocumentStructure(pdfDocument, inputPath);
            console.log(`Generated input structure: ${mdPath}`);
        }

        console.log('\nExtracting images...');
        const files = await extractImages(pdfDocument, inputPath, outputDir, options);
        console.log(`\nExtracted ${files.length} file(s)`);

    } else if (mode === 'extract-content-streams') {
        // Extract content streams only - needs input PDF and output directory
        if (positional.length < 2) {
            console.error('Error: Missing input PDF or output directory');
            printUsage();
            process.exit(1);
        }

        const inputPath = resolve(positional[0]);
        const outputDir = resolve(positional[1]);
        const extractMode = options.extractionMode.contentStreams;

        console.log(`\nMode: Extract Content Streams Only`);
        console.log(`Input PDF:   ${inputPath}`);
        console.log(`Output Dir:  ${outputDir}`);
        console.log(`Output Mode: ${extractMode}`);
        console.log(`Verbosity:   ${options.verbosity}`);
        console.log(`Doc Structure: ${options.generateDocumentStructure}`);

        const pdfBuffer = await readFile(inputPath);
        const pdfDocument = await PDFDocument.load(pdfBuffer);

        console.log(`\nPages: ${pdfDocument.getPageCount()}`);

        // Generate input document structure if requested
        if (options.generateDocumentStructure) {
            const mdPath = await generateDocumentStructure(pdfDocument, inputPath);
            console.log(`Generated input structure: ${mdPath}`);
        }

        console.log('\nExtracting content streams...');
        let files;
        if (extractMode === 'combined') {
            files = await extractContentStreamsCombined(pdfDocument, inputPath, outputDir, options);
        } else {
            // 'pages' mode - one PDF per page (legacy behavior)
            files = await extractContentStreamsPerPage(pdfDocument, inputPath, outputDir, options);
        }
        console.log(`\nExtracted ${files.length} file(s)`);

    } else if (mode === 'extract-convert-images') {
        console.error('\nError: --extract-and-convert-images-only is not supported yet');
        console.error('This feature will be implemented in a future session.');
        process.exit(1);

    } else if (mode === 'extract-convert-content-streams') {
        console.error('\nError: --extract-and-convert-content-streams-only is not supported yet');
        console.error('This feature will be implemented in a future session.');
        process.exit(1);

    } else {
        // Default conversion mode - needs input PDF, profile, and output PDF
        if (positional.length < 3) {
            console.error('Error: Missing required arguments (input.pdf, profile.icc, output.pdf)');
            printUsage();
            process.exit(1);
        }

        const [inputPath, profilePath, outputPath] = positional.map(p => resolve(p));

        console.log(`\nMode: Full Conversion`);
        console.log(`Input PDF:    ${inputPath}`);
        console.log(`ICC Profile:  ${profilePath}`);
        console.log(`Output PDF:   ${outputPath}`);
        console.log(`\nOptions:`);
        console.log(`  Rendering Intent:  ${options.renderingIntent}`);
        console.log(`  BPC:               ${options.blackPointCompensation}`);
        console.log(`  Convert Images:    ${options.convertImages}`);
        console.log(`  Convert Content:   ${options.convertContentStreams}`);
        console.log(`  Verbosity:         ${options.verbosity}`);
        console.log(`  Doc Structure:     ${options.generateDocumentStructure}`);
        console.log(`  Transform Only:    ${options.transformOnly}`);
        if (options.colorEnginePackagePath) {
            console.log(`  Color Engine:      ${options.colorEnginePackagePath}`);
        }
        console.log(`  Transform Method:  ${options.transformMethod}`);

        try {
            // Create diagnostics collector early so we can track file I/O
            const diagnosticsEnabled = options.showDiagnostics || options.showTraces || options.saveDiagnostics;
            const diagnostics = diagnosticsEnabled ? new DiagnosticsCollector() : undefined;

            const { PDFService, ICCService, ColorEngineService, colorEngineInstance } = await loadServices({
                colorEnginePackagePath: options.colorEnginePackagePath,
            });

            // Read and load PDF with timing
            const readPdfSpan = diagnostics?.startSpan('read-pdf', { path: inputPath });
            const pdfBuffer = await readFile(inputPath);
            if (diagnostics && readPdfSpan) {
                diagnostics.endSpan(readPdfSpan, { bytes: pdfBuffer.length });
            }

            const loadPdfSpan = diagnostics?.startSpan('load-pdf', { bytes: pdfBuffer.length });
            const pdfDocument = await PDFDocument.load(pdfBuffer);
            if (diagnostics && loadPdfSpan) {
                diagnostics.endSpan(loadPdfSpan, { pages: pdfDocument.getPageCount() });
            }

            // Read profile
            const readProfileSpan = diagnostics?.startSpan('read-profile', { path: profilePath });
            const profileBuffer = await readFile(profilePath);
            if (diagnostics && readProfileSpan) {
                diagnostics.endSpan(readProfileSpan, { bytes: profileBuffer.length });
            }

            console.log(`\nPages: ${pdfDocument.getPageCount()}`);

            // Generate input document structure if requested
            if (options.generateDocumentStructure) {
                const mdPath = await generateDocumentStructure(pdfDocument, inputPath);
                console.log(`Generated input structure: ${mdPath}`);
            }

            console.log('\nConverting colors...');
            const startTime = performance.now();

            // Create ColorEngineService with custom engine instance if provided
            let colorEngineServiceInstance = null;
            if (colorEngineInstance) {
                colorEngineServiceInstance = new ColorEngineService({
                    defaultRenderingIntent: options.renderingIntent,
                    colorEngineInstance: colorEngineInstance,
                });
            }

            const result = await PDFService.convertColorInPDFDocument(pdfDocument, {
                destinationProfile: profileBuffer.buffer.slice(
                    profileBuffer.byteOffset,
                    profileBuffer.byteOffset + profileBuffer.byteLength
                ),
                renderingIntent: options.renderingIntent,
                convertImages: options.convertImages,
                convertContentStreams: options.convertContentStreams,
                blackPointCompensation: options.blackPointCompensation,
                useIndexedImages: options.useIndexedImages,
                useWorkers: options.useWorkers,
                verbose: options.verbosity >= 2,
                colorEngineService: colorEngineServiceInstance,
                diagnostics,
            });

            const elapsed = performance.now() - startTime;

            console.log(`\nConversion completed in ${elapsed.toFixed(2)}ms`);
            console.log(`  Pages processed: ${result.pagesProcessed}`);
            console.log(`  Color space conversions: ${result.totalColorSpaceConversions}`);
            console.log(`  Content stream conversions: ${result.totalContentStreamConversions}`);
            console.log(`  Image conversions: ${result.totalImageConversions}`);

            // Full workflow: transparency blending space and output intent
            if (!options.transformOnly) {
                console.log('\nApplying full workflow...');

                // Determine output color space from destination profile
                const destHeader = ICCService.parseICCHeaderFromSource(profileBuffer);
                const outputColorSpace = destHeader.colorSpace ?? 'CMYK'; // 'CMYK', 'RGB', 'GRAY'

                // Replace transparency blending color space to match output
                await PDFService.replaceTransarencyBlendingSpaceInPDFDocument(
                    pdfDocument,
                    outputColorSpace // 'CMYK', 'RGB', or 'GRAY'
                );
                console.log(`  Transparency blending: updated to ${outputColorSpace}`);

                // Set output intent with the destination profile
                const profileName = destHeader.description || basename(profilePath, extname(profilePath));
                await PDFService.setOutputIntentForPDFDocument(pdfDocument, {
                    subType: 'GTS_PDFX',
                    iccProfile: profileBuffer,
                    identifier: profileName,
                    info: profileName,
                });
                console.log(`  Output intent: set to ${profileName}`);
            }

            // Serialize PDF with timing
            const serializePdfSpan = diagnostics?.startSpan('serialize-pdf', { path: outputPath });
            const outputBytes = await pdfDocument.save();
            if (diagnostics && serializePdfSpan) {
                diagnostics.endSpan(serializePdfSpan, { bytes: outputBytes.length });
            }

            // Write PDF with timing
            const writePdfSpan = diagnostics?.startSpan('write-pdf', { path: outputPath, bytes: outputBytes.length });
            await writeFile(outputPath, outputBytes);
            if (diagnostics && writePdfSpan) {
                diagnostics.endSpan(writePdfSpan, {});
            }
            console.log(`\nSaved: ${outputPath} (${(outputBytes.length / 1024 / 1024).toFixed(2)} MB)`);

            // Generate output document structure if requested
            if (options.generateDocumentStructure) {
                const reloadedDoc = await PDFDocument.load(outputBytes);
                const mdPath = await generateDocumentStructure(reloadedDoc, outputPath);
                console.log(`Generated output structure: ${mdPath}`);
            }

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

        } catch (error) {
            console.error('\nError:', error.message);
            if (options.verbosity >= 1) {
                console.error(error.stack);
            }
            process.exit(1);
        }
    }

    console.log('\n' + '═'.repeat(80));
    console.log('Done!');
    console.log('═'.repeat(80) + '\n');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
