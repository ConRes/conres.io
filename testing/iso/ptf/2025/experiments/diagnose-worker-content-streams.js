#!/usr/bin/env node
// @ts-check
/**
 * Diagnose worker content stream conversion issues
 *
 * Compares:
 * 1. Color space definitions extracted per page
 * 2. Content stream parsing results
 * 3. Color conversion results (worker vs main thread)
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKSPACE_ROOT = resolve(__dirname, '../../../../../..');

// Import services
const PDFLib = await import(resolve(WORKSPACE_ROOT, 'testing/iso/ptf/2025/packages/pdf-lib/pdf-lib.esm.js'));
const { PDFDocument, PDFDict, PDFName, PDFArray, PDFRef, PDFRawStream } = PDFLib;

const ColorConversionUtils = await import(resolve(WORKSPACE_ROOT, 'testing/iso/ptf/2025/services/ColorConversionUtils.js'));
const LittleCMS = await import(resolve(WORKSPACE_ROOT, 'testing/iso/ptf/2025/packages/color-engine/src/index.js'));
const pako = await import('pako');

// Test PDF path
const TEST_PDF_PATH = resolve(WORKSPACE_ROOT, 'assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map.pdf');

// ICC Profile path
const ICC_PROFILE_PATH = resolve(WORKSPACE_ROOT, 'testing/iso/ptf/fixtures/profiles/eciCMYK v2.icc');

async function main() {
    console.log('='.repeat(80));
    console.log('DIAGNOSE WORKER CONTENT STREAM CONVERSION');
    console.log('='.repeat(80));

    // Load PDF
    console.log('\n1. Loading PDF...');
    const pdfBytes = await fs.readFile(TEST_PDF_PATH);
    const pdfDocument = await PDFDocument.load(pdfBytes);
    console.log(`   Loaded: ${TEST_PDF_PATH}`);
    console.log(`   Pages: ${pdfDocument.getPageCount()}`);

    // Load ICC profile
    const profileBuffer = await fs.readFile(ICC_PROFILE_PATH);
    const destProfile = new Uint8Array(profileBuffer);
    console.log(`   Profile: ${ICC_PROFILE_PATH}`);

    // Create color engine
    const colorEngine = await LittleCMS.createEngine();
    const sourceRGBProfile = colorEngine.createSRGBProfile();
    const sourceGrayProfile = colorEngine.createGray2Profile();

    const context = pdfDocument.context;
    const pages = pdfDocument.getPages();

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        console.log('\n' + '='.repeat(80));
        console.log(`PAGE ${pageIndex + 1}`);
        console.log('='.repeat(80));

        const page = pages[pageIndex];
        const pageRef = page.ref;
        const pageDict = context.lookup(pageRef);

        if (!(pageDict instanceof PDFDict)) {
            console.log('   ERROR: Page dict not found');
            continue;
        }

        // Extract color space definitions
        const colorSpaceDefinitions = extractPageColorSpaceDefinitions(pageDict, context);
        console.log('\n2. Color Space Definitions:');
        if (Object.keys(colorSpaceDefinitions).length === 0) {
            console.log('   (none)');
        } else {
            for (const [name, def] of Object.entries(colorSpaceDefinitions)) {
                console.log(`   ${name}: ${def.colorSpaceType}${def.range ? ` range=[${def.range.join(', ')}]` : ''}`);
            }
        }

        // Get content streams
        const contents = pageDict.get(PDFName.of('Contents'));
        if (!contents) {
            console.log('   No content streams');
            continue;
        }

        const contentRefs = contents instanceof PDFArray
            ? contents.asArray()
            : [contents];

        console.log(`\n3. Content Streams: ${contentRefs.length}`);

        for (let streamIndex = 0; streamIndex < contentRefs.length; streamIndex++) {
            const contentRef = contentRefs[streamIndex];
            const stream = context.lookup(contentRef);

            if (!(stream instanceof PDFRawStream)) {
                console.log(`   Stream ${streamIndex}: not a raw stream`);
                continue;
            }

            // Decompress
            const compressedData = stream.contents;
            let streamText;
            try {
                const inflated = pako.default.inflate(compressedData);
                streamText = new TextDecoder().decode(inflated);
            } catch (e) {
                streamText = new TextDecoder().decode(compressedData);
            }

            console.log(`\n   Stream ${streamIndex} (${streamText.length} chars):`);

            // Parse colors
            const parseResult = ColorConversionUtils.parseContentStreamColors(streamText);
            const colorChunks = parseResult.chunks.filter(c =>
                c.type !== 'head' && c.type !== 'string' && c.type !== 'colorspace'
            );

            console.log(`   Color chunks found: ${colorChunks.length}`);

            // Analyze each color chunk
            const colorsByType = { gray: [], rgb: [], cmyk: [], indexed: [], unknown: [] };

            for (const chunk of colorChunks) {
                const category = colorsByType[chunk.type] ?? colorsByType.unknown;
                category.push(chunk);
            }

            for (const [type, chunks] of Object.entries(colorsByType)) {
                if (chunks.length > 0) {
                    console.log(`   ${type}: ${chunks.length} colors`);
                    // Show first few examples
                    for (const chunk of chunks.slice(0, 3)) {
                        const values = chunk.values ? `[${chunk.values.join(', ')}]` : '';
                        const name = chunk.name ? ` name=${chunk.name}` : '';
                        console.log(`      ${chunk.operator}: ${values}${name}`);

                        // Determine source type
                        const { sourceType, colorSpaceDef } = ColorConversionUtils.determineSourceColorType(
                            { type: chunk.type, values: chunk.values, name: chunk.name },
                            colorSpaceDefinitions
                        );
                        console.log(`         -> sourceType: ${sourceType ?? 'null (passthrough)'}`);
                        if (colorSpaceDef) {
                            console.log(`         -> colorSpaceDef: ${colorSpaceDef.colorSpaceType}`);
                        }
                    }
                    if (chunks.length > 3) {
                        console.log(`      ... and ${chunks.length - 3} more`);
                    }
                }
            }

            // Now test conversion
            console.log('\n   Testing conversion with worker-like flow:');

            const destProfileHandle = colorEngine.openProfileFromMem(destProfile);

            const result = await ColorConversionUtils.convertContentStreamColors(streamText, {
                colorSpaceDefinitions,
                colorEngine,
                renderingIntent: ColorConversionUtils.RENDERING_INTENTS.PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
                flags: ColorConversionUtils.ENGINE_FLAGS.BLACKPOINT_COMPENSATION,
                sourceRGBProfile,
                sourceGrayProfile,
                destinationProfile: destProfileHandle,
                verbose: false,
            });

            console.log(`   Replacement count: ${result.replacementCount}`);

            // Show first few changes
            if (result.newText !== streamText) {
                // Find differences
                const parseOriginal = ColorConversionUtils.parseContentStreamColors(streamText);
                const parseNew = ColorConversionUtils.parseContentStreamColors(result.newText);

                const origColors = parseOriginal.chunks.filter(c =>
                    c.type !== 'head' && c.type !== 'string' && c.type !== 'colorspace'
                );
                const newColors = parseNew.chunks.filter(c =>
                    c.type !== 'head' && c.type !== 'string' && c.type !== 'colorspace'
                );

                console.log(`   Original color operations: ${origColors.length}`);
                console.log(`   New color operations: ${newColors.length}`);

                // Show first few conversions
                let shown = 0;
                for (let i = 0; i < Math.min(origColors.length, newColors.length) && shown < 5; i++) {
                    const orig = origColors[i];
                    const newC = newColors[i];

                    // Skip if same
                    if (orig.raw === newC.raw) continue;

                    console.log(`\n   Example conversion ${shown + 1}:`);
                    console.log(`      Original: ${orig.operator} ${orig.values?.join(', ') ?? orig.name ?? ''}`);
                    console.log(`      New:      ${newC.operator} ${newC.values?.join(', ') ?? newC.name ?? ''}`);
                    shown++;
                }
            }

            colorEngine.closeProfile(destProfileHandle);
        }
    }

    colorEngine.closeProfile(sourceRGBProfile);
    colorEngine.closeProfile(sourceGrayProfile);

    console.log('\n' + '='.repeat(80));
    console.log('DIAGNOSIS COMPLETE');
    console.log('='.repeat(80));
}

/**
 * Extract color space definitions from page resources
 * (Same logic as WorkerColorConversion.js)
 */
function extractPageColorSpaceDefinitions(pageDict, context) {
    const definitions = {};

    const resources = pageDict.get(PDFName.of('Resources'));
    if (!resources) return definitions;

    const resourcesDict = resources instanceof PDFRef
        ? context.lookup(resources)
        : resources;
    if (!(resourcesDict instanceof PDFDict)) return definitions;

    const colorSpaceDict = resourcesDict.get(PDFName.of('ColorSpace'));
    if (!colorSpaceDict) return definitions;

    const csDict = colorSpaceDict instanceof PDFRef
        ? context.lookup(colorSpaceDict)
        : colorSpaceDict;
    if (!(csDict instanceof PDFDict)) return definitions;

    const entries = csDict.entries();
    for (const [key, value] of entries) {
        const csName = key.asString().replace(/^\//, '');

        let csDescriptor = value;
        if (csDescriptor instanceof PDFRef) {
            csDescriptor = context.lookup(csDescriptor);
        }

        if (csDescriptor instanceof PDFName) {
            definitions[csName] = {
                colorSpaceType: csDescriptor.asString().replace(/^\//, ''),
            };
        } else if (csDescriptor instanceof PDFArray && csDescriptor.size() > 0) {
            const csType = csDescriptor.get(0);
            if (csType instanceof PDFName) {
                const typeName = csType.asString().replace(/^\//, '');
                const def = { colorSpaceType: typeName };

                if (typeName === 'Lab' && csDescriptor.size() > 1) {
                    const labDict = csDescriptor.get(1);
                    const labDictResolved = labDict instanceof PDFRef
                        ? context.lookup(labDict)
                        : labDict;

                    if (labDictResolved instanceof PDFDict) {
                        const rangeArray = labDictResolved.get(PDFName.of('Range'));
                        if (rangeArray instanceof PDFArray) {
                            def.range = rangeArray.asArray().map(n => n.asNumber?.() ?? 0);
                        } else {
                            def.range = [-100, 100, -100, 100];
                        }
                    }
                }

                definitions[csName] = def;
            }
        }
    }

    return definitions;
}

main().catch(console.error);
