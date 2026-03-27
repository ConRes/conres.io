#!/usr/bin/env node
// @ts-check
/**
 * Compare color values between two PDFs
 *
 * Extracts unique CMYK color values from content streams and compares them.
 *
 * TODO: This script has MAGIC PATH RESOLUTION that needs normalization.
 * Run from: testing/iso/ptf/2025/experiments/
 */

// =============================================================================
// AGENT RESTRICTIONS - READ BEFORE MODIFYING
// =============================================================================
//
// TODO: This script needs path normalization to be CWD-relative.
// Currently uses __dirname-based paths which is MAGIC.
//
// DO NOT add more magic path resolution patterns.
// If you actively use this script, normalize it first.
//
// =============================================================================

import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream, PDFRef } from '../../packages/pdf-lib/pdf-lib.esm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const experimentsDir = join(__dirname, '..');
const servicesDir = join(experimentsDir, '..', 'services');

// Import color parsing
const { parseContentStreamColors } = await import(join(servicesDir, 'ColorSpaceUtils.js'));

/**
 * Extract all color values from a PDF's content streams
 * @param {PDFDocument} doc
 * @returns {{ type: string, values: number[] }[]}
 */
function extractColorValues(doc) {
    const colors = [];
    const pages = doc.getPages();

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const contentsObj = page.node.lookup(PDFName.of('Contents'));

        const streams = [];
        if (contentsObj instanceof PDFRawStream) {
            streams.push(contentsObj);
        } else if (contentsObj instanceof PDFArray) {
            for (let i = 0; i < contentsObj.size(); i++) {
                const entry = contentsObj.lookup(i);
                const entryObj = entry instanceof PDFRef
                    ? doc.context.lookup(entry)
                    : entry;
                if (entryObj instanceof PDFRawStream) {
                    streams.push(entryObj);
                }
            }
        }

        for (const stream of streams) {
            try {
                const decoded = decodePDFRawStream(stream).decode();
                const text = new TextDecoder().decode(decoded);
                const parseResult = parseContentStreamColors(text);

                for (const chunk of parseResult.chunks) {
                    if (chunk.values && chunk.values.length > 0) {
                        colors.push({
                            page: pageIndex + 1,
                            type: chunk.type,
                            operator: chunk.operator,
                            values: chunk.values,
                        });
                    }
                }
            } catch (e) {
                // Skip failed streams
            }
        }
    }

    return colors;
}

/**
 * Get unique colors keyed by their values
 * @param {{ type: string, values: number[] }[]} colors
 * @returns {Map<string, { type: string, values: number[] }>}
 */
function getUniqueColors(colors) {
    const unique = new Map();
    for (const color of colors) {
        const key = `${color.type}:${color.values.map(v => v.toFixed(3)).join(',')}`;
        if (!unique.has(key)) {
            unique.set(key, color);
        }
    }
    return unique;
}

async function main() {
    console.log('═'.repeat(80));
    console.log('Color Value Comparison');
    console.log('═'.repeat(80));
    console.log();

    // Paths to compare
    const myPDFPath = join(experimentsDir, 'output', '2025-12-18-005', 'Interlaken Map - Contents - eciCMYK v2 - Relative Colorimetric.pdf');
    const acrobatPDFPath = join(experimentsDir, 'output', '2025-12-17-Acrobat', '2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map - eciCMYK v2 - Relative Colorimetric - Acrobat.pdf');

    // Load PDFs
    console.log('Loading my conversion...');
    const myBytes = await readFile(myPDFPath);
    const myDoc = await PDFDocument.load(myBytes);

    console.log('Loading Acrobat reference...');
    const acrobatBytes = await readFile(acrobatPDFPath);
    const acrobatDoc = await PDFDocument.load(acrobatBytes);

    // Extract colors
    console.log('\nExtracting colors from my conversion...');
    const myColors = extractColorValues(myDoc);
    const myUnique = getUniqueColors(myColors);
    console.log(`  Total colors: ${myColors.length}, Unique: ${myUnique.size}`);

    console.log('\nExtracting colors from Acrobat...');
    const acrobatColors = extractColorValues(acrobatDoc);
    const acrobatUnique = getUniqueColors(acrobatColors);
    console.log(`  Total colors: ${acrobatColors.length}, Unique: ${acrobatUnique.size}`);

    // Compare color types
    console.log('\n─'.repeat(80));
    console.log('Color Type Summary');
    console.log('─'.repeat(80));

    const myTypes = {};
    for (const c of myColors) {
        myTypes[c.type] = (myTypes[c.type] || 0) + 1;
    }
    console.log('\nMy conversion:', myTypes);

    const acrobatTypes = {};
    for (const c of acrobatColors) {
        acrobatTypes[c.type] = (acrobatTypes[c.type] || 0) + 1;
    }
    console.log('Acrobat:', acrobatTypes);

    // Sample CMYK values from both
    console.log('\n─'.repeat(80));
    console.log('Sample CMYK Values (first 10 unique)');
    console.log('─'.repeat(80));

    const myCMYK = [...myUnique.values()].filter(c => c.type === 'cmyk').slice(0, 10);
    const acrobatIndexed = [...acrobatUnique.values()].filter(c => c.type === 'indexed').slice(0, 10);

    console.log('\nMy conversion (cmyk):');
    for (const c of myCMYK) {
        console.log(`  ${c.values.map(v => v.toFixed(3)).join(', ')}`);
    }

    console.log('\nAcrobat (indexed - likely CMYK via named colorspace):');
    for (const c of acrobatIndexed) {
        console.log(`  ${c.values.map(v => v.toFixed(3)).join(', ')}`);
    }

    // Save detailed comparison
    const outputDir = join(experimentsDir, 'output', '2025-12-18-003');
    await mkdir(outputDir, { recursive: true });

    const report = {
        myConversion: {
            totalColors: myColors.length,
            uniqueColors: myUnique.size,
            colorTypes: myTypes,
            sampleCMYK: myCMYK.map(c => c.values),
        },
        acrobatReference: {
            totalColors: acrobatColors.length,
            uniqueColors: acrobatUnique.size,
            colorTypes: acrobatTypes,
            sampleIndexed: acrobatIndexed.map(c => c.values),
        },
    };

    const reportPath = join(outputDir, 'color-comparison.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport saved to: ${basename(reportPath)}`);

    console.log('\n═'.repeat(80));
    console.log('Done');
    console.log('═'.repeat(80));
}

main().catch(console.error);
