#!/usr/bin/env node
// @ts-check
/**
 * Compare PDF Outputs CLI Tool
 *
 * Compares PDF outputs from color conversion using configurable metrics.
 * Designed as a drop-in replacement for verification matrix comparisons.
 *
 * Features:
 * - Self-describing metrics classes with ComparisonsCoordinator
 * - Configurable Delta-E computation with sampling strategies
 * - JSON configuration with relative path resolution (paths resolved relative to JSON file)
 *
 * @module compare-pdf-outputs
 */

import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { createReadStream, existsSync, readdirSync } from 'fs';
import { resolve, dirname, basename, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { argv, exit, cwd } from 'process';
import {
    PDFDocument,
    PDFRawStream,
    PDFDict,
    PDFArray,
    PDFName,
    PDFRef,
    PDFPageLeaf,
    decodePDFRawStream,
} from 'pdf-lib';
import * as pako from 'pako';

// Comparison classes
import { ComparisonsCoordinator } from './classes/comparisons-coordinator.mjs';
import { DeltaEMetrics } from './classes/delta-e-metrics.mjs';
import { ColorChangeMetrics } from './classes/color-change-metrics.mjs';
import { ImageMatchMetrics } from './classes/image-match-metrics.mjs';
import { ImageSampler } from './classes/image-sampler.mjs';
import { ContentStreamColorExtractor } from './classes/content-stream-color-extractor.mjs';

// Production color conversion classes
import { PDFImageColorSampler } from '../classes/pdf-image-color-sampler.js';

// ============================================================================
// PDF Image Extraction Utilities
// ============================================================================

/**
 * @param {string} filePath 
 * @returns 
 */
async function readLargeFile(filePath) {
  // 1. Check file size
  const stats = await stat(filePath);
  const TWO_GB = 2 * 1024 * 1024 * 1024;

  if (stats.size <= TWO_GB) {
    // Standard way for "small" files
    return await readFile(filePath);
  }

  // 2. Stream into a single large Buffer for files > 2GB
  console.log(`Large file detected (${(stats.size / 1024**3).toFixed(2)} GB). Using stream...`);
  
  return new Promise((resolve, reject) => {
    const mainBuffer = Buffer.alloc(stats.size);
    const readStream = createReadStream(filePath);
    let offset = 0;

    readStream.on('data', (chunk) => {
      // Copy each chunk into the pre-allocated main buffer
      chunk.copy(mainBuffer, offset);
      offset += chunk.length;
    });

    readStream.on('end', () => resolve(mainBuffer));
    readStream.on('error', (err) => reject(err));
  });
}

/**
 * @typedef {{
 *   name: string,
 *   width: number,
 *   height: number,
 *   colorSpace: string,
 *   bitsPerComponent: number,
 *   channels: number,
 *   pixelData: Uint8Array,
 *   iccProfile?: Uint8Array,
 * }} ExtractedImage
 */

/**
 * @typedef {{
 *   profile: Uint8Array,
 *   description: string,
 * }} OutputIntentProfile
 */

/**
 * Extract Output Intent ICC profile from PDF document.
 * The Output Intent is required to convert Device* images to Lab.
 *
 * @param {PDFDocument} pdfDocument
 * @returns {OutputIntentProfile | null}
 */
function extractOutputIntentProfile(pdfDocument) {
    const catalog = pdfDocument.catalog;
    const outputIntentsRef = catalog.get(PDFName.of('OutputIntents'));

    if (!outputIntentsRef) {
        return null;
    }

    const outputIntents = pdfDocument.context.lookup(outputIntentsRef);
    if (!(outputIntents instanceof PDFArray) || outputIntents.size() === 0) {
        return null;
    }

    // Get first output intent
    const intentRef = outputIntents.get(0);
    const intent = pdfDocument.context.lookup(intentRef);

    if (!(intent instanceof PDFDict)) {
        return null;
    }

    // Get the ICC profile from DestOutputProfile
    const destProfileRef = intent.get(PDFName.of('DestOutputProfile'));
    if (!destProfileRef) {
        return null;
    }

    const destProfile = pdfDocument.context.lookup(destProfileRef);
    if (!(destProfile instanceof PDFRawStream)) {
        return null;
    }

    // Get description
    const infoRef = intent.get(PDFName.of('Info'));
    let description = 'Unknown';
    if (infoRef) {
        const info = pdfDocument.context.lookup(infoRef);
        if (info && typeof info.asString === 'function') {
            description = info.asString();
        }
    }

    // Decode the profile stream
    const decodedProfile = decodePDFRawStream(destProfile);
    const profileData = decodedProfile.decode();

    return {
        profile: profileData instanceof Uint8Array ? profileData : new Uint8Array(profileData),
        description,
    };
}

/**
 * Determine channels from color space.
 *
 * @param {string} colorSpace
 * @returns {number}
 */
function getChannelsForColorSpace(colorSpace) {
    switch (colorSpace) {
        case 'DeviceGray':
            return 1;
        case 'DeviceRGB':
            return 3;
        case 'DeviceCMYK':
            return 4;
        case 'Lab':
            return 3;
        default:
            // For ICCBased, need to examine the profile
            if (colorSpace.startsWith('ICCBased')) {
                // Extract channel count from description if available
                return 4; // Default to CMYK for output PDFs
            }
            return 4;
    }
}

/**
 * @typedef {{
 *   name: string,
 *   iccProfile?: Uint8Array,
 *   channels: number,
 * }} ColorSpaceInfo
 */

/**
 * Get color space info from PDF color space object, including embedded ICC profile.
 *
 * @param {any} colorSpaceObj
 * @param {import('pdf-lib').PDFContext} context
 * @returns {ColorSpaceInfo}
 */
function getColorSpaceInfo(colorSpaceObj, context) {
    if (colorSpaceObj instanceof PDFName) {
        const name = colorSpaceObj.asString().replace('/', '');
        return {
            name,
            channels: getChannelsForColorSpace(name),
        };
    }

    if (colorSpaceObj instanceof PDFRef) {
        const resolved = context.lookup(colorSpaceObj);
        return getColorSpaceInfo(resolved, context);
    }

    if (colorSpaceObj instanceof PDFArray && colorSpaceObj.size() > 0) {
        const firstElement = colorSpaceObj.get(0);
        if (firstElement instanceof PDFName) {
            const name = firstElement.asString().replace('/', '');
            if (name === 'ICCBased' && colorSpaceObj.size() > 1) {
                // Extract ICC profile and channel count
                const profileRef = colorSpaceObj.get(1);
                const profile = context.lookup(profileRef);
                if (profile instanceof PDFRawStream) {
                    const dict = profile.dict;
                    const nObj = dict.get(PDFName.of('N'));
                    const channels = nObj && typeof nObj.asNumber === 'function' ? nObj.asNumber() : 4;

                    // Decode the ICC profile stream
                    const decodedProfile = decodePDFRawStream(profile);
                    const profileData = decodedProfile.decode();
                    const iccProfile = profileData instanceof Uint8Array
                        ? profileData
                        : new Uint8Array(profileData);

                    // Map channel count to color space name
                    const colorSpaceByChannels = {
                        1: 'ICCBasedGray',
                        3: 'ICCBasedRGB',
                        4: 'ICCBasedCMYK',
                    };
                    const colorSpaceName = colorSpaceByChannels[channels] || `ICCBased(${channels})`;

                    return {
                        name: colorSpaceName,
                        iccProfile,
                        channels,
                    };
                }
            }
            // For non-ICCBased array color spaces (e.g., Lab, CalGray, CalRGB)
            // use the correct channel count for the color space type
            return {
                name,
                channels: getChannelsForColorSpace(name),
            };
        }
    }

    return {
        name: 'Unknown',
        channels: 4,
    };
}

/**
 * Get color space name from PDF color space object (legacy wrapper).
 *
 * @param {any} colorSpaceObj
 * @param {import('pdf-lib').PDFContext} context
 * @returns {string}
 */
function getColorSpaceName(colorSpaceObj, context) {
    return getColorSpaceInfo(colorSpaceObj, context).name;
}

/**
 * Extract all images from a PDF page.
 * Includes embedded ICC profiles for ICCBased color spaces.
 *
 * @param {PDFPageLeaf} page
 * @param {import('pdf-lib').PDFContext} context
 * @returns {ExtractedImage[]}
 */
function extractImagesFromPage(page, context) {
    const images = [];

    // Get Resources dictionary
    const resourcesRef = page.get(PDFName.of('Resources'));
    if (!resourcesRef) {
        return images;
    }

    const resources = context.lookup(resourcesRef);
    if (!(resources instanceof PDFDict)) {
        return images;
    }

    // Get XObject dictionary
    const xobjectRef = resources.get(PDFName.of('XObject'));
    if (!xobjectRef) {
        return images;
    }

    const xobjects = context.lookup(xobjectRef);
    if (!(xobjects instanceof PDFDict)) {
        return images;
    }

    // Iterate over XObjects
    const entries = xobjects.entries();
    for (const [nameObj, ref] of entries) {
        const name = nameObj instanceof PDFName ? nameObj.asString().replace('/', '') : String(nameObj);

        const xobject = context.lookup(ref);
        if (!(xobject instanceof PDFRawStream)) {
            continue;
        }

        const dict = xobject.dict;

        // Check if it's an Image
        const subtype = dict.get(PDFName.of('Subtype'));
        if (!(subtype instanceof PDFName) || subtype.asString() !== '/Image') {
            continue;
        }

        // Get image dimensions
        const widthObj = dict.get(PDFName.of('Width'));
        const heightObj = dict.get(PDFName.of('Height'));
        const bpcObj = dict.get(PDFName.of('BitsPerComponent'));

        const width = widthObj && typeof widthObj.asNumber === 'function' ? widthObj.asNumber() : 0;
        const height = heightObj && typeof heightObj.asNumber === 'function' ? heightObj.asNumber() : 0;
        const bpc = bpcObj && typeof bpcObj.asNumber === 'function' ? bpcObj.asNumber() : 8;

        if (width === 0 || height === 0) {
            continue;
        }

        // Get color space info including embedded ICC profile
        const colorSpaceRef = dict.get(PDFName.of('ColorSpace'));
        const colorSpaceInfo = colorSpaceRef
            ? getColorSpaceInfo(colorSpaceRef, context)
            : { name: 'DeviceGray', channels: 1 };

        // Decode the image stream
        const decoded = decodePDFRawStream(xobject);
        let pixelData;
        try {
            const rawData = decoded.decode();
            pixelData = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
        } catch (error) {
            console.warn(`[extractImagesFromPage] Failed to decode image ${name}: ${error.message}`);
            continue;
        }

        images.push({
            name,
            width,
            height,
            colorSpace: colorSpaceInfo.name,
            bitsPerComponent: bpc,
            channels: colorSpaceInfo.channels,
            pixelData,
            iccProfile: colorSpaceInfo.iccProfile,
        });
    }

    return images;
}

/**
 * Find actual PDF file matching the expected name pattern.
 * Handles `# Workers` → `N Workers` substitution by scanning directory.
 *
 * @param {string} expectedPath - Path with possible `# Workers` placeholder
 * @param {string} outputDir - Directory to search in
 * @returns {string | null} - Actual file path or null if not found
 */
function findActualPdfPath(expectedPath, outputDir) {
    const expectedFilename = basename(expectedPath);

    // If file exists as-is, return it
    if (existsSync(expectedPath)) {
        return expectedPath;
    }

    // Check if filename contains `# Workers` pattern
    if (!expectedFilename.includes('# Workers')) {
        return null; // No substitution possible
    }

    // Create regex pattern: replace `# Workers` with `\d+ Workers`
    const pattern = expectedFilename
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
        .replace(/# Workers/g, '\\d+ Workers'); // Replace placeholder

    const regex = new RegExp(`^${pattern}$`);

    // Scan directory for matching files
    let files;
    try {
        files = readdirSync(outputDir);
    } catch (error) {
        return null;
    }

    for (const file of files) {
        if (regex.test(file)) {
            return resolve(outputDir, file);
        }
    }

    return null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG = 'configurations/2026-02-02-REFACTOR-FIXTURES-BASELINE.json';

// ============================================================================
// Argument Parsing
// ============================================================================

function printUsage() {
    console.log(`
Compare PDF Outputs CLI Tool

Compares PDF outputs using configurable metrics (Delta-E, Color changes, etc.).

Usage:
  node compare-pdf-outputs.js [options]

Configuration:
  --config=<path>         JSON configuration file (default: ${DEFAULT_CONFIG})
                          Relative paths in JSON are resolved relative to the JSON file.

Input Options:
  --source-dir=<path>     Directory containing converted PDFs to compare (default: auto from config)

Output Options:
  --output-dir=<path>     Output directory for comparison results (default: same as source-dir)
  --format=<fmt>          Output format: json, markdown, both (default: both)

Filter Options:
  --group=<name>          Process only named group(s) (can be repeated)
  --aspect=<type>         Process only aspect type(s) (can be repeated)

Execution Options:
  --changes-only          Only run changes verification (content stream colors), skip comparisons
  --comparisons-only      Only run comparisons (image Delta-E), skip changes
  --dry-run               Show what would be done without executing
  --verbose, -v           Enable verbose output
  --help, -h              Show this help message

Examples:
  # Compare using default configuration
  node compare-pdf-outputs.js

  # Use custom configuration
  node compare-pdf-outputs.js --config=configurations/my-config.json

  # Run only changes verification
  node compare-pdf-outputs.js --changes-only

  # Run only comparisons (Delta-E)
  node compare-pdf-outputs.js --comparisons-only

  # Process specific group only
  node compare-pdf-outputs.js --group="FIPS 2024"

  # Dry run to see what would be executed
  node compare-pdf-outputs.js --dry-run --verbose
`);
}

/**
 * @typedef {{
 *   configPath: string,
 *   sourceDir: string | null,
 *   outputDir: string | null,
 *   outputFormat: 'json' | 'markdown' | 'both',
 *   groups: string[],
 *   aspects: string[],
 *   changesOnly: boolean,
 *   comparisonsOnly: boolean,
 *   nestedFormat: boolean,
 *   dryRun: boolean,
 *   verbose: boolean,
 * }} ParsedOptions
 */

/**
 * @param {string[]} args
 * @returns {ParsedOptions}
 */
function parseArgs(args) {
    const options = {
        configPath: DEFAULT_CONFIG,
        sourceDir: /** @type {string | null} */ (null),
        outputDir: /** @type {string | null} */ (null),
        outputFormat: /** @type {'both'} */ ('both'),
        groups: /** @type {string[]} */ ([]),
        aspects: /** @type {string[]} */ ([]),
        changesOnly: false,
        comparisonsOnly: false,
        nestedFormat: false,
        dryRun: false,
        verbose: false,
    };

    for (const arg of args) {
        // Help
        if (arg === '--help' || arg === '-h') {
            printUsage();
            exit(0);
        }

        // Verbose
        if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
            continue;
        }

        // Dry run
        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }

        // Changes only
        if (arg === '--changes-only') {
            options.changesOnly = true;
            continue;
        }

        // Comparisons only
        if (arg === '--comparisons-only') {
            options.comparisonsOnly = true;
            continue;
        }

        // Nested format for CHANGES.json (reduced redundancy)
        if (arg === '--nested-format' || arg === '--nested') {
            options.nestedFormat = true;
            continue;
        }

        // Config path
        if (arg.startsWith('--config=')) {
            options.configPath = arg.slice('--config='.length);
            continue;
        }

        // Source directory (where PDFs are read from)
        if (arg.startsWith('--source-dir=')) {
            options.sourceDir = arg.slice('--source-dir='.length);
            continue;
        }

        // Output directory (where results are written)
        if (arg.startsWith('--output-dir=')) {
            options.outputDir = arg.slice('--output-dir='.length);
            continue;
        }

        // Output format
        if (arg.startsWith('--format=')) {
            const format = arg.slice('--format='.length).toLowerCase();
            if (format === 'json' || format === 'markdown' || format === 'both') {
                options.outputFormat = format;
            } else {
                console.error(`Unknown format: ${format}. Use json, markdown, or both.`);
                exit(1);
            }
            continue;
        }

        // Group filter
        if (arg.startsWith('--group=')) {
            options.groups.push(arg.slice('--group='.length));
            continue;
        }

        // Aspect filter
        if (arg.startsWith('--aspect=')) {
            options.aspects.push(arg.slice('--aspect='.length));
            continue;
        }

        // Unknown option
        if (arg.startsWith('--')) {
            console.error(`Unknown option: ${arg}`);
            printUsage();
            exit(1);
        }
    }

    return options;
}

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * @typedef {{
 *   type: string,
 *   resource?: string,
 *   metrics?: string | string[] | object | object[],
 *   sampling?: string | object,
 *   transform?: {
 *     colorspace?: string,
 *     intent?: string,
 *     'blackpoint-compensation'?: boolean,
 *   },
 *   mode?: 'pairs',
 *   reference?: string,
 *   required?: boolean,
 *   tolerances?: Record<string, number>,
 *   threshold?: number,
 * }} AspectConfig
 */

/**
 * @typedef {{
 *   pdf: string,
 * }} InputDefinition
 */

/**
 * @typedef {{
 *   profile: string,
 *   intent: string,
 *   'blackpoint-compensation'?: boolean,
 * }} OutputDefinition
 */

/**
 * @typedef {{
 *   implementation: string,
 *   engine?: string,
 *   modality?: string,
 * }} ConfigurationDefinition
 */

/**
 * Pairs are keyed by configuration name, e.g. { "Main Thread": "config-a", "Workers": "config-b" }
 * @typedef {Record<string, string>} PairDefinition
 */

/**
 * @typedef {{
 *   description?: string,
 *   enabled?: boolean,
 *   input?: string,
 *   outputs?: string[],
 *   pairs?: PairDefinition[],
 *   aspects?: AspectConfig[],
 * }} GroupConfig
 */

/**
 * @typedef {{
 *   type: 'Color',
 *   resource: 'Contents',
 *   input: {
 *     colorspace: string,
 *     values: number[],
 *   },
 *   [pairMemberName: string]: {
 *     colorspace: string,
 *     values: number[],
 *     tolerances: number[],
 *   } | string | { colorspace: string, values: number[] },
 * }} ColorAspectConfig
 */

/**
 * @typedef {{
 *   description?: string,
 *   enabled?: boolean,
 *   input?: string,
 *   outputs?: string[],
 *   pairs?: PairDefinition[],
 *   aspects?: ColorAspectConfig[],
 * }} ChangesGroupConfig
 */

/**
 * @typedef {{
 *   description?: string,
 *   inputs?: Record<string, InputDefinition>,
 *   outputs?: Record<string, OutputDefinition>,
 *   configurations?: Record<string, ConfigurationDefinition>,
 *   comparisons?: {
 *     enabled?: boolean,
 *     groups?: GroupConfig[],
 *   },
 *   changes?: {
 *     enabled?: boolean,
 *     groups?: ChangesGroupConfig[],
 *   },
 * }} Configuration
 */

/**
 * Resolve a path relative to a base URL.
 * If the path is absolute, return it as-is.
 * If the path starts with ./ or ../, resolve relative to baseURL.
 *
 * @param {string} path
 * @param {URL} baseURL
 * @returns {string}
 */
function resolveRelativePath(path, baseURL) {
    if (isAbsolute(path)) {
        return path;
    }

    if (path.startsWith('./') || path.startsWith('../')) {
        const resolved = new URL(path, baseURL);
        return fileURLToPath(resolved);
    }

    // Treat as relative to CWD if not explicitly relative
    return resolve(cwd(), path);
}

/**
 * Load and process configuration file.
 * Resolves relative paths within the JSON relative to the JSON file location.
 *
 * @param {string} configPath
 * @returns {Promise<{ config: Configuration, configURL: URL }>}
 */
async function loadConfiguration(configPath) {
    // Resolve config path relative to CWD or as absolute
    const absoluteConfigPath = isAbsolute(configPath)
        ? configPath
        : resolve(cwd(), configPath);

    if (!existsSync(absoluteConfigPath)) {
        throw new Error(`Configuration file not found: ${absoluteConfigPath}`);
    }

    // Create URL for the config file (for relative path resolution)
    const configURL = new URL(`file://${absoluteConfigPath}`);

    // Load and parse JSON
    const configText = await readFile(absoluteConfigPath, 'utf-8');
    const rawConfig = JSON.parse(configText);

    // Process configuration to resolve relative paths
    // Following ColorConversionPolicy pattern: paths in JSON are relative to JSON file
    const config = processConfigPaths(rawConfig, configURL);

    return { config, configURL };
}

/**
 * Process configuration to resolve relative paths.
 * Resolves paths in:
 * - `inputs[].pdf` - input PDF paths
 * - `outputs[].profile` - ICC profile paths
 *
 * @param {Configuration} config
 * @param {URL} configURL
 * @returns {Configuration}
 */
function processConfigPaths(config, configURL) {
    const processed = { ...config };

    // Process input PDF paths
    if (config.inputs) {
        processed.inputs = {};
        for (const [name, def] of Object.entries(config.inputs)) {
            processed.inputs[name] = {
                ...def,
                pdf: def.pdf ? resolveRelativePath(def.pdf, configURL) : def.pdf,
            };
        }
    }

    // Process output profile paths
    if (config.outputs) {
        processed.outputs = {};
        for (const [name, def] of Object.entries(config.outputs)) {
            processed.outputs[name] = {
                ...def,
                profile: def.profile ? resolveRelativePath(def.profile, configURL) : def.profile,
            };
        }
    }

    return processed;
}

// ============================================================================
// Comparison Execution (Scaffold)
// ============================================================================

/**
 * @typedef {{
 *   group: string,
 *   input: string,
 *   output: string,
 *   aspect: AspectConfig,
 *   mode: 'pairs' | 'reference',
 *   pairMembers: Array<{
 *     name: string,
 *     configuration: string,
 *     pdfPath: string,
 *   }>,
 *   referencePdfPath?: string,
 * }} ComparisonTask
 */

/**
 * Build PDF path from matrix configuration.
 * Actual pattern: <input> - <output> - <configuration> (<date-seq>).pdf
 *
 * Example:
 * "2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-02-001).pdf"
 *
 * @param {string} inputName
 * @param {string} configName
 * @param {string} outputName
 * @param {string} outputDir
 * @param {string} dateSeq - Date sequence like "2026-02-02-001"
 * @returns {string}
 */
function buildPdfPath(inputName, configName, outputName, outputDir, dateSeq) {
    // The output PDF naming convention: "<input> - <output> - <configuration> (<date-seq>).pdf"
    const filename = `${inputName} - ${outputName} - ${configName} (${dateSeq}).pdf`;
    return resolve(outputDir, filename);
}

/**
 * Extract date sequence from output directory name.
 * @param {string} outputDir
 * @returns {string}
 */
function extractDateSeq(outputDir) {
    const match = basename(outputDir).match(/^(\d{4}-\d{2}-\d{2}-\d{3})/);
    return match ? match[1] : basename(outputDir);
}

/**
 * Build list of comparison tasks from matrix configuration.
 *
 * Matrix structure:
 * - inputs: { "<name>": { pdf: "<path>" } }
 * - outputs: { "<name>": { profile, intent, bpc } }
 * - configurations: { "<name>": { implementation, engine, modality } }
 * - comparisons.groups[]: { input, outputs[], pairs[{ "<memberA>": "<configA>", ... }], aspects[] }
 *
 * @param {Configuration} config
 * @param {URL} configURL
 * @param {ParsedOptions} options
 * @returns {ComparisonTask[]}
 */
function buildComparisonTasks(config, configURL, options) {
    const tasks = /** @type {ComparisonTask[]} */ ([]);

    if (!config.comparisons?.enabled || !config.comparisons.groups) {
        return tasks;
    }

    // Determine source directory - where to read PDFs from
    const configDir = dirname(fileURLToPath(configURL));
    const experimentsDir = dirname(configDir); // Go up from configurations/ to experiments/
    const defaultSourceDir = resolve(experimentsDir, 'output/2026-02-02-001');
    const sourceDir = options.sourceDir
        ? (isAbsolute(options.sourceDir) ? options.sourceDir : resolve(cwd(), options.sourceDir))
        : defaultSourceDir;

    // Extract date sequence from source directory name
    const dateSeq = extractDateSeq(sourceDir);

    for (const group of config.comparisons.groups) {
        // Skip disabled groups
        if (group.enabled === false) {
            continue;
        }

        // Filter by group name if specified
        if (options.groups.length > 0 && group.description) {
            if (!options.groups.includes(group.description)) {
                continue;
            }
        }

        const inputName = group.input;
        if (!inputName) {
            continue;
        }

        const outputNames = group.outputs ?? [];
        const pairDefs = group.pairs ?? [];
        const aspects = group.aspects ?? [];

        // For each output profile
        for (const outputName of outputNames) {
            // For each aspect (Delta-E, etc.)
            for (const aspect of aspects) {
                // Filter by aspect type if specified
                if (options.aspects.length > 0) {
                    if (!options.aspects.includes(aspect.type)) {
                        continue;
                    }
                }

                // Determine mode: reference (compare against input PDF) or pairs (compare against each other)
                const isReferenceMode = typeof aspect.reference === 'string';
                const mode = isReferenceMode ? 'reference' : 'pairs';

                // For reference mode, get the reference input PDF path
                let referencePdfPath;
                if (isReferenceMode) {
                    const referenceInputName = aspect.reference;
                    const referenceInput = config.inputs?.[referenceInputName];
                    if (referenceInput?.pdf) {
                        referencePdfPath = referenceInput.pdf;
                    } else {
                        console.warn(`Reference input "${referenceInputName}" not found in config.inputs`);
                        continue;
                    }
                }

                // For each pair definition
                for (const pairDef of pairDefs) {
                    // Build pair members from the keyed configuration references
                    const pairMembers = [];
                    for (const [memberName, configName] of Object.entries(pairDef)) {
                        const pdfPath = buildPdfPath(inputName, configName, outputName, sourceDir, dateSeq);
                        pairMembers.push({
                            name: memberName,
                            configuration: configName,
                            pdfPath,
                        });
                    }

                    // For pairs mode, need at least 2 members; for reference mode, need at least 1
                    const minMembers = isReferenceMode ? 1 : 2;
                    if (pairMembers.length >= minMembers) {
                        tasks.push({
                            group: group.description ?? 'Unnamed Group',
                            input: inputName,
                            output: outputName,
                            aspect,
                            mode,
                            pairMembers,
                            referencePdfPath,
                        });
                    }
                }
            }
        }
    }

    return tasks;
}

/**
 * @typedef {{
 *   group: string,
 *   input: string,
 *   output: string,
 *   aspect: ColorAspectConfig,
 *   pairMembers: Array<{
 *     name: string,
 *     configuration: string,
 *     pdfPath: string,
 *   }>,
 * }} ChangesTask
 */

/**
 * Build list of changes verification tasks from configuration.
 *
 * @param {Configuration} config
 * @param {URL} configURL
 * @param {ParsedOptions} options
 * @returns {ChangesTask[]}
 */
function buildChangesTasks(config, configURL, options) {
    const tasks = /** @type {ChangesTask[]} */ ([]);

    if (!config.changes?.enabled || !config.changes.groups) {
        return tasks;
    }

    // Determine source directory
    const configDir = dirname(fileURLToPath(configURL));
    const experimentsDir = dirname(configDir);
    const defaultSourceDir = resolve(experimentsDir, 'output/2026-02-02-001');
    const sourceDir = options.sourceDir
        ? (isAbsolute(options.sourceDir) ? options.sourceDir : resolve(cwd(), options.sourceDir))
        : defaultSourceDir;

    const dateSeq = extractDateSeq(sourceDir);

    for (const group of config.changes.groups) {
        if (group.enabled === false) {
            continue;
        }

        // Filter by group name
        if (options.groups.length > 0 && group.description) {
            if (!options.groups.includes(group.description)) {
                continue;
            }
        }

        const inputName = group.input;
        if (!inputName) {
            continue;
        }

        const outputNames = group.outputs ?? [];
        const pairDefs = group.pairs ?? [];
        const aspects = group.aspects ?? [];

        for (const outputName of outputNames) {
            for (const aspect of aspects) {
                // Filter by aspect type
                if (options.aspects.length > 0) {
                    if (!options.aspects.includes(aspect.type)) {
                        continue;
                    }
                }

                // Only handle Color aspects here
                if (aspect.type !== 'Color') {
                    continue;
                }

                for (const pairDef of pairDefs) {
                    const pairMembers = [];
                    for (const [memberName, configName] of Object.entries(pairDef)) {
                        const pdfPath = buildPdfPath(inputName, configName, outputName, sourceDir, dateSeq);
                        pairMembers.push({
                            name: memberName,
                            configuration: configName,
                            pdfPath,
                        });
                    }

                    if (pairMembers.length >= 1) {
                        // Store input PDF path for use in executeChanges (Phase 4C optimization)
                        const inputPdfPath = config.inputs?.[inputName]?.pdf ?? null;

                        tasks.push({
                            group: group.description ?? 'Unnamed Group',
                            input: inputName,
                            inputPdfPath,  // Pre-resolved path to input PDF
                            output: outputName,
                            aspect,
                            pairMembers,
                        });
                    }
                }
            }
        }
    }

    return tasks;
}

/**
 * @typedef {{
 *   group: string,
 *   input: string,
 *   output: string,
 *   pair: {
 *     reference: { name: string, configuration: string },
 *     sample: { name: string, configuration: string },
 *   },
 *   aspect: AspectConfig,
 *   images: Array<{
 *     name: string,
 *     page: number,
 *     dimensions: string,
 *     colorSpace: string,
 *     status: 'BINARY-MATCH' | 'WITHIN-TOLERANCE' | 'OUT-OF-TOLERANCE' | 'N/A' | 'INCOMPATIBLE' | 'MISSING (1/2)',
 *     deltaE: import('./classes/delta-e-metrics.mjs').DeltaEMetricsResult | null,
 *   }>,
 * }} ComparisonResult
 */

/**
 * @typedef {{
 *   group: string,
 *   input: string,
 *   output: string,
 *   aspect: ColorAspectConfig,
 *   pairMembers: string[],
 *   result: import('./classes/color-change-metrics.mjs').ColorChangeMetricsResult,
 * }} ChangesResult
 */

/**
 * Compare images between two PDFs.
 *
 * @param {PDFDocument} referencePdf - Reference PDF (can be original input or converted output)
 * @param {PDFDocument} samplePdf - Sample PDF (converted output)
 * @param {OutputIntentProfile} outputIntent - ICC profile for Lab conversion (for Device* images)
 * @param {ComparisonTask} task - Task configuration
 * @param {ImageSampler} sampler - Pixel sampler
 * @param {ComparisonsCoordinator} coordinator - Metrics coordinator
 * @param {PDFImageColorSampler} labSampler - Lab color sampler for Delta-E
 * @param {ParsedOptions} options - CLI options
 * @returns {Promise<Array<Object>>} - Image comparison results
 */
async function compareImages(referencePdf, samplePdf, outputIntent, task, sampler, coordinator, labSampler, options, pretestedCombinations) {
    const imageResults = [];

    // Get pages
    const refPages = referencePdf.getPages();
    const samplePages = samplePdf.getPages();

    if (refPages.length !== samplePages.length) {
        console.error(`  Page count mismatch: reference=${refPages.length}, sample=${samplePages.length}`);
        return imageResults;
    }

    if (options.verbose) {
        console.log(`    Pages: ${refPages.length}`);
    }

    // Process each page
    for (let pageIndex = 0; pageIndex < refPages.length; pageIndex++) {
        const refPage = refPages[pageIndex];
        const samplePage = samplePages[pageIndex];

        // Extract images from both pages
        const refImages = extractImagesFromPage(refPage.node, referencePdf.context);
        const sampleImages = extractImagesFromPage(samplePage.node, samplePdf.context);

        if (options.verbose) {
            console.log(`    Page ${pageIndex + 1}: ${refImages.length} images`);
        }

        // Match images by name
        for (const refImage of refImages) {
            const sampleImage = sampleImages.find(img => img.name === refImage.name);

            if (!sampleImage) {
                imageResults.push({
                    name: refImage.name,
                    page: pageIndex + 1,
                    dimensions: `${refImage.width}×${refImage.height}`,
                    colorSpace: refImage.colorSpace,
                    status: 'MISSING (1/2)',
                    match: null,
                    deltaE: null,
                    error: 'Image not found in sample PDF',
                });
                continue;
            }

            // Use ImageMatchMetrics for pre-checks and binary matching
            // In reference mode, skip strict color space check since conversion changes color spaces
            const isReferenceMode = task.mode === 'reference';
            const matchResult = ImageMatchMetrics.compare(
                {
                    name: refImage.name,
                    width: refImage.width,
                    height: refImage.height,
                    colorSpace: refImage.colorSpace,
                    bitsPerComponent: refImage.bitsPerComponent,
                    channels: refImage.channels,
                    pixelData: refImage.pixelData,
                },
                {
                    name: sampleImage.name,
                    width: sampleImage.width,
                    height: sampleImage.height,
                    colorSpace: sampleImage.colorSpace,
                    bitsPerComponent: sampleImage.bitsPerComponent,
                    channels: sampleImage.channels,
                    pixelData: sampleImage.pixelData,
                },
                {
                    // In reference mode, don't fail on color space mismatch
                    // since color conversion inherently changes color spaces
                    strictColorSpace: false,
                }
            );

            // Handle based on match status
            if (matchResult.status === 'SKIP') {
                imageResults.push({
                    name: refImage.name,
                    page: pageIndex + 1,
                    dimensions: `${refImage.width}×${refImage.height}`,
                    colorSpace: refImage.colorSpace,
                    status: 'MISSING (1/2)',
                    match: matchResult,
                    deltaE: null,
                    error: matchResult.skipReason ?? 'Cannot compare images',
                });
                if (options.verbose) {
                    console.log(`      ${refImage.name}: MISSING (1/2) (${matchResult.skipReason})`);
                }
                continue;
            }

            if (matchResult.status === 'MISMATCH') {
                const failedChecks = matchResult.preChecks.filter(c => !c.passed);
                const errorMsg = failedChecks.map(c => c.message).join('; ');

                // In reference mode with required=true, allow color space/channel mismatches
                // if dimensions match - we'll convert both to Lab for comparison
                const isReferenceMode = task.mode === 'reference';
                const deltaERequired = task.aspect.required === true;
                const dimensionsMatch = matchResult.preChecks
                    .filter(c => c.type === 'dimensions')
                    .every(c => c.passed);

                if (isReferenceMode && deltaERequired && dimensionsMatch) {
                    // Allow mismatch to proceed to Delta-E computation
                    if (options.verbose) {
                        console.log(`      ${refImage.name}: INCOMPATIBLE but proceeding to Delta-E (reference mode with required=true)`);
                    }
                    // Continue to Delta-E computation below (don't skip)
                } else {
                    // Show both dimensions for INCOMPATIBLE status
                    const refDimensions = `${refImage.width}×${refImage.height}`;
                    const sampleDimensions = `${sampleImage.width}×${sampleImage.height}`;
                    const bothDimensions = refDimensions === sampleDimensions
                        ? refDimensions
                        : `${refDimensions} vs ${sampleDimensions}`;

                    imageResults.push({
                        name: refImage.name,
                        page: pageIndex + 1,
                        dimensions: bothDimensions,
                        colorSpace: refImage.colorSpace,
                        status: 'INCOMPATIBLE',
                        match: matchResult,
                        deltaE: null,
                        error: errorMsg,
                    });
                    if (options.verbose) {
                        console.log(`      ${refImage.name}: INCOMPATIBLE (${errorMsg})`);
                    }
                    continue;
                }
            }

            // Check if Delta-E is required even for binary matches
            const deltaERequired = task.aspect.required === true;

            if (matchResult.status === 'MATCH' && !deltaERequired) {
                // Binary identical and Delta-E not required - skip computation
                imageResults.push({
                    name: refImage.name,
                    page: pageIndex + 1,
                    dimensions: `${refImage.width}×${refImage.height}`,
                    colorSpace: refImage.colorSpace,
                    status: 'BINARY-MATCH',
                    match: {
                        layer: matchResult.matchLayer,
                        pixelCount: matchResult.pixelCount,
                        binaryMatch: true,
                    },
                    deltaE: null, // No Delta-E for binary matches when not required
                });
                if (options.verbose) {
                    console.log(`      ${refImage.name}: BINARY-MATCH (${matchResult.matchLayer} layer, ${matchResult.pixelCount} pixels)`);
                }
                continue;
            }

            // Compute Delta-E: either status is DELTA or required is true
            // Sample pixel indices
            const sampling = sampler.sample(refImage.width, refImage.height);

            // Determine ICC profile for each image:
            // - Lab: No conversion needed - Lab is device-independent (use 'Lab' sentinel)
            // - ICCBased: use embedded ICC profile
            // - Device*: use Output Intent profile
            // No fallbacks - fail if profile not available
            //
            // IMPORTANT: ColorConverter.convertColorsBuffer() expects ArrayBuffer, not Uint8Array
            // Convert Uint8Array to ArrayBuffer by slicing (handles view offsets properly)
            const toArrayBuffer = (data) => {
                if (data instanceof ArrayBuffer) return data;
                if (data instanceof Uint8Array) {
                    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                }
                return data;
            };

            const getProfileForImage = (image) => {
                // Lab is device-independent - signal to use built-in Lab profile
                if (image.colorSpace === 'Lab') {
                    return 'Lab';
                }
                // ICCBased: use embedded profile (convert to ArrayBuffer)
                if (image.iccProfile) {
                    return toArrayBuffer(image.iccProfile);
                }
                // Device*: use Output Intent profile (convert to ArrayBuffer)
                if (image.colorSpace.startsWith('Device')) {
                    return toArrayBuffer(outputIntent.profile);
                }
                // Unknown: no profile available
                return null;
            };

            const refProfile = getProfileForImage(refImage);
            const sampleProfile = getProfileForImage(sampleImage);

            if (!refProfile) {
                imageResults.push({
                    name: refImage.name,
                    page: pageIndex + 1,
                    dimensions: `${refImage.width}×${refImage.height}`,
                    colorSpace: refImage.colorSpace,
                    status: 'INCOMPATIBLE',
                    match: matchResult,
                    deltaE: null,
                    error: `No ICC profile for reference image (${refImage.colorSpace}). ICCBased requires embedded profile, Device* requires Output Intent, Lab uses built-in.`,
                });
                continue;
            }

            if (!sampleProfile) {
                imageResults.push({
                    name: refImage.name,
                    page: pageIndex + 1,
                    dimensions: `${refImage.width}×${refImage.height}`,
                    colorSpace: refImage.colorSpace,
                    status: 'INCOMPATIBLE',
                    match: matchResult,
                    deltaE: null,
                    error: `No ICC profile for sample image (${sampleImage.colorSpace}). ICCBased requires embedded profile, Device* requires Output Intent, Lab uses built-in.`,
                });
                continue;
            }

            // Maps PDF color space names to PDFImageColorSampler color space names
            const mapColorSpace = (pdfColorSpace) => {
                if (pdfColorSpace === 'DeviceCMYK') return 'CMYK';
                if (pdfColorSpace === 'DeviceRGB') return 'RGB';
                if (pdfColorSpace === 'DeviceGray') return 'Gray';
                if (pdfColorSpace === 'Lab') return 'Lab';
                if (pdfColorSpace.startsWith('ICCBased')) {
                    // Handle both formats: ICCBasedGray/RGB/CMYK and legacy ICCBased(N)
                    if (pdfColorSpace === 'ICCBasedGray') return 'Gray';
                    if (pdfColorSpace === 'ICCBasedRGB') return 'RGB';
                    if (pdfColorSpace === 'ICCBasedCMYK') return 'CMYK';
                    // Legacy format: ICCBased(N) where N is channel count
                    const match = pdfColorSpace.match(/\((\d+)\)/);
                    if (match) {
                        const channels = parseInt(match[1], 10);
                        if (channels === 1) return 'Gray';
                        if (channels === 3) return 'RGB';
                        if (channels === 4) return 'CMYK';
                    }
                }
                return 'CMYK'; // Default to CMYK for unknown
            };

            // ================================================================
            // PRETEST: Verify sampler consistency for this image's parameters
            // A 255×255 uniform buffer should produce exactly 1 unique Lab color.
            // Run once per unique (colorSpace, profile) combination.
            // ================================================================
            const runPretest = async (label, colorSpace, channels, profile, pretestedSet) => {
                // Create a unique key for this combination
                const profileKey = profile === 'Lab' ? 'Lab' :
                    (profile instanceof ArrayBuffer ? `icc-${profile.byteLength}` : String(profile));
                const pretestKey = `${colorSpace}:${profileKey}`;

                if (pretestedSet.has(pretestKey)) {
                    return; // Already tested this combination
                }
                pretestedSet.add(pretestKey);

                const width = 255;
                const height = 255;
                const pixelCount = width * height;
                const bufferSize = pixelCount * channels;
                const midValue = 128; // 0.5 equivalent for 8-bit

                // Create uniform buffer
                const uniformBuffer = new Uint8Array(bufferSize);
                uniformBuffer.fill(midValue);
                const inputValues = Array(channels).fill(midValue).join(', ');
                const allIndices = Array.from({ length: pixelCount }, (_, i) => i);

                try {
                    const result = await labSampler.samplePixels({
                        streamRef: `pretest-${label}`,
                        streamData: uniformBuffer,
                        isCompressed: false,
                        width,
                        height,
                        colorSpace,
                        bitsPerComponent: 8,
                        sourceProfile: profile,
                        pixelIndices: allIndices,
                    });

                    // Count unique Lab outputs
                    const uniqueColors = new Set();
                    const labValues = result.labValues;
                    /** @type {Map<string, {L: number, a: number, b: number, count: number}>} */
                    const colorCounts = new Map();

                    for (let i = 0; i < result.pixelCount; i++) {
                        const offset = i * 3;
                        const L = labValues[offset];
                        const a = labValues[offset + 1];
                        const b = labValues[offset + 2];
                        const key = `${Math.round(L * 10)},${Math.round(a * 10)},${Math.round(b * 10)}`;
                        uniqueColors.add(key);
                        if (!colorCounts.has(key)) {
                            colorCounts.set(key, { L, a, b, count: 0 });
                        }
                        colorCounts.get(key).count++;
                    }

                    if (uniqueColors.size > 1) {
                        console.warn(`[PRETEST WARNING] ${label} (${colorSpace}): Uniform input → ${uniqueColors.size} unique Lab outputs!`);
                        console.warn(`  Buffer: ${width}×${height}×${channels} = ${pixelCount} pixels`);
                        console.warn(`  Input: [${inputValues}] (0.5 equivalent)`);
                        const sorted = [...colorCounts.entries()].sort((a, b) => b[1].count - a[1].count);
                        console.warn(`  Output Lab values:`);
                        for (const [, data] of sorted.slice(0, 5)) {
                            console.warn(`    L=${data.L.toFixed(4)}, a=${data.a.toFixed(4)}, b=${data.b.toFixed(4)} (${data.count} pixels)`);
                        }
                        if (sorted.length > 5) {
                            console.warn(`    ... and ${sorted.length - 5} more`);
                        }
                    }
                } catch (err) {
                    // Silently skip pretest failures - actual sampling will report errors
                }
            };

            // Run pretest for reference image parameters
            const refColorSpace = mapColorSpace(refImage.colorSpace);
            await runPretest('Reference', refColorSpace, refImage.channels, refProfile, pretestedCombinations);

            // Run pretest for sample image parameters
            const sampleColorSpace = mapColorSpace(sampleImage.colorSpace);
            await runPretest('Sample', sampleColorSpace, sampleImage.channels, sampleProfile, pretestedCombinations);

            let refLab, sampleLab;
            try {
                // Convert reference image sampled pixels to Lab Float32
                // PDFImageColorSampler handles decompression, bit normalization, sampling, and Lab conversion
                const refResult = await labSampler.samplePixels({
                    streamRef: refImage.name,
                    streamData: refImage.pixelData,  // Already decompressed by extractImagesFromPage
                    isCompressed: false,
                    width: refImage.width,
                    height: refImage.height,
                    colorSpace: mapColorSpace(refImage.colorSpace),
                    bitsPerComponent: refImage.bitsPerComponent,
                    sourceProfile: refProfile,
                    pixelIndices: sampling.indices,
                });
                refLab = refResult.labValues;  // Float32Array directly

                // Convert sample image sampled pixels to Lab Float32
                const sampleResult = await labSampler.samplePixels({
                    streamRef: sampleImage.name,
                    streamData: sampleImage.pixelData,  // Already decompressed
                    isCompressed: false,
                    width: sampleImage.width,
                    height: sampleImage.height,
                    colorSpace: mapColorSpace(sampleImage.colorSpace),
                    bitsPerComponent: sampleImage.bitsPerComponent,
                    sourceProfile: sampleProfile,
                    pixelIndices: sampling.indices,
                });
                sampleLab = sampleResult.labValues;  // Float32Array directly
            } catch (error) {
                imageResults.push({
                    name: refImage.name,
                    page: pageIndex + 1,
                    dimensions: `${refImage.width}×${refImage.height}`,
                    colorSpace: refImage.colorSpace,
                    status: 'INCOMPATIBLE',
                    match: matchResult,
                    deltaE: null,
                    error: `Lab conversion failed: ${error.message}`,
                });
                continue;
            }

            // Compute Delta-E
            const metrics = coordinator.createMetrics('Delta-E', {
                metrics: task.aspect.metrics ?? ['Average', 'Maximum'],
                threshold: task.aspect.threshold,
            });
            metrics.setReference({
                name: refImage.name,
                dimensions: { width: refImage.width, height: refImage.height },
                colorSpace: refImage.colorSpace,
            });
            metrics.setSample({
                name: sampleImage.name,
                dimensions: { width: sampleImage.width, height: sampleImage.height },
                colorSpace: sampleImage.colorSpace,
            });
            metrics.setSamplingMethod(sampling.method);
            metrics.addFromPixelArrays(refLab, sampleLab, Array.from({ length: sampling.indices.length }, (_, i) => i));

            const metricsResult = metrics.getMetrics();

            // Diagnostic: If max ΔE > 50, show the actual Lab values for high-ΔE pixels
            const maxDeltaE = metricsResult.metrics.find(m => m.type === 'maximum')?.value ?? 0;
            if (maxDeltaE > 50) {
                console.warn(`\n[DIAGNOSTIC] ${refImage.name}: Max ΔE = ${maxDeltaE.toFixed(2)} - investigating pixel values...`);
                console.warn(`  Reference: ${refImage.colorSpace} (${refImage.channels}ch, ${refImage.bitsPerComponent}bpc)`);
                console.warn(`  Sample: ${sampleImage.colorSpace} (${sampleImage.channels}ch, ${sampleImage.bitsPerComponent}bpc)`);

                // Find pixels with ΔE > 50 and show their Lab values
                const highDeltaEPixels = [];
                for (let i = 0; i < sampling.indices.length; i++) {
                    const offset = i * 3;
                    const refL = refLab[offset], refA = refLab[offset + 1], refB = refLab[offset + 2];
                    const smpL = sampleLab[offset], smpA = sampleLab[offset + 1], smpB = sampleLab[offset + 2];
                    const dL = smpL - refL, da = smpA - refA, db = smpB - refB;
                    const dE = Math.sqrt(dL * dL + da * da + db * db);
                    if (dE > 50) {
                        highDeltaEPixels.push({
                            pixelIndex: sampling.indices[i],
                            ref: { L: refL, a: refA, b: refB },
                            smp: { L: smpL, a: smpA, b: smpB },
                            deltaE: dE,
                        });
                    }
                }
                console.warn(`  Found ${highDeltaEPixels.length} pixels with ΔE > 50:`);
                for (const p of highDeltaEPixels.slice(0, 10)) {
                    console.warn(`    Pixel ${p.pixelIndex}: Ref(L=${p.ref.L.toFixed(2)}, a=${p.ref.a.toFixed(2)}, b=${p.ref.b.toFixed(2)}) → Sample(L=${p.smp.L.toFixed(2)}, a=${p.smp.a.toFixed(2)}, b=${p.smp.b.toFixed(2)}) ΔE=${p.deltaE.toFixed(2)}`);
                }
                if (highDeltaEPixels.length > 10) {
                    console.warn(`    ... and ${highDeltaEPixels.length - 10} more`);
                }

                // Also show raw pixel bytes from the original image data for first high-ΔE pixel
                if (highDeltaEPixels.length > 0) {
                    const firstBadPixel = highDeltaEPixels[0];
                    const pixelIdx = firstBadPixel.pixelIndex;

                    // Account for bit depth when calculating byte offsets
                    const refBytesPerSample = refImage.bitsPerComponent / 8;
                    const smpBytesPerSample = sampleImage.bitsPerComponent / 8;
                    const refBytesPerPixel = refImage.channels * refBytesPerSample;
                    const smpBytesPerPixel = sampleImage.channels * smpBytesPerSample;

                    const refOffset = pixelIdx * refBytesPerPixel;
                    const smpOffset = pixelIdx * smpBytesPerPixel;
                    const refBytes = Array.from(refImage.pixelData.slice(refOffset, refOffset + refBytesPerPixel));
                    const smpBytes = Array.from(sampleImage.pixelData.slice(smpOffset, smpOffset + smpBytesPerPixel));

                    console.warn(`  Raw bytes for pixel ${pixelIdx}:`);
                    console.warn(`    Reference (${refImage.colorSpace}, ${refImage.bitsPerComponent}bpc): [${refBytes.join(', ')}]`);
                    console.warn(`    Sample (${sampleImage.colorSpace}, ${sampleImage.bitsPerComponent}bpc): [${smpBytes.join(', ')}]`);

                    // For 16-bit, also show the decoded values
                    if (refImage.bitsPerComponent === 16) {
                        const decoded = [];
                        for (let c = 0; c < refImage.channels; c++) {
                            const high = refBytes[c * 2];
                            const low = refBytes[c * 2 + 1];
                            decoded.push((high << 8) | low);
                        }
                        console.warn(`    Reference 16-bit values: [${decoded.join(', ')}]`);
                    }
                    if (sampleImage.bitsPerComponent === 16) {
                        const decoded = [];
                        for (let c = 0; c < sampleImage.channels; c++) {
                            const high = smpBytes[c * 2];
                            const low = smpBytes[c * 2 + 1];
                            decoded.push((high << 8) | low);
                        }
                        console.warn(`    Sample 16-bit values: [${decoded.join(', ')}]`);
                    }
                }
                console.warn('');
            }

            // Get tolerances from config (if specified)
            const tolerances = task.aspect.tolerances ?? {};

            // Metric name aliases for tolerance lookup
            const metricAliases = {
                'Maximum': ['Maximum', 'Max', 'max', 'maximum'],
                'Minimum': ['Minimum', 'Min', 'min', 'minimum'],
                'Average': ['Average', 'Avg', 'avg', 'average', 'Mean', 'mean'],
            };

            // Evaluate each metric against its tolerance
            /** @type {Array<{type: string, name: string, value: number, tolerance?: number, withinTolerance?: boolean}>} */
            const metricsWithTolerances = metricsResult.metrics.map(m => {
                // Find tolerance using metric name or any of its aliases
                const aliases = metricAliases[m.name] ?? [m.name];
                let tolerance;
                for (const alias of aliases) {
                    if (tolerances[alias] !== undefined) {
                        tolerance = tolerances[alias];
                        break;
                    }
                }
                return {
                    ...m,
                    tolerance: tolerance,
                    withinTolerance: tolerance !== undefined ? m.value <= tolerance : undefined,
                };
            });

            // Determine final status:
            // - BINARY-MATCH: Binary identical pixels
            // - WITHIN-TOLERANCE: Tolerances specified and all metrics within tolerance
            // - OUT-OF-TOLERANCE: Tolerances specified and at least one metric exceeds tolerance
            // - N/A: No tolerances specified (Delta-E computed but no pass/fail judgment)
            let finalStatus;
            const isBinaryMatch = matchResult.status === 'MATCH';

            if (isBinaryMatch) {
                // Binary identical - always BINARY-MATCH
                finalStatus = 'BINARY-MATCH';
            } else if (Object.keys(tolerances).length > 0) {
                // Tolerances specified - determine WITHIN-TOLERANCE or OUT-OF-TOLERANCE
                const allWithinTolerance = metricsWithTolerances
                    .filter(m => m.tolerance !== undefined)
                    .every(m => m.withinTolerance);
                finalStatus = allWithinTolerance ? 'WITHIN-TOLERANCE' : 'OUT-OF-TOLERANCE';
            } else {
                // No tolerances - N/A (computed but no judgment)
                finalStatus = 'N/A';
            }

            // Build result with tolerance info
            const deltaEResult = {
                ...metricsResult,
                metrics: metricsWithTolerances,
                tolerances: Object.keys(tolerances).length > 0 ? tolerances : undefined,
            };

            imageResults.push({
                name: refImage.name,
                page: pageIndex + 1,
                dimensions: `${refImage.width}×${refImage.height}`,
                colorSpace: refImage.colorSpace,
                status: finalStatus,
                match: {
                    layer: matchResult.matchLayer,
                    pixelCount: matchResult.pixelCount,
                    binaryMatch: isBinaryMatch,
                },
                deltaE: deltaEResult,
            });

            const avgDeltaE = metricsResult.metrics.find(m => m.type === 'average')?.value ?? 0;
            if (options.verbose) {
                const binaryNote = isBinaryMatch ? ' (binary identical)' : '';
                console.log(`      ${refImage.name}: ${finalStatus}${binaryNote} (ΔE avg=${avgDeltaE.toFixed(2)}, samples=${sampling.sampledCount})`);
            }
        }
    }

    return imageResults;
}

/**
 * Execute comparison tasks.
 *
 * @param {ComparisonTask[]} tasks
 * @param {ParsedOptions} options
 * @param {URL} configURL - Config URL for output path resolution
 * @returns {Promise<ComparisonResult[]>}
 */
async function executeComparisons(tasks, options, configURL) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Comparison Tasks: ${tasks.length}`);
    console.log(`${'='.repeat(60)}\n`);

    if (tasks.length === 0) {
        console.log('No comparison tasks found. Check configuration and filters.');
        return [];
    }

    // Determine source directory (where PDFs are read from)
    const configDir = dirname(fileURLToPath(configURL));
    const experimentsDir = dirname(configDir);
    const defaultSourceDir = resolve(experimentsDir, 'output/2026-02-02-001');
    const sourceDir = options.sourceDir
        ? (isAbsolute(options.sourceDir) ? options.sourceDir : resolve(cwd(), options.sourceDir))
        : defaultSourceDir;

    // Display tasks before execution
    for (const task of tasks) {
        console.log(`Group: ${task.group}`);
        console.log(`  Input:  ${task.input}`);
        console.log(`  Output: ${task.output}`);
        console.log(`  Aspect: ${task.aspect.type} (${task.aspect.resource ?? 'unspecified'})`);
        console.log(`  Mode:   ${task.mode}`);

        if (task.mode === 'reference') {
            const refExists = existsSync(task.referencePdfPath);
            console.log(`  Reference PDF: ${basename(task.referencePdfPath)} ${refExists ? '[EXISTS]' : '[MISSING]'}`);
        }

        console.log(`  Pair Members:`);

        for (const member of task.pairMembers) {
            const actualPath = findActualPdfPath(member.pdfPath, sourceDir);
            const exists = actualPath !== null;
            const displayPath = actualPath ? basename(actualPath) : basename(member.pdfPath);
            console.log(`    ${member.name}: ${displayPath} ${exists ? '[EXISTS]' : '[MISSING]'}`);

            if (options.verbose) {
                console.log(`      Configuration: ${member.configuration}`);
                console.log(`      Expected path: ${member.pdfPath}`);
                if (actualPath && actualPath !== member.pdfPath) {
                    console.log(`      Actual path: ${actualPath}`);
                }
            }
        }

        console.log();
    }

    if (options.dryRun) {
        console.log('[DRY RUN] Comparison execution skipped.');
        return [];
    }

    // Initialize coordinator and register Delta-E metrics
    const coordinator = new ComparisonsCoordinator({ metrics: [DeltaEMetrics] });
    console.log(`Coordinator initialized with metrics: ${coordinator.metricNames.join(', ')}`);

    // Initialize PDFImageColorSampler for Lab Float32 output (shared across all tasks)
    // Uses production PDFImageColorSampler class from 2025/classes/
    // Outputs Lab Float32 directly for accurate Delta-E computation
    const labSampler = new PDFImageColorSampler({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: 'Lab',      // Required: must be 'Lab'
        destinationColorSpace: 'Lab',   // Required: must be 'Lab'
        inputType: 'CMYK',              // Default, overridden per-image
        compressOutput: false,          // Not applicable for analysis mode
        verbose: false,
    });

    try {
        await labSampler.ensureReady();
        console.log('PDFImageColorSampler (Lab Float32 output) initialized');
    } catch (error) {
        console.error(`Failed to initialize PDFImageColorSampler: ${error.message}`);
        throw error;
    }

    const results = [];

    // Track which color space + profile combinations we've already pretested
    /** @type {Set<string>} */
    const pretestedCombinations = new Set();

    // Process each task
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
        const task = tasks[taskIndex];
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`Processing task ${taskIndex + 1}/${tasks.length}: ${task.group}`);
        console.log(`${'─'.repeat(60)}`);

        // Skip non-Delta-E aspects for now
        if (task.aspect.type !== 'Delta-E') {
            console.log(`  Skipping aspect type: ${task.aspect.type} (only Delta-E supported)`);
            continue;
        }

        // Skip non-Image resources
        if (task.aspect.resource !== 'Image') {
            console.log(`  Skipping resource type: ${task.aspect.resource} (only Image supported)`);
            continue;
        }

        // Validate pair members based on mode
        if (task.mode === 'pairs') {
            if (task.pairMembers.length !== 2) {
                console.log(`  Skipping: Pairs mode requires exactly 2 members, got ${task.pairMembers.length}`);
                continue;
            }
        } else if (task.mode === 'reference') {
            if (task.pairMembers.length < 1) {
                console.log(`  Skipping: Reference mode requires at least 1 member`);
                continue;
            }
            if (!task.referencePdfPath) {
                console.log(`  Skipping: Reference mode but no reference PDF path`);
                continue;
            }
        }

        console.log(`  Mode: ${task.mode}`);

        // Create sampler from aspect config (shared by both modes)
        const sampler = new ImageSampler({
            sampling: task.aspect.sampling ?? 'random',
            samplingTypes: DeltaEMetrics.metricDefinitions.samplingTypes,
        });

        console.log(`  Sampling: ${sampler.getSamplingConfigs()[0]?.name ?? 'Random'}`);

        // For reference mode: Compare each pair member against the original input PDF
        // For pairs mode: Compare pair member A vs pair member B
        if (task.mode === 'reference') {
            // Load the reference (original input) PDF
            if (!existsSync(task.referencePdfPath)) {
                console.error(`  Reference PDF not found: ${task.referencePdfPath}`);
                continue;
            }

            let referencePdf;
            try {
                const refBytes = await readFile(task.referencePdfPath);
                referencePdf = await PDFDocument.load(refBytes, { updateMetadata: false });
            } catch (error) {
                console.error(`  Failed to load reference PDF: ${error.message}`);
                continue;
            }

            console.log(`  Reference: ${basename(task.referencePdfPath)} (original input)`);

            // For reference mode, we need an ICC profile to convert to Lab
            // Get it from the first pair member's converted PDF
            const firstMemberPath = findActualPdfPath(task.pairMembers[0].pdfPath, sourceDir);
            if (!firstMemberPath) {
                console.error(`  Cannot find converted PDF to extract Output Intent`);
                continue;
            }

            let samplePdfForProfile;
            try {
                const sampleBytes = await readFile(firstMemberPath);
                samplePdfForProfile = await PDFDocument.load(sampleBytes, { updateMetadata: false });
            } catch (error) {
                console.error(`  Failed to load converted PDF for profile: ${error.message}`);
                continue;
            }

            const outputIntent = extractOutputIntentProfile(samplePdfForProfile);
            if (!outputIntent) {
                console.error('  No Output Intent profile found in converted PDF');
                console.error('  Cannot convert colors to Lab without destination profile');
                continue;
            }

            console.log(`  Output Intent: ${outputIntent.description}`);

            // Process each pair member against the reference
            for (const member of task.pairMembers) {
                const memberPath = findActualPdfPath(member.pdfPath, sourceDir);
                if (!memberPath) {
                    console.error(`  Member PDF not found: ${basename(member.pdfPath)}`);
                    continue;
                }

                console.log(`  Comparing: ${member.name} vs Reference`);

                let memberPdf;
                try {
                    const memberBytes = await readFile(memberPath);
                    memberPdf = await PDFDocument.load(memberBytes, { updateMetadata: false });
                } catch (error) {
                    console.error(`    Failed to load member PDF: ${error.message}`);
                    continue;
                }

                // Compare member against reference
                const imageResults = await compareImages(
                    referencePdf,
                    memberPdf,
                    outputIntent,
                    task,
                    sampler,
                    coordinator,
                    labSampler,
                    options,
                    pretestedCombinations
                );

                // Store result
                results.push({
                    group: task.group,
                    input: task.input,
                    output: task.output,
                    pair: {
                        reference: { name: 'Original', configuration: 'Input PDF' },
                        sample: { name: member.name, configuration: member.configuration },
                    },
                    aspect: task.aspect,
                    images: imageResults,
                });

                // Summary for this comparison
                const binaryMatchCount = imageResults.filter(r => r.status === 'BINARY-MATCH').length;
                const withinToleranceCount = imageResults.filter(r => r.status === 'WITHIN-TOLERANCE').length;
                const outOfToleranceCount = imageResults.filter(r => r.status === 'OUT-OF-TOLERANCE').length;
                const naCount = imageResults.filter(r => r.status === 'N/A').length;
                const incompatibleCount = imageResults.filter(r => r.status === 'INCOMPATIBLE').length;
                const missingCount = imageResults.filter(r => r.status === 'MISSING (1/2)').length;

                console.log(`    Results: ${binaryMatchCount} BINARY-MATCH, ${withinToleranceCount} WITHIN-TOLERANCE, ${outOfToleranceCount} OUT-OF-TOLERANCE, ${naCount} N/A, ${incompatibleCount} INCOMPATIBLE, ${missingCount} MISSING`);
            }

            continue; // Skip pairs mode processing
        }

        // Pairs mode: Compare first two pair members against each other
        const [referenceMember, sampleMember] = task.pairMembers;

        // Find actual PDF files
        const referencePath = findActualPdfPath(referenceMember.pdfPath, sourceDir);
        const samplePath = findActualPdfPath(sampleMember.pdfPath, sourceDir);

        if (!referencePath) {
            console.error(`  Reference PDF not found: ${basename(referenceMember.pdfPath)}`);
            continue;
        }

        if (!samplePath) {
            console.error(`  Sample PDF not found: ${basename(sampleMember.pdfPath)}`);
            continue;
        }

        console.log(`  Reference: ${basename(referencePath)}`);
        console.log(`  Sample:    ${basename(samplePath)}`);

        // Load PDFs
        let referencePdf, samplePdf;
        try {
            const [refBytes, sampleBytes] = await Promise.all([
                readFile(referencePath),
                readFile(samplePath),
            ]);
            referencePdf = await PDFDocument.load(refBytes, { updateMetadata: false });
            samplePdf = await PDFDocument.load(sampleBytes, { updateMetadata: false });
        } catch (error) {
            console.error(`  Failed to load PDFs: ${error.message}`);
            continue;
        }

        // Extract Output Intent profile from reference PDF (both should have same)
        const outputIntent = extractOutputIntentProfile(referencePdf);
        if (!outputIntent) {
            console.error('  No Output Intent profile found in reference PDF');
            console.error('  Cannot convert Device* colors to Lab without destination profile');
            continue;
        }

        console.log(`  Output Intent: ${outputIntent.description}`);

        // Compare images using helper function
        const imageResults = await compareImages(
            referencePdf,
            samplePdf,
            outputIntent,
            task,
            sampler,
            coordinator,
            labSampler,
            options,
            pretestedCombinations
        );

        // Store result
        results.push({
            group: task.group,
            input: task.input,
            output: task.output,
            pair: {
                reference: { name: referenceMember.name, configuration: referenceMember.configuration },
                sample: { name: sampleMember.name, configuration: sampleMember.configuration },
            },
            aspect: task.aspect,
            images: imageResults,
        });

        // Summary for this task
        const binaryMatchCount = imageResults.filter(r => r.status === 'BINARY-MATCH').length;
        const withinToleranceCount = imageResults.filter(r => r.status === 'WITHIN-TOLERANCE').length;
        const outOfToleranceCount = imageResults.filter(r => r.status === 'OUT-OF-TOLERANCE').length;
        const naCount = imageResults.filter(r => r.status === 'N/A').length;
        const incompatibleCount = imageResults.filter(r => r.status === 'INCOMPATIBLE').length;
        const missingCount = imageResults.filter(r => r.status === 'MISSING (1/2)').length;

        console.log(`  Results: ${binaryMatchCount} BINARY-MATCH, ${withinToleranceCount} WITHIN-TOLERANCE, ${outOfToleranceCount} OUT-OF-TOLERANCE, ${naCount} N/A, ${incompatibleCount} INCOMPATIBLE, ${missingCount} MISSING`);
    }

    // Cleanup
    labSampler.dispose();

    return results;
}

/**
 * Execute changes verification tasks.
 *
 * @param {ChangesTask[]} tasks
 * @param {ParsedOptions} options
 * @param {URL} configURL
 * @param {object} config - The full config object for input PDF lookup
 * @returns {Promise<ChangesResult[]>}
 */
async function executeChanges(tasks, options, configURL, config) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Changes Verification Tasks: ${tasks.length}`);
    console.log(`${'='.repeat(60)}\n`);

    if (tasks.length === 0) {
        console.log('No changes verification tasks found. Check configuration and filters.');
        return [];
    }

    // Determine source directory
    const configDir = dirname(fileURLToPath(configURL));
    const experimentsDir = dirname(configDir);
    const defaultSourceDir = resolve(experimentsDir, 'output/2026-02-02-001');
    const sourceDir = options.sourceDir
        ? (isAbsolute(options.sourceDir) ? options.sourceDir : resolve(cwd(), options.sourceDir))
        : defaultSourceDir;

    // Display tasks
    for (const task of tasks) {
        console.log(`Group: ${task.group}`);
        console.log(`  Input:  ${task.input}`);
        console.log(`  Output: ${task.output}`);
        console.log(`  Aspect: ${task.aspect.type} (${task.aspect.resource})`);
        console.log(`  Input Color: ${task.aspect.input.colorspace} [${task.aspect.input.values.join(', ')}]`);
        console.log(`  Pair Members:`);

        for (const member of task.pairMembers) {
            const actualPath = findActualPdfPath(member.pdfPath, sourceDir);
            const exists = actualPath !== null;
            const displayPath = actualPath ? basename(actualPath) : basename(member.pdfPath);
            console.log(`    ${member.name}: ${displayPath} ${exists ? '[EXISTS]' : '[MISSING]'}`);
        }

        console.log();
    }

    if (options.dryRun) {
        console.log('[DRY RUN] Changes verification skipped.');
        return [];
    }

    const results = /** @type {ChangesResult[]} */ ([]);

    // Process each task
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
        const task = tasks[taskIndex];
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`Processing changes task ${taskIndex + 1}/${tasks.length}: ${task.group}`);
        console.log(`${'─'.repeat(60)}`);

        // Create metrics instance for this aspect
        const metrics = new ColorChangeMetrics();
        metrics.setInputSpec({
            colorspace: task.aspect.input.colorspace,
            values: task.aspect.input.values,
        });

        // Add output specs for each pair member
        for (const member of task.pairMembers) {
            const outputSpec = task.aspect[member.name];
            if (outputSpec && typeof outputSpec === 'object' && 'colorspace' in outputSpec) {
                metrics.addOutputSpec(member.name, {
                    colorspace: outputSpec.colorspace,
                    values: outputSpec.values,
                    tolerances: outputSpec.tolerances ?? [0, 0, 0, 0],
                });
            }
        }

        // Get input PDF path (Phase 4C: use pre-resolved path from task, fallback to config lookup)
        let inputPdfPath;
        if (task.inputPdfPath) {
            // Use pre-resolved path from buildChangesTasks
            const configDir = dirname(fileURLToPath(configURL));
            inputPdfPath = resolve(configDir, task.inputPdfPath);
        } else {
            // Fallback: lookup from config
            const inputDef = config.inputs?.[task.input];
            if (!inputDef || !inputDef.pdf) {
                console.error(`  Input definition not found in config: ${task.input}`);
                results.push({
                    group: task.group,
                    input: task.input,
                    output: task.output,
                    aspect: task.aspect,
                    pairMembers: task.pairMembers,
                    result: { passed: 0, failed: 0, total: 0, verifications: [] },
                });
                continue;
            }
            const configDir = dirname(fileURLToPath(configURL));
            inputPdfPath = resolve(configDir, inputDef.pdf);
        }

        if (!existsSync(inputPdfPath)) {
            console.error(`  Input PDF not found: ${inputPdfPath}`);
            results.push({
                group: task.group,
                input: task.input,
                output: task.output,
                aspect: task.aspect,
                pairMembers: task.pairMembers,
                result: { passed: 0, failed: 0, total: 0, verifications: [] },
            });
            continue;
        }

        // Extract colors from INPUT PDF first (critical fix: was extracting from OUTPUT PDFs)
        console.log(`  Extracting colors from input PDF: ${basename(inputPdfPath)}`);
        /** @type {import('./classes/content-stream-color-extractor.mjs').ColorMatch[]} */
        let inputColors;
        try {
            inputColors = await ContentStreamColorExtractor.extractColors(inputPdfPath);
            console.log(`    Found ${inputColors.length} color operations`);
        } catch (error) {
            console.error(`    Failed to extract input colors: ${error.message}`);
            results.push({
                group: task.group,
                input: task.input,
                output: task.output,
                aspect: task.aspect,
                pairMembers: task.pairMembers,
                result: { passed: 0, failed: 0, total: 0, verifications: [] },
            });
            continue;
        }

        // Find positions in input PDF matching the input spec
        const inputMatches = ContentStreamColorExtractor.findMatchingColors(inputColors, {
            colorspace: task.aspect.input.colorspace,
            values: task.aspect.input.values,
        });

        console.log(`  Found ${inputMatches.length} matching input colors`);

        if (inputMatches.length === 0) {
            console.log(`  No input colors match spec: ${task.aspect.input.colorspace} [${task.aspect.input.values.join(', ')}]`);
            results.push({
                group: task.group,
                input: task.input,
                output: task.output,
                aspect: task.aspect,
                pairMembers: task.pairMembers,
                result: { passed: 0, failed: 0, total: 0, verifications: [] },
            });
            continue;
        }

        // Extract colors from each OUTPUT PDF
        /** @type {Map<string, import('./classes/content-stream-color-extractor.mjs').ColorMatch[]>} */
        const pdfColors = new Map();

        for (const member of task.pairMembers) {
            const actualPath = findActualPdfPath(member.pdfPath, sourceDir);
            if (!actualPath) {
                console.error(`  Output PDF not found: ${basename(member.pdfPath)}`);
                continue;
            }

            console.log(`  Extracting colors from output: ${member.name}`);
            try {
                const colors = await ContentStreamColorExtractor.extractColors(actualPath);
                pdfColors.set(member.name, colors);
                console.log(`    Found ${colors.length} color operations`);
            } catch (error) {
                console.error(`    Failed to extract colors: ${error.message}`);
            }
        }

        // For each matched position, verify output values in all PDFs
        for (const inputMatch of inputMatches) {
            const position = {
                pageNum: inputMatch.pageNum,
                streamIndex: inputMatch.streamIndex,
                operatorIndex: inputMatch.operatorIndex,
            };

            // Find corresponding colors in each output PDF
            /** @type {Record<string, import('./classes/content-stream-color-extractor.mjs').ColorMatch | null>} */
            const outputMatches = {};

            for (const [memberName, colors] of pdfColors.entries()) {
                // Find color at same position
                const match = colors.find(c =>
                    c.pageNum === position.pageNum &&
                    c.streamIndex === position.streamIndex &&
                    c.operatorIndex === position.operatorIndex
                );
                outputMatches[memberName] = match ?? null;
            }

            // Add verification
            try {
                metrics.addVerification(position, inputMatch, outputMatches);
            } catch (e) {
                // Might fail if output spec not defined for a member
                if (options.verbose) {
                    console.log(`    Skipping position ${position.pageNum}:${position.streamIndex}:${position.operatorIndex}: ${e.message}`);
                }
            }
        }

        const metricsResult = metrics.getMetrics();
        console.log(`  Results: ${metricsResult.passed} passed, ${metricsResult.failed} failed out of ${metricsResult.total}`);

        results.push({
            group: task.group,
            input: task.input,
            output: task.output,
            aspect: task.aspect,
            pairMembers: task.pairMembers.map(m => m.name),
            result: metricsResult,
        });
    }

    return results;
}

// ============================================================================
// Changes Output Generation (matching generate-verification-matrix.mjs format)
// ============================================================================

/**
 * Generate CHANGES.json output matching working implementation format.
 *
 * Groups changesResults by group description and flattens verifications.
 *
 * @param {ChangesResult[]} changesResults
 * @param {string} configPath - Relative path to config file
 * @param {string} outputSuffix - Output folder suffix (e.g., "2026-02-02-007")
 * @returns {object}
 */
function generateChangesJsonOutput(changesResults, configPath, outputSuffix) {
    // Group results by group description
    /** @type {Map<string, ChangesResult[]>} */
    const groupedByDescription = new Map();

    for (const result of changesResults) {
        const key = result.group;
        if (!groupedByDescription.has(key)) {
            groupedByDescription.set(key, []);
        }
        groupedByDescription.get(key).push(result);
    }

    // Build groups array
    const groups = [];
    let totalGroupsPassed = 0;
    let totalGroupsFailed = 0;

    for (const [description, results] of groupedByDescription) {
        // Get group metadata from first result
        const firstResult = results[0];

        // Collect unique outputs and pairs
        const outputs = [...new Set(results.map(r => r.output))];
        const pairMemberNames = firstResult.pairMembers.map(m => m.name ?? m);

        // Build verifications array in working format
        const verifications = [];
        let groupPassedCount = 0;
        let groupFailedCount = 0;

        for (const result of results) {
            // Get pair member info
            const pairFirst = result.pairMembers[0];
            const pairSecond = result.pairMembers[1];
            const pairFirstName = pairFirst?.name ?? pairFirst;
            const pairSecondName = pairSecond?.name ?? pairSecond;
            const pairFirstConfig = pairFirst?.configuration ?? '';
            const pairSecondConfig = pairSecond?.configuration ?? '';

            for (const v of result.result.verifications) {
                const firstOutput = v.outputResults?.[pairFirstName];
                const secondOutput = v.outputResults?.[pairSecondName];

                const verification = {
                    outputName: result.output,
                    pairFirstName,
                    pairFirstConfig,
                    pairSecondName,
                    pairSecondConfig,
                    pageNum: v.position.pageNum,
                    streamIndex: v.position.streamIndex,
                    operatorIndex: v.position.operatorIndex,
                    operator: v.inputMatch?.operator ?? 'scn',
                    inputColorspace: v.inputMatch?.colorspace ?? result.aspect.input.colorspace,
                    inputValues: v.inputMatch?.values ?? result.aspect.input.values,
                    firstExpectedColorspace: firstOutput?.expected?.colorspace ?? 'DeviceRGB',
                    firstExpected: firstOutput?.expected?.values ?? [],
                    firstActualColorspace: firstOutput?.match?.colorspace ?? 'DeviceRGB',
                    firstActual: firstOutput?.match?.values ?? [],
                    firstMatch: firstOutput?.passed ?? false,
                    firstMissing: firstOutput?.match === null || firstOutput?.match === undefined,
                    secondExpectedColorspace: secondOutput?.expected?.colorspace ?? 'DeviceRGB',
                    secondExpected: secondOutput?.expected?.values ?? [],
                    secondActualColorspace: secondOutput?.match?.colorspace ?? 'DeviceRGB',
                    secondActual: secondOutput?.match?.values ?? [],
                    secondMatch: secondOutput?.passed ?? false,
                    secondMissing: secondOutput?.match === null || secondOutput?.match === undefined,
                    passed: v.passed,
                };

                verifications.push(verification);

                if (v.passed) {
                    groupPassedCount++;
                } else {
                    groupFailedCount++;
                }
            }
        }

        const groupPassed = groupFailedCount === 0;
        if (groupPassed) {
            totalGroupsPassed++;
        } else {
            totalGroupsFailed++;
        }

        // Build pairs array from first result's pair members
        const pairs = [];
        if (firstResult.pairMembers.length >= 2) {
            const pair = {};
            for (const member of firstResult.pairMembers) {
                const name = member.name ?? member;
                const config = member.configuration ?? '';
                pair[name] = config;
            }
            pairs.push(pair);
        }

        groups.push({
            description,
            input: firstResult.input,
            outputs,
            pairs,
            verifications,
            passed: groupPassed,
            failureReason: groupPassed ? null : `${groupFailedCount} verification(s) failed`,
            summary: {
                totalMatches: verifications.length,
                passedMatches: groupPassedCount,
                failedMatches: groupFailedCount,
            },
        });
    }

    return {
        configPath,
        outputSuffix,
        enabled: true,
        passed: totalGroupsPassed,
        failed: totalGroupsFailed,
        groups,
    };
}

/**
 * Generate CHANGES.json with nested structure for reduced redundancy.
 * Structure: { outputs: { [outputName]: { pairs: { [pairKey]: { members, verifications } } } } }
 *
 * This format eliminates repeated outputName, pairFirst*, pairSecond* fields from each verification,
 * and combines identical firstExpected/secondExpected into a single expected field.
 *
 * @param {ChangesResult[]} changesResults
 * @param {string} configPath
 * @param {string} outputSuffix
 * @returns {object}
 */
function generateChangesJsonOutputNested(changesResults, configPath, outputSuffix) {
    /** @type {Map<string, Map<string, { members: object, verifications: object[] }>>} */
    const outputsMap = new Map();

    let totalVerifications = 0;
    let totalPassed = 0;
    let totalFailed = 0;

    for (const result of changesResults) {
        const outputName = result.output;
        const pairFirst = result.pairMembers[0];
        const pairSecond = result.pairMembers[1];
        const pairFirstName = pairFirst?.name ?? pairFirst;
        const pairSecondName = pairSecond?.name ?? pairSecond;
        const pairKey = `${pairFirstName} vs ${pairSecondName}`;

        // Initialize output entry if needed
        if (!outputsMap.has(outputName)) {
            outputsMap.set(outputName, new Map());
        }
        const pairsMap = outputsMap.get(outputName);

        // Initialize pair entry if needed
        if (!pairsMap.has(pairKey)) {
            pairsMap.set(pairKey, {
                members: {
                    first: {
                        name: pairFirstName,
                        configuration: pairFirst?.configuration ?? '',
                    },
                    second: {
                        name: pairSecondName,
                        configuration: pairSecond?.configuration ?? '',
                    },
                },
                verifications: [],
            });
        }
        const pairEntry = pairsMap.get(pairKey);

        // Add verifications with reduced fields
        for (const v of result.result.verifications) {
            const firstOutput = v.outputResults?.[pairFirstName];
            const secondOutput = v.outputResults?.[pairSecondName];

            // Use single expected field (first and second expected are always identical in pairs mode)
            const expected = {
                colorspace: firstOutput?.expected?.colorspace ?? 'DeviceRGB',
                values: firstOutput?.expected?.values ?? [],
            };

            const verification = {
                position: {
                    page: v.position.pageNum,
                    stream: v.position.streamIndex,
                    operator: v.position.operatorIndex,
                },
                op: v.inputMatch?.operator ?? 'scn',
                input: {
                    colorspace: v.inputMatch?.colorspace ?? result.aspect.input.colorspace,
                    values: v.inputMatch?.values ?? result.aspect.input.values,
                },
                expected,
                first: firstOutput?.match ? {
                    colorspace: firstOutput.match.colorspace,
                    values: firstOutput.match.values,
                    match: firstOutput.passed ?? false,
                } : { missing: true },
                second: secondOutput?.match ? {
                    colorspace: secondOutput.match.colorspace,
                    values: secondOutput.match.values,
                    match: secondOutput.passed ?? false,
                } : { missing: true },
                passed: v.passed,
            };

            pairEntry.verifications.push(verification);
            totalVerifications++;
            if (v.passed) {
                totalPassed++;
            } else {
                totalFailed++;
            }
        }
    }

    // Convert maps to objects
    const outputs = {};
    for (const [outputName, pairsMap] of outputsMap) {
        const pairs = {};
        for (const [pairKey, pairData] of pairsMap) {
            pairs[pairKey] = pairData;
        }
        outputs[outputName] = {
            pairs,
            summary: {
                pairCount: Object.keys(pairs).length,
                verificationCount: Object.values(pairs).reduce((sum, p) => sum + p.verifications.length, 0),
            },
        };
    }

    return {
        version: 2,
        format: 'nested',
        configPath,
        outputSuffix,
        generated: new Date().toISOString(),
        summary: {
            outputCount: Object.keys(outputs).length,
            totalVerifications,
            passed: totalPassed,
            failed: totalFailed,
            status: totalFailed === 0 ? 'PASS' : 'FAIL',
        },
        outputs,
    };
}

/**
 * Generate SUMMARY.json with both comparisons and changes data.
 * Provides a condensed overview suitable for quick status checks.
 *
 * @param {object} options
 * @param {string} options.configPath - Configuration file path
 * @param {string} options.outputSuffix - Output directory suffix
 * @param {object} [options.changesJson] - Output from generateChangesJsonOutput
 * @param {object[]} [options.comparisonResults] - Array of comparison results
 * @returns {object}
 */
function generateSummaryJson({ configPath, outputSuffix, changesJson, comparisonResults }) {
    const summary = {
        configPath,
        outputSuffix,
        generated: new Date().toISOString(),
        overview: {
            status: 'PASS',
            comparisons: null,
            changes: null,
        },
    };

    // Comparisons summary
    if (comparisonResults && comparisonResults.length > 0) {
        let totalImages = 0;
        let binaryMatchCount = 0;
        let withinToleranceCount = 0;
        let outOfToleranceCount = 0;
        let naCount = 0;
        let incompatibleCount = 0;
        let missingCount = 0;

        // Aggregate Delta-E metrics across all images
        let totalAvgSum = 0;
        let totalMaxValue = 0;
        let totalUniqueReference = 0;
        let totalUniqueSample = 0;
        let deltaEImageCount = 0;

        for (const result of comparisonResults) {
            for (const img of result.images) {
                totalImages++;
                if (img.status === 'BINARY-MATCH') binaryMatchCount++;
                else if (img.status === 'WITHIN-TOLERANCE') withinToleranceCount++;
                else if (img.status === 'OUT-OF-TOLERANCE') outOfToleranceCount++;
                else if (img.status === 'N/A') naCount++;
                else if (img.status === 'INCOMPATIBLE') incompatibleCount++;
                else if (img.status === 'MISSING (1/2)') missingCount++;

                // Aggregate Delta-E metrics
                if (img.deltaE) {
                    const avgMetric = img.deltaE.metrics?.find(m => m.type === 'average');
                    const maxMetric = img.deltaE.metrics?.find(m => m.type === 'maximum');
                    const uniqueMetric = img.deltaE.metrics?.find(m => m.type === 'unique');
                    if (avgMetric) {
                        totalAvgSum += avgMetric.value;
                        deltaEImageCount++;
                    }
                    if (maxMetric && maxMetric.value > totalMaxValue) {
                        totalMaxValue = maxMetric.value;
                    }
                    if (uniqueMetric) {
                        // Unique is now an object with reference/sample counts
                        if (typeof uniqueMetric.value === 'object' && uniqueMetric.value !== null) {
                            totalUniqueReference += uniqueMetric.value.reference || 0;
                            totalUniqueSample += uniqueMetric.value.sample || 0;
                        } else {
                            // Legacy format (single number)
                            totalUniqueReference += uniqueMetric.value || 0;
                            totalUniqueSample += uniqueMetric.value || 0;
                        }
                    }
                }
            }
        }

        summary.overview.comparisons = {
            total: totalImages,
            binaryMatch: binaryMatchCount,
            withinTolerance: withinToleranceCount,
            outOfTolerance: outOfToleranceCount,
            na: naCount,
            incompatible: incompatibleCount,
            missing: missingCount,
        };

        summary.comparisons = {
            enabled: true,
            images: {
                total: totalImages,
                binaryMatch: binaryMatchCount,
                withinTolerance: withinToleranceCount,
                outOfTolerance: outOfToleranceCount,
                na: naCount,
                incompatible: incompatibleCount,
                missing: missingCount,
            },
            deltaE: deltaEImageCount > 0 ? {
                averageOfAverages: totalAvgSum / deltaEImageCount,
                overallMaximum: totalMaxValue,
                totalUniqueColors: {
                    reference: totalUniqueReference,
                    sample: totalUniqueSample,
                },
            } : null,
        };

        // FAIL if any images are OUT-OF-TOLERANCE, INCOMPATIBLE, or MISSING
        if (outOfToleranceCount > 0 || incompatibleCount > 0 || missingCount > 0) {
            summary.overview.status = 'FAIL';
        }
    }

    // Changes summary
    if (changesJson) {
        let totalVerifications = 0;
        let totalPassedVerifications = 0;
        let totalFailedVerifications = 0;

        for (const group of changesJson.groups || []) {
            const groupSummary = group.summary || {};
            totalVerifications += groupSummary.totalMatches || 0;
            totalPassedVerifications += groupSummary.passedMatches || 0;
            totalFailedVerifications += groupSummary.failedMatches || 0;
        }

        summary.overview.changes = {
            total: totalVerifications,
            passed: totalPassedVerifications,
            failed: totalFailedVerifications,
        };

        summary.changes = {
            enabled: changesJson.enabled,
            passed: changesJson.passed,
            failed: changesJson.failed,
            verifications: {
                total: totalVerifications,
                passed: totalPassedVerifications,
                failed: totalFailedVerifications,
            },
        };

        if (totalFailedVerifications > 0) {
            summary.overview.status = 'FAIL';
        }
    }

    return summary;
}

/**
 * Generate SUMMARY.json for changes verification (legacy compatibility).
 *
 * @param {object} changesJson - Output from generateChangesJsonOutput
 * @returns {object}
 * @deprecated Use generateSummaryJson instead
 */
function generateChangesSummaryJson(changesJson) {
    return generateSummaryJson({
        configPath: changesJson.configPath,
        outputSuffix: changesJson.outputSuffix,
        changesJson,
    });
}

/**
 * Generate SUMMARY.md with quick status table and condensed information.
 * Includes aggregated verification tables matching the working format.
 *
 * @param {object} summaryJson - Output from generateSummaryJson
 * @param {object} [changesJson] - Full changes data for detailed tables (optional)
 * @returns {string}
 */
function generateChangesSummaryMarkdown(summaryJson, changesJson = null) {
    const lines = [];

    lines.push('# Verification Summary');
    lines.push('');
    lines.push(`**Configuration**: \`${summaryJson.configPath}\``);
    lines.push(`**Output Folder**: \`${summaryJson.outputSuffix}\``);
    if (summaryJson.generated) {
        lines.push(`**Generated**: ${summaryJson.generated}`);
    }
    lines.push('');

    // Quick status table at top
    if (summaryJson.overview) {
        const status = summaryJson.overview.status || 'UNKNOWN';
        const statusIndicator = status === 'PASS' ? '✓ PASS' : '✗ FAIL';
        lines.push('## Quick Status');
        lines.push('');
        lines.push(`| Category | Status | Details |`);
        lines.push(`|----------|--------|---------|`);

        if (summaryJson.overview.comparisons) {
            const c = summaryJson.overview.comparisons;
            const compStatus = (c.mismatch === 0 && c.skip === 0) ? '✓' : '✗';
            lines.push(`| Comparisons | ${compStatus} | ${c.match} match, ${c.delta} delta, ${c.mismatch} mismatch, ${c.skip} skip |`);
        }

        if (summaryJson.overview.changes) {
            const ch = summaryJson.overview.changes;
            const chStatus = ch.failed === 0 ? '✓' : '✗';
            lines.push(`| Changes | ${chStatus} | ${ch.passed}/${ch.total} passed |`);
        }

        lines.push(`| **Overall** | **${statusIndicator}** | |`);
        lines.push('');
    }

    // Comparisons section (condensed)
    if (summaryJson.comparisons) {
        lines.push('## Comparisons (Delta-E)');
        lines.push('');
        lines.push(`| Metric | Value |`);
        lines.push(`|--------|-------|`);
        lines.push(`| Total Images | ${summaryJson.comparisons.images.total} |`);
        lines.push(`| Binary Match | ${summaryJson.comparisons.images.binaryMatch} |`);
        lines.push(`| Within Tolerance | ${summaryJson.comparisons.images.withinTolerance} |`);
        lines.push(`| Out of Tolerance | ${summaryJson.comparisons.images.outOfTolerance} |`);
        lines.push(`| N/A | ${summaryJson.comparisons.images.na} |`);
        lines.push(`| Incompatible | ${summaryJson.comparisons.images.incompatible} |`);
        lines.push(`| Missing | ${summaryJson.comparisons.images.missing} |`);
        if (summaryJson.comparisons.deltaE) {
            const dE = summaryJson.comparisons.deltaE;
            lines.push(`| Avg of Averages | ${dE.averageOfAverages.toFixed(2)} |`);
            lines.push(`| Overall Maximum | ${dE.overallMaximum.toFixed(2)} |`);
            if (dE.totalUniqueColors) {
                lines.push(`| Unique (Sample/Reference) | ${dE.totalUniqueColors.sample}/${dE.totalUniqueColors.reference} |`);
            } else if (dE.totalUnique !== undefined) {
                // Legacy format
                lines.push(`| Total Unique | ${dE.totalUnique} |`);
            }
        }
        lines.push('');
        lines.push('See [COMPARISONS.md](COMPARISONS.md) for detailed image comparisons.');
        lines.push('');
    }

    if (summaryJson.changes) {
        const changesPassedCount = summaryJson.changes.passed;
        const changesFailedCount = summaryJson.changes.failed;

        lines.push('## Changes Verification (Before vs After)');
        lines.push('');
        lines.push(`- **Passed**: ${changesPassedCount}`);
        lines.push(`- **Failed**: ${changesFailedCount}`);
        lines.push('');

        // Add detailed aggregated tables if changesJson is provided
        if (changesJson && changesJson.groups) {
            // Format values with 4 decimal places
            const formatValues = (values) => {
                if (!values || values.length === 0) return '-';
                return values.map(v => v.toFixed(4)).join(', ');
            };

            // Group verifications by (output name, input colorspace) to match working format
            // This creates separate sections per input colorspace type
            for (const group of changesJson.groups) {
                // Group verifications by output name AND input colorspace
                const byOutputAndColorspace = new Map();
                for (const v of group.verifications || []) {
                    const outputName = v.outputName || 'Unknown Output';
                    const inputColorspace = v.inputColorspace || 'Unknown';
                    const groupKey = `${outputName}|${inputColorspace}`;
                    if (!byOutputAndColorspace.has(groupKey)) {
                        byOutputAndColorspace.set(groupKey, {
                            outputName,
                            inputColorspace,
                            verifications: [],
                        });
                    }
                    byOutputAndColorspace.get(groupKey).verifications.push(v);
                }

                // Generate section for each (output, input colorspace) combination
                for (const [, { outputName, verifications: outputVerifications }] of byOutputAndColorspace) {
                    lines.push(`### ${group.description}`);
                    lines.push('');
                    lines.push(`**Input**: ${group.input}`);
                    lines.push(`**Outputs**: ${outputName}`);
                    lines.push('');

                    // Group by pair names
                    const byPair = new Map();
                    for (const v of outputVerifications) {
                        const pairKey = `${v.pairFirstName}|${v.pairSecondName}`;
                        if (!byPair.has(pairKey)) {
                            byPair.set(pairKey, []);
                        }
                        byPair.get(pairKey).push(v);
                    }

                    // Calculate summary
                    const totalMatches = outputVerifications.length;
                    const passedMatches = outputVerifications.filter(v => v.passed).length;
                    lines.push(`**Summary**: ${passedMatches}/${totalMatches} passed`);
                    lines.push('');

                    // Generate table for each pair
                    for (const [pairKey, pairVerifications] of byPair) {
                        const [firstName, secondName] = pairKey.split('|');
                        const pairPassed = pairVerifications.filter(v => v.passed).length;
                        const pairTotal = pairVerifications.length;

                        lines.push(`#### Pair: ${firstName} → ${secondName}`);
                        lines.push('');
                        lines.push(`**Passed**: ${pairPassed}/${pairTotal}`);
                        lines.push('');

                        // Aggregate similar rows by grouping key (Count column instead of Op#)
                        /** @type {Map<string, { count: number, first: object }>} */
                        const grouped = new Map();
                        for (const v of pairVerifications) {
                            // Build display values for grouping
                            const inputCell = `${v.inputColorspace}:${formatValues(v.inputValues)}`;
                            const firstExpCell = `${v.firstExpectedColorspace}:${formatValues(v.firstExpected)}`;
                            const firstActCell = v.firstMissing ? 'missing' : `${v.firstActualColorspace}:${formatValues(v.firstActual)}`;
                            const firstStatus = v.firstMatch ? 'PASS' : 'FAIL';
                            const secondExpCell = `${v.secondExpectedColorspace}:${formatValues(v.secondExpected)}`;
                            const secondActCell = v.secondMissing ? 'missing' : `${v.secondActualColorspace}:${formatValues(v.secondActual)}`;
                            const secondStatus = v.secondMatch ? 'PASS' : 'FAIL';
                            // Group by page, stream, and all display columns
                            const groupKey = `${v.pageNum}|${v.streamIndex}|${inputCell}|${firstExpCell}|${firstActCell}|${firstStatus}|${secondExpCell}|${secondActCell}|${secondStatus}`;
                            if (!grouped.has(groupKey)) {
                                grouped.set(groupKey, { count: 0, first: v });
                            }
                            grouped.get(groupKey).count++;
                        }

                        // Summary table with Count in place of Op#
                        lines.push(`| Page | Stream | Count | Input | ${firstName} Expected | Actual | Status | ${secondName} Expected | Actual | Status |`);
                        lines.push('|------|--------|-------|-------|----------------------|--------|--------|----------------------|--------|--------|');
                        for (const [, { count, first: v }] of grouped) {
                            const inputCell = `${v.inputColorspace}: \`${formatValues(v.inputValues)}\``;
                            const firstExpectedCell = `${v.firstExpectedColorspace}: \`${formatValues(v.firstExpected)}\``;
                            const firstActualCell = v.firstMissing ? '(missing)' : `${v.firstActualColorspace}: \`${formatValues(v.firstActual)}\``;
                            const firstStatus = v.firstMatch ? 'PASS' : 'FAIL';
                            const secondExpectedCell = `${v.secondExpectedColorspace}: \`${formatValues(v.secondExpected)}\``;
                            const secondActualCell = v.secondMissing ? '(missing)' : `${v.secondActualColorspace}: \`${formatValues(v.secondActual)}\``;
                            const secondStatus = v.secondMatch ? 'PASS' : 'FAIL';
                            lines.push(`| ${v.pageNum} | ${v.streamIndex} | ${count} | ${inputCell} | ${firstExpectedCell} | ${firstActualCell} | ${firstStatus} | ${secondExpectedCell} | ${secondActualCell} | ${secondStatus} |`);
                        }
                        lines.push('');
                    }

                    // Group status
                    const groupPassed = outputVerifications.every(v => v.passed);
                    lines.push(`**Status**: ${groupPassed ? 'PASS' : 'FAIL'}`);
                    lines.push('');
                }
            }

            lines.push('See [CHANGES.md](CHANGES.md) for raw verification tables.');
            lines.push('');

            // Overall status
            if (changesFailedCount === 0) {
                lines.push('### Status: ALL CHANGES VERIFIED');
            } else {
                lines.push(`### Status: ${changesFailedCount} CHANGE VERIFICATION(S) FAILED`);
            }
            lines.push('');
        }
    }

    if (summaryJson.comparisons) {
        lines.push('## Comparisons (Delta-E)');
        lines.push('');
        lines.push(`**Enabled**: ${summaryJson.comparisons.enabled}`);
        lines.push(`**Groups Passed**: ${summaryJson.comparisons.passed}`);
        lines.push(`**Groups Failed**: ${summaryJson.comparisons.failed}`);
        lines.push('');
        if (summaryJson.comparisons.images) {
            lines.push('### Images');
            lines.push('');
            lines.push(`| Status | Count |`);
            lines.push(`|--------|-------|`);
            lines.push(`| Total | ${summaryJson.comparisons.images.total} |`);
            lines.push(`| Match | ${summaryJson.comparisons.images.match} |`);
            lines.push(`| Delta | ${summaryJson.comparisons.images.delta} |`);
            lines.push(`| Mismatch | ${summaryJson.comparisons.images.mismatch} |`);
            lines.push(`| Skip | ${summaryJson.comparisons.images.skip} |`);
            lines.push('');
        }
    }

    return lines.join('\n');
}

/**
 * Generate CHANGES.md output matching working implementation format.
 *
 * @param {object} changesJson - Output from generateChangesJsonOutput
 * @returns {string}
 */
/**
 * Generate CHANGES.md from nested format.
 *
 * @param {object} changesJson - Nested format from generateChangesJsonOutputNested
 * @returns {string}
 */
function generateChangesMarkdownOutputNested(changesJson) {
    const lines = [];

    lines.push('# Changes Verification Results');
    lines.push('');
    lines.push(`**Configuration**: \`${changesJson.configPath}\``);
    lines.push(`**Output Folder**: \`${changesJson.outputSuffix}\``);
    lines.push(`**Generated**: ${changesJson.generated}`);
    lines.push('');
    lines.push(`**Status**: ${changesJson.summary.status}`);
    lines.push(`**Passed**: ${changesJson.summary.passed}/${changesJson.summary.totalVerifications}`);
    lines.push(`**Failed**: ${changesJson.summary.failed}`);
    lines.push('');

    // Format values with 4 decimal places
    const formatValues = (values) => {
        if (!values || values.length === 0) return '-';
        return values.map(v => v.toFixed(4)).join(', ');
    };

    for (const [outputName, outputData] of Object.entries(changesJson.outputs)) {
        lines.push(`## Output: ${outputName}`);
        lines.push('');
        lines.push(`**Pairs**: ${outputData.summary.pairCount}`);
        lines.push(`**Verifications**: ${outputData.summary.verificationCount}`);
        lines.push('');

        for (const [pairKey, pairData] of Object.entries(outputData.pairs)) {
            const firstName = pairData.members.first.name;
            const secondName = pairData.members.second.name;

            lines.push(`### Pair: ${pairKey}`);
            lines.push('');
            lines.push(`- **${firstName}**: ${pairData.members.first.configuration || '(default)'}`);
            lines.push(`- **${secondName}**: ${pairData.members.second.configuration || '(default)'}`);
            lines.push('');

            // Count passed/failed
            const passed = pairData.verifications.filter(v => v.passed).length;
            const total = pairData.verifications.length;
            lines.push(`**Passed**: ${passed}/${total}`);
            lines.push('');

            // Table
            lines.push(`| Page | Stream | Op# | Input | Expected | ${firstName} | Status | ${secondName} | Status |`);
            lines.push('|------|--------|-----|-------|----------|--------------|--------|---------------|--------|');

            for (const v of pairData.verifications) {
                const inputStr = `${v.input.colorspace}: \`${formatValues(v.input.values)}\``;
                const expectedStr = `${v.expected.colorspace}: \`${formatValues(v.expected.values)}\``;

                const firstActStr = v.first.missing ? '(missing)' : `${v.first.colorspace}: \`${formatValues(v.first.values)}\``;
                const firstStatus = v.first.missing ? 'MISSING' : (v.first.match ? 'PASS' : 'FAIL');

                const secondActStr = v.second.missing ? '(missing)' : `${v.second.colorspace}: \`${formatValues(v.second.values)}\``;
                const secondStatus = v.second.missing ? 'MISSING' : (v.second.match ? 'PASS' : 'FAIL');

                lines.push(`| ${v.position.page} | ${v.position.stream} | ${v.position.operator} | ${inputStr} | ${expectedStr} | ${firstActStr} | ${firstStatus} | ${secondActStr} | ${secondStatus} |`);
            }

            lines.push('');
        }
    }

    return lines.join('\n');
}

function generateChangesMarkdownOutput(changesJson) {
    // Handle nested format (version 2)
    if (changesJson.format === 'nested') {
        return generateChangesMarkdownOutputNested(changesJson);
    }

    const lines = [];

    lines.push('# Changes Verification Results');
    lines.push('');
    lines.push(`**Configuration**: \`${changesJson.configPath}\``);
    lines.push(`**Output Folder**: \`${changesJson.outputSuffix}\``);
    lines.push('');
    lines.push(`**Passed**: ${changesJson.passed}`);
    lines.push(`**Failed**: ${changesJson.failed}`);
    lines.push('');

    for (const group of changesJson.groups) {
        lines.push(`## ${group.description}`);
        lines.push('');
        lines.push(`**Input**: ${group.input}`);
        lines.push(`**Outputs**: ${group.outputs.join(', ')}`);
        lines.push('');
        lines.push(`**Summary**: ${group.summary.passedMatches}/${group.summary.totalMatches} passed`);
        lines.push('');

        // Get pair names from first verification
        if (group.verifications.length > 0) {
            const firstV = group.verifications[0];
            const pairFirstName = firstV.pairFirstName;
            const pairSecondName = firstV.pairSecondName;

            lines.push(`### Pair: ${pairFirstName} → ${pairSecondName}`);
            lines.push('');
            lines.push(`**Passed**: ${group.summary.passedMatches}/${group.summary.totalMatches}`);
            lines.push('');

            // Table header with side-by-side comparison
            lines.push(`| Page | Stream | Op# | Input | ${pairFirstName} Expected | Actual | Status | ${pairSecondName} Expected | Actual | Status |`);
            lines.push('|------|--------|-----|-------|----------------------|--------|--------|----------------------|--------|--------|');

            // Format values with 4 decimal places
            const formatValues = (values) => {
                if (!values || values.length === 0) return '-';
                return values.map(v => v.toFixed(4)).join(', ');
            };

            for (const v of group.verifications) {
                const inputStr = `${v.inputColorspace}: \`${formatValues(v.inputValues)}\``;
                const firstExpStr = `${v.firstExpectedColorspace}: \`${formatValues(v.firstExpected)}\``;
                const firstActStr = `${v.firstActualColorspace}: \`${formatValues(v.firstActual)}\``;
                const firstStatus = v.firstMissing ? 'MISSING' : (v.firstMatch ? 'PASS' : 'FAIL');
                const secondExpStr = `${v.secondExpectedColorspace}: \`${formatValues(v.secondExpected)}\``;
                const secondActStr = `${v.secondActualColorspace}: \`${formatValues(v.secondActual)}\``;
                const secondStatus = v.secondMissing ? 'MISSING' : (v.secondMatch ? 'PASS' : 'FAIL');

                lines.push(`| ${v.pageNum} | ${v.streamIndex} | ${v.operatorIndex} | ${inputStr} | ${firstExpStr} | ${firstActStr} | ${firstStatus} | ${secondExpStr} | ${secondActStr} | ${secondStatus} |`);
            }

            lines.push('');
        }
    }

    return lines.join('\n');
}

/**
 * Generate JSON output from comparison and changes results.
 *
 * @param {ComparisonResult[]} comparisonResults
 * @param {ChangesResult[]} changesResults
 * @returns {object}
 */
function generateJsonOutput(comparisonResults, changesResults = []) {
    const output = {
        generated: new Date().toISOString(),
    };

    // Add comparisons if present
    if (comparisonResults.length > 0) {
        output.comparisons = comparisonResults.map(r => ({
            group: r.group,
            input: r.input,
            output: r.output,
            pair: r.pair,
            aspect: {
                type: r.aspect.type,
                resource: r.aspect.resource,
            },
            images: r.images.map(img => ({
                name: img.name,
                page: img.page,
                dimensions: img.dimensions,
                colorSpace: img.colorSpace,
                status: img.status,
                match: img.match,
                deltaE: img.deltaE,
                error: img.error,
            })),
        }));
    }

    // Add changes if present
    if (changesResults.length > 0) {
        output.changes = changesResults.map(r => ({
            group: r.group,
            input: r.input,
            output: r.output,
            aspect: {
                type: r.aspect.type,
                resource: r.aspect.resource,
                inputSpec: r.aspect.input,
            },
            pairMembers: r.pairMembers,
            result: {
                passed: r.result.passed,
                failed: r.result.failed,
                total: r.result.total,
                verifications: r.result.verifications,
            },
        }));
    }

    return output;
}

/**
 * Generate Markdown output from comparison and changes results.
 *
 * @param {ComparisonResult[]} comparisonResults
 * @param {ChangesResult[]} changesResults
 * @returns {string}
 */
function generateMarkdownOutput(comparisonResults, changesResults = []) {
    const lines = [];

    lines.push('# Verification Results');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    // Comparisons section
    if (comparisonResults.length > 0) {
        lines.push('---');
        lines.push('');
        lines.push('# Comparisons (Delta-E)');
        lines.push('');

        for (const result of comparisonResults) {
            lines.push(`## ${result.group}`);
            lines.push('');
            lines.push(`- **Input**: ${result.input}`);
            lines.push(`- **Output**: ${result.output}`);
            lines.push(`- **Reference**: ${result.pair.reference.name} (${result.pair.reference.configuration})`);
            lines.push(`- **Sample**: ${result.pair.sample.name} (${result.pair.sample.configuration})`);
            lines.push('');

            // Image table
            lines.push('| Image | Page | Status | Binary | Dimensions | Color Space | ΔE Avg | ΔE Max | Unique | Samples |');
            lines.push('|-------|------|--------|--------|------------|-------------|--------|--------|--------|---------|');

            for (const img of result.images) {
                const binaryMatch = img.match?.binaryMatch ? 'Yes' : 'No';
                const avgMetric = img.deltaE?.metrics.find(m => m.type === 'average');
                const maxMetric = img.deltaE?.metrics.find(m => m.type === 'maximum');
                const uniqueMetric = img.deltaE?.metrics.find(m => m.type === 'unique');

                // Format metric with tolerance indicator
                const formatMetric = (metric) => {
                    if (!metric) return '-';
                    const value = typeof metric.value === 'number' && !Number.isInteger(metric.value)
                        ? metric.value.toFixed(2)
                        : String(metric.value);
                    if (metric.withinTolerance !== undefined) {
                        const indicator = metric.withinTolerance ? ' ✓' : ' ✗';
                        return `${value}${indicator}`;
                    }
                    return value;
                };

                // Format unique metric (object with sample/reference)
                const formatUniqueMetric = (metric) => {
                    if (!metric) return '-';
                    if (typeof metric.value === 'object' && metric.value !== null) {
                        return `${metric.value.sample}/${metric.value.reference}`;
                    }
                    return String(metric.value);
                };

                const samples = img.deltaE?.sampleCount ?? img.match?.pixelCount ?? '-';

                lines.push(`| ${img.name} | ${img.page} | ${img.status} | ${binaryMatch} | ${img.dimensions} | ${img.colorSpace} | ${formatMetric(avgMetric)} | ${formatMetric(maxMetric)} | ${formatUniqueMetric(uniqueMetric)} | ${samples} |`);
            }

            lines.push('');
        }
    }

    // Changes section
    if (changesResults.length > 0) {
        lines.push('---');
        lines.push('');
        lines.push('# Changes (Color Verification)');
        lines.push('');

        for (const result of changesResults) {
            lines.push(`## ${result.group}`);
            lines.push('');
            lines.push(`- **Input**: ${result.input}`);
            lines.push(`- **Output**: ${result.output}`);
            lines.push(`- **Input Color**: ${result.aspect.input.colorspace} [${result.aspect.input.values.join(', ')}]`);
            lines.push(`- **Pair Members**: ${result.pairMembers.join(', ')}`);
            lines.push('');

            // Summary
            lines.push(`**Results**: ${result.result.passed} passed, ${result.result.failed} failed out of ${result.result.total}`);
            lines.push('');

            // Verification details table
            if (result.result.verifications.length > 0) {
                lines.push('| Position | Status | Member | Colorspace | Values | Expected | Differences |');
                lines.push('|----------|--------|--------|------------|--------|----------|-------------|');

                for (const v of result.result.verifications) {
                    const pos = `${v.position.pageNum}:${v.position.streamIndex}:${v.position.operatorIndex}`;
                    const status = v.passed ? 'PASS' : 'FAIL';

                    for (const [memberName, outputResult] of Object.entries(v.outputResults)) {
                        const colorspace = outputResult.match?.colorspace ?? '-';
                        const values = outputResult.match?.values?.map(v => v.toFixed(3)).join(', ') ?? '-';
                        const expected = outputResult.expected.values.map(v => v.toFixed(3)).join(', ');
                        const diffs = outputResult.differences?.map(d => d.toFixed(4)).join(', ') ?? '-';

                        lines.push(`| ${pos} | ${status} | ${memberName} | ${colorspace} | ${values} | ${expected} | ${diffs} |`);
                    }
                }
            }

            lines.push('');
        }
    }

    return lines.join('\n');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    const args = argv.slice(2);
    const options = parseArgs(args);

    console.log('Compare PDF Outputs CLI Tool');
    console.log('============================\n');

    if (options.verbose) {
        console.log('Options:');
        console.log(`  Config:          ${options.configPath}`);
        console.log(`  Source Dir:      ${options.sourceDir ?? '(auto)'}`);
        console.log(`  Output Dir:      ${options.outputDir ?? '(same as source)'}`);
        console.log(`  Format:          ${options.outputFormat}`);
        console.log(`  Groups:          ${options.groups.length > 0 ? options.groups.join(', ') : '(all)'}`);
        console.log(`  Aspects:         ${options.aspects.length > 0 ? options.aspects.join(', ') : '(all)'}`);
        console.log(`  Changes Only:    ${options.changesOnly}`);
        console.log(`  Comparisons Only: ${options.comparisonsOnly}`);
        console.log(`  Dry Run:         ${options.dryRun}`);
        console.log();
    }

    // Validate mutually exclusive flags
    if (options.changesOnly && options.comparisonsOnly) {
        console.error('Error: --changes-only and --comparisons-only are mutually exclusive.');
        exit(1);
    }

    // Load configuration
    console.log(`Loading configuration: ${options.configPath}`);

    let config, configURL;
    try {
        const result = await loadConfiguration(options.configPath);
        config = result.config;
        configURL = result.configURL;
    } catch (error) {
        console.error(`Error loading configuration: ${error.message}`);
        exit(1);
    }

    if (options.verbose) {
        console.log(`Configuration loaded from: ${fileURLToPath(configURL)}`);
        console.log(`Comparisons enabled: ${config.comparisons?.enabled ?? false}`);
        console.log(`Comparisons groups: ${config.comparisons?.groups?.length ?? 0}`);
        console.log(`Changes enabled: ${config.changes?.enabled ?? false}`);
        console.log(`Changes groups: ${config.changes?.groups?.length ?? 0}`);
        console.log();
    }

    // Determine what to run based on flags and config
    const runComparisons = !options.changesOnly && (config.comparisons?.enabled ?? false);
    const runChanges = !options.comparisonsOnly && (config.changes?.enabled ?? false);

    if (!runComparisons && !runChanges) {
        console.log('Nothing to run. Check configuration and flags.');
        console.log('  - comparisons.enabled:', config.comparisons?.enabled ?? false);
        console.log('  - changes.enabled:', config.changes?.enabled ?? false);
        console.log('  - --changes-only:', options.changesOnly);
        console.log('  - --comparisons-only:', options.comparisonsOnly);
        return;
    }

    // Execute comparisons if enabled
    let comparisonResults = /** @type {ComparisonResult[]} */ ([]);
    if (runComparisons) {
        const tasks = buildComparisonTasks(config, configURL, options);
        comparisonResults = await executeComparisons(tasks, options, configURL);
    }

    // Execute changes if enabled
    let changesResults = /** @type {ChangesResult[]} */ ([]);
    if (runChanges) {
        const tasks = buildChangesTasks(config, configURL, options);
        changesResults = await executeChanges(tasks, options, configURL, config);
    }

    if (comparisonResults.length === 0 && changesResults.length === 0) {
        console.log('\nNo results generated.');
        return;
    }

    // Generate output
    console.log(`\n${'='.repeat(60)}`);
    console.log('Generating Output');
    console.log(`${'='.repeat(60)}\n`);

    // Determine output directory for writing results
    const configDir = dirname(fileURLToPath(configURL));
    const experimentsDir = dirname(configDir);
    const defaultSourceDir = resolve(experimentsDir, 'output/2026-02-02-001');
    const sourceDir = options.sourceDir
        ? (isAbsolute(options.sourceDir) ? options.sourceDir : resolve(cwd(), options.sourceDir))
        : defaultSourceDir;
    const outputBaseDir = options.outputDir
        ? (isAbsolute(options.outputDir) ? options.outputDir : resolve(cwd(), options.outputDir))
        : sourceDir;

    // Ensure output directory exists
    await mkdir(outputBaseDir, { recursive: true });

    // Extract outputSuffix from source directory name (e.g., "2026-02-02-007")
    const outputSuffix = basename(sourceDir);
    const relativeConfigPath = options.configPath;

    // Generate changes JSON if running changes (use nested format if flag is set)
    const changesJson = (runChanges && changesResults.length > 0)
        ? (options.nestedFormat
            ? generateChangesJsonOutputNested(changesResults, relativeConfigPath, outputSuffix)
            : generateChangesJsonOutput(changesResults, relativeConfigPath, outputSuffix))
        : null;

    // Generate unified summary (includes both comparisons and changes)
    const summaryJson = generateSummaryJson({
        configPath: relativeConfigPath,
        outputSuffix,
        changesJson,
        comparisonResults: (runComparisons && comparisonResults.length > 0) ? comparisonResults : null,
    });

    // Generate output files based on what was run
    if (runChanges && changesJson) {
        if (options.outputFormat === 'json' || options.outputFormat === 'both') {
            // Write CHANGES.json
            const changesJsonPath = resolve(outputBaseDir, 'CHANGES.json');
            await writeFile(changesJsonPath, JSON.stringify(changesJson, null, 2), 'utf-8');
            console.log(`JSON output written to: ${changesJsonPath}`);
        }

        if (options.outputFormat === 'markdown' || options.outputFormat === 'both') {
            // Write CHANGES.md
            const changesMd = generateChangesMarkdownOutput(changesJson);
            const changesMdPath = resolve(outputBaseDir, 'CHANGES.md');
            await writeFile(changesMdPath, changesMd, 'utf-8');
            console.log(`Markdown output written to: ${changesMdPath}`);
        }
    }

    // Write unified SUMMARY files
    if (options.outputFormat === 'json' || options.outputFormat === 'both') {
        const summaryJsonPath = resolve(outputBaseDir, 'SUMMARY.json');
        await writeFile(summaryJsonPath, JSON.stringify(summaryJson, null, 2), 'utf-8');
        console.log(`Summary JSON written to: ${summaryJsonPath}`);
    }

    if (options.outputFormat === 'markdown' || options.outputFormat === 'both') {
        const summaryMd = generateChangesSummaryMarkdown(summaryJson, changesJson);
        const summaryMdPath = resolve(outputBaseDir, 'SUMMARY.md');
        await writeFile(summaryMdPath, summaryMd, 'utf-8');
        console.log(`Summary markdown written to: ${summaryMdPath}`);
    }

    if (runComparisons && comparisonResults.length > 0) {
        // Use existing format for comparisons
        if (options.outputFormat === 'json' || options.outputFormat === 'both') {
            const jsonOutput = generateJsonOutput(comparisonResults, []);
            const jsonPath = resolve(outputBaseDir, 'COMPARISONS.json');
            await writeFile(jsonPath, JSON.stringify(jsonOutput, null, 2), 'utf-8');
            console.log(`JSON output written to: ${jsonPath}`);
        }

        if (options.outputFormat === 'markdown' || options.outputFormat === 'both') {
            const mdOutput = generateMarkdownOutput(comparisonResults, []);
            const mdPath = resolve(outputBaseDir, 'COMPARISONS.md');
            await writeFile(mdPath, mdOutput, 'utf-8');
            console.log(`Markdown output written to: ${mdPath}`);
        }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Summary');
    console.log('='.repeat(60));

    // Comparisons summary
    if (comparisonResults.length > 0) {
        let totalImages = 0;
        let totalBinaryMatch = 0;
        let totalWithinTolerance = 0;
        let totalOutOfTolerance = 0;
        let totalNA = 0;
        let totalIncompatible = 0;
        let totalMissing = 0;

        for (const result of comparisonResults) {
            for (const img of result.images) {
                totalImages++;
                if (img.status === 'BINARY-MATCH') totalBinaryMatch++;
                else if (img.status === 'WITHIN-TOLERANCE') totalWithinTolerance++;
                else if (img.status === 'OUT-OF-TOLERANCE') totalOutOfTolerance++;
                else if (img.status === 'N/A') totalNA++;
                else if (img.status === 'INCOMPATIBLE') totalIncompatible++;
                else if (img.status === 'MISSING (1/2)') totalMissing++;
            }
        }

        console.log('\nComparisons (Delta-E):');
        console.log(`  Total images: ${totalImages}`);
        console.log(`    BINARY-MATCH:      ${totalBinaryMatch}`);
        console.log(`    WITHIN-TOLERANCE:  ${totalWithinTolerance}`);
        console.log(`    OUT-OF-TOLERANCE:  ${totalOutOfTolerance}`);
        console.log(`    N/A:               ${totalNA}`);
        console.log(`    INCOMPATIBLE:      ${totalIncompatible}`);
        console.log(`    MISSING:           ${totalMissing}`);
    }

    // Changes summary
    if (changesResults.length > 0) {
        let totalVerifications = 0;
        let totalPassed = 0;
        let totalFailed = 0;

        for (const result of changesResults) {
            totalVerifications += result.result.total;
            totalPassed += result.result.passed;
            totalFailed += result.result.failed;
        }

        console.log('\nChanges (Color Verification):');
        console.log(`  Total verifications: ${totalVerifications}`);
        console.log(`    PASSED: ${totalPassed}`);
        console.log(`    FAILED: ${totalFailed}`);
    }
}

if (process.argv[1] === __filename) {
    main().catch(error => {
        console.error('Fatal error:', error);
        exit(1);
    });
}

export {
    readLargeFile,
    extractOutputIntentProfile,
    getColorSpaceInfo,
    getColorSpaceName,
    extractImagesFromPage,
    findActualPdfPath,
    loadConfiguration,
    processConfigPaths,
    buildPdfPath,
    extractDateSeq,
};
