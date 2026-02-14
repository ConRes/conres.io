// @ts-check
/**
 * Bootstrap Worker Entrypoint — Runs the entire generation pipeline off the main thread.
 *
 * This module worker receives generation inputs via postMessage, runs
 * TestFormPDFDocumentGenerator.generate(), and posts back progress updates
 * and the final result (PDF ArrayBuffer + metadata JSON).
 *
 * @module bootstrap-worker-entrypoint
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { setCurrentContext } from '../services/helpers/runtime.js';
import { TestFormPDFDocumentGenerator } from './classes/test-form-pdf-document-generator.js';

setCurrentContext('Bootstrap');

/**
 * @typedef {import('./classes/test-form-pdf-document-generator.js').UserMetadata} UserMetadata
 * @typedef {import('./classes/test-form-pdf-document-generator.js').AssetResources} AssetResources
 */

/**
 * Message types received from the main thread:
 *
 * - `generate`: Start generation with provided inputs.
 *   Payload: { type: 'generate', taskId, testFormVersion, resources?, iccProfileBuffer,
 *              userMetadata, debugging, outputBitsPerComponent, useWorkers,
 *              processingStrategy }
 *
 * Message types sent to the main thread:
 *
 * - `ready`: Worker is loaded and ready to accept tasks.
 * - `progress`: Progress update. Payload: { type: 'progress', taskId, stage, percent, message }
 * - `download-progress`: Download progress. Payload: { type: 'download-progress', taskId, state }
 * - `chain-output`: Separate chain PDF output. Payload: { type: 'chain-output', taskId, colorSpace, pdfBuffer, metadataJSON }
 * - `result`: Generation complete. Payload: { type: 'result', taskId, pdfBuffer, metadataJSON }
 * - `error`: Generation failed. Payload: { type: 'error', taskId, message, stack }
 */

self.onmessage = async (event) => {
    const data = event.data;

    if (data.type === 'generate') {
        await handleGenerate(data);
    }
};

/**
 * Handles a generation task.
 *
 * @param {object} data
 * @param {number} data.taskId
 * @param {string} data.testFormVersion
 * @param {AssetResources} [data.resources]
 * @param {ArrayBuffer} data.iccProfileBuffer
 * @param {UserMetadata | null} data.userMetadata
 * @param {boolean} data.debugging
 * @param {8 | 16 | undefined} data.outputBitsPerComponent
 * @param {boolean} data.useWorkers
 * @param {'in-place' | 'separate-chains' | 'recombined-chains'} data.processingStrategy
 */
async function handleGenerate(data) {
    const { taskId } = data;

    try {
        const generator = new TestFormPDFDocumentGenerator({
            testFormVersion: data.testFormVersion,
            resources: data.resources,
            debugging: data.debugging,
            outputBitsPerComponent: data.outputBitsPerComponent,
            useWorkers: data.useWorkers,
            processingStrategy: data.processingStrategy,
        });

        const result = await generator.generate(
            data.iccProfileBuffer,
            data.userMetadata,
            {
                onProgress: (stage, percent, message) => {
                    self.postMessage({
                        type: 'progress',
                        taskId,
                        stage,
                        percent,
                        message,
                    });
                },
                onDownloadProgress: (state) => {
                    self.postMessage({
                        type: 'download-progress',
                        taskId,
                        state,
                    });
                },
                onChainOutput: data.processingStrategy === 'separate-chains'
                    ? async (colorSpace, pdfBuffer, metadataJSON) => {
                        self.postMessage(
                            {
                                type: 'chain-output',
                                taskId,
                                colorSpace,
                                pdfBuffer,
                                metadataJSON,
                            },
                            // Transfer the PDF buffer to avoid copying
                            [pdfBuffer],
                        );
                    }
                    : undefined,
            },
        );

        /** @type {Transferable[]} */
        const transferables = [];
        if (result.pdfBuffer) transferables.push(result.pdfBuffer);

        self.postMessage(
            {
                type: 'result',
                taskId,
                pdfBuffer: result.pdfBuffer,
                metadataJSON: result.metadataJSON,
            },
            transferables,
        );
    } catch (error) {
        self.postMessage({
            type: 'error',
            taskId,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
    }
}

// Signal readiness
self.postMessage({ type: 'ready' });
