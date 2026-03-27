#!/usr/bin/env node
// @ts-check
/**
 * Convert Colors Script
 *
 * Converts color values between color spaces using the color engine.
 * Useful for testing transforms and verifying expected outputs.
 *
 * IMPORTANT: This script behaves like a standard CLI tool.
 * - All paths (profiles, engines) are resolved RELATIVE TO CWD
 * - Run from the experiments directory: testing/iso/ptf/2025/experiments/
 *
 * Example (from experiments/):
 *   node scripts/convert-colors.js \
 *       --color-engine ../packages/color-engine-2026-01-21 \
 *       --source sRGB \
 *       --target "../tests/fixtures/profiles/eciCMYK v2.icc" \
 *       --intent k-only-gcr \
 *       "242,242,242" "128,128,128" "0,0,0"
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
// - Short name resolution (profile name -> fixtures/profiles/name.icc)
// - Basename-only matching (search by filename in multiple directories)
// - Any path resolution that differs from standard shell behavior
//
// WHY: Magic resolution makes scripts unpredictable and masks errors.
// If a path doesn't resolve, the error message tells the user exactly
// what path failed. The user can then fix their command.
//
// CORRECT BEHAVIOR:
// - All user-provided paths resolve relative to process.cwd()
// - If a path doesn't exist, throw an error with the exact path that failed
// - Script-internal paths (services) use __dirname (package structure)
//
// =============================================================================

import { parseArgs } from 'node:util';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

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
        'source': { type: 'string', default: 'sRGB' },
        'target': { type: 'string' },
        'intent': { type: 'string', default: 'relative-colorimetric' },
        'source-format': { type: 'string' },
        'target-format': { type: 'string' },
        'source-bit-depth': { type: 'string' },
        'target-bit-depth': { type: 'string' },
        'verbose': { type: 'boolean', short: 'v', default: false },
        'help': { type: 'boolean', short: 'h', default: false },
    }
});

const colorValues = positionals;
const colorEnginePath = values['color-engine'];
const sourceSpec = values['source'] ?? 'sRGB';
const targetSpec = values['target'];
const intentSpec = values['intent'] ?? 'relative-colorimetric';
const sourceFormat = values['source-format'];
const targetFormat = values['target-format'];
const sourceBitDepth = values['source-bit-depth'];
const targetBitDepth = values['target-bit-depth'];
const verbose = values['verbose'] ?? false;

// ============================================================================
// Help
// ============================================================================

if (values.help || !colorEnginePath || !targetSpec || colorValues.length === 0) {
    console.log(`
Convert Colors Script

Converts color values between color spaces using the color engine.

Usage:
  node scripts/convert-colors.js \\
      --color-engine <path> \\
      --source <source-spec> \\
      --target <target-spec> \\
      [options] \\
      "R,G,B" "R,G,B" ...

Options:
  <colors>                  Color values (comma-separated components)
  --color-engine <path>     Color engine package path (required)
  --source <spec>           Source: sRGB, DeviceRGB, DeviceCMYK, DeviceGray, Lab, or profile path
                            (default: sRGB)
  --target <spec>           Target: sRGB, DeviceRGB, DeviceCMYK, DeviceGray, Lab, or profile path
                            (required)
  --intent <name>           Rendering intent (default: relative-colorimetric):
                            - perceptual
                            - relative-colorimetric
                            - saturation
                            - absolute-colorimetric
                            - k-only-gcr (for K-Only GCR Relative Colorimetric with BPC)
  --source-format <fmt>     Input notation: 0-1, 0-255, 0-65535, percent (auto-detected)
  --target-format <fmt>     Output notation: 0-1, 0-255, 0-65535, percent (default: same as source)
  --source-bit-depth <n>    Force source bit depth: 8 or 16
  --target-bit-depth <n>    Force target bit depth: 8 or 16
  --verbose, -v             Show detailed transform info
  --help, -h                Show this help message

Examples:
  # Convert RGB grays to CMYK with K-Only GCR
  node scripts/convert-colors.js \\
      --color-engine ../packages/color-engine-2026-01-21 \\
      --source sRGB \\
      --target "../tests/fixtures/profiles/eciCMYK v2.icc" \\
      --intent k-only-gcr \\
      "242,242,242" "128,128,128" "0,0,0"

  # Convert Lab to CMYK
  node scripts/convert-colors.js \\
      --color-engine ../packages/color-engine-2026-01-21 \\
      --source Lab \\
      --target "../tests/fixtures/profiles/eciCMYK v2.icc" \\
      "50,0,0" "75,-10,20"

  # Convert with format specifiers
  node scripts/convert-colors.js \\
      --color-engine ../packages/color-engine-2026-01-21 \\
      --source DeviceCMYK \\
      --target sRGB \\
      --source-format percent \\
      --target-format 0-255 \\
      "0,0,0,100" "100,0,0,0"
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
// Color Space and Format Detection
// ============================================================================

/**
 * @typedef {'sRGB' | 'DeviceRGB' | 'DeviceCMYK' | 'DeviceGray' | 'Lab' | 'profile'} ColorSpaceType
 */

/**
 * @typedef {{
 *   type: ColorSpaceType,
 *   profilePath?: string,
 *   components: number,
 * }} ColorSpaceSpec
 */

/**
 * Parse color space specification
 * @param {string} spec
 * @returns {ColorSpaceSpec}
 */
function parseColorSpaceSpec(spec) {
    const lowerSpec = spec.toLowerCase();

    if (lowerSpec === 'srgb' || lowerSpec === 'devicergb') {
        return { type: lowerSpec === 'srgb' ? 'sRGB' : 'DeviceRGB', components: 3 };
    }
    if (lowerSpec === 'devicecmyk') {
        return { type: 'DeviceCMYK', components: 4 };
    }
    if (lowerSpec === 'devicegray') {
        return { type: 'DeviceGray', components: 1 };
    }
    if (lowerSpec === 'lab') {
        return { type: 'Lab', components: 3 };
    }

    // Assume it's a profile path
    const profilePath = resolvePath(spec, 'Profile');
    return { type: 'profile', profilePath, components: 0 }; // Will detect from profile
}

/**
 * Detect format from color values
 * @param {number[][]} colorArrays
 * @returns {'0-1' | '0-255' | '0-65535' | 'percent'}
 */
function detectFormat(colorArrays) {
    const maxValue = Math.max(...colorArrays.flat());
    if (maxValue <= 1) return '0-1';
    if (maxValue <= 100) return 'percent';
    if (maxValue <= 255) return '0-255';
    return '0-65535';
}

/**
 * Normalize color values to 0-1 range
 * @param {number[]} values
 * @param {'0-1' | '0-255' | '0-65535' | 'percent'} format
 * @returns {number[]}
 */
function normalizeToUnit(values, format) {
    switch (format) {
        case '0-1': return values;
        case '0-255': return values.map(v => v / 255);
        case '0-65535': return values.map(v => v / 65535);
        case 'percent': return values.map(v => v / 100);
        default: return values;
    }
}

/**
 * Convert from 0-1 range to target format
 * @param {number[]} values
 * @param {'0-1' | '0-255' | '0-65535' | 'percent'} format
 * @returns {number[]}
 */
function fromUnit(values, format) {
    switch (format) {
        case '0-1': return values;
        case '0-255': return values.map(v => Math.round(v * 255));
        case '0-65535': return values.map(v => Math.round(v * 65535));
        case 'percent': return values.map(v => v * 100);
        default: return values;
    }
}

/**
 * Parse color string to array
 * @param {string} colorStr
 * @returns {number[]}
 */
function parseColorString(colorStr) {
    return colorStr.split(',').map(s => parseFloat(s.trim()));
}

// ============================================================================
// Rendering Intent Mapping
// ============================================================================

/**
 * Map intent name to LittleCMS intent value
 * @param {string} intentName
 * @param {typeof import('../../../packages/color-engine/src/index.js')} colorEngineModule
 * @returns {number}
 */
function getIntent(intentName, colorEngineModule) {
    const lower = intentName.toLowerCase().replace(/-/g, '');
    switch (lower) {
        case 'perceptual':
            return 0;
        case 'relativecolorimetric':
            return 1;
        case 'saturation':
            return 2;
        case 'absolutecolorimetric':
            return 3;
        case 'konlygcr':
        case 'preservekonlyrelativecolorimetricgcr':
            return colorEngineModule.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR;
        default:
            throw new Error(`Unknown rendering intent: ${intentName}`);
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
// Main
// ============================================================================

async function main() {
    // Resolve color engine path
    const enginePath = resolvePath(colorEnginePath, 'Color engine');

    // Import color engine
    const engineIndexPath = join(enginePath, 'src', 'index.js');
    const colorEngineModule = await import(engineIndexPath);
    const colorEngine = await colorEngineModule.createEngine();

    // Parse color space specs
    const sourceSpaceSpec = parseColorSpaceSpec(sourceSpec);
    const targetSpaceSpec = parseColorSpaceSpec(targetSpec);

    // Parse color values
    const parsedColors = colorValues.map(parseColorString);

    // Detect or use specified format
    const detectedFormat = sourceFormat || detectFormat(parsedColors);
    const outputFormat = targetFormat || detectedFormat;

    if (verbose) {
        console.log('Configuration:');
        console.log(`  Source: ${sourceSpec} (${sourceSpaceSpec.type})`);
        console.log(`  Target: ${targetSpec} (${targetSpaceSpec.type})`);
        console.log(`  Intent: ${getIntentDisplayName(intentSpec)}`);
        console.log(`  Source format: ${detectedFormat}`);
        console.log(`  Output format: ${outputFormat}`);
        console.log('');
    }

    // Create profiles
    let sourceProfile;
    let targetProfile;
    let sourceComponents = sourceSpaceSpec.components;
    let targetComponents = targetSpaceSpec.components;

    // Source profile
    switch (sourceSpaceSpec.type) {
        case 'sRGB':
        case 'DeviceRGB':
            sourceProfile = colorEngine.createSRGBProfile();
            sourceComponents = 3;
            break;
        case 'DeviceGray':
            sourceProfile = colorEngine.createGrayProfile();
            sourceComponents = 1;
            break;
        case 'Lab':
            sourceProfile = colorEngine.createLab4Profile(0); // D50
            sourceComponents = 3;
            break;
        case 'DeviceCMYK':
            // Use a default CMYK profile - need to load one
            throw new Error('DeviceCMYK source requires an explicit profile path');
        case 'profile':
            if (!sourceSpaceSpec.profilePath) throw new Error('Profile path required');
            const sourceProfileBytes = await readFile(sourceSpaceSpec.profilePath);
            sourceProfile = colorEngine.openProfileFromMem(sourceProfileBytes, sourceProfileBytes.length);
            // Detect component count from profile header
            const sourceHeader = parseProfileHeader(sourceProfileBytes);
            sourceComponents = getComponentsFromColorSpace(sourceHeader.colorSpace);
            break;
    }

    // Target profile
    switch (targetSpaceSpec.type) {
        case 'sRGB':
        case 'DeviceRGB':
            targetProfile = colorEngine.createSRGBProfile();
            targetComponents = 3;
            break;
        case 'DeviceGray':
            targetProfile = colorEngine.createGrayProfile();
            targetComponents = 1;
            break;
        case 'Lab':
            targetProfile = colorEngine.createLab4Profile(0); // D50
            targetComponents = 3;
            break;
        case 'DeviceCMYK':
            throw new Error('DeviceCMYK target requires an explicit profile path');
        case 'profile':
            if (!targetSpaceSpec.profilePath) throw new Error('Profile path required');
            const targetProfileBytes = await readFile(targetSpaceSpec.profilePath);
            targetProfile = colorEngine.openProfileFromMem(targetProfileBytes, targetProfileBytes.length);
            const targetHeader = parseProfileHeader(targetProfileBytes);
            targetComponents = getComponentsFromColorSpace(targetHeader.colorSpace);
            break;
    }

    // Determine bit depth and pixel formats
    const srcBitDepth = sourceBitDepth ? parseInt(sourceBitDepth, 10) : 8;
    const tgtBitDepth = targetBitDepth ? parseInt(targetBitDepth, 10) : 8;

    const sourcePixelType = getPixelType(sourceComponents, srcBitDepth, sourceSpaceSpec.type === 'Lab', colorEngineModule);
    const targetPixelType = getPixelType(targetComponents, tgtBitDepth, targetSpaceSpec.type === 'Lab', colorEngineModule);

    // Get intent
    const intent = getIntent(intentSpec, colorEngineModule);
    const flags = colorEngineModule.cmsFLAGS_BLACKPOINTCOMPENSATION;

    // Create transform
    const transform = colorEngine.createTransform(
        sourceProfile,
        sourcePixelType,
        targetProfile,
        targetPixelType,
        intent,
        flags
    );

    if (verbose) {
        console.log('Transform created:');
        console.log(`  Source pixel type: 0x${sourcePixelType.toString(16)}`);
        console.log(`  Target pixel type: 0x${targetPixelType.toString(16)}`);
        console.log(`  Intent: ${intent}`);
        console.log('');
    }

    // Output header
    const sourceLabel = getColorSpaceLabel(sourceSpaceSpec.type, sourceComponents);
    const targetLabel = getColorSpaceLabel(targetSpaceSpec.type, targetComponents);
    console.log(`${sourceLabel} → ${targetLabel} (${getIntentDisplayName(intentSpec)})`);
    console.log('─'.repeat(70));

    // Transform each color
    for (let i = 0; i < parsedColors.length; i++) {
        const inputValues = parsedColors[i];

        // Normalize to 0-1 for internal processing
        const normalized = normalizeToUnit(inputValues, /** @type {any} */ (detectedFormat));

        // Scale to bit depth
        const maxInput = srcBitDepth === 8 ? 255 : 65535;
        const scaled = normalized.map(v => Math.round(v * maxInput));

        // Create input buffer
        const inputBuffer = srcBitDepth === 8
            ? new Uint8Array(scaled)
            : new Uint16Array(scaled);

        // Create output buffer
        const outputBuffer = tgtBitDepth === 8
            ? new Uint8Array(targetComponents)
            : new Uint16Array(targetComponents);

        // Transform
        colorEngine.doTransform(transform, inputBuffer, outputBuffer, 1);

        // Convert output to normalized 0-1
        const maxOutput = tgtBitDepth === 8 ? 255 : 65535;
        const outputNormalized = Array.from(outputBuffer).map(v => v / maxOutput);

        // Format output
        const outputFormatted = fromUnit(outputNormalized, /** @type {any} */ (outputFormat));

        // Format for display
        const inputStr = formatColorValues(inputValues, sourceComponents);
        const outputStr = formatColorValues(outputFormatted, targetComponents);

        // Check for K-only (if target is CMYK)
        let status = '';
        if (targetComponents === 4) {
            const [c, m, y, k] = outputNormalized;
            if (c < 0.02 && m < 0.02 && y < 0.02 && k > 0.01) {
                status = ' ✓ K-only';
            } else if (c < 0.02 && m < 0.02 && y < 0.02 && k < 0.01) {
                status = ' (white)';
            }
        }

        console.log(`${inputStr} → ${outputStr}${status}`);
    }

    // Cleanup
    colorEngine.deleteTransform(transform);
    colorEngine.closeProfile(sourceProfile);
    colorEngine.closeProfile(targetProfile);
}

/**
 * Get pixel type constant for LittleCMS
 * @param {number} components
 * @param {number} bitDepth
 * @param {boolean} isLab
 * @param {any} colorEngineModule
 * @returns {number}
 */
function getPixelType(components, bitDepth, isLab, colorEngineModule) {
    if (isLab) {
        return bitDepth === 8 ? colorEngineModule.TYPE_Lab_8 : colorEngineModule.TYPE_Lab_16;
    }
    if (components === 1) {
        return bitDepth === 8 ? colorEngineModule.TYPE_GRAY_8 : colorEngineModule.TYPE_GRAY_16;
    }
    if (components === 3) {
        return bitDepth === 8 ? colorEngineModule.TYPE_RGB_8 : colorEngineModule.TYPE_RGB_16;
    }
    if (components === 4) {
        return bitDepth === 8 ? colorEngineModule.TYPE_CMYK_8 : colorEngineModule.TYPE_CMYK_16;
    }
    throw new Error(`Unsupported component count: ${components}`);
}

/**
 * Get component count from color space signature
 * @param {string} colorSpace
 * @returns {number}
 */
function getComponentsFromColorSpace(colorSpace) {
    switch (colorSpace) {
        case 'GRAY': return 1;
        case 'RGB ': return 3;
        case 'Lab ': return 3;
        case 'CMYK': return 4;
        default: return 3;
    }
}

/**
 * Parse ICC profile header for color space
 * @param {Buffer} profileBytes
 * @returns {{ colorSpace: string }}
 */
function parseProfileHeader(profileBytes) {
    const colorSpace = profileBytes.slice(16, 20).toString('ascii');
    return { colorSpace };
}

/**
 * Get color space display label
 * @param {ColorSpaceType} type
 * @param {number} components
 * @returns {string}
 */
function getColorSpaceLabel(type, components) {
    switch (type) {
        case 'sRGB': return 'sRGB';
        case 'DeviceRGB': return 'RGB';
        case 'DeviceCMYK': return 'CMYK';
        case 'DeviceGray': return 'Gray';
        case 'Lab': return 'Lab';
        case 'profile':
            if (components === 4) return 'CMYK';
            if (components === 3) return 'RGB';
            if (components === 1) return 'Gray';
            return `${components}ch`;
        default: return type;
    }
}

/**
 * Format color values for display
 * @param {number[]} values
 * @param {number} components
 * @returns {string}
 */
function formatColorValues(values, components) {
    const formatted = values.slice(0, components).map(v => {
        if (Number.isInteger(v) || v > 100) {
            return v.toString().padStart(3);
        }
        return v.toFixed(3);
    }).join(', ');
    return `(${formatted})`;
}

main().catch(err => {
    console.error('Error:', err.message);
    if (verbose) {
        console.error(err.stack);
    }
    process.exit(1);
});
