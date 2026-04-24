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

import { inflate } from '../../packages/pako/dist/pako.mjs';

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
 *   expected: boolean | string,
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
 *   guard?: RuleCondition,
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

    /** @type {Map<string, (target: *, context: *) => boolean | string | null>} */
    #evaluators = new Map();

    /** @type {boolean} */
    #loadFailed = false;

    /** @type {string | null} */
    #loadError = null;

    /** @type {{ hasDeviceCMYK: boolean, hasDeviceRGB: boolean, hasDeviceGray: boolean } | null} */
    #colorSpaceScanCache = null;

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

        // Guard condition: if present, evaluate first — skip rule if guard is not met
        if (rule.guard) {
            const guardEvaluator = this.#evaluators.get(rule.guard.property);
            if (guardEvaluator) {
                const guardResult = guardEvaluator(this.#document, { loadFailed: this.#loadFailed, loadError: this.#loadError });
                if (guardResult !== rule.guard.expected) {
                    return this.#makeFinding(rule, 'skipped', severity, null, {
                        reason: `Guard not met: ${rule.guard.property}`,
                        guardProperty: rule.guard.property,
                        guardExpected: rule.guard.expected,
                        guardActual: guardResult,
                    });
                }
            }
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

        // --- Color Space Compatibility ---
        evaluators.set('OUTPUTINTENT::ProfileColorSpace', (doc) => {
            const profile = this.#getDestOutputProfile(doc);
            if (!profile) return null;
            try {
                let contents = profile.getContents();

                // Decompress if FlateDecode
                const filter = profile.dict.get(PDFName.of('Filter'));
                if (filter instanceof PDFName && filter.encodedName === '/FlateDecode') {
                    contents = inflate(contents);
                }

                if (contents.byteLength < 20) return null;
                // ICC header bytes 16-19: color space signature (ASCII)
                const signature = String.fromCharCode(contents[16], contents[17], contents[18], contents[19]);
                switch (signature) {
                    case 'CMYK': return 'CMYK';
                    case 'RGB ': return 'RGB';
                    case 'GRAY': return 'Gray';
                    case 'Lab ': return 'Lab';
                    default: return null;
                }
            } catch {
                return null;
            }
        });

        evaluators.set('DOC::HasDeviceCMYK', (doc) => {
            return this.#scanDocumentColorSpaces(doc).hasDeviceCMYK;
        });
        evaluators.set('DOC::HasDeviceRGB', (doc) => {
            return this.#scanDocumentColorSpaces(doc).hasDeviceRGB;
        });
        evaluators.set('DOC::HasDeviceGray', (doc) => {
            return this.#scanDocumentColorSpaces(doc).hasDeviceGray;
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

    // ========================================================================
    // Private: Document Color Space Scanning
    // ========================================================================

    /**
     * Scan document for Device color space usage. Cached per validator instance.
     *
     * Checks three locations per page:
     *   1. Resources/ColorSpace dict values (PDFName entries like /DeviceCMYK)
     *   2. Image XObject ColorSpace entries
     *   3. Content stream operators (k/K, rg/RG, g/G) — implicit Device colors
     *
     * Also checks Form XObject Resources recursively.
     *
     * @param {PDFDocument | null} doc
     * @returns {{ hasDeviceCMYK: boolean, hasDeviceRGB: boolean, hasDeviceGray: boolean }}
     */
    #scanDocumentColorSpaces(doc) {
        if (this.#colorSpaceScanCache) return this.#colorSpaceScanCache;

        const result = { hasDeviceCMYK: false, hasDeviceRGB: false, hasDeviceGray: false };
        if (!doc) {
            this.#colorSpaceScanCache = result;
            return result;
        }

        const visitedRefs = new Set();

        /**
         * Check a ColorSpace dict value for Device color space names.
         * @param {*} csValue
         * @param {PDFDocument} doc
         */
        const checkColorSpaceValue = (csValue, doc) => {
            // Direct PDFName: /DeviceCMYK, /DeviceRGB, /DeviceGray
            if (csValue instanceof PDFName) {
                const name = csValue.encodedName;
                if (name === '/DeviceCMYK') result.hasDeviceCMYK = true;
                else if (name === '/DeviceRGB') result.hasDeviceRGB = true;
                else if (name === '/DeviceGray') result.hasDeviceGray = true;
                return;
            }
            // PDFRef — resolve and check
            if (csValue instanceof PDFRef) {
                const resolved = doc.context.lookup(csValue);
                checkColorSpaceValue(resolved, doc);
                return;
            }
            // PDFArray: first element is the color space type name
            // e.g., [/Indexed /DeviceRGB 255 <hex>] or [/ICCBased <ref>]
            if (csValue instanceof PDFArray && csValue.size() > 0) {
                const csType = csValue.lookup(0);
                if (csType instanceof PDFName) {
                    const typeName = csType.encodedName;
                    if (typeName === '/DeviceCMYK') result.hasDeviceCMYK = true;
                    else if (typeName === '/DeviceRGB') result.hasDeviceRGB = true;
                    else if (typeName === '/DeviceGray') result.hasDeviceGray = true;
                    // For /Indexed, the base color space is the second element
                    else if (typeName === '/Indexed' && csValue.size() > 1) {
                        checkColorSpaceValue(csValue.get(1), doc);
                    }
                    // For /Separation or /DeviceN, the alternate is the third element
                    // (Phase B — not checked here)
                }
            }
        };

        /** @type {PDFRef[]} */
        const formXObjectStreamRefs = [];

        /**
         * Scan a Resources dict for Device color space usage.
         * @param {PDFDict} resources
         * @param {PDFDocument} doc
         */
        const scanResources = (resources, doc) => {
            // Check Resources/ColorSpace dict
            const csDict = resources.lookup(PDFName.of('ColorSpace'));
            if (csDict instanceof PDFDict) {
                for (const [, value] of csDict.entries()) {
                    checkColorSpaceValue(value, doc);
                }
            }

            // Check XObject dict for Image and Form XObjects
            const xobjDict = resources.lookup(PDFName.of('XObject'));
            if (xobjDict instanceof PDFDict) {
                for (const [, xobjValue] of xobjDict.entries()) {
                    const xobjRef = xobjValue instanceof PDFRef ? xobjValue : null;
                    const xobj = xobjRef ? doc.context.lookup(xobjRef) : xobjValue;
                    if (!(xobj instanceof PDFRawStream) && !(xobj instanceof PDFStream)) continue;
                    const xobjDictInner = xobj.dict;
                    if (!xobjDictInner) continue;

                    const subtype = xobjDictInner.get(PDFName.of('Subtype'));

                    // Image XObject — check ColorSpace
                    if (subtype instanceof PDFName && subtype.encodedName === '/Image') {
                        const imgCs = xobjDictInner.get(PDFName.of('ColorSpace'));
                        if (imgCs) checkColorSpaceValue(imgCs, doc);
                    }

                    // Form XObject — recurse into Resources and collect for stream scanning
                    if (subtype instanceof PDFName && subtype.encodedName === '/Form') {
                        const refKey = xobjRef ? xobjRef.toString() : null;
                        if (refKey && visitedRefs.has(refKey)) continue;
                        if (refKey) visitedRefs.add(refKey);
                        const formResources = xobjDictInner.lookup(PDFName.of('Resources'));
                        if (formResources instanceof PDFDict) {
                            scanResources(formResources, doc);
                        }
                        // Collect Form XObject ref for content stream scanning
                        if (xobjRef) formXObjectStreamRefs.push(xobjRef);
                    }
                }
            }
        };

        // Scan all pages
        const pages = doc.getPages();
        for (const page of pages) {
            const resources = page.node.lookup(PDFName.of('Resources'));
            if (resources instanceof PDFDict) {
                scanResources(resources, doc);
            }

            // Early exit if all three are found
            if (result.hasDeviceCMYK && result.hasDeviceRGB && result.hasDeviceGray) break;
        }

        // If resource scan did not find all Device color spaces, scan content streams
        // for implicit Device operators (k/K, rg/RG, g/G) and cs/CS with Device names
        if (!result.hasDeviceCMYK || !result.hasDeviceRGB || !result.hasDeviceGray) {
            // Scan page content streams
            for (const page of pages) {
                this.#scanPageContentStreams(page, doc, result);
                if (result.hasDeviceCMYK && result.hasDeviceRGB && result.hasDeviceGray) break;
            }
        }

        // Also scan Form XObject content streams (slugs, stamps, etc.)
        if (!result.hasDeviceCMYK || !result.hasDeviceRGB || !result.hasDeviceGray) {
            for (const ref of formXObjectStreamRefs) {
                this.#scanStreamRef(ref, doc, result);
                if (result.hasDeviceCMYK && result.hasDeviceRGB && result.hasDeviceGray) break;
            }
        }

        this.#colorSpaceScanCache = result;
        return result;
    }

    /**
     * Scan a page's content streams for implicit Device color operators.
     *
     * Operators k/K, rg/RG, g/G implicitly set both the color space and
     * color value without appearing in Resources/ColorSpace. This scan
     * decompresses each content stream and checks for operator presence.
     *
     * @param {import('../../packages/pdf-lib/pdf-lib.esm.js').PDFPage} page
     * @param {PDFDocument} doc
     * @param {{ hasDeviceCMYK: boolean, hasDeviceRGB: boolean, hasDeviceGray: boolean }} result
     */
    #scanPageContentStreams(page, doc, result) {
        const contentsRef = page.node.get(PDFName.of('Contents'));
        if (!contentsRef) return;

        /** @type {PDFRef[]} */
        const streamRefs = [];
        if (contentsRef instanceof PDFRef) {
            const resolved = doc.context.lookup(contentsRef);
            if (resolved instanceof PDFArray) {
                for (let i = 0; i < resolved.size(); i++) {
                    const ref = resolved.get(i);
                    if (ref instanceof PDFRef) streamRefs.push(ref);
                }
            } else {
                streamRefs.push(contentsRef);
            }
        } else if (contentsRef instanceof PDFArray) {
            for (let i = 0; i < contentsRef.size(); i++) {
                const ref = contentsRef.get(i);
                if (ref instanceof PDFRef) streamRefs.push(ref);
            }
        }

        for (const ref of streamRefs) {
            this.#scanStreamRef(ref, doc, result);
            if (result.hasDeviceCMYK && result.hasDeviceRGB && result.hasDeviceGray) return;
        }
    }

    /**
     * Decompress and scan a single stream ref for Device color operators.
     *
     * @param {PDFRef} ref
     * @param {PDFDocument} doc
     * @param {{ hasDeviceCMYK: boolean, hasDeviceRGB: boolean, hasDeviceGray: boolean }} result
     */
    #scanStreamRef(ref, doc, result) {
        const stream = doc.context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) return;

        try {
            let bytes = stream.getContents();
            const filter = stream.dict.get(PDFName.of('Filter'));
            if (filter instanceof PDFName && filter.encodedName === '/FlateDecode') {
                bytes = inflate(bytes);
            }
            let text = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                text += String.fromCharCode(bytes[i]);
            }
            this.#scanTextForDeviceOperators(text, result);
        } catch {
            // Stream decode failure — skip silently
        }
    }

    /**
     * Scan a content stream text for Device color operators.
     *
     * Detects both implicit operators (g/G, rg/RG, k/K) and explicit
     * Device color space selection via cs/CS operator.
     *
     * @param {string} text - Decoded content stream text
     * @param {{ hasDeviceCMYK: boolean, hasDeviceRGB: boolean, hasDeviceGray: boolean }} result
     */
    #scanTextForDeviceOperators(text, result) {
        // Implicit operators: k/K, rg/RG, g/G
        if (!result.hasDeviceCMYK && /(?:^|[\s\n])[-.\d]+\s+[-.\d]+\s+[-.\d]+\s+[-.\d]+\s+[kK]\b/.test(text)) {
            result.hasDeviceCMYK = true;
        }
        if (!result.hasDeviceRGB && /(?:^|[\s\n])[-.\d]+\s+[-.\d]+\s+[-.\d]+\s+(?:rg|RG)\b/.test(text)) {
            result.hasDeviceRGB = true;
        }
        if (!result.hasDeviceGray && /(?:^|[\s\n])[-.\d]+\s+[gG]\b/.test(text)) {
            result.hasDeviceGray = true;
        }

        // Explicit cs/CS operator with Device color space name
        if (!result.hasDeviceCMYK && /\/DeviceCMYK\s+(?:cs|CS)\b/.test(text)) {
            result.hasDeviceCMYK = true;
        }
        if (!result.hasDeviceRGB && /\/DeviceRGB\s+(?:cs|CS)\b/.test(text)) {
            result.hasDeviceRGB = true;
        }
        if (!result.hasDeviceGray && /\/DeviceGray\s+(?:cs|CS)\b/.test(text)) {
            result.hasDeviceGray = true;
        }
    }
}
