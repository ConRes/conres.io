// @ts-check
/// <reference types="emscripten" />

import GhostscriptModule from "../packages/ghostscript-wasm/gs.js";
import { prepareInputResources, mkdirRecursiveWithFS } from "../helpers.js";

/**
 * Service for Ghostscript operations
 */
export class GhostscriptService {
    /** @type {Record<Uppercase<string>, {name: string, arguments: string[]}>} */
    static #slugsColorSpaceArguments = {
        'GRAY': {
            name: 'Gray',
            arguments: "-sProcessColorModel=DeviceGray -sColorConversionStrategy=Gray -dRenderIntent=1 -dBlackPtComp=1".split(' '),
        },
        'RGB': {
            name: 'RGB',
            arguments: "-sProcessColorModel=DeviceRGB -sColorConversionStrategy=RGB -dRenderIntent=1 -dBlackPtComp=1 -dKPreserve=0 -dVectorKPreserve=0 -dTextKPreserve=0".split(' '),
        },
        'CMYK': {
            name: 'CMYK',
            arguments: "-sProcessColorModel=DeviceCMYK -sColorConversionStrategy=CMYK -dRenderIntent=1 -dBlackPtComp=1 -dKPreserve=2".split(' '),
        },
    };

    /**
     * Generates slugs PDF using Ghostscript
     * @param {Record<string, ArrayBuffer>} resources - Map of resources
     * @param {string} colorSpace - The color space (Gray, RGB, or CMYK)
     * @param {boolean} debugging - Whether to enable debugging
     * @returns {Promise<ArrayBuffer>} - The generated PDF buffer
     */
    static async generateSlugsPDF(resources, colorSpace, debugging = false) {
        const { arguments: colorSpaceArguments } = GhostscriptService.#slugsColorSpaceArguments[`${colorSpace}`.toUpperCase()];
        if (!colorSpaceArguments) {
            const supported = Object.keys(GhostscriptService.#slugsColorSpaceArguments);
            const joined = supported.length <= 1
                ? supported[0] ?? 'none'
                : supported.slice(0, -1).join(', ') + ' and ' + supported[supported.length - 1];
            throw new Error(
                `Ghostscript rendered slugs currently support ${joined} only. ` +
                `Got: "${colorSpace}"`
            );
        }

        // Load Ghostscript module
        /** @type {EmscriptenModule & { FS: typeof FS; callMain: (argv: string[]) => number}} */
        const ghostscriptModule = await GhostscriptModule({ noInitialRun: true });

        // Prepare input resources for Ghostscript
        /** @type {Record<string, import('../helpers.js').InputResource>} */
        const inputResources = {};

        for (const asset of ['Barcode.ps', 'Slugs.ps']) {
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
            "-dPDFSETTINGS=/printer",
            "-dCompatibilityLevel=1.7",
            "-dAutoRotatePages=/None",
            ...colorSpaceArguments,
            "/input/Slugs.ps",
        ]);

        if (exitCode !== 0) {
            throw new Error(`Ghostscript failed with exit code ${exitCode}`);
        }

        // Read the output file
        return ghostscriptModule.FS.readFile("/output/Slugs.pdf").slice().buffer;
    }

    /**
     * Re-process a PDF through Ghostscript to embed fonts.
     *
     * GS substitutes its bundled NimbusSans for Helvetica references
     * and embeds the font subsets. This resolves the PDF/X-4 "font not
     * embedded" violation for standard fonts that pdf-lib cannot embed.
     *
     * @param {Uint8Array | ArrayBuffer} pdfBytes - The input PDF
     * @returns {Promise<ArrayBuffer>} - The output PDF with fonts embedded
     */
    static async embedFontsInPDF(pdfBytes) {
        /** @type {EmscriptenModule & { FS: typeof FS; callMain: (argv: string[]) => number}} */
        const ghostscriptModule = await GhostscriptModule({ noInitialRun: true });

        try { ghostscriptModule.FS.mkdir('/input'); } catch { /* exists */ }
        try { ghostscriptModule.FS.mkdir('/output'); } catch { /* exists */ }

        ghostscriptModule.FS.writeFile('/input/doc.pdf', new Uint8Array(pdfBytes));

        const exitCode = await ghostscriptModule.callMain([
            '-dBATCH', '-dNOPAUSE', '-dNOSAFER',
            '-sDEVICE=pdfwrite',
            '-sOutputFile=/output/doc.pdf',
            '-dCompatibilityLevel=1.7',
            '-dEmbedAllFonts=true',
            '-dSubsetFonts=true',
            '-dAutoRotatePages=/None',
            '/input/doc.pdf',
        ]);

        if (exitCode !== 0) {
            throw new Error(`Ghostscript font embedding failed with exit code ${exitCode}`);
        }

        return ghostscriptModule.FS.readFile('/output/doc.pdf').slice().buffer;
    }

    /**
     * Processes PostScript data with Ghostscript
     * @param {string} slugTemplateText - The slug template text
     * @param {{ pages: Array<{ metadata: { title?: string, variant?: string, colorSpace?: string, resolution?: { values?: number[], value?: number, unit?: string } } }> }} slugData - Data to inject into the template
     * @param {{slugs?: Partial<Record<'device'|'colorants'|'substrate'|'settings'|'email', string>>, renderingIntent?: string, profileCategory?: string, outputProfileName?: string, timestamp?: string}} metadata - Metadata for the slug
     * @returns {string} - The processed PostScript
     */
    static processSlugTemplate(slugTemplateText, slugData, metadata) {
        let slugSourceText = slugTemplateText;

        // Detect template support for OutputParameters (rendering intent + output profile on separate line)
        const templateSupportsOutputParameters = slugSourceText.includes('OutputParameters');

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
                            resolution: { values, value = values?.join('/'), unit } = /** @type {Partial<{ values: number[], value: number, unit: string }>} */({}),
                        },
                    }) => {
                        const inputParameters = [colorSpace, `${value || ""}${unit || ""}`].filter(Boolean);
                        const outputParameters = [metadata?.renderingIntent, metadata?.outputProfileName].filter(Boolean);

                        return [
                            "$<indent><<",
                            title && `$<indent>  /Title (${title})`,
                            variant && `$<indent>  /Variant (${variant})`,
                            ...(templateSupportsOutputParameters
                                ? [
                                    inputParameters.length > 0 && `$<indent>  /Parameters (${inputParameters.join(" - ")})`,
                                    outputParameters.length > 0 && `$<indent>  /OutputParameters (${outputParameters.join(" - ")})`,
                                ]
                                : [
                                    (inputParameters.length > 0 || outputParameters.length > 0) &&
                                    `$<indent>  /Parameters (${[...inputParameters, ...outputParameters].join(" - ")})`,
                                ]),
                            "$<indent>>>",
                        ]
                            .filter(Boolean)
                            .join("\n");
                    }
                )
                .join("\n")
        );

        // Replace slug header/footer
        slugSourceText = /^(?<indent>[ \t]*)%\|[ \t]+\{\{Slug\}\}.*?$/m[Symbol.replace](
            slugSourceText,
            [
                `$<indent>/SlugHeader (${[
                    "Slug CR 20250322",
                    metadata?.profileCategory,
                ]
                    .filter(Boolean)
                    .join(" - ")}) def`,
                `$<indent>/SlugFooter (${[
                    metadata?.slugs?.email ?? "user@example.com",
                    /^(?<YYYY>\d{4})-(?<MM>\d{2})-(?<DD>\d{2})T(?<hh>\d{2}):(?<mm>\d{2}):(?<ss>\d{2})\.\d+Z$/[
                        Symbol.replace
                    ](metadata?.timestamp ?? new Date().toISOString(), "$<YYYY>-$<MM>-$<DD> $<hh>:$<mm>:$<ss>"),
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
