// @ts-check
/**
 * PDF Validator Worker Entry Point
 *
 * Runs validation off the main thread. Same pattern as
 * generator/bootstrap-worker-entrypoint.js.
 *
 * Messages:
 *   IN:  { type: 'validate', taskId, pdfBuffer }
 *   OUT: { type: 'progress', taskId, stage, percent, message }
 *   OUT: { type: 'report', taskId, report }
 *   OUT: { type: 'fixed', taskId, pdfBuffer, changelog }
 *   OUT: { type: 'error', taskId, message, stack }
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { PDFDocument } from '../packages/pdf-lib/pdf-lib.esm.js';
import { PDFPreflightFixerValidator } from './classes/pdf-preflight-fixer-validator.js';
import { PDFPreflightValidator } from '../classes/baseline/pdf-preflight-validator.js';

/** @type {object | null} */
let rulesCache = null;

/**
 * @returns {Promise<object>}
 */
async function loadRules() {
    if (rulesCache) return rulesCache;
    const response = await fetch(new URL('../classes/configurations/preflight-rules.json', import.meta.url).href);
    rulesCache = await response.json();
    return rulesCache;
}

self.addEventListener('message', async (e) => {
    const { type, taskId, pdfBuffer, approvedFixes } = e.data;

    if (type === 'validate') {
        try {
            self.postMessage({ type: 'progress', taskId, stage: 'loading', percent: 10, message: 'Loading rules...' });
            const rules = await loadRules();

            self.postMessage({ type: 'progress', taskId, stage: 'parsing', percent: 30, message: 'Parsing PDF...' });

            let report;
            try {
                const doc = await PDFDocument.load(pdfBuffer, { updateMetadata: false });

                self.postMessage({ type: 'progress', taskId, stage: 'validating', percent: 60, message: 'Evaluating rules...' });
                const fv = new PDFPreflightFixerValidator(doc, rules);
                report = fv.validate();
            } catch (loadError) {
                report = PDFPreflightValidator.validateLoadError(loadError, rules);
            }

            self.postMessage({ type: 'progress', taskId, stage: 'done', percent: 100, message: 'Complete' });
            self.postMessage({ type: 'report', taskId, report });

        } catch (error) {
            self.postMessage({
                type: 'error',
                taskId,
                message: error.message,
                stack: error.stack,
            });
        }
    }

    if (type === 'fix') {
        try {
            self.postMessage({ type: 'progress', taskId, stage: 'loading', percent: 10, message: 'Loading rules...' });
            const rules = await loadRules();

            self.postMessage({ type: 'progress', taskId, stage: 'parsing', percent: 20, message: 'Parsing PDF...' });
            const doc = await PDFDocument.load(pdfBuffer, { updateMetadata: false });

            self.postMessage({ type: 'progress', taskId, stage: 'fixing', percent: 40, message: 'Applying fixes...' });
            const { PDFPreflightFixer } = await import('./classes/pdf-preflight-fixer.js');
            const fixer = new PDFPreflightFixer(doc);
            const changelog = fixer.applyFixes(approvedFixes);

            self.postMessage({ type: 'progress', taskId, stage: 'saving', percent: 70, message: 'Saving PDF...' });
            const savedBytes = await doc.save({
                addDefaultPage: false,
                updateFieldAppearances: false,
            });

            self.postMessage({ type: 'progress', taskId, stage: 'done', percent: 100, message: 'Complete' });
            self.postMessage(
                { type: 'fixed', taskId, pdfBuffer: savedBytes.buffer, changelog },
                [savedBytes.buffer],
            );

        } catch (error) {
            self.postMessage({
                type: 'error',
                taskId,
                message: error.message,
                stack: error.stack,
            });
        }
    }
});

self.postMessage({ type: 'ready' });
