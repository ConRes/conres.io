#!/usr/bin/env node
// @ts-check
/**
 * PDF Conversion Worker
 *
 * Worker thread script for parallel PDF color conversion.
 * Receives conversion task via workerData, performs conversion, returns result.
 *
 * Used by matrix-benchmark.js with --parallel flag.
 *
 * IMPORTANT: This worker receives all paths from the parent thread.
 * It does NOT resolve paths on its own - all paths are absolute.
 */

// =============================================================================
// AGENT RESTRICTIONS - READ BEFORE MODIFYING
// =============================================================================
//
// This worker receives ALL paths from the parent thread via workerData:
// - testFormPath: absolute path to PDF
// - profilePath: absolute path to ICC profile
// - enginePath: absolute path to color engine package
// - outputPath: absolute path for output file
// - servicesDir: absolute path to services directory
//
// DO NOT add any path resolution logic to this worker.
// If paths don't work, the problem is in the parent script, not here.
//
// The parent (matrix-benchmark.js) is responsible for:
// - Resolving user paths relative to CWD
// - Converting all paths to absolute before passing to worker
// - Passing servicesDir for service imports
//
// =============================================================================

import { workerData, parentPort } from 'worker_threads';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join, basename, extname } from 'path';
import { PDFDocument } from 'pdf-lib';

/**
 * @typedef {{
 *   testFormPath: string,
 *   profilePath: string,
 *   enginePath: string,
 *   outputPath: string,
 *   servicesDir: string,
 *   verbose: boolean,
 *   taskId: number,
 * }} ConversionTask
 */

/**
 * Run a single PDF conversion
 * @param {ConversionTask} task
 */
async function runConversion(task) {
    const start = performance.now();
    const profileName = basename(task.profilePath, extname(task.profilePath));

    // Validate required paths
    if (!task.servicesDir) {
        throw new Error('servicesDir not provided in workerData. Parent script must pass servicesDir.');
    }

    try {
        // Dynamically import the color engine and services
        const engineIndexPath = join(task.enginePath, 'src', 'index.js');
        await import(engineIndexPath);

        // Import services using path from parent
        const { ColorEngineService } = await import(join(task.servicesDir, 'ColorEngineService.js'));
        const { PDFService } = await import(join(task.servicesDir, 'PDFService.js'));
        const { ICCService } = await import(join(task.servicesDir, 'ICCService.js'));

        // Load PDF
        const pdfBytes = await readFile(task.testFormPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);

        // Load destination profile
        const profileBytes = await readFile(task.profilePath);
        const destinationProfile = profileBytes.buffer.slice(
            profileBytes.byteOffset,
            profileBytes.byteOffset + profileBytes.byteLength
        );

        // Determine rendering intent based on profile type
        const isCMYKProfile = profileName.toLowerCase().includes('cmyk') ||
                             profileName.toLowerCase().includes('ecicmyk') ||
                             profileName.toLowerCase().includes('fogra');
        const renderingIntent = isCMYKProfile
            ? 'preserve-k-only-relative-colorimetric-gcr'
            : 'relative-colorimetric';

        // Create color engine service
        const colorEngine = new ColorEngineService();

        // Convert colors
        await PDFService.convertColorInPDFDocument(pdfDoc, {
            destinationProfile,
            renderingIntent,
            convertImages: true,
            convertContentStreams: true,
            verbose: task.verbose,
            colorEngineService: colorEngine,
        });

        // Parse profile header to get color space and description
        const destHeader = ICCService.parseICCHeaderFromSource(profileBytes);
        const outputColorSpace = destHeader.colorSpace ?? 'CMYK';

        // Update transparency blending color space to match output
        await PDFService.replaceTransarencyBlendingSpaceInPDFDocument(pdfDoc, outputColorSpace);

        // Set output intent with the destination profile
        const profileDescription = destHeader.description || profileName;
        PDFService.setOutputIntentForPDFDocument(pdfDoc, {
            subType: 'GTS_PDFX',
            iccProfile: profileBytes,
            identifier: profileDescription,
            info: profileDescription,
        });

        // Save output
        const outputBytes = await pdfDoc.save();
        await mkdir(dirname(task.outputPath), { recursive: true });
        await writeFile(task.outputPath, outputBytes);

        return {
            taskId: task.taskId,
            success: true,
            timeMs: performance.now() - start,
            outputSize: outputBytes.length,
            outputPath: task.outputPath,
        };

    } catch (error) {
        return {
            taskId: task.taskId,
            success: false,
            timeMs: performance.now() - start,
            error: error.message,
            outputPath: task.outputPath,
        };
    }
}

// Main worker entry point
async function main() {
    if (!workerData) {
        console.error('No workerData provided');
        process.exit(1);
    }

    const result = await runConversion(workerData);
    parentPort?.postMessage(result);
}

main().catch(err => {
    parentPort?.postMessage({
        taskId: workerData?.taskId ?? -1,
        success: false,
        error: err.message,
        timeMs: 0,
    });
});
