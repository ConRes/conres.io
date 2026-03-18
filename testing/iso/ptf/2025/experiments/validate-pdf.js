#!/usr/bin/env node

/**
 * PDF Validation CLI Tool
 *
 * Validates a PDF document's color spaces and structure.
 *
 * Usage:
 *   node validate-pdf.js <input.pdf> [options]
 *
 * Options:
 *   --expected-profile=<name>   Expected output intent profile name
 *   --expected-color-space=<cs> Expected primary color space (DeviceCMYK, ICCBased, etc.)
 *   --verbose                   Enable verbose output
 *   --dump-images               Dump image metadata
 *   --dump-content              Dump content stream color operations
 *
 * Example:
 *   node validate-pdf.js output.pdf --expected-color-space=DeviceCMYK --verbose
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { PDFDocument, PDFName, PDFArray, PDFRef } from 'pdf-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dynamic import for browser-compatible modules
async function loadServices() {
    const { analyzeColorSpaces, analyzePageColors, extractImageMetadata, parseICCProfileFromRef } = await import('../services/ColorSpaceUtils.js');
    const { ICCService } = await import('../services/ICCService.js');
    return { analyzeColorSpaces, analyzePageColors, extractImageMetadata, parseICCProfileFromRef, ICCService };
}

function printUsage() {
    console.log(`
PDF Validation CLI Tool

Usage:
  node validate-pdf.js <input.pdf> [options]

Options:
  --expected-profile=<name>   Expected output intent profile name
  --expected-color-space=<cs> Expected primary color space (DeviceCMYK, ICCBased, etc.)
  --verbose                   Enable verbose output
  --dump-images               Dump image metadata
  --dump-content              Dump content stream color operations
  --check-profiles            Check ICC profile validity

Example:
  node validate-pdf.js output.pdf --expected-color-space=DeviceCMYK --verbose
`);
}

function parseArgs(args) {
    const positional = [];
    const options = {
        expectedProfile: null,
        expectedColorSpace: null,
        verbose: false,
        dumpImages: false,
        dumpContent: false,
        checkProfiles: false,
    };

    for (const arg of args) {
        if (arg.startsWith('--expected-profile=')) {
            options.expectedProfile = arg.split('=')[1];
        } else if (arg.startsWith('--expected-color-space=')) {
            options.expectedColorSpace = arg.split('=')[1];
        } else if (arg === '--verbose') {
            options.verbose = true;
        } else if (arg === '--dump-images') {
            options.dumpImages = true;
        } else if (arg === '--dump-content') {
            options.dumpContent = true;
        } else if (arg === '--check-profiles') {
            options.checkProfiles = true;
        } else if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        } else if (!arg.startsWith('-')) {
            positional.push(arg);
        }
    }

    return { positional, options };
}

async function main() {
    const args = process.argv.slice(2);
    const { positional, options } = parseArgs(args);

    if (positional.length < 1) {
        console.error('Error: Missing required PDF file argument');
        printUsage();
        process.exit(1);
    }

    const [inputPath] = positional;

    console.log('\n' + '═'.repeat(80));
    console.log('PDF Validation Tool');
    console.log('═'.repeat(80));

    console.log(`\nInput PDF: ${inputPath}`);

    const issues = [];
    const warnings = [];
    const info = [];

    try {
        // Load services
        const { analyzeColorSpaces, analyzePageColors, extractImageMetadata, parseICCProfileFromRef, ICCService } = await loadServices();

        // Read and load PDF
        console.log('\nLoading PDF...');
        const pdfBuffer = await readFile(resolve(inputPath));
        const pdfDocument = await PDFDocument.load(pdfBuffer);
        const pageCount = pdfDocument.getPageCount();
        info.push(`Pages: ${pageCount}`);

        // Analyze color spaces
        console.log('Analyzing color spaces...');
        const analysis = analyzeColorSpaces(pdfDocument, { debug: false });

        // Count color space types
        const colorSpaceTypes = new Map();
        const colorSpacesByClassifier = new Map();

        // colorSpaceDesignationTargetsByClassifier is Record<string, Map<any, ColorSpaceDesignation>>
        for (const [classifier, targetsMap] of Object.entries(analysis.colorSpaceDesignationTargetsByClassifier)) {
            if (!colorSpacesByClassifier.has(classifier)) {
                colorSpacesByClassifier.set(classifier, new Map());
            }
            const classifierTypes = colorSpacesByClassifier.get(classifier);

            for (const [, designation] of targetsMap) {
                // Get color space type from the definition(s)
                let type = 'Unknown';
                if (designation.colorSpaceDefinition) {
                    type = designation.colorSpaceDefinition.colorSpaceType;
                } else if (designation.colorSpaceDefinitions) {
                    // For pages with multiple color spaces, collect all types
                    const types = new Set();
                    for (const def of Object.values(designation.colorSpaceDefinitions)) {
                        if (def?.colorSpaceType) {
                            types.add(def.colorSpaceType);
                        }
                    }
                    type = types.size > 0 ? Array.from(types).join('+') : 'Mixed';
                }
                colorSpaceTypes.set(type, (colorSpaceTypes.get(type) || 0) + 1);
                classifierTypes.set(type, (classifierTypes.get(type) || 0) + 1);
            }
        }

        console.log('\n' + '─'.repeat(80));
        console.log('Color Space Summary');
        console.log('─'.repeat(80));

        console.log('\nBy type:');
        for (const [type, count] of colorSpaceTypes) {
            console.log(`  ${type}: ${count}`);
        }

        console.log('\nBy classifier:');
        for (const [classifier, types] of colorSpacesByClassifier) {
            console.log(`  ${classifier}:`);
            for (const [type, count] of types) {
                console.log(`    ${type}: ${count}`);
            }
        }

        // Check for unexpected color spaces
        if (options.expectedColorSpace) {
            const unexpectedTypes = [];
            for (const [type] of colorSpaceTypes) {
                // Allow DeviceGray, Separation, and the expected type
                if (type !== options.expectedColorSpace &&
                    type !== 'DeviceGray' &&
                    type !== 'Separation' &&
                    type !== 'Lab') {
                    unexpectedTypes.push(type);
                }
            }
            if (unexpectedTypes.length > 0) {
                issues.push(`Unexpected color space types found: ${unexpectedTypes.join(', ')}`);
            }
        }

        // Check ICC profiles by searching for ICCBased color spaces
        console.log('\n' + '─'.repeat(80));
        console.log('ICC Profiles');
        console.log('─'.repeat(80));

        // Find ICC profiles from the unique color space records
        const iccProfiles = new Map();
        const records = analysis.uniqueColorSpaceRecords.records;
        for (const [uuid, record] of Object.entries(records)) {
            if (record.colorSpaceDefinition?.colorSpaceType === 'ICCBased' &&
                record.colorSpaceDescriptor instanceof PDFArray) {
                const profileRef = record.colorSpaceDescriptor.get(1);
                if (profileRef) {
                    const refStr = profileRef.toString();
                    if (!iccProfiles.has(refStr)) {
                        const profile = parseICCProfileFromRef(pdfDocument, profileRef);
                        if (profile) {
                            iccProfiles.set(refStr, profile);
                        }
                    }
                }
            }
        }

        if (iccProfiles.size === 0) {
            info.push('No ICC profiles found in document');
        } else {
            console.log(`\nFound ${iccProfiles.size} ICC profile(s):`);
            for (const [ref, profile] of iccProfiles) {
                const header = profile.header;
                console.log(`  ${ref}:`);
                console.log(`    Color Space: ${header.colorSpace}`);
                console.log(`    PCS: ${header.pcs}`);
                console.log(`    Size: ${profile.buffer.byteLength} bytes`);
                if (header.description) {
                    console.log(`    Description: ${header.description}`);
                }
            }
        }

        // Check for expected profile count
        if (options.expectedColorSpace === 'DeviceCMYK' && iccProfiles.size > 1) {
            warnings.push(`Multiple ICC profiles (${iccProfiles.size}) found in document that should use DeviceCMYK`);
        }

        // Check output intent
        console.log('\n' + '─'.repeat(80));
        console.log('Output Intent');
        console.log('─'.repeat(80));

        const catalog = pdfDocument.catalog;
        const outputIntents = catalog.lookup(PDFName.of('OutputIntents'));

        if (outputIntents instanceof PDFArray) {
            console.log(`\nFound ${outputIntents.size()} output intent(s):`);
            for (let i = 0; i < outputIntents.size(); i++) {
                const intent = outputIntents.lookup(i);
                if (intent) {
                    const subtype = intent.get(PDFName.of('S'));
                    const outputCondition = intent.get(PDFName.of('OutputCondition'));
                    const outputConditionIdentifier = intent.get(PDFName.of('OutputConditionIdentifier'));
                    const registryName = intent.get(PDFName.of('RegistryName'));

                    console.log(`  Intent ${i + 1}:`);
                    if (subtype) console.log(`    Subtype: ${subtype.toString()}`);
                    if (outputConditionIdentifier) console.log(`    Identifier: ${outputConditionIdentifier.toString()}`);
                    if (outputCondition) console.log(`    Condition: ${outputCondition.toString()}`);
                    if (registryName) console.log(`    Registry: ${registryName.toString()}`);
                }
            }
        } else {
            info.push('No output intent defined');
        }

        // Dump images if requested
        if (options.dumpImages) {
            console.log('\n' + '─'.repeat(80));
            console.log('Images');
            console.log('─'.repeat(80));

            // Find all XObject images
            const imagesByClassifier = colorSpacesByClassifier.get('XObjectImage');
            if (imagesByClassifier && imagesByClassifier.size > 0) {
                console.log(`\nImage color spaces:`);
                for (const [type, count] of imagesByClassifier) {
                    console.log(`  ${type}: ${count} images`);
                }
            } else {
                console.log('\nNo XObject images found');
            }

            // Detailed image info
            if (options.verbose) {
                const pages = pdfDocument.getPages();
                let imageCount = 0;

                for (let i = 0; i < pages.length; i++) {
                    const page = pages[i];
                    const resources = page.node.Resources();
                    if (!resources) continue;

                    const xObjects = resources.lookup(PDFName.of('XObject'));
                    if (!xObjects) continue;

                    const entries = xObjects.entries();
                    for (const [name, ref] of entries) {
                        const xObj = pdfDocument.context.lookup(ref);
                        if (!xObj || !xObj.dict) continue;

                        const subtype = xObj.dict.get(PDFName.of('Subtype'));
                        if (subtype?.toString() !== '/Image') continue;

                        imageCount++;
                        const metadata = extractImageMetadata(xObj);

                        console.log(`\n  Image ${imageCount} (Page ${i + 1}, ${name.toString()}):`);
                        console.log(`    Dimensions: ${metadata.width}×${metadata.height}`);
                        console.log(`    BitsPerComponent: ${metadata.bitsPerComponent}`);
                        console.log(`    Filter: ${metadata.filter || 'None'}`);

                        // Get color space
                        const colorSpace = xObj.dict.get(PDFName.of('ColorSpace'));
                        if (colorSpace) {
                            if (colorSpace instanceof PDFName) {
                                console.log(`    ColorSpace: ${colorSpace.toString()}`);
                            } else if (colorSpace instanceof PDFArray) {
                                const csType = colorSpace.get(0);
                                console.log(`    ColorSpace: ${csType?.toString() || 'Array'}`);
                            } else {
                                console.log(`    ColorSpace: (ref)`);
                            }
                        }
                    }
                }
            }
        }

        // Dump content stream colors if requested
        if (options.dumpContent) {
            console.log('\n' + '─'.repeat(80));
            console.log('Content Stream Colors');
            console.log('─'.repeat(80));

            const pages = pdfDocument.getPages();
            for (let i = 0; i < Math.min(pages.length, options.verbose ? pages.length : 3); i++) {
                const page = pages[i];
                const pageColors = analyzePageColors(page.node, page.ref, pdfDocument);

                // Group by type and get unique values
                const colorsByType = new Map();
                for (const parsedStream of pageColors.parsedStreams) {
                    for (const chunk of parsedStream.parseResult?.chunks || []) {
                        if (!chunk.values) continue;

                        const type = chunk.type;
                        if (!colorsByType.has(type)) {
                            colorsByType.set(type, new Set());
                        }

                        const valueStr = chunk.values.map(v => v.toFixed(3)).join(',');
                        colorsByType.get(type).add(valueStr);
                    }
                }

                console.log(`\nPage ${i + 1}:`);
                for (const [type, values] of colorsByType) {
                    console.log(`  ${type}: ${values.size} unique color(s)`);
                    if (options.verbose && values.size <= 10) {
                        for (const v of values) {
                            console.log(`    [${v}]`);
                        }
                    }
                }
            }
        }

        // Summary
        console.log('\n' + '═'.repeat(80));
        console.log('Validation Summary');
        console.log('═'.repeat(80));

        console.log('\nInfo:');
        for (const item of info) {
            console.log(`  ℹ️  ${item}`);
        }

        if (warnings.length > 0) {
            console.log('\nWarnings:');
            for (const warning of warnings) {
                console.log(`  ⚠️  ${warning}`);
            }
        }

        if (issues.length > 0) {
            console.log('\nIssues:');
            for (const issue of issues) {
                console.log(`  ❌ ${issue}`);
            }
            console.log('\n' + '═'.repeat(80));
            console.log('VALIDATION FAILED');
            console.log('═'.repeat(80) + '\n');
            process.exit(1);
        } else {
            console.log('\n' + '═'.repeat(80));
            console.log('VALIDATION PASSED');
            console.log('═'.repeat(80) + '\n');
        }

    } catch (error) {
        console.error('\nError:', error.message);
        if (options.verbose) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
