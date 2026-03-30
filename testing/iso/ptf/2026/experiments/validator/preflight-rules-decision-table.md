# PDF/X-4 Preflight Rules — Decision Table (Revised)

Based on Acrobat preflight reports from the pdf-lib validation suite,
pdf-lib load/inspection testing, and Acrobat behavior observations.

Total: 223 rules

## Page Geometry

| Rule   | Display Name                                            | Capability | Relevance    | Notes                                                             |
| ------ | ------------------------------------------------------- | ---------- | ------------ | ----------------------------------------------------------------- |
| RUL95  | Page has TrimBox and ArtBox (but must only have one ... | check      | confirmed    | Confirmed by Acrobat (pg-02).                                     |
| RUL103 | Page does not have MediaBox                             | check      | important    | pdf-lib detects. Acrobat did not flag separately (pg-03) — pdf... |
| RUL122 | Page does not have TrimBox or ArtBox                    | check-fix  | critical     | Set from MediaBox. Confirmed by Acrobat (pg-01).                  |
| RUL155 | Page boxes not nested properly                          | check      | confirmed    | Confirmed by Acrobat (pg-04). Compare box coordinates.            |
| RUL204 | Viewer preferences not MediaBox or BleedBox             | check      | nice-to-have | Check ViewerPreferences CropBox entry.                            |

## Document Structure

| Rule   | Display Name                                            | Capability   | Relevance    | Notes                                                             |
| ------ | ------------------------------------------------------- | ------------ | ------------ | ----------------------------------------------------------------- |
| RUL2   | Syntax problem: Indirect object with number 0           | check        | nice-to-have | Enumerate objects, check objectNumber === 0.                      |
| RUL9   | Stream object contains F entry                          | check        | nice-to-have |                                                                   |
| RUL10  | Image uses compression type prohibited in PDF/X-4       | check        | nice-to-have | Check Filter entries against PDF/X-4 allowed list.                |
| RUL18  | Syntax problem: String object in content stream with... | check        | nice-to-have | Decode content streams, scan string token lengths.                |
| RUL31  | Implementation limit: Integer value out of range (to... | check        | nice-to-have | Scan PDFNumber values.                                            |
| RUL44  | Syntax problem: Name object with 0 byte length          | check        | nice-to-have | Traverse dicts, check PDFName.encodedName.length.                 |
| RUL48  | Document has alternate presentations                    | check        | not-relevant |                                                                   |
| RUL85  | Separation color representations for special colors ... | check        | nice-to-have |                                                                   |
| RUL86  | Document contains additional actions (AA)               | check        | important    | Check AA entries on catalog, pages.                               |
| RUL90  | Document contains actions                               | check        | confirmed    | Confirmed by Acrobat (ds-05 triggered this too). Check OpenAct... |
| RUL91  | Document contains XFA entry                             | check        | not-relevant | Generator does not use XFA.                                       |
| RUL110 | Spot color representations are inconsistent             | check        | nice-to-have |                                                                   |
| RUL113 | Document is damaged and needs repair                    | detect-throw | critical     | pdf-lib throws at load. Acrobat: "file is damaged" (ds-02). Br... |
| RUL114 | Syntax problem: Real value out of range (too low)       | check        | nice-to-have | Traverse all PDFNumber values, check ranges.                      |
| RUL117 | Page uses compression type prohibited in PDF/X-4        | check        | nice-to-have | Check Filter entries against PDF/X-4 allowed list.                |
| RUL126 | Alternate image uses compression type prohibited in ... | check        | nice-to-have | Check Filter entries against PDF/X-4 allowed list.                |
| RUL127 | Document ID missing                                     | check-fix    | critical     | Generate random ID. Confirmed by Acrobat (ds-01 — in baseline).   |
| RUL129 | Invalid content stream parameter                        | partial      | nice-to-have | Can do basic operand count validation.                            |
| RUL135 | Implementation limit: Max. number of nested graphic ... | check        | nice-to-have | Acrobat did NOT flag 29-level nesting (cs-02). May need deeper... |
| RUL138 | Syntax problem: Real value out of range (positive to... | check        | nice-to-have | Traverse all PDFNumber values, check ranges.                      |
| RUL142 | Error in PDF syntax                                     | detect-throw | important    | pdf-lib throws at load time.                                      |
| RUL145 | DeviceN/NChannel MixingHints dictionaries have incon... | check        | not-relevant |                                                                   |
| RUL148 | Document permissions have invalid access control        | check        | nice-to-have |                                                                   |
| RUL156 | Document is encrypted                                   | check        | important    | Check trailerInfo.Encrypt. pdf-lib confirmed (ds-06).             |
| RUL162 | Document uses compression type prohibited in PDF/X-4    | check        | nice-to-have | Check Filter entries against PDF/X-4 allowed list.                |
| RUL163 | Syntax problem: Real value out of range (negative to... | check        | nice-to-have | Traverse all PDFNumber values, check ranges.                      |
| RUL167 | Document contains encrypted data                        | check        | important    | Check for Crypt filter in streams.                                |
| RUL175 | Implementation limit: Integer value out of range (to... | check        | nice-to-have | Scan PDFNumber values.                                            |
| RUL183 | Syntax problem: Real value out of range (too high)      | check        | nice-to-have | Traverse all PDFNumber values, check ranges.                      |
| RUL186 | LZW compression used                                    | check        | nice-to-have | Scan stream Filter entries for LZWDecode.                         |
| RUL191 | Syntax problem: Unknown operator                        | check        | confirmed    | Confirmed by Acrobat (cs-01). Decode streams, validate against... |
| RUL192 | Implementation limit: CID (character identifier) gre... | partial      | nice-to-have | Would need CIDFont dict inspection.                               |
| RUL197 | Implementation limit: More than 8388607 indirect obj... | check        | nice-to-have | Count enumerateIndirectObjects().                                 |
| RUL207 | Implementation limit: Name object with a length grea... | check        | nice-to-have | Scan PDFName encodedName lengths (limit 127).                     |
| RUL209 | Document contains JavaScripts                           | check        | confirmed    | Confirmed by Acrobat (ds-05). Check Names/JavaScript.             |
| RUL218 | DeviceN/NChannel MixingHints dictionaries have incon... | check        | not-relevant |                                                                   |
| RUL220 | Form XObject contains Ref key (referenced PDF)          | check        | nice-to-have | Check Form XObjects for /Ref key.                                 |

## XMP Metadata

| Rule   | Display Name                                            | Capability | Relevance    | Notes                                                             |
| ------ | ------------------------------------------------------- | ---------- | ------------ | ----------------------------------------------------------------- |
| RUL5   | XMP does not have ModifyDate entry in the XMP Basic ... | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Add missing XMP entry.       |
| RUL13  | PDFXVersion key does not use PDFDocEncoding             | check      | nice-to-have |                                                                   |
| RUL14  | Compressed metadata stream on document or on object ... | check      | nice-to-have | Check stream Filter on Metadata object.                           |
| RUL19  | XMP uses deprecated attribute: “encoding”               | check      | nice-to-have |                                                                   |
| RUL23  | xmp:CreateDate entry is empty                           | check-fix  | important    | Populate from Info dict.                                          |
| RUL25  | Author mismatch between Document Info and XMP Metadata  | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Sync Author between Info ... |
| RUL29  | Producer mismatch between Document Info and XMP Meta... | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Sync Producer between Inf... |
| RUL34  | XMP for a page object uses deprecated attribute: “en... | check      | nice-to-have |                                                                   |
| RUL38  | Document XMP metadata is not valid                      | check      | important    | Basic XMP well-formedness check (XML parse).                      |
| RUL42  | XMP “PDF/X Identification extension schema” does not... | check-fix  | critical     | Set GTS_PDFXVersion in XMP. Also needs pdfxid prefix.             |
| RUL54  | Metadata missing (XMP)                                  | check-fix  | critical     | Confirmed by Acrobat (xm-01, in baseline). Generate minimal XMP.  |
| RUL59  | XMP “Adobe PDF Schema” does not use ‘pdf’ prefix        | check      | nice-to-have | XMP namespace prefix validation.                                  |
| RUL60  | Object XMP metadata is not valid                        | check      | important    | Basic XMP well-formedness check (XML parse).                      |
| RUL64  | PDF/X entry in Document info present (must only be p... | check      | nice-to-have |                                                                   |
| RUL69  | XMP “Dublin Core Schema” does not use ‘dc’ prefix       | check      | nice-to-have | XMP namespace prefix validation.                                  |
| RUL70  | Creator mismatch between Document Info and XMP Metadata | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Sync Creator between Info... |
| RUL73  | Trapped key not present in XMP metadata                 | check-fix  | confirmed    | Confirmed by Acrobat (xm-02). Add Trapped entry.                  |
| RUL76  | Metadata namespace for the GTS_PDFXVersion entry has... | check      | nice-to-have |                                                                   |
| RUL89  | XMP does not have a DocumentID entry in the XMP Medi... | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Add missing XMP entry.       |
| RUL98  | XMP “XMP Basic Schema” does not use ‘xmp’ prefix        | check      | nice-to-have | XMP namespace prefix validation.                                  |
| RUL99  | Trapped entry mismatch between Document Info and XMP    | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Sync Trapped between Info... |
| RUL118 | XMP “XMP Media Management Schema” does not use ‘xmpM... | check      | nice-to-have | XMP namespace prefix validation.                                  |
| RUL123 | Metadata does not conform to XMP                        | check      | important    |                                                                   |
| RUL124 | Subject mismatch between Document Info and XMP Metadata | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Sync Subject between Info... |
| RUL128 | Title mismatch between Document Info and XMP Metadata   | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Sync Title between Info d... |
| RUL130 | XMP does not have MetadataDate entry in the XMP Basi... | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Add missing XMP entry.       |
| RUL133 | Keyword mismatch between Document Info and XMP Metadata | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Sync Keywords between Inf... |
| RUL143 | PDFXVersion entry mismatch between Document info and... | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Sync PDFXVersion between ... |
| RUL149 | PDF/X-4p entry missing or incorrect                     | check-fix  | critical     | Set GTS_PDFXVersion in XMP. Also needs pdfxid prefix.             |
| RUL152 | Creation date mismatch between Document Info and XMP... | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Sync CreationDate between... |
| RUL161 | Trapped key in Metadata neither True nor False          | check      | nice-to-have |                                                                   |
| RUL166 | XMP dc:title entry is empty                             | check-fix  | important    | Populate from Info dict.                                          |
| RUL178 | XMP does not have a RenditionClass entry in the XMP ... | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Add missing XMP entry.       |
| RUL195 | xmp:ModifyDate entry is empty                           | check-fix  | important    | Populate from Info dict.                                          |
| RUL196 | XMP does not have a VersionID entry in the XMP Media... | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Add missing XMP entry.       |
| RUL203 | XMP does not have CreateDate entry in the XMP Basic ... | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Add missing XMP entry.       |
| RUL206 | XMP for a page object uses deprecated attribute: “by... | check      | nice-to-have |                                                                   |
| RUL210 | XMP uses deprecated attribute: “bytes”                  | check      | nice-to-have |                                                                   |
| RUL211 | Last Modification Date mismatch between Document Inf... | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Sync ModDate between Info... |
| RUL222 | xmp:MetadataDate entry is empty                         | check-fix  | important    | Populate from Info dict.                                          |
| RUL223 | XMP does not have “title” entry in the Dublin Core S... | check-fix  | confirmed    | Confirmed by Acrobat (xm-02 extras). Add missing XMP entry.       |

## Output Intent

| Rule   | Display Name                                            | Capability     | Relevance    | Notes                                              |
| ------ | ------------------------------------------------------- | -------------- | ------------ | -------------------------------------------------- |
| RUL1   | Transparency blend color space identical to destinat... | check          | important    | Cross-check blend CS with output intent.           |
| RUL3   | DeviceN uses CMYK process color space but OutputInte... | check          | important    | Depends on output intent profile color space.      |
| RUL7   | OutputIntent Info contains XML code                     | check          | nice-to-have |                                                    |
| RUL11  | Number of PDF/X OutputIntent entries > 1                | check          | important    |                                                    |
| RUL12  | OutputCondition not of type string                      | check          | nice-to-have |                                                    |
| RUL17  | OutputIntent Info not of type string                    | check          | nice-to-have |                                                    |
| RUL22  | ICC profile is not valid                                | check          | important    | Parse ICC header, verify signature.                |
| RUL24  | Reference to destination profile: URL is not a file ... | check          | not-relevant | PDF/X-4p only (DestOutputProfileRef).              |
| RUL26  | OutputIntent for PDF/X missing                          | check          | critical     | Confirmed in baseline. Can offer to embed profile. |
| RUL28  | TrapNet has FontFauxing set to true                     | not-applicable | not-relevant | Generator does not use TrapNet.                    |
| RUL32  | Reference to destination profile: ICC version not pr... | check          | not-relevant | PDF/X-4p only (DestOutputProfileRef).              |
| RUL35  | Referenced destination profile is not available         | check          | not-relevant | PDF/X-4p only.                                     |
| RUL36  | ICC profile in OutputIntent older than version 2.0      | check          | important    | Read ICC header version field.                     |
| RUL39  | TrapNet process color model Gray but destination pro... | not-applicable | not-relevant | Generator does not use TrapNet.                    |
| RUL58  | CMYK used for transparency blend color space but Out... | check          | important    | Depends on output intent profile color space.      |
| RUL62  | DeviceN uses Gray process color space but OutputInte... | check          | important    | Depends on output intent profile color space.      |
| RUL65  | OutputCondition contains XML code                       | check          | nice-to-have |                                                    |
| RUL66  | DeviceGray used for transparency blend color space b... | check          | important    | Depends on output intent profile color space.      |
| RUL67  | DeviceGray used for alt. color but PDF/X OutputInten... | check          | important    | Depends on output intent profile color space.      |
| RUL68  | TrapNet annotation present but Trapped key (in XMP M... | not-applicable | not-relevant | Generator does not use TrapNet.                    |
| RUL72  | OutputConditionIdentifier contains XML code             | check          | nice-to-have |                                                    |
| RUL75  | Reference Output Intent dictionary has no ICCVersion... | check          | not-relevant | PDF/X-4p only.                                     |
| RUL77  | TrapNet process color model CMYK but destination pro... | not-applicable | not-relevant | Generator does not use TrapNet.                    |
| RUL79  | ICC profile is not valid                                | check          | important    | Parse ICC header, verify signature.                |
| RUL81  | DeviceN uses RGB process color space but OutputInten... | check          | important    | Depends on output intent profile color space.      |
| RUL84  | DeviceGray used but OutputIntent not Gray or CMYK       | check          | important    | Depends on output intent profile color space.      |
| RUL96  | Reference to the destination output profile does not... | check          | not-relevant | PDF/X-4p only (DestOutputProfileRef).              |
| RUL97  | OutputConditionIdentifier missing                       | check          | important    |                                                    |
| RUL101 | CMYK used for alt. color but PDF/X OutputIntent not ... | check          | important    | Depends on output intent profile color space.      |
| RUL102 | CMYK used but PDF/X OutputIntent not CMYK               | check          | important    | Depends on output intent profile color space.      |
| RUL104 | Reference to destination profile: Color space not Gr... | check          | not-relevant | PDF/X-4p only (DestOutputProfileRef).              |
| RUL107 | Reference to destination profile: Colorant table pre... | check          | not-relevant | PDF/X-4p only (DestOutputProfileRef).              |
| RUL111 | Reference to destination profile: Checksum is not pr... | check          | not-relevant | PDF/X-4p only (DestOutputProfileRef).              |
| RUL112 | TrapNet process color model RGB but destination prof... | not-applicable | not-relevant | Generator does not use TrapNet.                    |
| RUL115 | RGB used but PDF/X OutputIntent not RGB                 | check          | important    | Depends on output intent profile color space.      |
| RUL116 | Color space of destination profile is none of ‘Gray’... | check          | important    | Read ICC header color space.                       |
| RUL134 | Reference to destination profile: Name is not a string  | check          | not-relevant | PDF/X-4p only (DestOutputProfileRef).              |
| RUL139 | Reference to destination profile: Color space is not... | check          | not-relevant | PDF/X-4p only (DestOutputProfileRef).              |
| RUL141 | ICC profile in OutputIntent newer than version 4        | check          | important    | Read ICC header version field.                     |
| RUL146 | Reference to the destination output profile does not... | check          | not-relevant | PDF/X-4p only (DestOutputProfileRef).              |
| RUL150 | Reference to the destination output profile does not... | check          | not-relevant | PDF/X-4p only (DestOutputProfileRef).              |
| RUL151 | OutputConditionIdentifier not of type string            | check          | nice-to-have |                                                    |
| RUL153 | Reference Output Intent dictionary has no ProfileCS ... | check          | not-relevant | PDF/X-4p only.                                     |
| RUL164 | Annotation other than TrapNet or PrinterMark inside ... | not-applicable | not-relevant | Generator does not use TrapNet.                    |
| RUL169 | RGB used for transparency blend color space but Outp... | check          | important    | Depends on output intent profile color space.      |
| RUL181 | RegistryName not of type string                         | check          | nice-to-have |                                                    |
| RUL182 | Reference to destination profile: ICC version not a ... | check          | not-relevant | PDF/X-4p only (DestOutputProfileRef).              |
| RUL189 | OutputIntent profile not 'prtr'                         | check          | nice-to-have | Check ICC header device class.                     |
| RUL190 | Version of OutputIntent ICC profile neither 2 nor 4     | check          | important    |                                                    |
| RUL194 | TrapNet Annotation error                                | not-applicable | not-relevant | Generator does not use TrapNet.                    |
| RUL199 | Destination profile embedded in OutputIntent            | check          | not-relevant | PDF/X-4p only.                                     |
| RUL200 | Reference to destination profile: URL uses file syst... | check          | not-relevant | PDF/X-4p only (DestOutputProfileRef).              |
| RUL208 | No entry for the referenced ICC profile present in t... | check          | important    | Check DestOutputProfile presence.                  |
| RUL213 | Reference to the destination output profile is not p... | check          | not-relevant | PDF/X-4p only (DestOutputProfileRef).              |
| RUL214 | RGB used for alt. color but PDF/X OutputIntent not RGB  | check          | important    | Depends on output intent profile color space.      |

## Optional Content

| Rule   | Display Name                                            | Capability | Relevance    | Notes                                                             |
| ------ | ------------------------------------------------------- | ---------- | ------------ | ----------------------------------------------------------------- |
| RUL4   | An optional content group does not have a name          | check-fix  | confirmed    | Acrobat flagged OCCD Name, not OCG Name (oc-01). Add Name to OCG. |
| RUL47  | Optional content configuration dictionary name is no... | check      | nice-to-have |                                                                   |
| RUL80  | No default view for layer configuration defined (D e... | check-fix  | important    |                                                                   |
| RUL106 | Optional content configuration dictionary has no Nam... | check-fix  | confirmed    | Confirmed by Acrobat (oc-02). Add Name entry to OCCD.             |
| RUL131 | Layer (OCG) not listed in the document’s list of lay... | check-fix  | critical     | Strip unregistered OCG references.                                |
| RUL158 | OCCD contains Order key that does not reference all ... | check      | nice-to-have |                                                                   |
| RUL160 | The required 'OCGs' array within the 'OCProperties' ... | check-fix  | important    |                                                                   |
| RUL168 | Optional content configuration dictionary has AS entry  | check-fix  | important    | Remove AS entry.                                                  |

## Color Space

| Rule   | Display Name                                            | Capability     | Relevance    | Notes                                                |
| ------ | ------------------------------------------------------- | -------------- | ------------ | ---------------------------------------------------- |
| RUL15  | The color table of an Indexed color space is greater... | check          | nice-to-have | Check Indexed CS hival <= 255 and lookup table size. |
| RUL16  | Invalid function object used in color space             | partial        | nice-to-have | Can check function dict structure, not evaluate.     |
| RUL21  | ICCbased CMYK is set to overprint but OPM is on (str... | check          | nice-to-have |                                                      |
| RUL33  | Spot color name uses improper escaping for special c... | check          | nice-to-have |                                                      |
| RUL46  | The needed color space for an image could not be read   | check          | nice-to-have | Check image ColorSpace resolves.                     |
| RUL49  | DeviceN color does not have colorant entry for all s... | check          | nice-to-have |                                                      |
| RUL53  | Invalid rendering intent                                | check          | nice-to-have |                                                      |
| RUL61  | Invalid color space                                     | check          | nice-to-have | Validate CS array structure.                         |
| RUL71  | Invalid rendering intent                                | check          | nice-to-have |                                                      |
| RUL121 | CMYK source profile identical with destination profi... | check          | nice-to-have |                                                      |
| RUL137 | Max. number (32) of colorants for DeviceN exceeded      | check          | nice-to-have |                                                      |
| RUL140 | ICCbased CMYK is set to overprint but OPM is on         | check          | nice-to-have |                                                      |
| RUL147 | JPEG2000 image does not have 1, 3 or 4 channels         | not-applicable | not-relevant | Generator does not use JPEG2000.                     |
| RUL159 | JPEG2000 image has more than one color space            | not-applicable | not-relevant | Generator does not use JPEG2000.                     |
| RUL165 | JPEG2000 image uses inconsistent bit-depth in its ch... | not-applicable | not-relevant | Generator does not use JPEG2000.                     |
| RUL179 | DeviceN/NChannel MixingHints dictionary contains Dot... | check          | not-relevant |                                                      |
| RUL198 | JPEG2000 image does not use either 1, 8 or 16 bits p... | not-applicable | not-relevant | Generator does not use JPEG2000.                     |
| RUL215 | Missing ColorSpace                                      | check          | nice-to-have | Check CS refs resolve.                               |
| RUL219 | JPEG2000 image uses CIEJab compression                  | not-applicable | not-relevant | Generator does not use JPEG2000.                     |
| RUL221 | Spot color name is not a valid UTF-8 string             | check          | nice-to-have |                                                      |

## Font

| Rule   | Display Name                                            | Capability    | Relevance    | Notes                                                             |
| ------ | ------------------------------------------------------- | ------------- | ------------ | ----------------------------------------------------------------- |
| RUL8   | TrueType font has differences to standard encodings ... | check         | nice-to-have | Check font Flags + Encoding dict.                                 |
| RUL27  | A Type0 font has no encoding entry                      | check         | nice-to-have | Check Type0 font for Encoding key.                                |
| RUL51  | Character references .notdef glyph                      | not-checkable | nice-to-have | Requires font file parsing.                                       |
| RUL63  | The name object which describes the font encoding is... | check         | nice-to-have | Validate Encoding against known names.                            |
| RUL82  | Wrong encoding for non-symbolic TrueType font           | check         | nice-to-have | Check non-symbolic TrueType Encoding value.                       |
| RUL109 | Font name uses improper escaping for special characters | check         | nice-to-have |                                                                   |
| RUL125 | Different font types in PDF font and embedded font file | check         | nice-to-have | Cross-check Subtype vs FontFile/FontFile2/FontFile3.              |
| RUL154 | Wrong Length entry found in FontDescriptor              | check         | nice-to-have | Compare FontDescriptor Length1/2/3 with stream sizes.             |
| RUL170 | Font name is not a valid UTF-8 string                   | check         | nice-to-have |                                                                   |
| RUL172 | More than one encoding in symbolic TrueType font's cmap | not-checkable | nice-to-have | Requires parsing embedded font cmap table.                        |
| RUL173 | Glyphs missing in embedded font                         | not-checkable | nice-to-have | Requires font file + content stream glyph correlation.            |
| RUL174 | Invalid length entries in embedded Type1 (PostScript... | not-checkable | not-relevant |                                                                   |
| RUL184 | Encoding entry prohibited for symbolic TrueType font    | check         | nice-to-have | Check symbolic TrueType for Encoding entry.                       |
| RUL187 | A CMap used in the PDF is corrupt                       | not-checkable | nice-to-have | Requires CMap stream parsing.                                     |
| RUL201 | Font is not valid                                       | detect        | important    |                                                                   |
| RUL202 | Missing font                                            | detect        | confirmed    | Confirmed by Acrobat (mr-02). Cross-ref Tf ops with Resources/... |
| RUL212 | The 'Widths' array in a font has an invalid length      | check         | nice-to-have | Same check as above.                                              |
| RUL217 | Font not embedded (and text rendering mode not 3)       | detect        | confirmed    | Confirmed by Acrobat (fn-01). Check FontDescriptor for FontFil... |

## Image

| Rule   | Display Name                                           | Capability | Relevance    | Notes                                    |
| ------ | ------------------------------------------------------ | ---------- | ------------ | ---------------------------------------- |
| RUL56  | An alternate image or required parts of it are missing | check      | not-relevant | Generator does not use alternate images. |
| RUL57  | Alternate image is default for printing                | check      | not-relevant | Generator does not use alternate images. |
| RUL74  | Image is not valid                                     | detect     | important    |                                          |
| RUL185 | Image has OPI information                              | check      | not-relevant | Generator does not use OPI.              |

## Transparency

| Rule   | Display Name                            | Capability | Relevance    | Notes |
| ------ | --------------------------------------- | ---------- | ------------ | ----- |
| RUL176 | Blend mode not conform to PDF Reference | check      | nice-to-have |       |

## Missing Resources

| Rule   | Display Name                   | Capability | Relevance    | Notes                                                             |
| ------ | ------------------------------ | ---------- | ------------ | ----------------------------------------------------------------- |
| RUL30  | Missing XObject                | check      | confirmed    | Confirmed by Acrobat (mr-01). Cross-ref Do ops with Resources/... |
| RUL144 | Missing Extended Graphic State | check      | confirmed    | Confirmed by Acrobat (mr-03). Cross-ref gs ops with Resources/... |
| RUL157 | Missing pattern                | check      | nice-to-have | Cross-ref pattern ops with Resources/Pattern.                     |
| RUL171 | Missing shading                | check      | nice-to-have | Cross-ref sh ops with Resources/Shading.                          |
| RUL188 | Missing Resource               | check      | nice-to-have | General resource resolution check.                                |

## Form XObject

| Rule  | Display Name                                       | Capability | Relevance | Notes                                                             |
| ----- | -------------------------------------------------- | ---------- | --------- | ----------------------------------------------------------------- |
| RUL92 | A required 'Subtype' entry is missing              | check      | critical  | fx-02 CRASHED Acrobat (error 18). Must detect and prevent.        |
| RUL93 | A required 'BBox' entry is missing in Form XObject | check      | important | Acrobat did NOT flag our test (fx-01) — pdf-lib may auto-add B... |

## Annotations

| Rule   | Display Name                                            | Capability | Relevance    | Notes                                      |
| ------ | ------------------------------------------------------- | ---------- | ------------ | ------------------------------------------ |
| RUL180 | Annotation Border Style is wrong                        | check      | nice-to-have | Check annotation BS/Border dict structure. |
| RUL216 | Annotation of type PrinterMark inside TrimBox or ArtBox | check      | nice-to-have |                                            |

## Other

| Rule   | Display Name                                            | Capability    | Relevance    | Notes                                                   |
| ------ | ------------------------------------------------------- | ------------- | ------------ | ------------------------------------------------------- |
| RUL6   | Interactive form field inside page area                 | check         | not-relevant |                                                         |
| RUL20  | TR2 entry used with value other than Default            | check         | nice-to-have |                                                         |
| RUL37  | The 'Domain' entry in function array is too large       | check         | nice-to-have |                                                         |
| RUL40  | Transfer function in halftone dictionary improperly ... | check         | not-relevant |                                                         |
| RUL41  | Invalid command                                         | check         | nice-to-have |                                                         |
| RUL43  | A character code is not correct defined in the codes... | check         | nice-to-have |                                                         |
| RUL45  | PRCWzDocu_SyntaxCheckTypeMissing_long                   | check         | nice-to-have |                                                         |
| RUL50  | PostScript operator embedded                            | check         | not-relevant | Generator does not use PostScript.                      |
| RUL52  | PRCWzDocu_SyntaxCheckFontWrongName_long                 | check         | nice-to-have |                                                         |
| RUL55  | Width information for glyphs is inconsistent            | check         | nice-to-have |                                                         |
| RUL78  | An Outline (Bookmark) entry has no Title                | check         | nice-to-have | Traverse Outlines tree, check Title.                    |
| RUL83  | Halftone not of type 1 or 5                             | check         | not-relevant |                                                         |
| RUL87  | A 'UseCMap' entry in a CMap does not match the 'UseC... | check         | nice-to-have |                                                         |
| RUL88  | An unknown error has occurred                           | not-checkable | nice-to-have | Acrobat catch-all.                                      |
| RUL94  | The 'Version' key in an OPI is not a fixed or intege... | check         | not-relevant |                                                         |
| RUL100 | Transfer curve used                                     | check         | not-relevant |                                                         |
| RUL105 | Page has PresSteps defined                              | check         | not-relevant |                                                         |
| RUL108 | Image and it’s alternate do not have same size and p... | check         | nice-to-have |                                                         |
| RUL119 | PostScript embedded (XObject)                           | check         | not-relevant | Generator does not use PostScript.                      |
| RUL120 | Invalid tagging structure                               | partial       | nice-to-have | Can check StructTreeRoot presence, not full validation. |
| RUL132 | Page is a separated plate                               | check         | not-relevant |                                                         |
| RUL136 | HalftoneName key present                                | check         | not-relevant |                                                         |
| RUL177 | Halftone phase entry present                            | check         | not-relevant |                                                         |
| RUL193 | Illegal recursion in Outline (Bookmark) structure tree  | check         | nice-to-have | Traverse with visited set, detect cycles.               |
| RUL205 | PostScript embedded (PostScript Form XObject)           | check         | not-relevant | Generator does not use PostScript.                      |

## Summary

### By Capability

| Capability     | Count | Description                             |
| -------------- | ----- | --------------------------------------- |
| check          | 162   | Can detect with pdf-lib (report only)   |
| check-fix      | 33    | Can detect AND fix with pdf-lib         |
| not-applicable | 12    | Feature not used by generator           |
| not-checkable  | 6     | Beyond pdf-lib capabilities             |
| partial        | 4     | Can approximate but not fully verify    |
| detect         | 4     | Can detect but cannot fix               |
| detect-throw   | 2     | pdf-lib throws at load time (pre-parse) |

### By Relevance

| Relevance    | Count | Description                                        |
| ------------ | ----- | -------------------------------------------------- |
| nice-to-have | 95    | Valid check, low priority                          |
| not-relevant | 50    | Feature our generator does not produce             |
| important    | 40    | PDF/X-4 compliance error                           |
| confirmed    | 29    | Acrobat preflight confirmed our test triggers this |
| critical     | 9     | Blocks opening or causes crashes                   |