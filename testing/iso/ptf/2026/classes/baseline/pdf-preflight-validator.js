// @ts-check
/**
 * PDF Preflight Validator
 *
 * Pure analysis engine that evaluates a PDFDocument against a declarative
 * rules configuration. Produces a structured report with findings.
 *
 * No fix logic, no UI dependency. Reusable from experiments, CLI, and generator.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import {
    PDFDocument,
    PDFDict,
    PDFArray,
    PDFName,
    PDFRef,
    PDFRawStream,
    PDFStream,
    PDFString,
    PDFHexString,
    PDFNumber,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

/**
 * @typedef {{
 *   ruleId: string,
 *   status: 'pass' | 'fail' | 'skipped',
 *   severity: string,
 *   scope: string,
 *   location: { page?: number, ref?: string } | null,
 *   fixId: string | null,
 *   displayName: string,
 *   description: string,
 *   details: Record<string, *>,
 * }} PreflightFinding
 *
 * @typedef {{
 *   documentInfo: {
 *     pageCount: number,
 *     producer: string,
 *     pdfVersion: string,
 *     fileSize: number | null,
 *   },
 *   findings: PreflightFinding[],
 *   summary: {
 *     errors: number,
 *     warnings: number,
 *     passed: number,
 *     skipped: number,
 *   },
 * }} PreflightReport
 *
 * @typedef {{
 *   property: string,
 *   expected: boolean,
 * }} RuleCondition
 *
 * @typedef {{
 *   ruleId: string,
 *   pdfxReference: string,
 *   displayName: string,
 *   description: string,
 *   scope: 'document' | 'page' | 'object',
 *   severity: Record<string, string>,
 *   conditions: RuleCondition[],
 *   logic: 'and' | 'or' | 'none',
 *   fixId?: string,
 * }} RuleDefinition
 *
 * @typedef {{
 *   categoryId: string,
 *   displayName: string,
 *   description: string,
 *   rules: RuleDefinition[],
 * }} RuleCategory
 *
 * @typedef {{
 *   schemaVersion: string,
 *   profile: string,
 *   categories: RuleCategory[],
 *   fixes: Record<string, object>,
 * }} RulesConfiguration
 */

export class PDFPreflightValidator {
    /** @type {PDFDocument | null} */
    #document;

    /** @type {RulesConfiguration} */
    #rules;

    /** @type {Map<string, (target: *, context: *) => boolean>} */
    #evaluators = new Map();

    /** @type {boolean} */
    #loadFailed = false;

    /** @type {string | null} */
    #loadError = null;

    /**
     * @param {PDFDocument | null} pdfDocument
     * @param {RulesConfiguration} rulesConfiguration
     */
    constructor(pdfDocument, rulesConfiguration) {
        this.#document = pdfDocument;
        this.#rules = rulesConfiguration;
        this.#registerEvaluators();
    }

    /**
     * Create a report for a PDF that failed to load.
     *
     * @param {Error} error
     * @param {RulesConfiguration} rulesConfiguration
     * @returns {PreflightReport}
     */
    static validateLoadError(error, rulesConfiguration) {
        const validator = new PDFPreflightValidator(null, rulesConfiguration);
        validator.#loadFailed = true;
        validator.#loadError = error.message;
        return validator.validate();
    }

    /**
     * Run all rules and produce a report.
     *
     * @param {string} [severityContext='default']
     * @returns {PreflightReport}
     */
    validate(severityContext = 'default') {
        /** @type {PreflightFinding[]} */
        const findings = [];

        for (const category of this.#rules.categories) {
            for (const rule of category.rules) {
                const ruleFindings = this.#evaluateRule(rule, severityContext);
                findings.push(...ruleFindings);
            }
        }

        const summary = {
            errors: findings.filter(f => f.status === 'fail' && f.severity === 'error').length,
            warnings: findings.filter(f => f.status === 'fail' && f.severity === 'warning').length,
            passed: findings.filter(f => f.status === 'pass').length,
            skipped: findings.filter(f => f.status === 'skipped').length,
        };

        return {
            documentInfo: this.#buildDocumentInfo(),
            findings,
            summary,
        };
    }

    // ========================================================================
    // Private: Rule evaluation
    // ========================================================================

    /**
     * @param {RuleDefinition} rule
     * @param {string} severityContext
     * @returns {PreflightFinding[]}
     */
    #evaluateRule(rule, severityContext) {
        const severity = rule.severity[severityContext] ?? rule.severity['default'] ?? 'error';

        switch (rule.scope) {
            case 'document':
                return [this.#evaluateDocumentRule(rule, severity)];
            case 'page':
                return this.#evaluatePageRule(rule, severity);
            case 'object':
                return this.#evaluateObjectRule(rule, severity);
            default:
                return [this.#makeFinding(rule, 'skipped', severity, null, { reason: `Unknown scope: ${rule.scope}` })];
        }
    }

    /**
     * @param {RuleDefinition} rule
     * @param {string} severity
     * @returns {PreflightFinding}
     */
    #evaluateDocumentRule(rule, severity) {
        if (!this.#document && !this.#loadFailed) {
            return this.#makeFinding(rule, 'skipped', severity, null, { reason: 'No document loaded' });
        }

        const conditionResults = rule.conditions.map(cond => {
            const evaluator = this.#evaluators.get(cond.property);
            if (!evaluator) return { property: cond.property, result: undefined };
            const result = evaluator(this.#document, { loadFailed: this.#loadFailed, loadError: this.#loadError });
            return { property: cond.property, result: result === cond.expected };
        });

        const status = this.#resolveConditions(conditionResults, rule.logic);
        const details = {};
        for (const cr of conditionResults) {
            details[cr.property] = cr.result;
        }
        return this.#makeFinding(rule, status, severity, null, details);
    }

    /**
     * @param {RuleDefinition} rule
     * @param {string} severity
     * @returns {PreflightFinding[]}
     */
    #evaluatePageRule(rule, severity) {
        if (!this.#document) {
            return [this.#makeFinding(rule, 'skipped', severity, null, { reason: 'No document loaded' })];
        }

        const pages = this.#document.getPages();
        return pages.map((page, index) => {
            const pageNode = page.node;
            const conditionResults = rule.conditions.map(cond => {
                const evaluator = this.#evaluators.get(cond.property);
                if (!evaluator) return { property: cond.property, result: undefined };
                const result = evaluator(pageNode, { document: this.#document, pageIndex: index });
                return { property: cond.property, result: result === cond.expected };
            });

            const status = this.#resolveConditions(conditionResults, rule.logic);
            const details = {};
            for (const cr of conditionResults) {
                details[cr.property] = cr.result;
            }

            // Add page box details for geometry rules
            if (rule.categoryId === 'page-geometry' || rule.ruleId.includes('page-')) {
                const mediaBox = pageNode.lookup(PDFName.of('MediaBox'));
                if (mediaBox instanceof PDFArray) {
                    details.mediaBox = [];
                    for (let i = 0; i < mediaBox.size(); i++) {
                        const val = mediaBox.lookup(i);
                        details.mediaBox.push(val instanceof PDFNumber ? val.numberValue : 0);
                    }
                }
            }

            return this.#makeFinding(rule, status, severity, { page: index + 1 }, details);
        });
    }

    /**
     * @param {RuleDefinition} rule
     * @param {string} severity
     * @returns {PreflightFinding[]}
     */
    #evaluateObjectRule(rule, severity) {
        if (!this.#document) {
            return [this.#makeFinding(rule, 'skipped', severity, null, { reason: 'No document loaded' })];
        }

        const findings = [];
        const objects = this.#document.context.enumerateIndirectObjects();

        for (const [ref, obj] of objects) {
            let target = null;
            let details = {};

            if (rule.ruleId === 'xobject-missing-subtype') {
                // Only check streams that have /Type /XObject
                if (!(obj instanceof PDFRawStream) && !(obj instanceof PDFStream)) continue;
                const dict = obj.dict;
                if (!dict) continue;
                const type = dict.get(PDFName.of('Type'));
                if (!(type instanceof PDFName) || type.encodedName !== '/XObject') continue;
                target = obj;
                details = { type: 'XObject', subtype: 'MISSING' };
            } else if (rule.ruleId === 'font-not-embedded') {
                // Check all Font dicts (including those without FontDescriptor — standard fonts)
                if (!(obj instanceof PDFDict)) continue;
                const type = obj.get(PDFName.of('Type'));
                if (!(type instanceof PDFName) || type.encodedName !== '/Font') continue;
                target = obj;
                const baseFont = obj.lookup(PDFName.of('BaseFont'));
                details = { fontName: baseFont instanceof PDFName ? baseFont.encodedName.replace(/^\//, '') : 'Unknown' };
            }

            if (!target) continue;

            const conditionResults = rule.conditions.map(cond => {
                const evaluator = this.#evaluators.get(cond.property);
                if (!evaluator) return { property: cond.property, result: undefined };
                const result = evaluator(target, { document: this.#document, ref });
                return { property: cond.property, result: result === cond.expected };
            });

            const status = this.#resolveConditions(conditionResults, rule.logic);
            if (status === 'fail') {
                findings.push(this.#makeFinding(rule, status, severity,
                    { ref: `${ref.objectNumber} ${ref.generationNumber} R` },
                    details,
                ));
            }
        }

        // If no failures found, report a single pass
        if (findings.length === 0) {
            findings.push(this.#makeFinding(rule, 'pass', severity, null, {}));
        }

        return findings;
    }

    /**
     * Resolve condition results based on logic operator.
     *
     * @param {{ property: string, result: boolean | undefined }[]} conditionResults
     * @param {'and' | 'or' | 'none'} logic
     * @returns {'pass' | 'fail' | 'skipped'}
     */
    #resolveConditions(conditionResults, logic) {
        const defined = conditionResults.filter(cr => cr.result !== undefined);
        if (defined.length === 0) return 'skipped';

        switch (logic) {
            case 'or':
                return defined.some(cr => cr.result) ? 'pass' : 'fail';
            case 'and':
                return defined.every(cr => cr.result) ? 'pass' : 'fail';
            case 'none':
                return defined.every(cr => !cr.result) ? 'pass' : 'fail';
            default:
                return 'skipped';
        }
    }

    /**
     * @param {RuleDefinition} rule
     * @param {'pass' | 'fail' | 'skipped'} status
     * @param {string} severity
     * @param {{ page?: number, ref?: string } | null} location
     * @param {Record<string, *>} details
     * @returns {PreflightFinding}
     */
    #makeFinding(rule, status, severity, location, details) {
        return {
            ruleId: rule.ruleId,
            status,
            severity,
            scope: rule.scope,
            location,
            fixId: rule.fixId ?? null,
            displayName: rule.displayName,
            description: rule.description,
            details,
        };
    }

    // ========================================================================
    // Private: Document info
    // ========================================================================

    /** @returns {PreflightReport['documentInfo']} */
    #buildDocumentInfo() {
        if (!this.#document) {
            return {
                pageCount: 0,
                producer: '',
                pdfVersion: '',
                fileSize: null,
            };
        }

        let producer = '';
        const infoRef = this.#document.context.trailerInfo.Info;
        if (infoRef) {
            const info = infoRef instanceof PDFRef
                ? this.#document.context.lookup(infoRef)
                : infoRef;
            if (info instanceof PDFDict) {
                const producerVal = info.lookup(PDFName.of('Producer'));
                if (producerVal instanceof PDFString) producer = producerVal.value;
                else if (producerVal instanceof PDFHexString) producer = producerVal.decodeText();
            }
        }

        return {
            pageCount: this.#document.getPageCount(),
            producer,
            pdfVersion: '1.7', // pdf-lib always writes 1.7
            fileSize: null,
        };
    }

    // ========================================================================
    // Private: Property evaluator registry
    // ========================================================================

    #registerEvaluators() {
        const evaluators = this.#evaluators;

        // --- Page Geometry ---
        evaluators.set('PAGE::HasTrimBox', (pageNode) =>
            pageNode.lookup(PDFName.of('TrimBox')) !== undefined
        );
        evaluators.set('PAGE::HasArtBox', (pageNode) =>
            pageNode.lookup(PDFName.of('ArtBox')) !== undefined
        );

        // --- Document Structure ---
        evaluators.set('DOC::HasDocumentID', (doc) =>
            !!doc?.context?.trailerInfo?.ID
        );
        evaluators.set('DOC::LoadSucceeded', (_doc, context) =>
            !context.loadFailed
        );
        evaluators.set('XOBJECT::HasSubtype', (obj) => {
            const dict = obj.dict ?? obj;
            if (!(dict instanceof PDFDict)) return true; // skip non-dicts
            return !!dict.get(PDFName.of('Subtype'));
        });

        // --- Output Intent ---
        evaluators.set('OUTPUTINTENT::ProfileHasN', (doc) => {
            const profile = this.#getDestOutputProfile(doc);
            if (!profile) return true; // no output intent = skip, not fail
            return !!profile.dict.get(PDFName.of('N'));
        });
        evaluators.set('OUTPUTINTENT::ProfileHasAlternate', (doc) => {
            const profile = this.#getDestOutputProfile(doc);
            if (!profile) return true;
            return !!profile.dict.get(PDFName.of('Alternate'));
        });

        // --- Optional Content ---
        evaluators.set('OCG::AllListedInOCProperties', (doc) => {
            if (!doc) return true;
            const ocProps = doc.catalog.lookup(PDFName.of('OCProperties'));
            if (!ocProps || !(ocProps instanceof PDFDict)) return true; // no OCProperties = no problem

            const ocgsArray = ocProps.lookup(PDFName.of('OCGs'));
            if (!(ocgsArray instanceof PDFArray)) return false; // OCProperties without OCGs array

            // Collect all registered OCG refs
            const registeredRefs = new Set();
            for (let i = 0; i < ocgsArray.size(); i++) {
                const ref = ocgsArray.get(i);
                if (ref instanceof PDFRef) registeredRefs.add(ref.toString());
            }

            // Scan all objects for OCG references (in Properties dicts of resources)
            const allObjects = doc.context.enumerateIndirectObjects();
            for (const [, obj] of allObjects) {
                if (!(obj instanceof PDFRawStream) && !(obj instanceof PDFDict)) continue;
                const dict = obj instanceof PDFRawStream ? obj.dict : obj;

                // Check for /OC entry (direct OCG reference on XObjects)
                const oc = dict.get(PDFName.of('OC'));
                if (oc instanceof PDFRef && !registeredRefs.has(oc.toString())) {
                    return false;
                }

                // Check Resources/Properties for OCG references
                const resources = dict.lookup(PDFName.of('Resources'));
                if (resources instanceof PDFDict) {
                    const properties = resources.lookup(PDFName.of('Properties'));
                    if (properties instanceof PDFDict) {
                        for (const [, propVal] of properties.entries()) {
                            const propRef = propVal instanceof PDFRef ? propVal : null;
                            if (propRef) {
                                const propObj = doc.context.lookup(propRef);
                                if (propObj instanceof PDFDict) {
                                    const type = propObj.get(PDFName.of('Type'));
                                    if (type instanceof PDFName && type.encodedName === '/OCG') {
                                        if (!registeredRefs.has(propRef.toString())) {
                                            return false;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            return true;
        });

        evaluators.set('OCCD::HasName', (doc) => {
            if (!doc) return true;
            const ocProps = doc.catalog.lookup(PDFName.of('OCProperties'));
            if (!ocProps || !(ocProps instanceof PDFDict)) return true;

            const d = ocProps.lookup(PDFName.of('D'));
            if (!(d instanceof PDFDict)) return true; // no D entry = different issue
            return !!d.get(PDFName.of('Name'));
        });

        // --- Font ---
        evaluators.set('FONT::IsEmbedded', (fontDict) => {
            if (!(fontDict instanceof PDFDict)) return true;

            // Type0 (composite) fonts delegate embedding to their descendant CIDFont
            const subtype = fontDict.get(PDFName.of('Subtype'));
            if (subtype instanceof PDFName && subtype.encodedName === '/Type0') {
                // Check the DescendantFonts array for embedding
                const descendants = fontDict.lookup(PDFName.of('DescendantFonts'));
                if (descendants instanceof PDFArray && descendants.size() > 0) {
                    const cidFont = descendants.lookup(0);
                    if (cidFont instanceof PDFDict) {
                        const cidDescRef = cidFont.get(PDFName.of('FontDescriptor'));
                        if (cidDescRef instanceof PDFRef) {
                            const cidDesc = this.#document?.context?.lookup(cidDescRef);
                            if (cidDesc instanceof PDFDict) {
                                return !!(cidDesc.get(PDFName.of('FontFile')) || cidDesc.get(PDFName.of('FontFile2')) || cidDesc.get(PDFName.of('FontFile3')));
                            }
                        }
                    }
                }
                return true; // can't determine — don't false-flag
            }

            const descriptorRef = fontDict.get(PDFName.of('FontDescriptor'));
            if (!(descriptorRef instanceof PDFRef)) {
                // No descriptor = standard font reference, NOT embedded
                return false;
            }
            const descriptor = this.#document?.context?.lookup(descriptorRef);
            if (!(descriptor instanceof PDFDict)) return false;
            return !!(
                descriptor.get(PDFName.of('FontFile')) ||
                descriptor.get(PDFName.of('FontFile2')) ||
                descriptor.get(PDFName.of('FontFile3'))
            );
        });

        // --- XMP Metadata ---
        evaluators.set('DOC::HasXMPMetadata', (doc) => {
            if (!doc) return false;
            return !!doc.catalog.get(PDFName.of('Metadata'));
        });

        evaluators.set('XMP::HasVersionID', (doc) => {
            const xmpText = this.#getXMPText(doc);
            if (!xmpText) return true; // no XMP = different rule handles it
            return xmpText.includes('VersionID') || xmpText.includes('xmpMM:VersionID');
        });

        evaluators.set('XMP::HasGTSPDFXVersion', (doc) => {
            const xmpText = this.#getXMPText(doc);
            if (!xmpText) return true;
            return xmpText.includes('GTS_PDFXVersion');
        });

        evaluators.set('XMP::ProducerMatchesInfoDict', (doc) => {
            if (!doc) return true;
            const xmpText = this.#getXMPText(doc);
            if (!xmpText) return true;

            // Get Info dict Producer
            let infoProducer = '';
            const infoRef = doc.context.trailerInfo.Info;
            if (infoRef) {
                const info = infoRef instanceof PDFRef ? doc.context.lookup(infoRef) : infoRef;
                if (info instanceof PDFDict) {
                    const val = info.lookup(PDFName.of('Producer'));
                    if (val instanceof PDFString) infoProducer = val.value;
                    else if (val instanceof PDFHexString) infoProducer = val.decodeText();
                }
            }
            if (!infoProducer) return true; // no Info Producer = nothing to mismatch

            // Check if XMP contains the Producer text
            const producerMatch = xmpText.match(/<pdf:Producer>([^<]*)<\/pdf:Producer>/);
            if (!producerMatch) return false; // XMP has no Producer at all
            return producerMatch[1] === infoProducer;
        });
    }

    // ========================================================================
    // Private: Helpers
    // ========================================================================

    /**
     * Get XMP metadata text content from the catalog Metadata stream.
     *
     * @param {PDFDocument | null} doc
     * @returns {string | null}
     */
    #getXMPText(doc) {
        if (!doc) return null;
        const metaRef = doc.catalog.get(PDFName.of('Metadata'));
        if (!(metaRef instanceof PDFRef)) return null;
        const metaObj = doc.context.lookup(metaRef);
        if (!(metaObj instanceof PDFRawStream)) return null;
        try {
            return new TextDecoder('utf-8').decode(metaObj.getContents());
        } catch {
            return null;
        }
    }

    /**
     * Get the DestOutputProfile stream from the first OutputIntent.
     *
     * @param {PDFDocument | null} doc
     * @returns {PDFRawStream | null}
     */
    #getDestOutputProfile(doc) {
        if (!doc) return null;
        const outputIntents = doc.catalog.lookup(PDFName.of('OutputIntents'));
        if (!(outputIntents instanceof PDFArray) || outputIntents.size() === 0) return null;

        const intent = outputIntents.lookup(0);
        if (!(intent instanceof PDFDict)) return null;

        const profileRef = intent.get(PDFName.of('DestOutputProfile'));
        if (!(profileRef instanceof PDFRef)) return null;

        const profile = doc.context.lookup(profileRef);
        if (profile instanceof PDFRawStream) return profile;
        return null;
    }
}
