// @ts-check
/**
 * Factory for creating the appropriate document color converter
 * based on the configured engine version.
 *
 * @module createDocumentColorConverter
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { PDFDocumentColorConverter } from './pdf-document-color-converter.js';
import { DEFAULT_ENGINE_VERSION } from './color-engine-provider.js';

/**
 * Creates the appropriate document color converter for the given engine version.
 *
 * Selects PDFDocumentColorConverter (>= 2026-02-14) or LegacyPDFDocumentColorConverter
 * (<= 2026-01-30) based on the configured engine version. Sets appropriate configuration
 * defaults for each engine variant.
 *
 * @param {import('./pdf-document-color-converter.js').PDFDocumentColorConverterConfiguration} configuration
 * @returns {Promise<PDFDocumentColorConverter>}
 */
export async function createDocumentColorConverter(configuration) {
    const engineVersion = configuration.engineVersion ?? DEFAULT_ENGINE_VERSION;

    if (PDFDocumentColorConverter.isColorEngineSupported(engineVersion)) {
        // New engine (>= 2026-02-14): engine-side BPC clamping, no Lab coercion needed
        return new PDFDocumentColorConverter({
            ...configuration,
            blackpointCompensationClamping: configuration.blackpointCompensationClamping ?? true,
        });
    }

    const { LegacyPDFDocumentColorConverter } = await import('./legacy/legacy-pdf-document-color-converter.js');

    if (LegacyPDFDocumentColorConverter.isColorEngineSupported(engineVersion)) {
        // Legacy engine (<= 2026-01-30): consumer-side adaptive BPC, Lab coercion
        return new LegacyPDFDocumentColorConverter({
            ...configuration,
            blackpointCompensationClamping: configuration.blackpointCompensationClamping ?? false,
            useAdaptiveBPCClamping: configuration.useAdaptiveBPCClamping ?? true,
            coerceLabAbsoluteZeroPixels: configuration.coerceLabAbsoluteZeroPixels ?? true,
        });
    }

    throw new Error(`No converter supports engine version "${engineVersion}"`);
}
