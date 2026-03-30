// @ts-check
/**
 * PDF Preflight Fixer-Validator
 *
 * Extends PDFPreflightValidator, composes PDFPreflightFixer.
 * Enriches validation findings with fix descriptions.
 * Orchestrates the two-phase flow: validate → fix → re-validate.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { PDFPreflightValidator } from '../../classes/baseline/pdf-preflight-validator.js';
import { PDFPreflightFixer } from './pdf-preflight-fixer.js';

/**
 * @typedef {import('../../classes/baseline/pdf-preflight-validator.js').PreflightReport} PreflightReport
 * @typedef {import('../../classes/baseline/pdf-preflight-validator.js').PreflightFinding} PreflightFinding
 * @typedef {import('../../classes/baseline/pdf-preflight-validator.js').RulesConfiguration} RulesConfiguration
 * @typedef {import('./pdf-preflight-fixer.js').ChangelogEntry} ChangelogEntry
 */

export class PDFPreflightFixerValidator extends PDFPreflightValidator {
    /** @type {PDFPreflightFixer} */
    #fixer;

    /** @type {RulesConfiguration} */
    #rulesConfig;

    /**
     * @param {import('pdf-lib').PDFDocument} pdfDocument
     * @param {RulesConfiguration} rulesConfiguration
     */
    constructor(pdfDocument, rulesConfiguration) {
        super(pdfDocument, rulesConfiguration);
        this.#fixer = new PDFPreflightFixer(pdfDocument);
        this.#rulesConfig = rulesConfiguration;
    }

    /**
     * Run validation and enrich findings with fix descriptions.
     *
     * @param {string} [severityContext='default']
     * @returns {PreflightReport & { findings: (PreflightFinding & { fixDescription?: string })[] }}
     */
    validate(severityContext = 'default') {
        const report = super.validate(severityContext);

        // Enrich fixable findings with fix descriptions
        for (const finding of report.findings) {
            if (finding.fixId && this.#rulesConfig.fixes[finding.fixId]) {
                /** @type {*} */
                const enriched = finding;
                enriched.fixDescription = this.#rulesConfig.fixes[finding.fixId].description;
            }
        }

        return report;
    }

    /**
     * Apply fixes by ID. Delegates to the composed fixer.
     *
     * @param {string[]} fixIds
     * @returns {ChangelogEntry[]}
     */
    fix(fixIds) {
        return this.#fixer.applyFixes(fixIds);
    }

    /**
     * Get the unique set of fixable fix IDs from failed findings in a report.
     *
     * @param {PreflightReport} report
     * @returns {string[]}
     */
    getFixableFixes(report) {
        const fixIds = new Set();
        for (const finding of report.findings) {
            if (finding.status === 'fail' && finding.fixId) {
                fixIds.add(finding.fixId);
            }
        }
        return [...fixIds];
    }
}
