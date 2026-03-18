#!/usr/bin/env node
// @ts-check
/**
 * Compare Implementations Script
 *
 * Compares output between legacy and new class-based implementations
 * to verify parity. Reports differences in timing, file size, and
 * content (via hash comparison).
 *
 * Output naming convention:
 *   <original-filename> - Comparison - Legacy - <profile> (<folder-id>).pdf
 *   <original-filename> - Comparison - Refactored - <profile> (<folder-id>).pdf
 *
 * @module compare-implementations
 */
import { argv, exit } from 'process';
import { fileURLToPath } from 'url';
import { dirname, join, basename, extname, resolve } from 'path';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Main
// ============================================================================

async function main() {
    const args = argv.slice(2);

    // Parse arguments
    const pdfPath = args.find(a => a.endsWith('.pdf'));
    const profilePath = args.find(a => a.endsWith('.icc'));
    const outputDirArg = args.find(a => a.startsWith('--output-dir='))?.split('=')[1] ||
                         args[args.indexOf('--output-dir') + 1];
    const verbose = args.includes('--verbose');
    const keepOutput = args.includes('--keep-output');

    if (!pdfPath || !profilePath) {
        console.log(`
Compare Implementations Script

Compares output between legacy and new class-based PDF color conversion.

Usage:
  node compare-implementations.js <input.pdf> <profile.icc> [options]

Options:
  --output-dir <dir>  Output directory for comparison PDFs
  --verbose           Show detailed output
  --keep-output       Keep output files for manual inspection

Output Naming:
  <original-filename> - Comparison - Legacy - <profile> (<folder-id>).pdf
  <original-filename> - Comparison - Refactored - <profile> (<folder-id>).pdf

Examples:
  node compare-implementations.js document.pdf profile.icc --output-dir ../output/2026-01-22-006
  node compare-implementations.js document.pdf profile.icc --verbose --keep-output
`);
        exit(1);
    }

    if (!existsSync(pdfPath)) {
        console.error(`Error: PDF not found: ${pdfPath}`);
        exit(1);
    }
    if (!existsSync(profilePath)) {
        console.error(`Error: ICC profile not found: ${profilePath}`);
        exit(1);
    }

    // Determine output directory
    const outputDir = outputDirArg
        ? resolve(process.cwd(), outputDirArg)
        : join(__dirname, '../output/compare-implementations');

    if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
    }

    // Extract folder ID from output dir (e.g., "output/2026-01-22-006" -> "2026-01-22-006")
    const folderIdMatch = outputDir.match(/(\d{4}-\d{2}-\d{2}-\d{3})$/);
    const folderId = folderIdMatch ? folderIdMatch[1] : basename(outputDir);

    // Extract profile name and original filename
    const profileName = basename(profilePath, extname(profilePath));
    const originalFilename = basename(pdfPath, '.pdf');

    // Determine rendering intent based on profile type
    const isCMYKProfile = profileName.toLowerCase().includes('cmyk') ||
                         profileName.toLowerCase().includes('ecicmyk') ||
                         profileName.toLowerCase().includes('fogra');
    const renderingIntent = isCMYKProfile
        ? 'preserve-k-only-relative-colorimetric-gcr'
        : 'relative-colorimetric';
    const intentName = isCMYKProfile ? 'K-Only GCR' : 'Relative Colorimetric';

    // Generate output filenames with proper naming convention
    const legacyOutputPath = join(outputDir, `${originalFilename} - Comparison - Legacy - ${profileName} (${folderId}).pdf`);
    const newOutputPath = join(outputDir, `${originalFilename} - Comparison - Refactored - ${profileName} (${folderId}).pdf`);

    console.log(`Compare Implementations`);
    console.log(`=======================`);
    console.log(`PDF: ${pdfPath}`);
    console.log(`Profile: ${profilePath} (${isCMYKProfile ? 'CMYK' : 'RGB'})`);
    console.log(`Rendering Intent: ${intentName}`);
    console.log(`Output Dir: ${outputDir}`);
    console.log('');

    // Load dependencies for new implementation
    const { PDFDocument } = await import('pdf-lib');
    const { PDFDocumentColorConverter } = await import('../../classes/pdf-document-color-converter.js');
    const { ICCService } = await import('../../services/ICCService.js');

    // Load input files
    const pdfBytes = await readFile(pdfPath);
    const profileBytes = await readFile(profilePath);
    const destinationProfile = /** @type {ArrayBuffer} */ (profileBytes.buffer.slice(
        profileBytes.byteOffset,
        profileBytes.byteOffset + profileBytes.byteLength
    ));

    // Parse profile header
    const destHeader = ICCService.parseICCHeaderFromSource(profileBytes);
    /** @type {'CMYK' | 'RGB'} */
    const outputColorSpace = /** @type {'CMYK' | 'RGB'} */ (destHeader.colorSpace ?? (isCMYKProfile ? 'CMYK' : 'RGB'));

    // Run legacy implementation
    console.log('Running legacy implementation...');
    const legacyStart = performance.now();
    const legacyResult = spawnSync('node', [
        join(__dirname, '../convert-pdf-color.js'),
        pdfPath,
        profilePath,
        legacyOutputPath,
        '--legacy',
        isCMYKProfile ? '--intent=k-only' : '--intent=relative',
    ], {
        cwd: __dirname,
        encoding: 'utf-8',
        timeout: 300000, // 5 minute timeout
    });

    const legacyTime = performance.now() - legacyStart;

    if (legacyResult.status !== 0) {
        console.error('Legacy implementation failed:');
        console.error(legacyResult.stderr || legacyResult.stdout);
        exit(1);
    }
    if (verbose) {
        console.log(legacyResult.stdout);
    }
    console.log(`  Legacy completed in ${legacyTime.toFixed(0)}ms`);
    console.log(`  Output: ${basename(legacyOutputPath)}`);

    // Run new implementation
    console.log('Running new class-based implementation...');
    const newStart = performance.now();

    const pdfDocument = await PDFDocument.load(pdfBytes, { updateMetadata: false });

    const converter = new PDFDocumentColorConverter({
        renderingIntent: /** @type {any} */ (renderingIntent),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile,
        destinationColorSpace: outputColorSpace,
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: false,
    });

    let newTime = 0;
    try {
        await converter.ensureReady();
        const result = await converter.convertColor({ pdfDocument }, {});

        newTime = performance.now() - newStart;
        console.log(`  New completed in ${newTime.toFixed(0)}ms`);
        console.log(`    Images: ${result.imagesConverted}, Streams: ${result.contentStreamsConverted}`);

        if (result.errors.length > 0) {
            console.log(`    Errors: ${result.errors.length}`);
            if (verbose) {
                for (const error of result.errors) {
                    console.log(`      - ${error}`);
                }
            }
        }

        // Update transparency blending color space
        const { PDFService } = await import('../../services/PDFService.js');
        await PDFService.replaceTransarencyBlendingSpaceInPDFDocument(pdfDocument, outputColorSpace);

        // Set output intent
        const profileDescription = destHeader.description || profileName;
        PDFService.setOutputIntentForPDFDocument(pdfDocument, {
            subType: 'GTS_PDFX',
            iccProfile: profileBytes,
            identifier: profileDescription,
            info: profileDescription,
        });

        // Save new output
        const outputBytes = await pdfDocument.save();
        await writeFile(newOutputPath, outputBytes);
        console.log(`  Output: ${basename(newOutputPath)}`);
    } finally {
        converter.dispose();
    }

    // Compare outputs
    console.log('\nComparing outputs...');

    const legacyBytes = await readFile(legacyOutputPath);
    const newBytes = await readFile(newOutputPath);

    const legacyHash = createHash('sha256').update(legacyBytes).digest('hex').slice(0, 16);
    const newHash = createHash('sha256').update(newBytes).digest('hex').slice(0, 16);

    const sizeDiff = newBytes.length - legacyBytes.length;
    const sizeDiffPercent = ((sizeDiff / legacyBytes.length) * 100).toFixed(2);

    console.log('\nResults:');
    console.log('─'.repeat(60));
    console.log(`  Legacy output: ${legacyBytes.length.toLocaleString()} bytes (hash: ${legacyHash}...)`);
    console.log(`  New output:    ${newBytes.length.toLocaleString()} bytes (hash: ${newHash}...)`);
    console.log('');
    console.log(`  Time - Legacy: ${legacyTime.toFixed(0)}ms`);
    console.log(`  Time - New:    ${newTime.toFixed(0)}ms`);
    console.log(`  Speedup:       ${(legacyTime / newTime).toFixed(2)}x`);
    console.log('');
    console.log(`  Size diff:     ${sizeDiff > 0 ? '+' : ''}${sizeDiff.toLocaleString()} bytes (${sizeDiffPercent}%)`);
    console.log(`  Hash match:    ${legacyHash === newHash ? '✓ IDENTICAL' : '✗ DIFFERENT'}`);
    console.log('─'.repeat(60));

    if (legacyHash !== newHash) {
        console.log('\n⚠️  Output files differ. This may be due to:');
        console.log('   - Different compression settings');
        console.log('   - Different object ordering');
        console.log('   - Actual conversion differences');
        console.log('\n   Use --keep-output to inspect the files manually.');
    }

    // Cleanup unless --keep-output or --output-dir specified
    if (!keepOutput && !outputDirArg) {
        try {
            await unlink(legacyOutputPath);
            await unlink(newOutputPath);
        } catch {
            // Ignore cleanup errors
        }
    } else {
        console.log(`\nOutput files saved:`);
        console.log(`  Legacy:     ${legacyOutputPath}`);
        console.log(`  Refactored: ${newOutputPath}`);
    }

    // Generate comparison report
    if (outputDirArg) {
        const reportLines = [
            '# Comparison Report',
            '',
            `Generated: ${new Date().toISOString()}`,
            '',
            '## Input',
            '',
            `- **PDF:** ${originalFilename}`,
            `- **Profile:** ${profileName} (${outputColorSpace})`,
            `- **Rendering Intent:** ${intentName}`,
            '',
            '## Results',
            '',
            '| Implementation | Time (ms) | Size | Hash |',
            '|----------------|-----------|------|------|',
            `| Legacy | ${legacyTime.toFixed(0)} | ${formatFileSize(legacyBytes.length)} | ${legacyHash}... |`,
            `| Refactored | ${newTime.toFixed(0)} | ${formatFileSize(newBytes.length)} | ${newHash}... |`,
            '',
            '## Comparison',
            '',
            `- **Speedup:** ${(legacyTime / newTime).toFixed(2)}x`,
            `- **Size Difference:** ${sizeDiff > 0 ? '+' : ''}${sizeDiff.toLocaleString()} bytes (${sizeDiffPercent}%)`,
            `- **Hash Match:** ${legacyHash === newHash ? 'IDENTICAL' : 'DIFFERENT'}`,
            '',
            '## Output Files',
            '',
            `- \`${basename(legacyOutputPath)}\``,
            `- \`${basename(newOutputPath)}\``,
        ];

        const reportPath = join(outputDir, `${originalFilename} - Comparison - ${profileName} (${folderId}).md`);
        await writeFile(reportPath, reportLines.join('\n'));
        console.log(`\nReport: ${basename(reportPath)}`);
    }
}

/**
 * Format file size
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

main().catch(error => {
    console.error('Error:', error.message);
    if (process.env.DEBUG) {
        console.error(error.stack);
    }
    exit(1);
});
