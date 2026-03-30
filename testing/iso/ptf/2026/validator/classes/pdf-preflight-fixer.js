// @ts-check
/**
 * PDF Preflight Fixer
 *
 * Standalone fix operations for PDF structural issues.
 * No validation logic — just knows how to apply corrections.
 *
 * Each fix method:
 * 1. Checks if the fix is needed (idempotent — won't overwrite existing correct data)
 * 2. Applies the correction to the PDFDocument in-place
 * 3. Returns a changelog array describing what changed
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
    PDFString,
    PDFHexString,
    PDFNumber,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

import {
    parseXML, serializeXML, findElementNS, getTextContent,
    setTextContent, createElement,
} from '../../classes/baseline/xml-markup-parser.js';

/**
 * @typedef {{
 *   fixId: string,
 *   description: string,
 *   location: { page?: number, ref?: string } | null,
 * }} ChangelogEntry
 */

export class PDFPreflightFixer {
    /** @type {PDFDocument} */
    #document;

    /** @type {Map<string, () => ChangelogEntry[]>} */
    #fixRegistry = new Map();

    /**
     * @param {PDFDocument} pdfDocument
     */
    constructor(pdfDocument) {
        this.#document = pdfDocument;
        this.#registerFixes();
    }

    /**
     * Apply a single fix by ID.
     *
     * @param {string} fixId
     * @returns {ChangelogEntry[]}
     */
    applyFix(fixId) {
        const fixFn = this.#fixRegistry.get(fixId);
        if (!fixFn) {
            console.warn(`Unknown fix ID: ${fixId}`);
            return [];
        }
        return fixFn();
    }

    /**
     * Apply multiple fixes. Returns combined changelog.
     *
     * @param {string[]} fixIds
     * @returns {ChangelogEntry[]}
     */
    applyFixes(fixIds) {
        /** @type {ChangelogEntry[]} */
        const changelog = [];
        for (const fixId of fixIds) {
            changelog.push(...this.applyFix(fixId));
        }
        return changelog;
    }

    // ========================================================================
    // Fix registry
    // ========================================================================

    #registerFixes() {
        this.#fixRegistry.set('set-geometry-from-mediabox', () => this.#fixGeometry());
        this.#fixRegistry.set('add-document-id', () => this.#fixDocumentId());
        this.#fixRegistry.set('fix-output-intent-profile', () => this.#fixOutputIntentProfile());
        this.#fixRegistry.set('strip-orphaned-ocg', () => this.#stripOrphanedOCG());
        this.#fixRegistry.set('add-occd-name', () => this.#addOCCDName());
        this.#fixRegistry.set('generate-minimal-xmp', () => this.#generateMinimalXMP());
        this.#fixRegistry.set('patch-xmp-metadata', () => this.#patchExistingXMP());
    }

    // ========================================================================
    // Fix: Page geometry
    // ========================================================================

    /** @returns {ChangelogEntry[]} */
    #fixGeometry() {
        /** @type {ChangelogEntry[]} */
        const changelog = [];
        const pages = this.#document.getPages();

        for (let i = 0; i < pages.length; i++) {
            const node = pages[i].node;
            const mediaBox = node.lookup(PDFName.of('MediaBox'));
            if (!mediaBox) continue;

            for (const boxName of ['TrimBox', 'BleedBox', 'CropBox']) {
                if (!node.get(PDFName.of(boxName))) {
                    node.set(PDFName.of(boxName), mediaBox);
                    changelog.push({
                        fixId: 'set-geometry-from-mediabox',
                        description: `Set ${boxName} from MediaBox on page ${i + 1}`,
                        location: { page: i + 1 },
                    });
                }
            }
        }

        return changelog;
    }

    // ========================================================================
    // Fix: Document ID
    // ========================================================================

    /** @returns {ChangelogEntry[]} */
    #fixDocumentId() {
        if (this.#document.context.trailerInfo.ID) return [];

        const generateHexId = () => {
            const bytes = new Uint8Array(16);
            for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
            return PDFHexString.of(
                Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
            );
        };

        const idArray = PDFArray.withContext(this.#document.context);
        idArray.push(generateHexId());
        idArray.push(generateHexId());
        this.#document.context.trailerInfo.ID = this.#document.context.register(idArray);

        return [{
            fixId: 'add-document-id',
            description: 'Added Document ID to trailer',
            location: null,
        }];
    }

    // ========================================================================
    // Fix: Output Intent ICC profile
    // ========================================================================

    /** @returns {ChangelogEntry[]} */
    #fixOutputIntentProfile() {
        /** @type {ChangelogEntry[]} */
        const changelog = [];

        const outputIntents = this.#document.catalog.lookup(PDFName.of('OutputIntents'));
        if (!(outputIntents instanceof PDFArray)) return changelog;

        for (let i = 0; i < outputIntents.size(); i++) {
            const intent = outputIntents.lookup(i);
            if (!(intent instanceof PDFDict)) continue;

            const profileRef = intent.get(PDFName.of('DestOutputProfile'));
            if (!(profileRef instanceof PDFRef)) continue;

            const profileStream = this.#document.context.lookup(profileRef);
            if (!(profileStream instanceof PDFRawStream)) continue;

            // Skip if already properly formed
            if (profileStream.dict.get(PDFName.of('N'))) continue;

            const rawContents = profileStream.getContents();
            if (rawContents.length < 20) continue;

            // Read ICC color space signature at bytes 16-19
            const sig = String.fromCharCode(rawContents[16], rawContents[17], rawContents[18], rawContents[19]);
            let n, alternate;
            switch (sig.trim()) {
                case 'CMYK': n = 4; alternate = 'DeviceCMYK'; break;
                case 'RGB': n = 3; alternate = 'DeviceRGB'; break;
                case 'GRAY': n = 1; alternate = 'DeviceGray'; break;
                default: continue;
            }

            // Replace with properly-formed compressed stream
            const newStream = this.#document.context.flateStream(rawContents, {
                N: n,
                Alternate: alternate,
            });
            this.#document.context.assign(profileRef, newStream);

            changelog.push({
                fixId: 'fix-output-intent-profile',
                description: `Fixed DestOutputProfile: /N ${n}, /Alternate /${alternate}, compressed ${rawContents.length} → ${newStream.getContentsSize()} bytes`,
                location: { ref: `${profileRef.objectNumber} ${profileRef.generationNumber} R` },
            });
        }

        return changelog;
    }

    // ========================================================================
    // Fix: Register orphaned OCGs
    //
    // The safe approach: ADD missing OCGs to OCProperties/OCGs array
    // rather than stripping references. Stripping breaks content streams
    // that use BDC/EMC operators referencing those Properties entries.
    // ========================================================================

    /** @returns {ChangelogEntry[]} */
    #stripOrphanedOCG() {
        /** @type {ChangelogEntry[]} */
        const changelog = [];

        const ocProps = this.#document.catalog.lookup(PDFName.of('OCProperties'));
        if (!ocProps || !(ocProps instanceof PDFDict)) return changelog;

        const ocgsArray = ocProps.lookup(PDFName.of('OCGs'));
        if (!(ocgsArray instanceof PDFArray)) return changelog;

        // Collect currently registered OCG refs
        const registeredRefs = new Set();
        for (let i = 0; i < ocgsArray.size(); i++) {
            const ref = ocgsArray.get(i);
            if (ref instanceof PDFRef) registeredRefs.add(ref.toString());
        }

        // Scan all objects for OCG references not in OCProperties
        /** @type {Set<string>} */
        const missingRefStrings = new Set();
        /** @type {PDFRef[]} */
        const missingRefs = [];

        for (const [, obj] of this.#document.context.enumerateIndirectObjects()) {
            if (!(obj instanceof PDFRawStream) && !(obj instanceof PDFDict)) continue;
            const dict = obj instanceof PDFRawStream ? obj.dict : obj;

            // Check /OC entries on XObjects
            const oc = dict.get(PDFName.of('OC'));
            if (oc instanceof PDFRef && !registeredRefs.has(oc.toString()) && !missingRefStrings.has(oc.toString())) {
                const ocObj = this.#document.context.lookup(oc);
                if (ocObj instanceof PDFDict) {
                    const type = ocObj.get(PDFName.of('Type'));
                    if (type instanceof PDFName && type.encodedName === '/OCG') {
                        missingRefStrings.add(oc.toString());
                        missingRefs.push(oc);
                    }
                }
            }

            // Check Resources/Properties for OCG references
            const resources = dict.lookup(PDFName.of('Resources'));
            if (resources instanceof PDFDict) {
                const properties = resources.lookup(PDFName.of('Properties'));
                if (properties instanceof PDFDict) {
                    for (const [, propVal] of properties.entries()) {
                        if (!(propVal instanceof PDFRef)) continue;
                        if (registeredRefs.has(propVal.toString())) continue;
                        if (missingRefStrings.has(propVal.toString())) continue;

                        const propObj = this.#document.context.lookup(propVal);
                        if (propObj instanceof PDFDict) {
                            const type = propObj.get(PDFName.of('Type'));
                            if (type instanceof PDFName && type.encodedName === '/OCG') {
                                missingRefStrings.add(propVal.toString());
                                missingRefs.push(propVal);
                            }
                        }
                    }
                }
            }
        }

        // Register missing OCGs by adding them to OCProperties/OCGs array
        if (missingRefs.length > 0) {
            for (const ref of missingRefs) {
                ocgsArray.push(ref);
            }

            // Also add to the default configuration's ON and Order arrays if D exists
            const d = ocProps.lookup(PDFName.of('D'));
            if (d instanceof PDFDict) {
                const onArray = d.lookup(PDFName.of('ON'));
                if (onArray instanceof PDFArray) {
                    for (const ref of missingRefs) {
                        onArray.push(ref);
                    }
                }
                const orderArray = d.lookup(PDFName.of('Order'));
                if (orderArray instanceof PDFArray) {
                    for (const ref of missingRefs) {
                        orderArray.push(ref);
                    }
                }
            }

            changelog.push({
                fixId: 'strip-orphaned-ocg',
                description: `Registered ${missingRefs.length} unregistered OCG(s) in OCProperties`,
                location: null,
            });
        }

        return changelog;
    }

    // ========================================================================
    // Fix: Add OCCD Name
    // ========================================================================

    /** @returns {ChangelogEntry[]} */
    #addOCCDName() {
        /** @type {ChangelogEntry[]} */
        const changelog = [];

        const ocProps = this.#document.catalog.lookup(PDFName.of('OCProperties'));
        if (!ocProps || !(ocProps instanceof PDFDict)) return changelog;

        const d = ocProps.lookup(PDFName.of('D'));
        if (!(d instanceof PDFDict)) return changelog;

        if (!d.get(PDFName.of('Name'))) {
            d.set(PDFName.of('Name'), PDFString.of('Default'));
            changelog.push({
                fixId: 'add-occd-name',
                description: 'Added Name "Default" to OCCD',
                location: null,
            });
        }

        return changelog;
    }

    // ========================================================================
    // Fix: Generate minimal XMP
    // ========================================================================

    /** @returns {ChangelogEntry[]} */
    #generateMinimalXMP() {
        const existingMetaRef = this.#document.catalog.get(PDFName.of('Metadata'));
        if (existingMetaRef) {
            return this.#patchExistingXMP();
        }

        // Extract Info dict values
        let title = '';
        let creator = '';
        let producer = '';
        let creationDate = '';
        let modDate = '';

        const infoRef = this.#document.context.trailerInfo.Info;
        if (infoRef) {
            const info = infoRef instanceof PDFRef
                ? this.#document.context.lookup(infoRef)
                : infoRef;
            if (info instanceof PDFDict) {
                const getStr = (key) => {
                    const val = info.lookup(PDFName.of(key));
                    if (val instanceof PDFString) return val.value;
                    if (val instanceof PDFHexString) return val.decodeText();
                    return '';
                };
                title = getStr('Title');
                creator = getStr('Creator');
                producer = getStr('Producer');
                creationDate = getStr('CreationDate');
                modDate = getStr('ModDate');
            }
        }

        // Convert PDF date (D:YYYYMMDDHHmmSSOHH'mm') to ISO 8601
        const pdfDateToISO = (pdfDate) => {
            if (!pdfDate) return new Date().toISOString();
            const m = pdfDate.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
            if (!m) return new Date().toISOString();
            return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
        };

        const nowDate = new Date();
        const now = nowDate.toISOString().replace(/\.\d+Z$/, 'Z');
        const createDateISO = pdfDateToISO(creationDate) || now;
        const modDateISO = pdfDateToISO(modDate) || now;

        // Escape XML special characters
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Generate a unique version ID
        const versionId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        // Document ID for xmpMM (reuse trailer ID if present, else generate)
        const documentId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
      xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
      xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(title)}</rdf:li></rdf:Alt></dc:title>
      <xmp:CreateDate>${createDateISO}</xmp:CreateDate>
      <xmp:ModifyDate>${modDateISO}</xmp:ModifyDate>
      <xmp:MetadataDate>${now}</xmp:MetadataDate>
      <xmp:CreatorTool>${esc(creator)}</xmp:CreatorTool>
      <pdf:Producer>${esc(producer)}</pdf:Producer>
      <xmpMM:DocumentID>uuid:${documentId}</xmpMM:DocumentID>
      <xmpMM:VersionID>${versionId}</xmpMM:VersionID>
      <xmpMM:RenditionClass>default</xmpMM:RenditionClass>
      <pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

        const xmpBytes = new TextEncoder().encode(xmp);
        const xmpStream = this.#document.context.stream(xmpBytes, {
            Type: 'Metadata',
            Subtype: 'XML',
            Length: xmpBytes.length,
        });
        const xmpRef = this.#document.context.register(xmpStream);
        this.#document.catalog.set(PDFName.of('Metadata'), xmpRef);

        // Sync Info dict ModDate to match XMP ModifyDate (prevents mismatch)
        if (infoRef) {
            const info = infoRef instanceof PDFRef
                ? this.#document.context.lookup(infoRef)
                : infoRef;
            if (info instanceof PDFDict) {
                const pdfModNow = `D:${nowDate.getUTCFullYear()}${String(nowDate.getUTCMonth() + 1).padStart(2, '0')}${String(nowDate.getUTCDate()).padStart(2, '0')}${String(nowDate.getUTCHours()).padStart(2, '0')}${String(nowDate.getUTCMinutes()).padStart(2, '0')}${String(nowDate.getUTCSeconds()).padStart(2, '0')}Z`;
                info.set(PDFName.of('ModDate'), PDFString.of(pdfModNow));
            }
        }

        return [{
            fixId: 'generate-minimal-xmp',
            description: `Generated PDF/X-4 conformant XMP metadata (${xmpBytes.length} bytes)`,
            location: null,
        }];
    }

    // ========================================================================
    // Fix: Patch existing XMP metadata
    //
    // When XMP already exists but is missing required entries, patch it
    // rather than replacing it (preserves existing entries).
    // ========================================================================

    /** @returns {ChangelogEntry[]} */
    #patchExistingXMP() {
        /** @type {ChangelogEntry[]} */
        const changelog = [];

        const metaRef = this.#document.catalog.get(PDFName.of('Metadata'));
        if (!(metaRef instanceof PDFRef)) return changelog;

        const metaObj = this.#document.context.lookup(metaRef);
        if (!(metaObj instanceof PDFRawStream)) return changelog;

        let xmpText;
        try {
            xmpText = new TextDecoder('utf-8').decode(metaObj.getContents());
        } catch {
            return changelog;
        }

        // Parse with xml-markup-parser (preserves xpacket PIs, namespaces, structure)
        const xmpDoc = parseXML(xmpText, { tolerant: true });

        // XMP namespaces
        const NS = {
            rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
            xmp: 'http://ns.adobe.com/xap/1.0/',
            xmpMM: 'http://ns.adobe.com/xap/1.0/mm/',
            pdf: 'http://ns.adobe.com/pdf/1.3/',
            pdfxid: 'http://www.npes.org/pdfx/ns/id/',
        };

        // Find rdf:Description (where XMP properties live)
        const desc = findElementNS(xmpDoc, NS.rdf, 'Description');
        if (!desc) return changelog;

        // Canonical timestamp — no milliseconds
        const nowDate = new Date();
        const xmpNow = nowDate.toISOString().replace(/\.\d+Z$/, 'Z');
        const pdfNow = `D:${nowDate.getUTCFullYear()}${String(nowDate.getUTCMonth() + 1).padStart(2, '0')}${String(nowDate.getUTCDate()).padStart(2, '0')}${String(nowDate.getUTCHours()).padStart(2, '0')}${String(nowDate.getUTCMinutes()).padStart(2, '0')}${String(nowDate.getUTCSeconds()).padStart(2, '0')}Z`;

        // Extract Info dict Producer for sync
        let infoProducer = '';
        const infoRef = this.#document.context.trailerInfo.Info;
        if (infoRef) {
            const info = infoRef instanceof PDFRef
                ? this.#document.context.lookup(infoRef)
                : infoRef;
            if (info instanceof PDFDict) {
                const val = info.lookup(PDFName.of('Producer'));
                if (val instanceof PDFString) infoProducer = val.value;
                else if (val instanceof PDFHexString) infoProducer = val.decodeText();
            }
        }

        const patches = [];

        /**
         * Get or create an element by namespace + local name.
         * @param {string} nsURI
         * @param {string} qualifiedName
         * @param {string} value
         * @returns {boolean} true if element was created (didn't exist)
         */
        const ensureElement = (nsURI, qualifiedName, value) => {
            const localName = qualifiedName.split(':').pop() ?? qualifiedName;
            const existing = findElementNS(desc, nsURI, localName);
            if (existing) {
                setTextContent(existing, value);
                return false;
            }
            createElement(desc, qualifiedName, nsURI, value);
            return true;
        };

        // Patch: xmpMM:VersionID
        if (!findElementNS(desc, NS.xmpMM, 'VersionID')) {
            const versionId = crypto.randomUUID?.() ?? `${Date.now()}`;
            ensureElement(NS.xmpMM, 'xmpMM:VersionID', versionId);
            patches.push('VersionID');
        }

        // Patch: xmpMM:DocumentID
        if (!findElementNS(desc, NS.xmpMM, 'DocumentID')) {
            const docId = crypto.randomUUID?.() ?? `${Date.now()}`;
            ensureElement(NS.xmpMM, 'xmpMM:DocumentID', `uuid:${docId}`);
            patches.push('DocumentID');
        }

        // Patch: xmpMM:RenditionClass
        if (!findElementNS(desc, NS.xmpMM, 'RenditionClass')) {
            ensureElement(NS.xmpMM, 'xmpMM:RenditionClass', 'default');
            patches.push('RenditionClass');
        }

        // Patch: pdfxid:GTS_PDFXVersion
        if (!findElementNS(desc, NS.pdfxid, 'GTS_PDFXVersion')) {
            ensureElement(NS.pdfxid, 'pdfxid:GTS_PDFXVersion', 'PDF/X-4');
            patches.push('GTS_PDFXVersion');
        }

        // Patch: pdf:Producer — sync with Info dict
        if (infoProducer) {
            const producerEl = findElementNS(desc, NS.pdf, 'Producer');
            if (producerEl) {
                if (getTextContent(producerEl) !== infoProducer) {
                    setTextContent(producerEl, infoProducer);
                    patches.push('Producer sync');
                }
            } else {
                ensureElement(NS.pdf, 'pdf:Producer', infoProducer);
                patches.push('Producer added');
            }
        }

        // Patch: xmp:ModifyDate — sync with current time
        ensureElement(NS.xmp, 'xmp:ModifyDate', xmpNow);
        patches.push('ModifyDate sync');

        // Patch: xmp:MetadataDate
        ensureElement(NS.xmp, 'xmp:MetadataDate', xmpNow);

        if (patches.length === 0) return changelog;

        // Serialize back — preserves xpacket PIs, namespaces, comments
        const serialized = serializeXML(xmpDoc);

        // Write patched XMP back
        const xmpBytes = new TextEncoder().encode(serialized);
        const newStream = this.#document.context.stream(xmpBytes, {
            Type: 'Metadata',
            Subtype: 'XML',
            Length: xmpBytes.length,
        });
        this.#document.context.assign(metaRef, newStream);

        // Sync Info dict ModDate
        if (infoRef) {
            const info = infoRef instanceof PDFRef
                ? this.#document.context.lookup(infoRef)
                : infoRef;
            if (info instanceof PDFDict) {
                info.set(PDFName.of('ModDate'), PDFString.of(pdfNow));
            }
        }

        changelog.push({
            fixId: 'patch-xmp-metadata',
            description: `Patched existing XMP: ${patches.join(', ')}`,
            location: null,
        });

        return changelog;
    }
}
