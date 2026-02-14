[@conres.io/test-form-generator](README.md) / PDFDocumentColorConverter

# PDFDocumentColorConverter

PDFDocumentColorConverter - Document-level color conversion orchestrator.

Coordinates page converters for an entire PDF document.
Manages ProfilePool, BufferRegistry, and WorkerPool.

## Classes

### PDFDocumentColorConverter

Defined in: [classes/pdf-document-color-converter.js:78](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L78)

Orchestrates color conversion for an entire PDF document.

#### Example

```javascript
const documentConverter = new PDFDocumentColorConverter({
    destinationProfile: cmykProfile,
    destinationColorSpace: 'CMYK',
    renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: true,
    convertImages: true,
    convertContentStreams: true,
    useWorkers: true,
    verbose: true,
});

const result = await documentConverter.convertColor({
    pdfDocument: pdfDoc,
});

console.log(`Converted ${result.imagesConverted} images, ${result.contentStreamsConverted} streams`);
documentConverter.dispose();
```

#### Extends

- [`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter)

#### Constructors

##### Constructor

> **new PDFDocumentColorConverter**(`configuration`: [`PDFDocumentColorConverterConfiguration`](#pdfdocumentcolorconverterconfiguration-1)): [`PDFDocumentColorConverter`](#pdfdocumentcolorconverter)

Defined in: [classes/pdf-document-color-converter.js:99](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L99)

Creates a new PDFDocumentColorConverter.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `configuration` | [`PDFDocumentColorConverterConfiguration`](#pdfdocumentcolorconverterconfiguration-1) |  |

###### Returns

[`PDFDocumentColorConverter`](#pdfdocumentcolorconverter)

###### Overrides

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`constructor`](CompositeColorConverter.md#constructor)

#### Accessors

##### bufferRegistry

###### Get Signature

> **get** **bufferRegistry**(): [`BufferRegistry`](BufferRegistry.md#bufferregistry)

Defined in: [classes/pdf-document-color-converter.js:179](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L179)

###### Returns

[`BufferRegistry`](BufferRegistry.md#bufferregistry)

##### configuration

###### Get Signature

> **get** **configuration**(): `Readonly`\<[`PDFDocumentColorConverterConfiguration`](#pdfdocumentcolorconverterconfiguration-1)\>

Defined in: [classes/pdf-document-color-converter.js:165](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L165)

###### Returns

`Readonly`\<[`PDFDocumentColorConverterConfiguration`](#pdfdocumentcolorconverterconfiguration-1)\>

###### Inherited from

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`configuration`](CompositeColorConverter.md#configuration)

##### profilePool

###### Get Signature

> **get** **profilePool**(): [`ProfilePool`](ProfilePool.md#profilepool)

Defined in: [classes/pdf-document-color-converter.js:172](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L172)

###### Returns

[`ProfilePool`](ProfilePool.md#profilepool)

#### Methods

##### applyWorkerResult()

> **applyWorkerResult**(`input`: [`PDFDocumentColorConverterInput`](#pdfdocumentcolorconverterinput), `workerResult`: [`WorkerResult`](ColorConverter.md#workerresult), `context`: `any`): `Promise`\<`void`\>

Defined in: [classes/pdf-document-color-converter.js:877](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L877)

Applies worker processing results back to the PDF document.

This is the top-level method that actually writes transformed data back
to the PDF structure. It receives results from all pages and applies
them by:
1. Creating new PDFRawStream objects with compressed data
2. Updating stream dictionaries (Filter, ColorSpace, BitsPerComponent)
3. Assigning the new streams to their original references

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFDocumentColorConverterInput`](#pdfdocumentcolorconverterinput) | Original document input |
| `workerResult` | [`WorkerResult`](ColorConverter.md#workerresult) | Document-level worker result |
| `context` | `any` | Conversion context |

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`applyWorkerResult`](CompositeColorConverter.md#applyworkerresult)

##### convertColor()

> **convertColor**(`input`: [`PDFDocumentColorConverterInput`](#pdfdocumentcolorconverterinput), `context?`: `any`): `Promise`\<[`PDFDocumentColorConverterResult`](#pdfdocumentcolorconverterresult)\>

Defined in: [classes/pdf-document-color-converter.js:287](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L287)

Converts colors in an entire PDF document.

Processes each page sequentially, coordinating image and content stream
conversion through PDFPageColorConverter instances.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFDocumentColorConverterInput`](#pdfdocumentcolorconverterinput) | Document to convert |
| `context?` | `any` | Conversion context |

###### Returns

`Promise`\<[`PDFDocumentColorConverterResult`](#pdfdocumentcolorconverterresult)\>

##### deriveImageConfiguration()

> **deriveImageConfiguration**(`imageRef`: `any`, `pageRef?`: `any`): [`PDFImageColorConverterConfiguration`](PDFImageColorConverter.md#pdfimagecolorconverterconfiguration-1)

Defined in: [classes/pdf-document-color-converter.js:243](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L243)

Derives configuration for a specific image (convenience method).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `imageRef` | `any` | The image reference |
| `pageRef?` | `any` | Optional page reference for page-level overrides |

###### Returns

[`PDFImageColorConverterConfiguration`](PDFImageColorConverter.md#pdfimagecolorconverterconfiguration-1)

##### derivePageConfiguration()

> **derivePageConfiguration**(`pageRef`: `any`): [`PDFPageColorConverterConfiguration`](PDFPageColorConverter.md#pdfpagecolorconverterconfiguration-1)

Defined in: [classes/pdf-document-color-converter.js:193](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L193)

Derives configuration for a specific page.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `pageRef` | `any` | The page reference |

###### Returns

[`PDFPageColorConverterConfiguration`](PDFPageColorConverter.md#pdfpagecolorconverterconfiguration-1)

##### dispose()

> **dispose**(): `void`

Defined in: [classes/pdf-document-color-converter.js:997](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L997)

Disposes of all owned resources.

###### Returns

`void`

###### Inherited from

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`dispose`](CompositeColorConverter.md#dispose)

##### ensureReady()

> **ensureReady**(): `Promise`\<`void`\>

Defined in: [classes/pdf-document-color-converter.js:153](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L153)

Ensures the converter is ready for use.
Overrides parent to include document-level initialization.

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`ensureReady`](CompositeColorConverter.md#ensureready)

##### prepareWorkerTask()

> **prepareWorkerTask**(`input`: [`PDFDocumentColorConverterInput`](#pdfdocumentcolorconverterinput), `context`: `any`): `any`

Defined in: [classes/pdf-document-color-converter.js:852](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L852)

Prepares worker tasks for the entire document.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFDocumentColorConverterInput`](#pdfdocumentcolorconverterinput) |  |
| `context` | `any` |  |

###### Returns

`any`

###### Inherited from

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`prepareWorkerTask`](CompositeColorConverter.md#prepareworkertask)

## Type Aliases

### PDFDocumentColorConverterConfiguration

> **PDFDocumentColorConverterConfiguration**\<\> = [`PDFPageColorConverterConfiguration`](PDFPageColorConverter.md#pdfpagecolorconverterconfiguration-1) & \{ `colorEnginePath?`: `string`; `engineVersion?`: `string`; `maxCachedProfiles?`: `number`; `maxProfileMemory?`: `number`; `pageOverrides?`: `Map`\<`any`, `Partial`\<[`PDFPageColorConverterConfiguration`](PDFPageColorConverter.md#pdfpagecolorconverterconfiguration-1)\>\>; `profilePool?`: [`ProfilePool`](ProfilePool.md#profilepool); \}

Defined in: [classes/pdf-document-color-converter.js:32](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L32)

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `colorEnginePath?` | `string` | [classes/pdf-document-color-converter.js:26](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L26) |
| `engineVersion?` | `string` | [classes/pdf-document-color-converter.js:31](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L31) |
| `maxCachedProfiles?` | `number` | [classes/pdf-document-color-converter.js:28](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L28) |
| `maxProfileMemory?` | `number` | [classes/pdf-document-color-converter.js:29](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L29) |
| `pageOverrides?` | `Map`\<`any`, `Partial`\<[`PDFPageColorConverterConfiguration`](PDFPageColorConverter.md#pdfpagecolorconverterconfiguration-1)\>\> | [classes/pdf-document-color-converter.js:30](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L30) |
| `profilePool?` | [`ProfilePool`](ProfilePool.md#profilepool) | [classes/pdf-document-color-converter.js:27](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L27) |

#### Type Parameters

| Type Parameter |
| ------ |

***

### PDFDocumentColorConverterInput

> **PDFDocumentColorConverterInput**\<\> = \{ `pdfDocument`: `any`; \}

Defined in: [classes/pdf-document-color-converter.js:38](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L38)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="pdfdocument"></a> `pdfDocument` | `any` | [classes/pdf-document-color-converter.js:37](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L37) |

***

### PDFDocumentColorConverterResult

> **PDFDocumentColorConverterResult**\<\> = \{ `contentStreamsConverted`: `number`; `errors`: `string`[]; `imagesConverted`: `number`; `pageResults`: [`PDFPageColorConverterResult`](PDFPageColorConverter.md#pdfpagecolorconverterresult)[]; `pagesProcessed`: `number`; `totalColorOperationsConverted`: `number`; \}

Defined in: [classes/pdf-document-color-converter.js:49](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L49)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="contentstreamsconverted"></a> `contentStreamsConverted` | `number` | [classes/pdf-document-color-converter.js:45](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L45) |
| <a id="errors"></a> `errors` | `string`[] | [classes/pdf-document-color-converter.js:47](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L47) |
| <a id="imagesconverted"></a> `imagesConverted` | `number` | [classes/pdf-document-color-converter.js:44](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L44) |
| <a id="pageresults"></a> `pageResults` | [`PDFPageColorConverterResult`](PDFPageColorConverter.md#pdfpagecolorconverterresult)[] | [classes/pdf-document-color-converter.js:48](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L48) |
| <a id="pagesprocessed"></a> `pagesProcessed` | `number` | [classes/pdf-document-color-converter.js:43](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L43) |
| <a id="totalcoloroperationsconverted"></a> `totalColorOperationsConverted` | `number` | [classes/pdf-document-color-converter.js:46](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-document-color-converter.js#L46) |
