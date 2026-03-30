// @ts-check
/**
 * XML Markup Parser Tests
 *
 * Tests the regex-driven XML parser against XMP metadata from real PDFs,
 * Acrobat preflight reports, and synthetic edge cases.
 *
 * @module xml-markup-parser.test
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {typeof import('../../classes/baseline/xml-markup-parser.js')} */
let xml;

describe('XML Markup Parser', () => {
    before(async () => {
        xml = await import('../../classes/baseline/xml-markup-parser.js');
    });

    describe('Basic Parsing', () => {
        test('parses empty element', () => {
            const doc = xml.parseXML('<root/>');
            assert.strictEqual(doc.children.length, 1);
            assert.strictEqual(doc.children[0].type, 'element');
            assert.strictEqual(/** @type {*} */ (doc.children[0]).name, 'root');
            assert.strictEqual(/** @type {*} */ (doc.children[0]).children.length, 0);
        });

        test('parses element with text content', () => {
            const doc = xml.parseXML('<greeting>Hello World</greeting>');
            const el = /** @type {*} */ (doc.children[0]);
            assert.strictEqual(el.name, 'greeting');
            assert.strictEqual(el.children.length, 1);
            assert.strictEqual(el.children[0].type, 'text');
            assert.strictEqual(el.children[0].value, 'Hello World');
        });

        test('parses nested elements', () => {
            const doc = xml.parseXML('<a><b><c>deep</c></b></a>');
            const a = /** @type {*} */ (doc.children[0]);
            assert.strictEqual(a.name, 'a');
            const b = a.children[0];
            assert.strictEqual(b.name, 'b');
            const c = b.children[0];
            assert.strictEqual(c.name, 'c');
            assert.strictEqual(xml.getTextContent(c), 'deep');
        });

        test('parses attributes', () => {
            const doc = xml.parseXML('<item id="42" class="primary"/>');
            const el = /** @type {*} */ (doc.children[0]);
            assert.strictEqual(el.attributes.get('id'), '42');
            assert.strictEqual(el.attributes.get('class'), 'primary');
        });

        test('parses single-quoted attributes', () => {
            const doc = xml.parseXML("<item name='test'/>");
            const el = /** @type {*} */ (doc.children[0]);
            assert.strictEqual(el.attributes.get('name'), 'test');
        });

        test('parses sibling elements', () => {
            const doc = xml.parseXML('<root><a/><b/><c/></root>');
            const root = /** @type {*} */ (doc.children[0]);
            assert.strictEqual(root.children.length, 3);
            assert.strictEqual(root.children[0].name, 'a');
            assert.strictEqual(root.children[1].name, 'b');
            assert.strictEqual(root.children[2].name, 'c');
        });
    });

    describe('Namespaces', () => {
        test('parses namespace declarations', () => {
            const doc = xml.parseXML('<root xmlns:ns="http://example.com/ns"><ns:child/></root>');
            const root = /** @type {*} */ (doc.children[0]);
            assert.strictEqual(root.namespaces.get('ns'), 'http://example.com/ns');
            const child = root.children[0];
            assert.strictEqual(child.prefix, 'ns');
            assert.strictEqual(child.localName, 'child');
        });

        test('resolves namespace from ancestor', () => {
            const doc = xml.parseXML('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description/></rdf:RDF>');
            const rdf = /** @type {*} */ (doc.children[0]);
            assert.strictEqual(rdf.prefix, 'rdf');
            assert.strictEqual(rdf.localName, 'RDF');
            const desc = rdf.children[0];
            assert.strictEqual(desc.prefix, 'rdf');
            assert.strictEqual(desc.localName, 'Description');
        });

        test('findElementNS resolves by namespace', () => {
            const doc = xml.parseXML(`
                <root xmlns:a="urn:a" xmlns:b="urn:b">
                    <a:item>first</a:item>
                    <b:item>second</b:item>
                </root>
            `);
            const aItem = xml.findElementNS(doc, 'urn:a', 'item');
            assert.ok(aItem);
            assert.strictEqual(xml.getTextContent(aItem), 'first');

            const bItem = xml.findElementNS(doc, 'urn:b', 'item');
            assert.ok(bItem);
            assert.strictEqual(xml.getTextContent(bItem), 'second');
        });
    });

    describe('Special Content', () => {
        test('parses comments', () => {
            const doc = xml.parseXML('<root><!-- a comment --></root>');
            const root = /** @type {*} */ (doc.children[0]);
            const comment = root.children[0];
            assert.strictEqual(comment.type, 'comment');
            assert.strictEqual(comment.value, ' a comment ');
        });

        test('parses CDATA sections', () => {
            const doc = xml.parseXML('<root><![CDATA[<not&parsed>]]></root>');
            const root = /** @type {*} */ (doc.children[0]);
            const cdata = root.children[0];
            assert.strictEqual(cdata.type, 'cdata');
            assert.strictEqual(cdata.value, '<not&parsed>');
        });

        test('parses processing instructions', () => {
            const doc = xml.parseXML('<?xml version="1.0"?><root/>');
            assert.ok(doc.xmlDeclaration);
            assert.strictEqual(doc.xmlDeclaration.target, 'xml');
            assert.ok(doc.xmlDeclaration.value.includes('version'));
        });

        test('parses entity references in text', () => {
            const doc = xml.parseXML('<root>a &amp; b &lt; c</root>');
            const root = /** @type {*} */ (doc.children[0]);
            assert.strictEqual(xml.getTextContent(root), 'a & b < c');
        });

        test('parses entity references in attributes', () => {
            const doc = xml.parseXML('<root title="a &amp; b"/>');
            const root = /** @type {*} */ (doc.children[0]);
            assert.strictEqual(root.attributes.get('title'), 'a & b');
        });

        test('parses numeric character references', () => {
            const doc = xml.parseXML('<root>&#65;&#x42;</root>');
            const root = /** @type {*} */ (doc.children[0]);
            assert.strictEqual(xml.getTextContent(root), 'AB');
        });
    });

    describe('Serialization', () => {
        test('round-trips simple document', () => {
            const input = '<root><child attr="val">text</child></root>';
            const doc = xml.parseXML(input);
            const output = xml.serializeXML(doc);
            assert.strictEqual(output, input);
        });

        test('preserves processing instructions', () => {
            const input = '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><root/><?xpacket end="w"?>';
            const doc = xml.parseXML(input);
            const output = xml.serializeXML(doc);
            assert.ok(output.includes('<?xpacket begin='));
            assert.ok(output.includes('<?xpacket end='));
        });

        test('preserves CDATA', () => {
            const input = '<root><![CDATA[special <chars>]]></root>';
            const doc = xml.parseXML(input);
            const output = xml.serializeXML(doc);
            assert.ok(output.includes('<![CDATA[special <chars>]]>'));
        });

        test('preserves comments', () => {
            const input = '<root><!-- keep me --></root>';
            const doc = xml.parseXML(input);
            const output = xml.serializeXML(doc);
            assert.ok(output.includes('<!-- keep me -->'));
        });
    });

    describe('Mutation', () => {
        test('setTextContent replaces children', () => {
            const doc = xml.parseXML('<root><child>old</child></root>');
            const root = /** @type {*} */ (doc.children[0]);
            xml.setTextContent(root, 'new');
            assert.strictEqual(root.children.length, 1);
            assert.strictEqual(xml.getTextContent(root), 'new');
        });

        test('createElement appends child element', () => {
            const doc = xml.parseXML('<root/>');
            const root = /** @type {*} */ (doc.children[0]);
            xml.createElement(root, 'child', undefined, 'hello');
            assert.strictEqual(root.children.length, 1);
            assert.strictEqual(root.children[0].name, 'child');
            assert.strictEqual(xml.getTextContent(root.children[0]), 'hello');
        });

        test('createElement with namespace adds xmlns declaration', () => {
            const doc = xml.parseXML('<root/>');
            const root = /** @type {*} */ (doc.children[0]);
            xml.createElement(root, 'xmpMM:VersionID', 'http://ns.adobe.com/xap/1.0/mm/', '1.0');
            const child = root.children[0];
            assert.strictEqual(child.name, 'xmpMM:VersionID');
            assert.strictEqual(child.attributes.get('xmlns:xmpMM'), 'http://ns.adobe.com/xap/1.0/mm/');
            assert.strictEqual(xml.getTextContent(child), '1.0');
        });
    });

    describe('XMP Metadata (Real-World)', () => {
        test('parses real XMP from PDF', async () => {
            // Load a PDF and extract its XMP
            const pdfLib = await import('../../packages/pdf-lib/pdf-lib.esm.js');
            const pdfPath = join(__dirname, '..', 'validator', 'pdf-lib-validation-suite', 'xm-02-xmp-present.pdf');
            const pdfBytes = await readFile(pdfPath);
            const doc = await pdfLib.PDFDocument.load(pdfBytes, { updateMetadata: false });
            const metaRef = doc.catalog.get(pdfLib.PDFName.of('Metadata'));
            if (!metaRef) { assert.fail('No XMP metadata in test PDF'); return; }
            const metaObj = doc.context.lookup(metaRef);
            const xmpText = new TextDecoder().decode(metaObj.getContents());

            // Parse with our parser
            const xmpDoc = xml.parseXML(xmpText);
            assert.ok(xmpDoc.children.length > 0);

            // Find dc:title
            const title = xml.findElementNS(xmpDoc, 'http://purl.org/dc/elements/1.1/', 'title');
            assert.ok(title, 'Should find dc:title');

            // Find xmp:CreateDate
            const createDate = xml.findElementNS(xmpDoc, 'http://ns.adobe.com/xap/1.0/', 'CreateDate');
            assert.ok(createDate, 'Should find xmp:CreateDate');
        });

        test('parse → mutate → serialize → re-parse round-trip', () => {
            const xmpSource = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Test</rdf:li></rdf:Alt></dc:title>
      <xmp:CreateDate>2026-03-29T00:00:00Z</xmp:CreateDate>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

            const doc1 = xml.parseXML(xmpSource);
            assert.ok(doc1.children.length > 0);

            // Find rdf:Description and add a new element
            const rdfNS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
            const desc = xml.findElementNS(doc1, rdfNS, 'Description');
            assert.ok(desc, 'Should find rdf:Description');

            xml.createElement(desc, 'xmpMM:VersionID', 'http://ns.adobe.com/xap/1.0/mm/', '1');

            // Serialize
            const serialized = xml.serializeXML(doc1);
            assert.ok(serialized.includes('xmpMM:VersionID'));
            assert.ok(serialized.includes('<?xpacket begin='));
            assert.ok(serialized.includes('<?xpacket end='));

            // Re-parse
            const doc2 = xml.parseXML(serialized);
            const versionId = xml.findElementNS(doc2, 'http://ns.adobe.com/xap/1.0/mm/', 'VersionID');
            assert.ok(versionId, 'Should find xmpMM:VersionID after round-trip');
            assert.strictEqual(xml.getTextContent(versionId), '1');
        });
    });

    describe('Tolerant Mode', () => {
        test('recovers from mismatched tags', () => {
            const doc = xml.parseXML('<a><b></a></b>', { tolerant: true });
            assert.ok(doc.children.length > 0);
        });

        test('handles unclosed elements at EOF', () => {
            const doc = xml.parseXML('<root><child>text', { tolerant: true });
            assert.ok(doc.children.length > 0);
        });
    });

    describe('Acrobat Preflight Report', () => {
        test('parses preflight report XML extract', () => {
            const reportXML = `<?xml version="1.0" encoding="UTF-8"?>
<preflight_report>
    <profile_info>
        <profile_name>Verify compliance with PDF/X-4</profile_name>
    </profile_info>
    <results>
        <hits rule_id="RUL118" severity="Error">
            <hit page="1"/>
            <hit page="2"/>
        </hits>
    </results>
</preflight_report>`;

            const doc = xml.parseXML(reportXML);
            assert.ok(doc.xmlDeclaration);

            const profileName = xml.findElementNS(doc, '', 'profile_name');
            assert.ok(profileName);
            assert.strictEqual(xml.getTextContent(profileName), 'Verify compliance with PDF/X-4');

            const hits = xml.findAllElementsNS(doc, '', 'hit');
            assert.strictEqual(hits.length, 2);
            assert.strictEqual(hits[0].attributes.get('page'), '1');
            assert.strictEqual(hits[1].attributes.get('page'), '2');
        });
    });
});
