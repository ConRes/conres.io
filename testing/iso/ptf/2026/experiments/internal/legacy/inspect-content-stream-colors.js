#!/usr/bin/env node
// @ts-check
/**
 * Inspect Content Stream Colors Script
 *
 * Inspects PDF content stream color operations, showing color space context
 * and Separation detection. Useful for debugging color conversion issues.
 *
 * IMPORTANT: This script behaves like a standard CLI tool.
 * - All paths are resolved RELATIVE TO CWD
 * - Run from the experiments directory: testing/iso/ptf/2025/experiments/
 *
 * Example (from experiments/):
 *   node scripts/inspect-content-stream-colors.js \
 *       "../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou.pdf" \
 *       --page 4 \
 *       --show-separation
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
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, basename } from 'path';
import {
    PDFDocument,
    PDFRawStream,
    PDFDict,
    PDFArray,
    PDFName,
    PDFRef,
    decodePDFRawStream,
    PDFPageLeaf,
} from '../../../packages/pdf-lib/pdf-lib.esm.js';

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
        'page': { type: 'string' },
        'show-separation': { type: 'boolean', default: false },
        'show-context': { type: 'boolean', default: false },
        'show-all-ops': { type: 'boolean', default: false },
        'limit': { type: 'string', default: '50' },
        'verbose': { type: 'boolean', short: 'v', default: false },
        'help': { type: 'boolean', short: 'h', default: false },
    }
});

const pdfPath = positionals[0];
const targetPage = values['page'] ? parseInt(values['page'], 10) : null;
const showSeparation = values['show-separation'] ?? false;
const showContext = values['show-context'] ?? false;
const showAllOps = values['show-all-ops'] ?? false;
const outputLimit = parseInt(values['limit'] ?? '50', 10);
const verbose = values['verbose'] ?? false;

// ============================================================================
// Help
// ============================================================================

if (values.help || !pdfPath) {
    console.log(`
Inspect Content Stream Colors Script

Inspects PDF content stream color operations, showing color space context
and Separation detection.

Usage:
  node scripts/inspect-content-stream-colors.js <pdf> [options]

Arguments:
  <pdf>                     Input PDF path (required)

Options:
  --page <n>                Page number to inspect (1-indexed, default: all)
  --show-separation         Highlight Separation color spaces
  --show-context            Show color space context for each operation
  --show-all-ops            Show all color operations (not just filtered)
  --limit <n>               Limit output to N color operations (default: 50)
  --verbose, -v             Show all parsed chunks including non-colors
  --help, -h                Show this help message

Examples:
  # Inspect all pages of a PDF
  node scripts/inspect-content-stream-colors.js \\
      "../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou.pdf"

  # Inspect specific page with Separation highlighting
  node scripts/inspect-content-stream-colors.js \\
      "../tests/fixtures/pdfs/Type Sizes and Lissajou.pdf" \\
      --page 4 \\
      --show-separation \\
      --show-context

  # Show all color operations with no limit
  node scripts/inspect-content-stream-colors.js \\
      "../tests/fixtures/pdfs/source.pdf" \\
      --show-all-ops \\
      --limit 0
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
// Color Space Utilities
// ============================================================================

/**
 * @typedef {{
 *   colorSpaceType: string,
 *   colorantName?: string,
 *   nComponents?: number,
 *   profileDescription?: string,
 *   alternate?: string,
 * }} ColorSpaceDefinition
 */

/**
 * Extract color space definitions from page resources
 * @param {PDFPageLeaf} pageNode
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Map<string, ColorSpaceDefinition>}
 */
function extractColorSpaceDefinitions(pageNode, context) {
    /** @type {Map<string, ColorSpaceDefinition>} */
    const definitions = new Map();

    const resources = pageNode.get(PDFName.of('Resources'));
    let resourcesDict = resources;
    if (resources instanceof PDFRef) {
        resourcesDict = context.lookup(resources);
    }
    if (!(resourcesDict instanceof PDFDict)) return definitions;

    const colorSpaceEntry = resourcesDict.get(PDFName.of('ColorSpace'));
    let colorSpaceDict = colorSpaceEntry;
    if (colorSpaceEntry instanceof PDFRef) {
        colorSpaceDict = context.lookup(colorSpaceEntry);
    }
    if (!(colorSpaceDict instanceof PDFDict)) return definitions;

    for (const [key, value] of colorSpaceDict.entries()) {
        // Use asString() to include the leading slash for proper matching
        const csNameWithSlash = key.asString();
        const csNameClean = csNameWithSlash.replace(/^\//, '');

        let csDescriptor = value;
        if (value instanceof PDFRef) {
            csDescriptor = context.lookup(value);
        }

        /** @type {ColorSpaceDefinition} */
        const def = { colorSpaceType: 'unknown' };

        if (csDescriptor instanceof PDFName) {
            def.colorSpaceType = csDescriptor.decodeText();
        } else if (csDescriptor instanceof PDFArray && csDescriptor.size() > 0) {
            const firstElement = csDescriptor.get(0);
            if (firstElement instanceof PDFName) {
                def.colorSpaceType = firstElement.decodeText();

                // For Separation, get colorant name and alternate space
                if (def.colorSpaceType === 'Separation' && csDescriptor.size() >= 2) {
                    const colorant = csDescriptor.get(1);
                    if (colorant instanceof PDFName) {
                        def.colorantName = colorant.decodeText();
                    }
                    if (csDescriptor.size() >= 3) {
                        const alternate = csDescriptor.get(2);
                        if (alternate instanceof PDFName) {
                            def.alternate = alternate.decodeText();
                        } else if (alternate instanceof PDFArray && alternate.size() > 0) {
                            const altFirst = alternate.get(0);
                            if (altFirst instanceof PDFName) {
                                def.alternate = altFirst.decodeText();
                            }
                        }
                    }
                }

                // For ICCBased, get profile info
                if (def.colorSpaceType === 'ICCBased' && csDescriptor.size() > 1) {
                    const profileRef = csDescriptor.get(1);
                    const profileStream = profileRef instanceof PDFRef
                        ? context.lookup(profileRef)
                        : profileRef;
                    if (profileStream instanceof PDFRawStream) {
                        const nValue = profileStream.dict.get(PDFName.of('N'));
                        if (nValue && typeof nValue.asNumber === 'function') {
                            def.nComponents = nValue.asNumber();
                        }
                        // Try to get profile description
                        try {
                            const decoded = decodePDFRawStream(profileStream).decode();
                            const descBytes = decoded.slice(128, 500);
                            const descStr = new TextDecoder('ascii', { fatal: false }).decode(descBytes);
                            const descMatch = descStr.match(/desc.*?([A-Za-z0-9 ._-]{4,})/);
                            if (descMatch) {
                                def.profileDescription = descMatch[1].trim();
                            }
                        } catch (e) {
                            // Ignore decode errors
                        }
                    }
                }

                // For Lab, note D50/D65 whitepoint if available
                if (def.colorSpaceType === 'Lab') {
                    def.nComponents = 3;
                }
            }
        }

        // Store with both forms for lookup flexibility
        definitions.set(csNameWithSlash, def);
        definitions.set(csNameClean, def);
    }

    return definitions;
}

/**
 * Extract content streams from a page
 * @param {PDFPageLeaf} pageNode
 * @param {import('pdf-lib').PDFContext} context
 * @returns {string[]}
 */
function extractContentStreams(pageNode, context) {
    const streams = [];
    const contents = pageNode.get(PDFName.of('Contents'));

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

    for (const ref of streamRefs) {
        const stream = context.lookup(ref);
        if (stream instanceof PDFRawStream) {
            try {
                const decoded = decodePDFRawStream(stream).decode();
                streams.push(new TextDecoder().decode(decoded));
            } catch (e) {
                // Ignore decode errors
            }
        }
    }

    return streams;
}

// ============================================================================
// Content Stream Parsing
// ============================================================================

/**
 * @typedef {{
 *   type: 'colorspace' | 'color' | 'gray' | 'rgb' | 'cmyk',
 *   operator: string,
 *   csName?: string,
 *   values?: number[],
 *   stroke: boolean,
 *   position: number,
 * }} ColorOperation
 */

/**
 * Parse color operations from content stream text
 * @param {string} text
 * @returns {ColorOperation[]}
 */
function parseColorOperations(text) {
    /** @type {ColorOperation[]} */
    const operations = [];

    // Pattern to match color space changes
    const csPattern = /\/([\w]+)\s+(CS|cs)\b/g;

    // Pattern to match SCN/scn operations (with optional color space name)
    const scnPattern = /(?:\/([\w]+)\s+)?((?:[\d.]+\s+)*[\d.]+)\s+(SCN|scn)\b/g;

    // Pattern to match named SCN/scn (e.g., /Black1 scn)
    const namedScnPattern = /\/([\w]+)\s+(SCN|scn)\b/g;

    // Pattern for device color operators
    const gPattern = /([\d.]+)\s+(G|g)\b/g;
    const rgPattern = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(RG|rg)\b/g;
    const kPattern = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(K|k)\b/g;

    // Color space changes
    for (const m of text.matchAll(csPattern)) {
        operations.push({
            type: 'colorspace',
            operator: m[2],
            csName: '/' + m[1],
            stroke: m[2] === 'CS',
            position: m.index ?? 0,
        });
    }

    // Named SCN operations first
    for (const m of text.matchAll(namedScnPattern)) {
        // Skip if this is actually a numeric pattern followed by scn
        const before = text.slice(Math.max(0, (m.index ?? 0) - 20), m.index);
        if (/[\d.]\s*$/.test(before)) continue;

        operations.push({
            type: 'color',
            operator: m[2],
            csName: '/' + m[1],
            stroke: m[2] === 'SCN',
            position: m.index ?? 0,
        });
    }

    // Numeric SCN/scn operations
    for (const m of text.matchAll(scnPattern)) {
        const valuesStr = m[2];
        const values = valuesStr.trim().split(/\s+/).map(parseFloat);

        operations.push({
            type: 'color',
            operator: m[3],
            csName: m[1] ? '/' + m[1] : undefined,
            values,
            stroke: m[3] === 'SCN',
            position: m.index ?? 0,
        });
    }

    // Device gray
    for (const m of text.matchAll(gPattern)) {
        operations.push({
            type: 'gray',
            operator: m[2],
            values: [parseFloat(m[1])],
            stroke: m[2] === 'G',
            position: m.index ?? 0,
        });
    }

    // Device RGB
    for (const m of text.matchAll(rgPattern)) {
        operations.push({
            type: 'rgb',
            operator: m[4],
            values: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])],
            stroke: m[4] === 'RG',
            position: m.index ?? 0,
        });
    }

    // Device CMYK
    for (const m of text.matchAll(kPattern)) {
        operations.push({
            type: 'cmyk',
            operator: m[5],
            values: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])],
            stroke: m[5] === 'K',
            position: m.index ?? 0,
        });
    }

    // Sort by position in stream
    operations.sort((a, b) => a.position - b.position);

    return operations;
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Format color values for display
 * @param {number[]} values
 * @returns {string}
 */
function formatValues(values) {
    return values.map(v => v.toFixed(3)).join(', ');
}

/**
 * Get color space type label with optional details
 * @param {ColorSpaceDefinition | undefined} def
 * @returns {string}
 */
function formatColorSpaceType(def) {
    if (!def) return 'unknown';

    let result = def.colorSpaceType;
    if (def.colorSpaceType === 'Separation' && def.colorantName) {
        result += ` (${def.colorantName})`;
        if (def.alternate) {
            result += ` → ${def.alternate}`;
        }
    } else if (def.colorSpaceType === 'ICCBased') {
        if (def.nComponents) {
            result += ` (${def.nComponents} ch)`;
        }
        if (def.profileDescription) {
            result += ` [${def.profileDescription}]`;
        }
    }
    return result;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    const resolvedPDFPath = resolvePath(pdfPath, 'PDF');
    const pdfBytes = await readFile(resolvedPDFPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const context = pdfDoc.context;
    const pages = pdfDoc.getPages();

    console.log('═'.repeat(80));
    console.log(`PDF: ${basename(resolvedPDFPath)}`);
    console.log(`Pages: ${pages.length}`);
    console.log('═'.repeat(80));
    console.log('');

    // Determine which pages to inspect
    const pagesToInspect = targetPage
        ? [targetPage]
        : Array.from({ length: pages.length }, (_, i) => i + 1);

    for (const pageNum of pagesToInspect) {
        if (pageNum < 1 || pageNum > pages.length) {
            console.error(`Invalid page number: ${pageNum} (PDF has ${pages.length} pages)`);
            continue;
        }

        const page = pages[pageNum - 1];
        const pageNode = /** @type {PDFPageLeaf} */ (page.node);

        console.log('─'.repeat(80));
        console.log(`Page ${pageNum}`);
        console.log('─'.repeat(80));

        // Extract color space definitions
        const colorSpaceDefs = extractColorSpaceDefinitions(pageNode, context);

        // List color space definitions
        console.log('\nColor Space Definitions:');
        if (colorSpaceDefs.size === 0) {
            console.log('  (none)');
        } else {
            // Deduplicate (we stored both with and without slash)
            const seen = new Set();
            for (const [name, def] of colorSpaceDefs) {
                if (name.startsWith('/') && !seen.has(name)) {
                    seen.add(name);
                    const isSeparation = def.colorSpaceType === 'Separation';
                    const marker = (showSeparation && isSeparation) ? ' ✓' : '';
                    console.log(`  ${name}: ${formatColorSpaceType(def)}${marker}`);
                }
            }
        }

        // Extract and parse content streams
        const contentStreams = extractContentStreams(pageNode, context);
        const allText = contentStreams.join('\n');
        const operations = parseColorOperations(allText);

        // Track current color space for context
        /** @type {string | undefined} */
        let currentStrokeCS = undefined;
        /** @type {string | undefined} */
        let currentFillCS = undefined;

        // Count operations by type
        const opCounts = {
            colorspace: 0,
            color: 0,
            gray: 0,
            rgb: 0,
            cmyk: 0,
        };

        // Separation tracking
        let separationCount = 0;
        let nonSeparationCount = 0;

        // Process operations
        console.log('\nColor Operations:');

        let outputCount = 0;
        for (const op of operations) {
            opCounts[op.type]++;

            // Update current color space
            if (op.type === 'colorspace') {
                if (op.stroke) {
                    currentStrokeCS = op.csName;
                } else {
                    currentFillCS = op.csName;
                }
            }

            // Get effective color space for color operations
            const effectiveCS = op.csName || (op.stroke ? currentStrokeCS : currentFillCS);
            const csDef = effectiveCS ? colorSpaceDefs.get(effectiveCS) : undefined;
            const isSeparation = csDef?.colorSpaceType === 'Separation';

            if (isSeparation) {
                separationCount++;
            } else if (op.type === 'color') {
                nonSeparationCount++;
            }

            // Filter output based on options
            const shouldShow = showAllOps ||
                (showSeparation && isSeparation) ||
                (op.type === 'color' && op.values && op.values.length > 0);

            if (!shouldShow && !verbose) continue;

            // Apply limit
            if (outputLimit > 0 && outputCount >= outputLimit) continue;
            outputCount++;

            // Format output line
            let line = '  ';

            if (op.type === 'colorspace') {
                line += `${op.operator}: ${op.csName}`;
                if (showContext && csDef) {
                    line += ` (${formatColorSpaceType(csDef)})`;
                }
            } else if (op.type === 'color') {
                line += `${op.operator}:`;
                if (op.csName) {
                    line += ` ${op.csName}`;
                }
                if (op.values) {
                    line += ` [${formatValues(op.values)}]`;
                }
                if (showContext && effectiveCS) {
                    line += ` context=${effectiveCS}`;
                    if (csDef) {
                        line += ` (${csDef.colorSpaceType})`;
                    }
                }
                if (showSeparation && isSeparation) {
                    line += ' ✓ Separation';
                }
            } else if (op.type === 'gray') {
                line += `${op.operator}: DeviceGray [${formatValues(op.values ?? [])}]`;
            } else if (op.type === 'rgb') {
                line += `${op.operator}: DeviceRGB [${formatValues(op.values ?? [])}]`;
            } else if (op.type === 'cmyk') {
                line += `${op.operator}: DeviceCMYK [${formatValues(op.values ?? [])}]`;
            }

            console.log(line);
        }

        if (outputLimit > 0 && outputCount >= outputLimit) {
            console.log(`  ... (limited to ${outputLimit} operations, use --limit 0 for all)`);
        }

        // Summary
        console.log('\nSummary:');
        console.log(`  Color space changes: ${opCounts.colorspace}`);
        console.log(`  Indexed colors (scn/SCN): ${opCounts.color}`);
        console.log(`  DeviceGray: ${opCounts.gray}`);
        console.log(`  DeviceRGB: ${opCounts.rgb}`);
        console.log(`  DeviceCMYK: ${opCounts.cmyk}`);

        if (showSeparation) {
            console.log(`  Separation colors: ${separationCount}`);
            console.log(`  Non-Separation indexed: ${nonSeparationCount}`);
        }

        console.log('');
    }
}

main().catch(err => {
    console.error('Error:', err.message);
    if (verbose) {
        console.error(err.stack);
    }
    process.exit(1);
});
