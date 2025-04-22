// @ts-check
/// <reference types="emscripten" />

import GhostscriptModule from "../packages/ghostscript-wasm/gs.js";
import { prepareInputResources, mkdirRecursiveWithFS } from "../helpers.js";

/**
 * Service for Ghostscript operations
 */
export class GhostscriptService {
    /**
     * Generates slugs PDF using Ghostscript
     * @param {Record<string, ArrayBuffer>} resources - Map of resources
     * @param {string} colorSpace - The color space (RGB or CMYK)
     * @param {boolean} debugging - Whether to enable debugging
     * @returns {Promise<ArrayBuffer>} - The generated PDF buffer
     */
    static async generateSlugsPDF(resources, colorSpace, debugging = false) {
        // Load Ghostscript module
        /** @type {EmscriptenModule & { FS: typeof FS; callMain: (argv: string[]) => number}} */
        const ghostscriptModule = await GhostscriptModule({ noInitialRun: true });

        // Prepare input resources for Ghostscript
        /** @type {Record<string, import('../helpers.js').InputResource>} */
        const inputResources = {};

        for (const asset of ['Barcode.ps', 'Slugs.ps', 'Output.icc']) {
            const pathname = `/input/${asset}`;
            const buffer = resources[`input/${asset}`];

            if (!buffer) throw new Error(`Missing resource: input/${asset}`);

            inputResources[`input/${asset}`] = {
                pathname,
                data: new Uint8Array(buffer),
            };
        }

        // Set up filesystem and prepare resources
        await prepareInputResources(ghostscriptModule.FS, inputResources);
        mkdirRecursiveWithFS(ghostscriptModule.FS, `/output/`);

        // Run Ghostscript with appropriate parameters
        const exitCode = await ghostscriptModule.callMain([
            "-dBATCH",
            "-dNOPAUSE",
            "-dNOSAFER",
            "-sDEVICE=pdfwrite",
            "-sOutputFile=/output/Slugs.pdf",
            "-sOutputICCProfile=/input/Output.icc",
            "-dPDFSETTINGS=/printer",
            "-dCompatibilityLevel=1.7",
            "-dAutoRotatePages=/None",
            ...colorSpace === 'RGB'
                ? "-sProcessColorModel=DeviceRGB -sColorConversionStrategy=RGB -dRenderIntent=1 -dBlackPtComp=1 -dKPreserve=0 -dVectorKPreserve=0 -dTextKPreserve=0".split(' ')
                : "-sProcessColorModel=DeviceCMYK -sColorConversionStrategy=CMYK -dRenderIntent=1 -dBlackPtComp=1 -dKPreserve=2".split(' '),
            "/input/Slugs.ps",
        ]);

        if (exitCode !== 0) {
            throw new Error(`Ghostscript failed with exit code ${exitCode}`);
        }

        // Read the output file
        return ghostscriptModule.FS.readFile("/output/Slugs.pdf").slice().buffer;
    }

    /**
     * Processes PostScript data with Ghostscript
     * @param {string} slugTemplateText - The slug template text
     * @param {object} slugData - Data to inject into the template
     * @param {object} metadata - Metadata for the slug
     * @returns {string} - The processed PostScript
     */
    static processSlugTemplate(slugTemplateText, slugData, metadata) {
        let slugSourceText = slugTemplateText;

        // Replace slug metadata
        slugSourceText = /^(?<indent>[ \t]*)%\|[ \t]+\{\{Slugs\}\}.*?$/m[Symbol.replace](
            slugSourceText,
            slugData.pages
                .map(
                    ({
                        metadata: {
                            title,
                            // @ts-ignore
                            variant,
                            colorSpace,
                            resolution: { value, unit } = /** @type {Partial<{ value: number, unit: string }>} */({}),
                        },
                    }) =>
                        [
                            "$<indent><<",
                            title && `$<indent>  /Title (${title})`,
                            variant && `$<indent>  /Variant (${variant})`,
                            (colorSpace || value) &&
                            `$<indent>  /Parameters (${[
                                colorSpace,
                                `${value || ""}${unit || ""}`,
                            ]
                                .filter(Boolean)
                                .join(" - ")})`,
                            "$<indent>>>",
                        ]
                            .filter(Boolean)
                            .join("\n")
                )
                .join("\n")
        );

        // Replace slug header/footer
        slugSourceText = /^(?<indent>[ \t]*)%\|[ \t]+\{\{Slug\}\}.*?$/m[Symbol.replace](
            slugSourceText,
            [
                `$<indent>/SlugHeader (Slug CR 20250322) def`,
                `$<indent>/SlugFooter (${[
                    metadata?.slugs?.email ?? "user@example.com",
                    /^(?<YYYY>\d{4})-(?<MM>\d{2})-(?<DD>\d{2})T(?<hh>\d{2}):(?<mm>\d{2}):(?<ss>\d{2})\.\d+Z$/[
                        Symbol.replace
                    ](new Date().toISOString(), "$<YYYY>-$<MM>-$<DD> $<hh>:$<mm>:$<ss>"),
                ]
                    .filter(Boolean)
                    .join(" ")}) def`,
            ].join("\n")
        );

        // Fix file paths
        slugSourceText = slugSourceText.replace(
            "(Barcode.ps)",
            "(/input/Barcode.ps)"
        );

        return slugSourceText;
    }
}
