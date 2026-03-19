/**
 * Debug script to trace image color conversion in the refactored pipeline.
 * Identifies where sRGB, sGray, and Lab images are failing.
 */

import { readFile } from 'fs/promises';
import { PDFDocument, PDFRawStream, PDFName, PDFArray, PDFRef, decodePDFRawStream } from 'pdf-lib';
import pako from 'pako';

const pdfPath = process.argv[2] || '../../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf';

console.log('=== Debug Image Conversion ===\n');
console.log('Loading PDF:', pdfPath);

const pdfBytes = await readFile(pdfPath);
const pdf = await PDFDocument.load(pdfBytes);
const context = pdf.context;

// Get first page
const page = pdf.getPages()[0];
const pageDict = page.node.dict;

// Get Resources/XObject dictionary
const resources = pageDict.get(PDFName.of('Resources'));
const resourcesDict = resources instanceof PDFRef ? context.lookup(resources) : resources;
const xobject = resourcesDict?.get(PDFName.of('XObject'));
const xobjectDict = xobject instanceof PDFRef ? context.lookup(xobject) : xobject;

if (!xobjectDict) {
    console.log('No XObject dictionary found');
    process.exit(1);
}

console.log('\n=== Image XObjects ===\n');

// Helper: decompress stream
function getDecompressedContents(stream) {
    const filter = stream.dict.get(PDFName.of('Filter'));
    const contents = stream.contents;

    if (filter instanceof PDFName && filter.asString() === '/FlateDecode') {
        try {
            return pako.inflate(contents);
        } catch (e) {
            console.log('    Failed to decompress:', e.message);
        }
    }
    return contents;
}

// Helper: get ICC color space from profile header
function getICCColorSpace(profileData) {
    if (profileData.length < 20) return 'Unknown';
    const csBytes = profileData.slice(16, 20);
    const cs = String.fromCharCode(...csBytes).trim();
    return cs;
}

// Examine each image
for (const [name, ref] of xobjectDict.entries()) {
    const imageName = name.asString().replace(/^\//, '');

    if (!(ref instanceof PDFRef)) continue;
    const obj = context.lookup(ref);
    if (!(obj instanceof PDFRawStream)) continue;

    const dict = obj.dict;
    const subtype = dict.get(PDFName.of('Subtype'));
    if (!(subtype instanceof PDFName) || subtype.asString() !== '/Image') continue;

    console.log(`\n--- ${imageName} (${ref.toString()}) ---`);

    // Basic image properties
    const width = dict.get(PDFName.of('Width'))?.asNumber?.() || '?';
    const height = dict.get(PDFName.of('Height'))?.asNumber?.() || '?';
    const bpc = dict.get(PDFName.of('BitsPerComponent'))?.asNumber?.() || '?';
    console.log(`  Dimensions: ${width}×${height}, BPC: ${bpc}`);

    // Color space analysis
    const colorSpace = dict.get(PDFName.of('ColorSpace'));
    let cs = colorSpace;
    if (cs instanceof PDFRef) {
        cs = context.lookup(cs);
    }

    let colorSpaceType = 'Unknown';
    let components = 0;
    let sourceProfile = null;
    let sourceProfileType = null;

    if (cs instanceof PDFName) {
        colorSpaceType = cs.asString();
        if (colorSpaceType === '/DeviceRGB') {
            components = 3;
            sourceProfileType = 'built-in sRGB';
        } else if (colorSpaceType === '/DeviceGray') {
            components = 1;
            sourceProfileType = 'built-in sGray';
        } else if (colorSpaceType === '/DeviceCMYK') {
            components = 4;
            sourceProfileType = 'no conversion needed';
        }
    } else if (cs instanceof PDFArray) {
        const items = cs.asArray();
        const first = items[0];

        if (first instanceof PDFName) {
            const typeName = first.asString();
            colorSpaceType = typeName;

            if (typeName === '/ICCBased') {
                const profileRef = items[1];
                if (profileRef instanceof PDFRef) {
                    const profileStream = context.lookup(profileRef);
                    if (profileStream instanceof PDFRawStream) {
                        const n = profileStream.dict.get(PDFName.of('N'))?.asNumber?.() || 0;
                        components = n;

                        // Get actual profile data
                        const profileData = getDecompressedContents(profileStream);
                        const iccColorSpace = getICCColorSpace(profileData);

                        console.log(`  ICC Profile: N=${n}, ICC ColorSpace=${iccColorSpace}`);
                        console.log(`  Profile size: ${profileData.length} bytes`);

                        // First 128 bytes of profile header for debugging
                        const headerPreview = Array.from(profileData.slice(0, 20))
                            .map(b => b.toString(16).padStart(2, '0'))
                            .join(' ');
                        console.log(`  Profile header: ${headerPreview}...`);

                        sourceProfile = profileData;
                        sourceProfileType = `ICC ArrayBuffer (${profileData.length} bytes)`;
                    }
                }
            } else if (typeName === '/Lab') {
                colorSpaceType = '/Lab';
                components = 3;
                sourceProfileType = 'built-in Lab';

                // Check for Range parameter
                const labDict = items[1];
                const labDictResolved = labDict instanceof PDFRef ? context.lookup(labDict) : labDict;
                if (labDictResolved?.get) {
                    const rangeArray = labDictResolved.get(PDFName.of('Range'));
                    if (rangeArray instanceof PDFArray) {
                        const range = rangeArray.asArray().map(n => n.asNumber?.() ?? 0);
                        console.log(`  Lab Range: [${range.join(', ')}]`);
                    }
                }
            } else if (typeName === '/Indexed') {
                colorSpaceType = '/Indexed';
                components = 1;  // Indexed images have 1 component (the index)

                // Get base color space
                let baseCs = items[1];
                if (baseCs instanceof PDFRef) {
                    baseCs = context.lookup(baseCs);
                }
                console.log(`  Base ColorSpace: ${baseCs?.asString?.() || baseCs?.constructor?.name || 'unknown'}`);
            }
        }
    }

    console.log(`  ColorSpace: ${colorSpaceType}, Components: ${components}`);
    console.log(`  Source Profile: ${sourceProfileType}`);

    // Check image data
    const filter = dict.get(PDFName.of('Filter'));
    const isCompressed = filter?.asString?.() === '/FlateDecode';
    const rawSize = obj.contents.length;
    console.log(`  Compressed: ${isCompressed}, Raw size: ${rawSize} bytes`);

    // Decompress and check pixel data
    if (components > 0 && width !== '?' && height !== '?') {
        const expectedPixels = width * height * components;
        const expectedBytes = expectedPixels * (bpc / 8);

        try {
            const decoded = isCompressed ? pako.inflate(obj.contents) : obj.contents;
            console.log(`  Decompressed: ${decoded.length} bytes, Expected: ~${Math.floor(expectedBytes)} bytes`);

            // Sample some pixel values
            const samples = [];
            const bytesPerPixel = components;
            for (let i = 0; i < 5 && i * bytesPerPixel < decoded.length; i++) {
                const offset = i * bytesPerPixel;
                const pixel = Array.from(decoded.slice(offset, offset + bytesPerPixel));
                samples.push(`[${pixel.join(',')}]`);
            }
            console.log(`  First 5 pixels: ${samples.join(' ')}`);

            // Sample from middle
            const midOffset = Math.floor(decoded.length / 2);
            const midPixel = Array.from(decoded.slice(midOffset, midOffset + bytesPerPixel));
            console.log(`  Middle pixel: [${midPixel.join(',')}]`);
        } catch (e) {
            console.log(`  Failed to decode: ${e.message}`);
        }
    }

    // Map to what refactored code would see
    console.log('\n  -> What refactored code should extract:');

    const typeMapping = {
        '/DeviceRGB': { type: 'DeviceRGB', profile: "'sRGB' (string)" },
        '/DeviceGray': { type: 'DeviceGray', profile: "'sGray' (string)" },
        '/DeviceCMYK': { type: 'DeviceCMYK', profile: 'N/A (skip)' },
        '/ICCBased': { type: `ICCBased-${components === 3 ? 'RGB' : components === 1 ? 'Gray' : 'CMYK'}`, profile: 'ArrayBuffer (ICC data)' },
        '/Lab': { type: 'Lab', profile: "'Lab' (string)" },
    };

    const baseType = colorSpaceType.replace(/^\//, '');
    const mapping = typeMapping['/' + baseType] || { type: 'Unknown', profile: 'Unknown' };

    if (colorSpaceType === '/ICCBased') {
        console.log(`     colorSpaceInfo.type: "${mapping.type}"`);
        console.log(`     colorSpaceInfo.sourceProfile: ArrayBuffer (${sourceProfile?.length || 0} bytes)`);
    } else {
        console.log(`     colorSpaceInfo.type: "${mapping.type}"`);
        console.log(`     colorSpaceInfo.sourceProfile: ${mapping.profile}`);
    }
}

console.log('\n\n=== Summary ===');
console.log('Expected behavior:');
console.log('  - DeviceRGB → sourceProfile: "sRGB" (string) → ColorEngineService.createSRGBProfile()');
console.log('  - DeviceGray → sourceProfile: "sGray" (string) → ColorEngineService.createGray2Profile()');
console.log('  - ICCBased → sourceProfile: ArrayBuffer → ColorEngineService.openProfileFromMem()');
console.log('  - Lab → sourceProfile: "Lab" (string) → ColorEngineService.createLab4Profile()');
console.log('\nIf images are failing, check:');
console.log('  1. Is sourceProfile being passed correctly through the pipeline?');
console.log('  2. Is ColorEngineService receiving the right profile type?');
console.log('  3. Is the pixel format (TYPE_RGB_8, TYPE_GRAY_8, TYPE_Lab_8) correct?');
