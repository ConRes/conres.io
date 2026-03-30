#!/usr/bin/env node
// @ts-check
/**
 * Build the final decision table for all PDF/X-4 preflight rules.
 * Incorporates findings from:
 * - Acrobat preflight reports on the pdf-lib validation suite
 * - pdf-lib load/inspection testing
 * - Acrobat behavior observations (crashes, batch breaks)
 *
 * Capability levels:
 *   check-fix    — can detect AND fix with pdf-lib
 *   check        — can detect with pdf-lib (report only)
 *   detect-throw — pdf-lib throws at load time (pre-parse check)
 *   detect       — can detect presence but cannot fix
 *   partial      — can approximate but not fully verify
 *   not-checkable — requires capabilities beyond pdf-lib
 *   not-applicable — feature not used by our generator
 *
 * Relevance levels:
 *   critical     — blocks opening or causes crashes in Acrobat
 *   important    — PDF/X-4 compliance error, visible in preflight
 *   confirmed    — Acrobat preflight confirmed our test case triggers this rule
 *   nice-to-have — valid check but low priority
 *   not-relevant — feature our generator does not produce
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFile, writeFile } from 'fs/promises';

const REPORT_PATH = '2026-03-30 - ConRes - ISO PTF - CR1 (F10a) Assets - Canon iPR C10000VP series Coated MGCR v1.2 - K-Only GCR with Blackpoint Compensation - Report.xml';

const xml = await readFile(REPORT_PATH, 'utf-8');

// Extract rules
const ruleRegex = /<rule\s+id="(RUL\d+)"\s+creator_id="[^"]*"\s+dict_key="([^"]*)">\s*<display_name>([^<]*)<\/display_name>\s*<display_comment>([^<]*)<\/display_comment>/g;
const rules = [];
let match;
while ((match = ruleRegex.exec(xml))) {
    rules.push({
        id: match[1],
        dictKey: match[2],
        name: match[3].replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
        comment: match[4].replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
    });
}

// Extract conditions per rule
const conditionRegex = /<condition\s+id="(CND\d+)"\s+creator_id="[^"]*"\s+property_key="([^"]*)">/g;
const condProps = new Map();
while ((match = conditionRegex.exec(xml))) condProps.set(match[1], match[2]);

const ruleCondRegex = /<condition\s+id="(CND\d+)"[^>]*>[\s\S]*?<rules>([\s\S]*?)<\/rules>/g;
const ruleConds = new Map();
while ((match = ruleCondRegex.exec(xml))) {
    const condId = match[1];
    for (const ref of match[2].matchAll(/<rule\s+id="(RUL\d+)">/g)) {
        if (!ruleConds.has(ref[1])) ruleConds.set(ref[1], new Set());
        ruleConds.get(ref[1]).add(condId);
    }
}

// ============================================================================
// Classification based on ALL evidence
// ============================================================================

function classify(rule, conditions) {
    const name = rule.name.toLowerCase();
    const dk = rule.dictKey.toLowerCase();

    // --- PAGE GEOMETRY ---
    if (name.includes('does not have trimbox or artbox'))
        return { cat: 'Page Geometry', cap: 'check-fix', rel: 'critical', note: 'Set from MediaBox. Confirmed by Acrobat (pg-01).' };
    if (name.includes('has trimbox and artbox'))
        return { cat: 'Page Geometry', cap: 'check', rel: 'confirmed', note: 'Confirmed by Acrobat (pg-02).' };
    if (name.includes('does not have mediabox'))
        return { cat: 'Page Geometry', cap: 'check', rel: 'important', note: 'pdf-lib detects. Acrobat did not flag separately (pg-03) — pdf-lib may re-add MediaBox on save.' };
    if (name.includes('boxes not nested'))
        return { cat: 'Page Geometry', cap: 'check', rel: 'confirmed', note: 'Confirmed by Acrobat (pg-04). Compare box coordinates.' };
    if (name.includes('viewer preferences') && (name.includes('mediabox') || name.includes('bleedbox')))
        return { cat: 'Page Geometry', cap: 'check', rel: 'nice-to-have', note: 'Check ViewerPreferences CropBox entry.' };

    // --- DOCUMENT STRUCTURE ---
    if (name.includes('document id missing'))
        return { cat: 'Document Structure', cap: 'check-fix', rel: 'critical', note: 'Generate random ID. Confirmed by Acrobat (ds-01 — in baseline).' };
    if (name.includes('document is damaged'))
        return { cat: 'Document Structure', cap: 'detect-throw', rel: 'critical', note: 'pdf-lib throws at load. Acrobat: "file is damaged" (ds-02). Breaks Action Wizard batch.' };
    if (name.includes('document is encrypted'))
        return { cat: 'Document Structure', cap: 'check', rel: 'important', note: 'Check trailerInfo.Encrypt. pdf-lib confirmed (ds-06).' };
    if (name.includes('contains encrypted data'))
        return { cat: 'Document Structure', cap: 'check', rel: 'important', note: 'Check for Crypt filter in streams.' };
    if (name.includes('contains javascript'))
        return { cat: 'Document Structure', cap: 'check', rel: 'confirmed', note: 'Confirmed by Acrobat (ds-05). Check Names/JavaScript.' };
    if (name.includes('contains actions') && !name.includes('additional'))
        return { cat: 'Document Structure', cap: 'check', rel: 'confirmed', note: 'Confirmed by Acrobat (ds-05 triggered this too). Check OpenAction, AA entries.' };
    if (name.includes('additional actions'))
        return { cat: 'Document Structure', cap: 'check', rel: 'important', note: 'Check AA entries on catalog, pages.' };
    if (name.includes('contains xfa'))
        return { cat: 'Document Structure', cap: 'check', rel: 'not-relevant', note: 'Generator does not use XFA.' };
    if (name.includes('alternate presentations'))
        return { cat: 'Document Structure', cap: 'check', rel: 'not-relevant', note: '' };
    if (name.includes('permissions') && name.includes('invalid'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('lzw compression'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: 'Scan stream Filter entries for LZWDecode.' };
    if (name.includes('compression type prohibited'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: 'Check Filter entries against PDF/X-4 allowed list.' };
    if (name.includes('form xobject contains ref'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: 'Check Form XObjects for /Ref key.' };
    if (name.includes('stream object contains f entry'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('separation') && name.includes('inconsistent'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('spot color representations'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('mixinghints') && name.includes('printing'))
        return { cat: 'Document Structure', cap: 'check', rel: 'not-relevant', note: '' };
    if (name.includes('mixinghints') && name.includes('solidit'))
        return { cat: 'Document Structure', cap: 'check', rel: 'not-relevant', note: '' };

    // Syntax problems — pdf-lib throws or can scan
    if (name.includes('syntax problem') && name.includes('indirect object'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: 'Enumerate objects, check objectNumber === 0.' };
    if (name.includes('syntax problem') && name.includes('string object'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: 'Decode content streams, scan string token lengths.' };
    if (name.includes('syntax problem') && name.includes('name object'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: 'Traverse dicts, check PDFName.encodedName.length.' };
    if (name.includes('syntax problem') && name.includes('real value'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: 'Traverse all PDFNumber values, check ranges.' };
    if (name.includes('syntax problem') && name.includes('unknown operator'))
        return { cat: 'Document Structure', cap: 'check', rel: 'confirmed', note: 'Confirmed by Acrobat (cs-01). Decode streams, validate against known operator set.' };
    if (name.includes('error in pdf syntax'))
        return { cat: 'Document Structure', cap: 'detect-throw', rel: 'important', note: 'pdf-lib throws at load time.' };
    if (name.includes('implementation limit') && name.includes('integer'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: 'Scan PDFNumber values.' };
    if (name.includes('implementation limit') && name.includes('name'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: 'Scan PDFName encodedName lengths (limit 127).' };
    if (name.includes('implementation limit') && name.includes('indirect objects'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: 'Count enumerateIndirectObjects().' };
    if (name.includes('implementation limit') && name.includes('nested'))
        return { cat: 'Document Structure', cap: 'check', rel: 'nice-to-have', note: 'Acrobat did NOT flag 29-level nesting (cs-02). May need deeper test.' };
    if (name.includes('implementation limit') && name.includes('cid'))
        return { cat: 'Document Structure', cap: 'partial', rel: 'nice-to-have', note: 'Would need CIDFont dict inspection.' };
    if (name.includes('invalid content stream parameter'))
        return { cat: 'Document Structure', cap: 'partial', rel: 'nice-to-have', note: 'Can do basic operand count validation.' };

    // --- XMP METADATA ---
    if (name.includes('metadata missing (xmp)'))
        return { cat: 'XMP Metadata', cap: 'check-fix', rel: 'critical', note: 'Confirmed by Acrobat (xm-01, in baseline). Generate minimal XMP.' };
    if (name.includes('pdf/x-4p entry missing') || (name.includes('pdf/x') && name.includes('identification') && name.includes('schema')))
        return { cat: 'XMP Metadata', cap: 'check-fix', rel: 'critical', note: 'Set GTS_PDFXVersion in XMP. Also needs pdfxid prefix.' };
    if (name.includes('pdf/x-4 entry missing'))
        return { cat: 'XMP Metadata', cap: 'check-fix', rel: 'critical', note: 'In baseline. Set GTS_PDFXVersion in XMP.' };
    if (name.includes('mismatch between document info and xmp')) {
        const field = name.includes('producer') ? 'Producer' : name.includes('author') ? 'Author' :
            name.includes('creator') ? 'Creator' : name.includes('title') ? 'Title' :
            name.includes('subject') ? 'Subject' : name.includes('keyword') ? 'Keywords' :
            name.includes('creation date') ? 'CreationDate' : name.includes('modification date') ? 'ModDate' :
            name.includes('trapped') ? 'Trapped' : name.includes('pdfxversion') ? 'PDFXVersion' : 'unknown';
        return { cat: 'XMP Metadata', cap: 'check-fix', rel: 'confirmed', note: `Confirmed by Acrobat (xm-02 extras). Sync ${field} between Info dict and XMP.` };
    }
    if (name.includes('xmp') && name.includes('does not have') && name.includes('entry'))
        return { cat: 'XMP Metadata', cap: 'check-fix', rel: 'confirmed', note: 'Confirmed by Acrobat (xm-02 extras). Add missing XMP entry.' };
    if (name.includes('entry is empty') && (name.includes('xmp') || name.includes('createdate') || name.includes('modifydate') || name.includes('metadatadate') || name.includes('title')))
        return { cat: 'XMP Metadata', cap: 'check-fix', rel: 'important', note: 'Populate from Info dict.' };
    if (name.includes('trapped key not present'))
        return { cat: 'XMP Metadata', cap: 'check-fix', rel: 'confirmed', note: 'Confirmed by Acrobat (xm-02). Add Trapped entry.' };
    if (name.includes('trapped key') && name.includes('neither true nor false'))
        return { cat: 'XMP Metadata', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('trapped entry mismatch'))
        return { cat: 'XMP Metadata', cap: 'check-fix', rel: 'important', note: 'Sync Trapped between Info dict and XMP.' };
    if (name.includes('does not use') && name.includes('prefix'))
        return { cat: 'XMP Metadata', cap: 'check', rel: 'nice-to-have', note: 'XMP namespace prefix validation.' };
    if (name.includes('metadata') && name.includes('not valid'))
        return { cat: 'XMP Metadata', cap: 'check', rel: 'important', note: 'Basic XMP well-formedness check (XML parse).' };
    if (name.includes('metadata') && name.includes('conform to xmp'))
        return { cat: 'XMP Metadata', cap: 'check', rel: 'important', note: '' };
    if (name.includes('compressed metadata'))
        return { cat: 'XMP Metadata', cap: 'check', rel: 'nice-to-have', note: 'Check stream Filter on Metadata object.' };
    if (name.includes('deprecated attribute'))
        return { cat: 'XMP Metadata', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('metadata namespace') && name.includes('additional'))
        return { cat: 'XMP Metadata', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('pdf/x entry in document info'))
        return { cat: 'XMP Metadata', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('pdfxversion') && name.includes('pdfdocencoding'))
        return { cat: 'XMP Metadata', cap: 'check', rel: 'nice-to-have', note: '' };

    // --- OUTPUT INTENT ---
    if (name.includes('outputintent for pdf/x missing'))
        return { cat: 'Output Intent', cap: 'check', rel: 'critical', note: 'Confirmed in baseline. Can offer to embed profile.' };
    if (name.includes('icc profile missing in') && name.includes('outputintent'))
        return { cat: 'Output Intent', cap: 'check', rel: 'critical', note: 'In baseline. DestOutputProfile missing.' };
    if (name.includes('outputconditionidentifier') && name.includes('missing'))
        return { cat: 'Output Intent', cap: 'check', rel: 'important', note: '' };
    if (name.includes('number of pdf/x outputintent entries'))
        return { cat: 'Output Intent', cap: 'check', rel: 'important', note: '' };
    if (name.includes('destination profile embedded in outputintent'))
        return { cat: 'Output Intent', cap: 'check', rel: 'not-relevant', note: 'PDF/X-4p only.' };
    if (name.includes('reference to') && name.includes('destination') && (name.includes('output profile') || name.includes('dest')))
        return { cat: 'Output Intent', cap: 'check', rel: 'not-relevant', note: 'PDF/X-4p only (DestOutputProfileRef).' };
    if (name.includes('referenced destination profile'))
        return { cat: 'Output Intent', cap: 'check', rel: 'not-relevant', note: 'PDF/X-4p only.' };
    if (name.includes('reference output intent dictionary'))
        return { cat: 'Output Intent', cap: 'check', rel: 'not-relevant', note: 'PDF/X-4p only.' };
    if (name.includes('icc profile') && name.includes('not valid'))
        return { cat: 'Output Intent', cap: 'check', rel: 'important', note: 'Parse ICC header, verify signature.' };
    if (name.includes('icc profile in outputintent') && name.includes('version'))
        return { cat: 'Output Intent', cap: 'check', rel: 'important', note: 'Read ICC header version field.' };
    if (name.includes('version of outputintent icc'))
        return { cat: 'Output Intent', cap: 'check', rel: 'important', note: '' };
    if (name.includes('outputintent profile not'))
        return { cat: 'Output Intent', cap: 'check', rel: 'nice-to-have', note: 'Check ICC header device class.' };
    if (name.includes('color space of destination profile'))
        return { cat: 'Output Intent', cap: 'check', rel: 'important', note: 'Read ICC header color space.' };
    if (name.includes('trapnet'))
        return { cat: 'Output Intent', cap: 'not-applicable', rel: 'not-relevant', note: 'Generator does not use TrapNet.' };
    if (name.includes('outputcondition') && (name.includes('xml') || name.includes('type') || name.includes('string')))
        return { cat: 'Output Intent', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('outputintent info') && (name.includes('xml') || name.includes('type') || name.includes('string')))
        return { cat: 'Output Intent', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('registryname'))
        return { cat: 'Output Intent', cap: 'check', rel: 'nice-to-have', note: '' };
    // Color space vs output intent checks
    if ((name.includes('cmyk used') || name.includes('rgb used') || name.includes('gray used') || name.includes('devicegray used') || name.includes('devicecmyk') || name.includes('devicergb')) && name.includes('outputintent'))
        return { cat: 'Output Intent', cap: 'check', rel: 'important', note: 'Depends on output intent profile color space.' };
    if (name.includes('devicen') && name.includes('outputintent'))
        return { cat: 'Output Intent', cap: 'check', rel: 'important', note: 'Depends on output intent profile color space.' };
    if (name.includes('transparency blend') && name.includes('outputintent'))
        return { cat: 'Output Intent', cap: 'check', rel: 'important', note: 'Cross-check blend CS with output intent.' };
    if (name.includes('for alt. color') && name.includes('outputintent'))
        return { cat: 'Output Intent', cap: 'check', rel: 'important', note: '' };
    if (name.includes('no entry for the referenced icc'))
        return { cat: 'Output Intent', cap: 'check', rel: 'important', note: 'Check DestOutputProfile presence.' };

    // --- OPTIONAL CONTENT ---
    if (name.includes('optional content group') && name.includes('does not have a name'))
        return { cat: 'Optional Content', cap: 'check-fix', rel: 'confirmed', note: 'Acrobat flagged OCCD Name, not OCG Name (oc-01). Add Name to OCG.' };
    if (name.includes('optional content configuration') && name.includes('no name'))
        return { cat: 'Optional Content', cap: 'check-fix', rel: 'confirmed', note: 'Confirmed by Acrobat (oc-02). Add Name entry to OCCD.' };
    if (name.includes('optional content configuration') && name.includes('name is not unique'))
        return { cat: 'Optional Content', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('layer') && name.includes('not listed'))
        return { cat: 'Optional Content', cap: 'check-fix', rel: 'critical', note: 'Strip unregistered OCG references.' };
    if (name.includes('no default view') && name.includes('ocproperties'))
        return { cat: 'Optional Content', cap: 'check-fix', rel: 'important', note: '' };
    if (name.includes('occd') && name.includes('order') && name.includes('not reference'))
        return { cat: 'Optional Content', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('ocgs') && name.includes('array') && name.includes('missing'))
        return { cat: 'Optional Content', cap: 'check-fix', rel: 'important', note: '' };
    if (name.includes('optional content configuration') && name.includes('as entry'))
        return { cat: 'Optional Content', cap: 'check-fix', rel: 'important', note: 'Remove AS entry.' };

    // --- COLOR SPACE ---
    if (name.includes('jpeg2000'))
        return { cat: 'Color Space', cap: 'not-applicable', rel: 'not-relevant', note: 'Generator does not use JPEG2000.' };
    if (name.includes('iccbased cmyk') && name.includes('overprint'))
        return { cat: 'Color Space', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('cmyk source profile identical'))
        return { cat: 'Color Space', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('spot color') && name.includes('escaping'))
        return { cat: 'Color Space', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('spot color') && name.includes('utf'))
        return { cat: 'Color Space', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('colorant entry'))
        return { cat: 'Color Space', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('max. number') && name.includes('colorant'))
        return { cat: 'Color Space', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('mixinghints'))
        return { cat: 'Color Space', cap: 'check', rel: 'not-relevant', note: '' };
    if (name.includes('indexed') && name.includes('color'))
        return { cat: 'Color Space', cap: 'check', rel: 'nice-to-have', note: 'Check Indexed CS hival <= 255 and lookup table size.' };
    if (name.includes('invalid function'))
        return { cat: 'Color Space', cap: 'partial', rel: 'nice-to-have', note: 'Can check function dict structure, not evaluate.' };
    if (name.includes('invalid color space'))
        return { cat: 'Color Space', cap: 'check', rel: 'nice-to-have', note: 'Validate CS array structure.' };
    if (name.includes('invalid rendering intent'))
        return { cat: 'Color Space', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('needed color space') && name.includes('could not be read'))
        return { cat: 'Color Space', cap: 'check', rel: 'nice-to-have', note: 'Check image ColorSpace resolves.' };
    if (name.includes('missing colorspace'))
        return { cat: 'Color Space', cap: 'check', rel: 'nice-to-have', note: 'Check CS refs resolve.' };

    // --- FONT ---
    if (name.includes('font not embedded') && name.includes('text rendering'))
        return { cat: 'Font', cap: 'detect', rel: 'confirmed', note: 'Confirmed by Acrobat (fn-01). Check FontDescriptor for FontFile/2/3. Cannot fix.' };
    if (name.includes('missing font'))
        return { cat: 'Font', cap: 'detect', rel: 'confirmed', note: 'Confirmed by Acrobat (mr-02). Cross-ref Tf ops with Resources/Font.' };
    if (name.includes('font is not valid'))
        return { cat: 'Font', cap: 'detect', rel: 'important', note: '' };
    if (name.includes('font name') && name.includes('escaping'))
        return { cat: 'Font', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('font name') && name.includes('utf'))
        return { cat: 'Font', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('font name') && name.includes('unique'))
        return { cat: 'Font', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('widths') && name.includes('inconsistent'))
        return { cat: 'Font', cap: 'check', rel: 'nice-to-have', note: 'Acrobat did NOT flag our test (fn-02) — flagged missing font instead. Check Widths length vs FirstChar/LastChar.' };
    if (name.includes('widths') && name.includes('invalid length'))
        return { cat: 'Font', cap: 'check', rel: 'nice-to-have', note: 'Same check as above.' };
    if (name.includes('wrong length') && name.includes('fontdescriptor'))
        return { cat: 'Font', cap: 'check', rel: 'nice-to-have', note: 'Compare FontDescriptor Length1/2/3 with stream sizes.' };
    if (name.includes('different font types'))
        return { cat: 'Font', cap: 'check', rel: 'nice-to-have', note: 'Cross-check Subtype vs FontFile/FontFile2/FontFile3.' };
    if (name.includes('encoding') && name.includes('prohibited') && name.includes('symbolic'))
        return { cat: 'Font', cap: 'check', rel: 'nice-to-have', note: 'Check symbolic TrueType for Encoding entry.' };
    if (name.includes('encoding') && name.includes('non-symbolic'))
        return { cat: 'Font', cap: 'check', rel: 'nice-to-have', note: 'Check non-symbolic TrueType Encoding value.' };
    if (name.includes('truetype') && name.includes('encoding') && name.includes('differences'))
        return { cat: 'Font', cap: 'check', rel: 'nice-to-have', note: 'Check font Flags + Encoding dict.' };
    if (name.includes('type0') && name.includes('no encoding'))
        return { cat: 'Font', cap: 'check', rel: 'nice-to-have', note: 'Check Type0 font for Encoding key.' };
    if (name.includes('encoding') && name.includes('unknown'))
        return { cat: 'Font', cap: 'check', rel: 'nice-to-have', note: 'Validate Encoding against known names.' };
    if (name.includes('more than one encoding') && name.includes('cmap'))
        return { cat: 'Font', cap: 'not-checkable', rel: 'nice-to-have', note: 'Requires parsing embedded font cmap table.' };
    if (name.includes('glyph') && name.includes('missing'))
        return { cat: 'Font', cap: 'not-checkable', rel: 'nice-to-have', note: 'Requires font file + content stream glyph correlation.' };
    if (name.includes('.notdef'))
        return { cat: 'Font', cap: 'not-checkable', rel: 'nice-to-have', note: 'Requires font file parsing.' };
    if (name.includes('cmap') && name.includes('corrupt'))
        return { cat: 'Font', cap: 'not-checkable', rel: 'nice-to-have', note: 'Requires CMap stream parsing.' };
    if (name.includes('usecmap') && name.includes('mismatch'))
        return { cat: 'Font', cap: 'not-checkable', rel: 'nice-to-have', note: 'Requires CMap stream parsing.' };
    if (name.includes('font') && name.includes('wrong name'))
        return { cat: 'Font', cap: 'check', rel: 'nice-to-have', note: 'Compare BaseFont vs FontDescriptor FontName.' };
    if (name.includes('postscript') && name.includes('length'))
        return { cat: 'Font', cap: 'not-checkable', rel: 'not-relevant', note: '' };

    // --- IMAGE ---
    if (name.includes('image') && name.includes('compression') && name.includes('prohibited'))
        return { cat: 'Image', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('alternate image'))
        return { cat: 'Image', cap: 'check', rel: 'not-relevant', note: 'Generator does not use alternate images.' };
    if (name.includes('image') && name.includes('opi'))
        return { cat: 'Image', cap: 'check', rel: 'not-relevant', note: 'Generator does not use OPI.' };
    if (name.includes('image') && name.includes('not valid'))
        return { cat: 'Image', cap: 'detect', rel: 'important', note: '' };
    if (name.includes('image') && name.includes('rendering intent'))
        return { cat: 'Image', cap: 'check', rel: 'nice-to-have', note: '' };

    // --- TRANSPARENCY ---
    if (name.includes('blend mode'))
        return { cat: 'Transparency', cap: 'check', rel: 'nice-to-have', note: '' };

    // --- ANNOTATIONS ---
    if (name.includes('annotation') && name.includes('inside'))
        return { cat: 'Annotations', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('printermark'))
        return { cat: 'Annotations', cap: 'check', rel: 'not-relevant', note: '' };
    if (name.includes('annotation border'))
        return { cat: 'Annotations', cap: 'check', rel: 'nice-to-have', note: 'Check annotation BS/Border dict structure.' };

    // --- MISSING RESOURCES ---
    if (name.includes('missing xobject'))
        return { cat: 'Missing Resources', cap: 'check', rel: 'confirmed', note: 'Confirmed by Acrobat (mr-01). Cross-ref Do ops with Resources/XObject.' };
    if (name.includes('missing extended graphic'))
        return { cat: 'Missing Resources', cap: 'check', rel: 'confirmed', note: 'Confirmed by Acrobat (mr-03). Cross-ref gs ops with Resources/ExtGState.' };
    if (name.includes('missing pattern'))
        return { cat: 'Missing Resources', cap: 'check', rel: 'nice-to-have', note: 'Cross-ref pattern ops with Resources/Pattern.' };
    if (name.includes('missing shading'))
        return { cat: 'Missing Resources', cap: 'check', rel: 'nice-to-have', note: 'Cross-ref sh ops with Resources/Shading.' };
    if (name.includes('missing resource'))
        return { cat: 'Missing Resources', cap: 'check', rel: 'nice-to-have', note: 'General resource resolution check.' };

    // --- FORM XOBJECT ---
    if (name.includes('bbox') && name.includes('missing') && name.includes('form'))
        return { cat: 'Form XObject', cap: 'check', rel: 'important', note: 'Acrobat did NOT flag our test (fx-01) — pdf-lib may auto-add BBox. Check Form XObjects for BBox.' };
    if (name.includes('subtype') && name.includes('missing'))
        return { cat: 'Form XObject', cap: 'check', rel: 'critical', note: 'fx-02 CRASHED Acrobat (error 18). Must detect and prevent.' };

    // --- OTHER / NOT RELEVANT ---
    if (name.includes('postscript'))
        return { cat: 'Other', cap: 'check', rel: 'not-relevant', note: 'Generator does not use PostScript.' };
    if (name.includes('halftone') || name.includes('transfer function') || name.includes('transfer curve'))
        return { cat: 'Other', cap: 'check', rel: 'not-relevant', note: '' };
    if (name.includes('interactive form field'))
        return { cat: 'Other', cap: 'check', rel: 'not-relevant', note: '' };
    if (name.includes('page is a separated'))
        return { cat: 'Other', cap: 'check', rel: 'not-relevant', note: '' };
    if (name.includes('pressteps'))
        return { cat: 'Other', cap: 'check', rel: 'not-relevant', note: '' };
    if (name.includes('outline') && name.includes('no title'))
        return { cat: 'Other', cap: 'check', rel: 'nice-to-have', note: 'Traverse Outlines tree, check Title.' };
    if (name.includes('outline') && name.includes('recursion'))
        return { cat: 'Other', cap: 'check', rel: 'nice-to-have', note: 'Traverse with visited set, detect cycles.' };
    if (name.includes('tagging structure'))
        return { cat: 'Other', cap: 'partial', rel: 'nice-to-have', note: 'Can check StructTreeRoot presence, not full validation.' };
    if (name.includes('domain') && name.includes('function'))
        return { cat: 'Other', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('tr2 entry'))
        return { cat: 'Other', cap: 'check', rel: 'nice-to-have', note: '' };
    if (name.includes('opi') && name.includes('version'))
        return { cat: 'Other', cap: 'check', rel: 'not-relevant', note: '' };
    if (name.includes('unknown error'))
        return { cat: 'Other', cap: 'not-checkable', rel: 'nice-to-have', note: 'Acrobat catch-all.' };

    // Fallback
    return { cat: 'Other', cap: 'check', rel: 'nice-to-have', note: '' };
}

// Build output
const lines = [];
lines.push('# PDF/X-4 Preflight Rules — Decision Table (Revised)');
lines.push('');
lines.push('Based on Acrobat preflight reports from the pdf-lib validation suite,');
lines.push('pdf-lib load/inspection testing, and Acrobat behavior observations.');
lines.push('');
lines.push(`Total: ${rules.length} rules`);
lines.push('');

const sorted = rules.sort((a, b) => parseInt(a.id.replace('RUL', '')) - parseInt(b.id.replace('RUL', '')));

const grouped = new Map();
for (const rule of sorted) {
    const conds = ruleConds.get(rule.id) ?? new Set();
    const { cat, cap, rel, note } = classify(rule, conds);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat).push({ ...rule, cap, rel, note });
}

const categoryOrder = [
    'Page Geometry', 'Document Structure', 'XMP Metadata', 'Output Intent',
    'Optional Content', 'Color Space', 'Font', 'Image', 'Transparency',
    'Missing Resources', 'Form XObject', 'Annotations', 'Other',
];

for (const cat of categoryOrder) {
    const entries = grouped.get(cat);
    if (!entries) continue;
    lines.push(`## ${cat}`);
    lines.push('');
    lines.push('| Rule | Display Name | Capability | Relevance | Notes |');
    lines.push('|------|-------------|-----------|-----------|-------|');
    for (const e of entries) {
        const truncName = e.name.length > 55 ? e.name.slice(0, 52) + '...' : e.name;
        const truncNote = e.note.length > 65 ? e.note.slice(0, 62) + '...' : e.note;
        lines.push(`| ${e.id} | ${truncName} | ${e.cap} | ${e.rel} | ${truncNote} |`);
    }
    lines.push('');
}

// Summary tables
lines.push('## Summary');
lines.push('');

const capCounts = new Map();
const relCounts = new Map();
for (const entries of grouped.values()) {
    for (const e of entries) {
        capCounts.set(e.cap, (capCounts.get(e.cap) ?? 0) + 1);
        relCounts.set(e.rel, (relCounts.get(e.rel) ?? 0) + 1);
    }
}

lines.push('### By Capability');
lines.push('');
lines.push('| Capability | Count | Description |');
lines.push('|-----------|-------|-------------|');
const capDescs = {
    'check-fix': 'Can detect AND fix with pdf-lib',
    'check': 'Can detect with pdf-lib (report only)',
    'detect-throw': 'pdf-lib throws at load time (pre-parse)',
    'detect': 'Can detect but cannot fix',
    'partial': 'Can approximate but not fully verify',
    'not-checkable': 'Beyond pdf-lib capabilities',
    'not-applicable': 'Feature not used by generator',
};
for (const [cap, count] of [...capCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${cap} | ${count} | ${capDescs[cap] ?? ''} |`);
}

lines.push('');
lines.push('### By Relevance');
lines.push('');
lines.push('| Relevance | Count | Description |');
lines.push('|-----------|-------|-------------|');
const relDescs = {
    'critical': 'Blocks opening or causes crashes',
    'confirmed': 'Acrobat preflight confirmed our test triggers this',
    'important': 'PDF/X-4 compliance error',
    'nice-to-have': 'Valid check, low priority',
    'not-relevant': 'Feature our generator does not produce',
};
for (const [rel, count] of [...relCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${rel} | ${count} | ${relDescs[rel] ?? ''} |`);
}

await writeFile('preflight-rules-decision-table.md', lines.join('\n'));
console.log(`Written to preflight-rules-decision-table.md (${rules.length} rules)`);

// Print critical rules
console.log('\nCRITICAL RULES:');
for (const entries of grouped.values()) {
    for (const e of entries) {
        if (e.rel === 'critical') console.log(`  ${e.id}: ${e.name} [${e.cap}]`);
    }
}
