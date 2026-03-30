#!/usr/bin/env node
// @ts-check
/**
 * Quick verification of xml-markup-parser — no pdf-lib, no Playwright, no OOM risk.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import {
    tokenize, tokenizeFrom, tokenizeFromAsync, collectTree,
    parseXML, serializeXML, getTextContent, setTextContent,
    findElementNS, findAllElementsNS, createElement,
} from '../../classes/baseline/xml-markup-parser.js';

let pass = 0;
let fail = 0;

function test(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  PASS: ${name}`);
    } catch (e) {
        fail++;
        console.log(`  FAIL: ${name} — ${e.message}`);
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) throw new Error(`${message || 'Mismatch'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log('XML Markup Parser — Quick Tests\n');

// Basic parsing
console.log('Basic Parsing:');

test('empty element', () => {
    const doc = parseXML('<root/>');
    assertEqual(doc.children.length, 1);
    assertEqual(doc.children[0].type, 'element');
    assertEqual(/** @type {*} */ (doc.children[0]).name, 'root');
});

test('element with text', () => {
    const doc = parseXML('<greeting>Hello World</greeting>');
    assertEqual(getTextContent(/** @type {*} */ (doc.children[0])), 'Hello World');
});

test('nested elements', () => {
    const doc = parseXML('<a><b><c>deep</c></b></a>');
    const c = /** @type {*} */ (doc.children[0]).children[0].children[0];
    assertEqual(getTextContent(c), 'deep');
});

test('attributes', () => {
    const doc = parseXML('<item id="42" class="primary"/>');
    const el = /** @type {*} */ (doc.children[0]);
    assertEqual(el.attributes.get('id'), '42');
    assertEqual(el.attributes.get('class'), 'primary');
});

test('single-quoted attributes', () => {
    const doc = parseXML("<item name='test'/>");
    assertEqual(/** @type {*} */ (doc.children[0]).attributes.get('name'), 'test');
});

test('siblings', () => {
    const doc = parseXML('<root><a/><b/><c/></root>');
    assertEqual(/** @type {*} */ (doc.children[0]).children.length, 3);
});

// Namespaces
console.log('\nNamespaces:');

test('namespace declarations', () => {
    const doc = parseXML('<root xmlns:ns="http://example.com"><ns:child/></root>');
    const root = /** @type {*} */ (doc.children[0]);
    assertEqual(root.namespaces.get('ns'), 'http://example.com');
    assertEqual(root.children[0].prefix, 'ns');
    assertEqual(root.children[0].localName, 'child');
});

test('findElementNS', () => {
    const doc = parseXML('<root xmlns:a="urn:a" xmlns:b="urn:b"><a:item>first</a:item><b:item>second</b:item></root>');
    const a = findElementNS(doc, 'urn:a', 'item');
    assert(!!a, 'Should find a:item');
    assertEqual(getTextContent(/** @type {*} */ (a)), 'first');
});

// Special content
console.log('\nSpecial Content:');

test('comments', () => {
    const doc = parseXML('<root><!-- a comment --></root>');
    assertEqual(/** @type {*} */ (doc.children[0]).children[0].type, 'comment');
    assertEqual(/** @type {*} */ (doc.children[0]).children[0].value, ' a comment ');
});

test('CDATA', () => {
    const doc = parseXML('<root><![CDATA[<not&parsed>]]></root>');
    assertEqual(/** @type {*} */ (doc.children[0]).children[0].type, 'cdata');
    assertEqual(/** @type {*} */ (doc.children[0]).children[0].value, '<not&parsed>');
});

test('processing instructions', () => {
    const doc = parseXML('<?xml version="1.0"?><root/>');
    assert(!!doc.xmlDeclaration, 'Should have xmlDeclaration');
    assertEqual(doc.xmlDeclaration.target, 'xml');
});

test('entity references in text', () => {
    const doc = parseXML('<root>a &amp; b &lt; c</root>');
    assertEqual(getTextContent(/** @type {*} */ (doc.children[0])), 'a & b < c');
});

test('entity references in attributes', () => {
    const doc = parseXML('<root title="a &amp; b"/>');
    assertEqual(/** @type {*} */ (doc.children[0]).attributes.get('title'), 'a & b');
});

test('numeric char references', () => {
    const doc = parseXML('<root>&#65;&#x42;</root>');
    assertEqual(getTextContent(/** @type {*} */ (doc.children[0])), 'AB');
});

// Serialization
console.log('\nSerialization:');

test('round-trip simple', () => {
    const input = '<root><child attr="val">text</child></root>';
    assertEqual(serializeXML(parseXML(input)), input);
});

test('preserves PIs', () => {
    const input = '<?xpacket begin="\uFEFF" id="test"?><root/><?xpacket end="w"?>';
    const output = serializeXML(parseXML(input));
    assert(output.includes('<?xpacket begin='), 'Should preserve begin PI');
    assert(output.includes('<?xpacket end='), 'Should preserve end PI');
});

test('preserves CDATA', () => {
    const input = '<root><![CDATA[special <chars>]]></root>';
    assert(serializeXML(parseXML(input)).includes('<![CDATA[special <chars>]]>'), 'CDATA preserved');
});

test('preserves comments', () => {
    const input = '<root><!-- keep me --></root>';
    assert(serializeXML(parseXML(input)).includes('<!-- keep me -->'), 'Comment preserved');
});

// Mutation
console.log('\nMutation:');

test('setTextContent', () => {
    const doc = parseXML('<root><child>old</child></root>');
    setTextContent(/** @type {*} */ (doc.children[0]), 'new');
    assertEqual(getTextContent(/** @type {*} */ (doc.children[0])), 'new');
});

test('createElement', () => {
    const doc = parseXML('<root/>');
    const root = /** @type {*} */ (doc.children[0]);
    createElement(root, 'child', undefined, 'hello');
    assertEqual(root.children.length, 1);
    assertEqual(getTextContent(root.children[0]), 'hello');
});

test('createElement with namespace', () => {
    const doc = parseXML('<root/>');
    const root = /** @type {*} */ (doc.children[0]);
    createElement(root, 'xmpMM:VersionID', 'http://ns.adobe.com/xap/1.0/mm/', '1.0');
    assertEqual(root.children[0].name, 'xmpMM:VersionID');
    assertEqual(root.children[0].attributes.get('xmlns:xmpMM'), 'http://ns.adobe.com/xap/1.0/mm/');
});

// XMP round-trip
console.log('\nXMP Round-Trip:');

test('XMP parse → mutate → serialize → re-parse', () => {
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

    const doc = parseXML(xmpSource);
    const rdfNS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
    const desc = findElementNS(doc, rdfNS, 'Description');
    assert(!!desc, 'Should find rdf:Description');

    createElement(/** @type {*} */ (desc), 'xmpMM:VersionID', 'http://ns.adobe.com/xap/1.0/mm/', '1');

    const serialized = serializeXML(doc);
    assert(serialized.includes('xmpMM:VersionID'), 'Should contain VersionID');
    assert(serialized.includes('<?xpacket begin='), 'Should preserve xpacket');
    assert(serialized.includes('<?xpacket end='), 'Should preserve xpacket end');

    const doc2 = parseXML(serialized);
    const vId = findElementNS(doc2, 'http://ns.adobe.com/xap/1.0/mm/', 'VersionID');
    assert(!!vId, 'Should find VersionID after round-trip');
    assertEqual(getTextContent(/** @type {*} */ (vId)), '1');
});

// Preflight report
console.log('\nPreflight Report:');

test('parses preflight report XML', () => {
    const reportXML = `<?xml version="1.0" encoding="UTF-8"?>
<preflight_report>
    <profile_info><profile_name>Verify compliance with PDF/X-4</profile_name></profile_info>
    <results>
        <hits rule_id="RUL118" severity="Error"><hit page="1"/><hit page="2"/></hits>
    </results>
</preflight_report>`;

    const doc = parseXML(reportXML);
    const profileName = findElementNS(doc, '', 'profile_name');
    assert(!!profileName, 'Should find profile_name');
    assertEqual(getTextContent(/** @type {*} */ (profileName)), 'Verify compliance with PDF/X-4');

    const hits = findAllElementsNS(doc, '', 'hit');
    assertEqual(hits.length, 2);
    assertEqual(hits[0].attributes.get('page'), '1');
});

// Generator API
console.log('\nGenerator API:');

test('tokenize yields events', () => {
    const events = [...tokenize('<root><child>text</child></root>')];
    const types = events.map(e => e.type);
    assert(types.includes('element-open'), 'Should yield element-open');
    assert(types.includes('text'), 'Should yield text');
    assert(types.includes('element-close'), 'Should yield element-close');
});

test('tokenize yields PI events', () => {
    const events = [...tokenize('<?xml version="1.0"?><root/>')];
    const piEvents = events.filter(e => e.type === 'pi');
    assertEqual(piEvents.length, 1);
    assertEqual(piEvents[0].target, 'xml');
});

test('tokenize yields self-close events', () => {
    const events = [...tokenize('<root/>')];
    assertEqual(events.length, 1);
    assertEqual(events[0].type, 'element-self-close');
});

test('collectTree from tokenize matches parseXML', () => {
    const source = '<root><a attr="1">text</a><b/></root>';
    const fromParse = parseXML(source);
    const fromCollect = collectTree(tokenize(source));
    assertEqual(serializeXML(fromParse), serializeXML(fromCollect));
});

test('tokenizeFrom streams lines', () => {
    const lines = [
        '<?xml version="1.0"?>',
        '<root>',
        '  <child>hello</child>',
        '</root>',
    ];
    const events = [...tokenizeFrom(lines)];
    const opens = events.filter(e => e.type === 'element-open');
    assert(opens.length >= 1, 'Should yield element-open from streamed lines');
    const doc = collectTree(events);
    // Re-tokenize to collect — events are consumed
    const doc2 = collectTree(tokenizeFrom(lines));
    const root = doc2.children.find(c => c.type === 'element');
    assert(!!root, 'Should have root element');
});

test('tokenizeFromAsync streams async lines', async () => {
    async function* asyncLines() {
        yield '<root>';
        yield '  <item id="1">first</item>';
        yield '  <item id="2">second</item>';
        yield '</root>';
    }
    const events = [];
    for await (const event of tokenizeFromAsync(asyncLines())) {
        events.push(event);
    }
    const doc2 = collectTree(events);
    const items = findAllElementsNS(doc2, '', 'item');
    assertEqual(items.length, 2);
    assertEqual(items[0].attributes.get('id'), '1');
    assertEqual(items[1].attributes.get('id'), '2');
});

// Summary
console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
