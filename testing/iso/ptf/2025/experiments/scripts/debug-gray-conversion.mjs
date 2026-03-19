/**
 * Debug script to trace Gray image conversion.
 * Identifies why Gray → CMYK with K-Only GCR is outputting all K=0.
 */

import { readFile } from 'fs/promises';
import { PDFDocument, PDFRawStream, PDFName, PDFRef, PDFArray } from 'pdf-lib';
import pako from 'pako';

const pdfPath = process.argv[2] || '../../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf';
const imageName = process.argv[3] || 'Im3';

console.log(`=== Debug Gray Conversion for ${imageName} ===\n`);

// Initialize ColorEngineService
const { ColorEngineService } = await import('../../services/ColorEngineService.js');
const colorEngine = new ColorEngineService();

// Load PDF and find the Gray image
const pdfBytes = await readFile(pdfPath);
const pdf = await PDFDocument.load(pdfBytes);
const context = pdf.context;

const page = pdf.getPages()[0];
const pageDict = page.node.dict;
const resources = pageDict.get(PDFName.of('Resources'));
const resourcesDict = resources instanceof PDFRef ? context.lookup(resources) : resources;
const xobject = resourcesDict?.get(PDFName.of('XObject'));
const xobjectDict = xobject instanceof PDFRef ? context.lookup(xobject) : xobject;

// Find the Gray image
let imageStream = null;
let grayProfile = null;
let imageWidth = 0;
let imageHeight = 0;
let imageBPC = 8;

for (const [name, ref] of xobjectDict.entries()) {
    if (name.asString().replace(/^\//, '') !== imageName) continue;

    const obj = context.lookup(ref);
    if (!(obj instanceof PDFRawStream)) continue;

    imageStream = obj;
    const dict = obj.dict;
    imageWidth = dict.get(PDFName.of('Width'))?.asNumber?.() || 0;
    imageHeight = dict.get(PDFName.of('Height'))?.asNumber?.() || 0;
    imageBPC = dict.get(PDFName.of('BitsPerComponent'))?.asNumber?.() || 8;

    // Extract color space
    const colorSpace = dict.get(PDFName.of('ColorSpace'));
    let cs = colorSpace instanceof PDFRef ? context.lookup(colorSpace) : colorSpace;

    if (cs instanceof PDFArray) {
        const items = cs.asArray();
        const typeName = items[0]?.asString?.();

        if (typeName === '/ICCBased') {
            const profileRef = items[1];
            if (profileRef instanceof PDFRef) {
                const profileStream = context.lookup(profileRef);
                if (profileStream instanceof PDFRawStream) {
                    const filter = profileStream.dict.get(PDFName.of('Filter'));
                    const isCompressed = filter?.asString?.() === '/FlateDecode';
                    const profileData = isCompressed
                        ? pako.inflate(profileStream.contents)
                        : profileStream.contents;

                    grayProfile = profileData.buffer.slice(
                        profileData.byteOffset,
                        profileData.byteOffset + profileData.byteLength
                    );

                    console.log('Gray ICC profile:');
                    console.log(`  N: ${profileStream.dict.get(PDFName.of('N'))?.asNumber?.()}`);
                    console.log(`  Size: ${grayProfile.byteLength} bytes`);

                    // Check ICC header
                    const header = new Uint8Array(grayProfile);
                    const csBytes = String.fromCharCode(...header.slice(16, 20)).trim();
                    console.log(`  ICC ColorSpace: ${csBytes}`);
                }
            }
        }
    }
    break;
}

if (!imageStream || !grayProfile) {
    console.log('Could not find Gray image or profile');
    process.exit(1);
}

console.log(`\nImage: ${imageWidth}×${imageHeight}, BPC ${imageBPC}`);

// Decompress image data
const filter = imageStream.dict.get(PDFName.of('Filter'));
const isCompressed = filter?.asString?.() === '/FlateDecode';
let pixelData = imageStream.contents;
if (isCompressed) {
    pixelData = pako.inflate(pixelData);
}

console.log(`Pixel data: ${pixelData.length} bytes`);
console.log(`First 20 pixels: [${Array.from(pixelData.slice(0, 20)).join(', ')}]`);

// Check for non-white pixels
let nonWhiteCount = 0;
let minValue = 255;
let maxValue = 0;
for (let i = 0; i < pixelData.length; i++) {
    if (pixelData[i] < 255) nonWhiteCount++;
    if (pixelData[i] < minValue) minValue = pixelData[i];
    if (pixelData[i] > maxValue) maxValue = pixelData[i];
}
console.log(`Non-white pixels: ${nonWhiteCount}/${pixelData.length} (${(nonWhiteCount / pixelData.length * 100).toFixed(1)}%)`);
console.log(`Value range: ${minValue}-${maxValue}`);

// Test direct conversion with ColorEngineService
console.log('\n=== Testing ColorEngineService ===\n');

// Load destination CMYK profile
const cmykProfilePath = '../../tests/fixtures/profiles/eciCMYK v2.icc';
const cmykProfileBuffer = (await readFile(cmykProfilePath)).buffer;
console.log(`CMYK profile: ${cmykProfileBuffer.byteLength} bytes`);

// Test converting a few pixels
const testPixels = new Uint8Array([0, 64, 128, 192, 255]);
console.log(`\nTest input pixels: [${Array.from(testPixels).join(', ')}]`);

try {
    // Test 1: Gray ICC → CMYK with K-Only GCR (direct)
    console.log('\n1. Gray ICC → CMYK (K-Only GCR, direct):');
    const result1 = await colorEngine.convertPixelBuffer(testPixels, {
        sourceProfile: grayProfile,
        destinationProfile: cmykProfileBuffer,
        inputType: 'Gray',
        outputType: 'CMYK',
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        blackPointCompensation: true,
    });
    console.log(`   Output: ${Array.from(result1.outputPixels).join(', ')}`);
    formatCMYKOutput(result1.outputPixels, 5);

    // Test 2: Gray ICC → CMYK with K-Only GCR (multiprofile, 2-profile)
    console.log('\n2. Gray ICC → CMYK (K-Only GCR, multiprofile 2-profile):');
    const result2 = await colorEngine.convertPixelBufferMultiprofile(testPixels, {
        profiles: [grayProfile, cmykProfileBuffer],
        inputType: 'Gray',
        outputType: 'CMYK',
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        blackPointCompensation: true,
    });
    console.log(`   Output: ${Array.from(result2.outputPixels).join(', ')}`);
    formatCMYKOutput(result2.outputPixels, 5);

    // Test 2b: Gray ICC → sRGB → CMYK with K-Only GCR (multiprofile, 3-profile - old engine)
    console.log('\n2b. Gray ICC → sRGB → CMYK (K-Only GCR, multiprofile 3-profile - old engine):');
    const result2b = await colorEngine.convertPixelBufferMultiprofile(testPixels, {
        profiles: [grayProfile, 'sRGB', cmykProfileBuffer],
        inputType: 'Gray',
        outputType: 'CMYK',
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        blackPointCompensation: true,
    });
    console.log(`   Output: ${Array.from(result2b.outputPixels).join(', ')}`);
    formatCMYKOutput(result2b.outputPixels, 5);

    // Test 3: sGray → CMYK with K-Only GCR
    console.log('\n3. sGray → CMYK (K-Only GCR, direct):');
    const result3 = await colorEngine.convertPixelBuffer(testPixels, {
        sourceProfile: 'sGray',
        destinationProfile: cmykProfileBuffer,
        inputType: 'Gray',
        outputType: 'CMYK',
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        blackPointCompensation: true,
    });
    console.log(`   Output: ${Array.from(result3.outputPixels).join(', ')}`);
    formatCMYKOutput(result3.outputPixels, 5);

    // Test 4: Check if the image colorSpaceInfo extraction is working
    console.log('\n4. What refactored pipeline extracts:');
    console.log('   colorSpaceInfo.type: ICCBased-Gray');
    console.log(`   colorSpaceInfo.sourceProfile: ArrayBuffer (${grayProfile.byteLength} bytes)`);
    console.log('   colorSpace (after mapping): Gray');

} catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
}

function formatCMYKOutput(data, pixelCount) {
    for (let i = 0; i < pixelCount && i * 4 < data.length; i++) {
        const offset = i * 4;
        console.log(`   Pixel ${i}: C=${data[offset]} M=${data[offset + 1]} Y=${data[offset + 2]} K=${data[offset + 3]}`);
    }
}

colorEngine.dispose();
