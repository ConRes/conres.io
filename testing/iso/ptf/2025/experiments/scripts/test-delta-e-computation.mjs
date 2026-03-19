#!/usr/bin/env node
// @ts-check
/**
 * Test script to exercise the Delta-E computation code path.
 * Compares two PDFs with different output profiles to ensure
 * the non-binary-match path is tested.
 */

import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
    PDFDocument,
    PDFRawStream,
    PDFDict,
    PDFArray,
    PDFName,
    decodePDFRawStream,
} from 'pdf-lib';

import { ComparisonsCoordinator } from './classes/comparisons-coordinator.mjs';
import { DeltaEMetrics } from './classes/delta-e-metrics.mjs';
import { ImageSampler } from './classes/image-sampler.mjs';
import { ImageLabConverter } from './classes/image-lab-converter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, '../output/2026-02-02-001');

// Test files with different output profiles (should have actual differences)
const PDF_1 = resolve(OUTPUT_DIR, '2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - K-Only GCR - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-02-001).pdf');
const PDF_2 = resolve(OUTPUT_DIR, '2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - eciCMYK v2 - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-02-001).pdf');

/**
 * Extract Output Intent ICC profile from PDF.
 */
function extractOutputIntentProfile(pdfDocument) {
    const catalog = pdfDocument.catalog;
    const outputIntentsRef = catalog.get(PDFName.of('OutputIntents'));

    if (!outputIntentsRef) return null;

    const outputIntents = pdfDocument.context.lookup(outputIntentsRef);
    if (!(outputIntents instanceof PDFArray) || outputIntents.size() === 0) return null;

    const intentRef = outputIntents.get(0);
    const intent = pdfDocument.context.lookup(intentRef);

    if (!(intent instanceof PDFDict)) return null;

    const destProfileRef = intent.get(PDFName.of('DestOutputProfile'));
    if (!destProfileRef) return null;

    const destProfile = pdfDocument.context.lookup(destProfileRef);
    if (!(destProfile instanceof PDFRawStream)) return null;

    const decoded = decodePDFRawStream(destProfile);
    const profileData = decoded.decode();

    return profileData instanceof Uint8Array ? profileData : new Uint8Array(profileData);
}

/**
 * Extract first image from PDF.
 */
function extractFirstImage(pdfDocument) {
    const pages = pdfDocument.getPages();
    const page = pages[0].node;
    const context = pdfDocument.context;

    const resourcesRef = page.get(PDFName.of('Resources'));
    if (!resourcesRef) return null;

    const resources = context.lookup(resourcesRef);
    if (!(resources instanceof PDFDict)) return null;

    const xobjectRef = resources.get(PDFName.of('XObject'));
    if (!xobjectRef) return null;

    const xobjects = context.lookup(xobjectRef);
    if (!(xobjects instanceof PDFDict)) return null;

    const entries = xobjects.entries();
    for (const [nameObj, ref] of entries) {
        const xobject = context.lookup(ref);
        if (!(xobject instanceof PDFRawStream)) continue;

        const dict = xobject.dict;
        const subtype = dict.get(PDFName.of('Subtype'));
        if (!(subtype instanceof PDFName) || subtype.asString() !== '/Image') continue;

        const widthObj = dict.get(PDFName.of('Width'));
        const heightObj = dict.get(PDFName.of('Height'));

        const width = widthObj?.asNumber?.() ?? 0;
        const height = heightObj?.asNumber?.() ?? 0;

        if (width === 0 || height === 0) continue;

        const decoded = decodePDFRawStream(xobject);
        const pixelData = decoded.decode();

        return {
            name: nameObj instanceof PDFName ? nameObj.asString().replace('/', '') : 'Unknown',
            width,
            height,
            channels: 4, // Assume CMYK for output PDFs
            pixelData: pixelData instanceof Uint8Array ? pixelData : new Uint8Array(pixelData),
        };
    }

    return null;
}

async function main() {
    console.log('Testing Delta-E Computation Path');
    console.log('================================\n');

    // Load PDFs
    console.log('Loading PDFs...');
    const [pdf1Bytes, pdf2Bytes] = await Promise.all([
        readFile(PDF_1),
        readFile(PDF_2),
    ]);

    const pdf1 = await PDFDocument.load(pdf1Bytes, { updateMetadata: false });
    const pdf2 = await PDFDocument.load(pdf2Bytes, { updateMetadata: false });

    console.log('  PDF 1: K-Only GCR');
    console.log('  PDF 2: Relative Colorimetric');

    // Extract Output Intent profile (same for both since same destination profile)
    const profile = extractOutputIntentProfile(pdf1);
    if (!profile) {
        throw new Error('No Output Intent profile found');
    }
    console.log(`\nOutput Intent profile: ${profile.length} bytes`);

    // Extract first image from each PDF
    const image1 = extractFirstImage(pdf1);
    const image2 = extractFirstImage(pdf2);

    if (!image1 || !image2) {
        throw new Error('Could not extract images from PDFs');
    }

    console.log(`\nImage 1: ${image1.name} (${image1.width}×${image1.height})`);
    console.log(`Image 2: ${image2.name} (${image2.width}×${image2.height})`);

    // Check for binary match (should NOT be a match)
    let binaryMatch = image1.pixelData.length === image2.pixelData.length;
    if (binaryMatch) {
        for (let i = 0; i < image1.pixelData.length; i++) {
            if (image1.pixelData[i] !== image2.pixelData[i]) {
                binaryMatch = false;
                break;
            }
        }
    }
    console.log(`\nBinary match: ${binaryMatch}`);

    if (binaryMatch) {
        console.log('\nWARNING: Images are binary identical. Delta-E computation will not be meaningful.');
        console.log('Try with different PDF files.');
        return;
    }

    // Initialize components
    console.log('\nInitializing components...');

    const coordinator = new ComparisonsCoordinator({ metrics: [DeltaEMetrics] });
    console.log(`  Coordinator: ${coordinator.metricNames.join(', ')}`);

    const sampler = new ImageSampler({
        sampling: { type: 'random', count: 5000 },
        samplingTypes: DeltaEMetrics.metricDefinitions.samplingTypes,
    });
    console.log(`  Sampler: ${sampler.getSamplingConfigs()[0]?.name}`);

    const labConverter = new ImageLabConverter({
        intent: 'relative-colorimetric',
        blackPointCompensation: true,
    });
    await labConverter.initialize();
    console.log('  Lab Converter: initialized');

    // Sample pixels
    console.log('\nSampling pixels...');
    const sampling = sampler.sample(image1.width, image1.height);
    console.log(`  Method: ${sampling.method}`);
    console.log(`  Total pixels: ${sampling.totalPixels}`);
    console.log(`  Sampled: ${sampling.sampledCount}`);

    // Convert to Lab
    console.log('\nConverting to Lab...');
    const lab1 = labConverter.convertAtIndices(
        image1.pixelData,
        image1.width,
        image1.height,
        image1.channels,
        profile,
        sampling.indices,
        'image1'
    );
    console.log(`  Image 1 Lab: ${lab1.length / 3} pixels`);

    const lab2 = labConverter.convertAtIndices(
        image2.pixelData,
        image2.width,
        image2.height,
        image2.channels,
        profile,
        sampling.indices,
        'image2'
    );
    console.log(`  Image 2 Lab: ${lab2.length / 3} pixels`);

    // Compute Delta-E
    console.log('\nComputing Delta-E...');
    const metrics = coordinator.createMetrics('Delta-E', {
        metrics: ['Average', 'Maximum', 'Minimum', 'PassRate'],
        threshold: 3.0,
    });

    metrics.setReference({
        name: image1.name,
        dimensions: { width: image1.width, height: image1.height },
        colorSpace: 'DeviceCMYK',
    });

    metrics.setSample({
        name: image2.name,
        dimensions: { width: image2.width, height: image2.height },
        colorSpace: 'DeviceCMYK',
    });

    metrics.setSamplingMethod(sampling.method);

    // Add from pixel arrays
    metrics.addFromPixelArrays(lab1, lab2, Array.from({ length: sampling.indices.length }, (_, i) => i));

    // Get results
    const result = metrics.getMetrics();

    console.log('\n========================================');
    console.log('DELTA-E RESULTS');
    console.log('========================================');
    console.log(`Formula: ${result.formula}`);
    console.log(`Threshold: ${result.threshold}`);
    console.log(`Sample Count: ${result.sampleCount}`);
    console.log(`Sampling Method: ${result.samplingMethod}`);
    console.log('\nMetrics:');
    for (const m of result.metrics) {
        console.log(`  ${m.name}: ${m.value.toFixed(4)}`);
    }

    // Cleanup
    labConverter.dispose();

    console.log('\n========================================');
    console.log('TEST COMPLETE - Delta-E path exercised');
    console.log('========================================');
}

main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
