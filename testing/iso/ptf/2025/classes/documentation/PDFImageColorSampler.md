[@conres.io/test-form-generator](README.md) / PDFImageColorSampler

# PDFImageColorSampler

PDF Image Color Sampler

Extends PDFImageColorConverter for analysis use cases.
Provides pixel sampling and Float32 Lab output for Delta-E computation.

IMPORTANT: This class is for ANALYSIS ONLY, not PDF output.
Float32 Lab output cannot be written back to PDF documents.

## Classes

### PDFImageColorSampler

Defined in: [classes/pdf-image-color-sampler.js:125](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L125)

Samples pixels from PDF images and converts to Lab for analysis.

This class is designed for color comparison workflows that need:
- Pixel sampling (not full image conversion)
- Float32 Lab output for precise Delta-E computation
- Direct TypedArray output (not PDF-compatible streams)

LIMITATIONS:
- Output cannot be written to PDF (Float32 has no big-endian support)
- destinationColorSpace must be 'Lab'
- destinationProfile must be 'Lab'

#### Example

```javascript
import { PDFImageColorSampler } from './classes/pdf-image-color-sampler.js';
import { ImageSampler } from '../experiments/classes/image-sampler.mjs';

// Create sampler for random pixel selection
const imageSampler = new ImageSampler({ sampling: 'random', count: 10000 });

// Create color sampler for Lab conversion
const colorSampler = new PDFImageColorSampler({
    renderingIntent: 'relative-colorimetric',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: false,
    destinationProfile: 'Lab',
    destinationColorSpace: 'Lab',
    inputType: 'CMYK',
    compressOutput: false, // Not applicable for analysis mode
    verbose: false,
});

// Sample pixel indices
const sampling = imageSampler.sample(imageWidth, imageHeight);

// Extract and convert sampled pixels to Lab
const result = await colorSampler.samplePixels({
    streamRef: imageRef,
    streamData: compressedImageData,
    isCompressed: true,
    width: imageWidth,
    height: imageHeight,
    colorSpace: 'CMYK',
    bitsPerComponent: 8,
    sourceProfile: cmykProfileBuffer, // From ICCBased or Output Intent
    pixelIndices: sampling.indices,
});

// result.labValues is Float32Array with L, a, b for each pixel
// Use with DeltaEMetrics for comparison
```

#### Extends

- [`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter)

#### Constructors

##### Constructor

> **new PDFImageColorSampler**(`configuration`: [`PDFImageColorSamplerConfiguration`](#pdfimagecolorsamplerconfiguration-1), `options?`: \{ `colorEngineProvider?`: [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider); `domain?`: `string`; `engineVersion?`: `string`; `policy?`: [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy); \}): [`PDFImageColorSampler`](#pdfimagecolorsampler)

Defined in: [classes/pdf-image-color-sampler.js:154](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L154)

Creates a new PDFImageColorSampler instance.

IMPORTANT: Configuration must specify Lab output:
- destinationProfile: 'Lab'
- destinationColorSpace: 'Lab' (Note: parent expects 'CMYK' | 'RGB', we override validation)

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `configuration` | [`PDFImageColorSamplerConfiguration`](#pdfimagecolorsamplerconfiguration-1) | Immutable configuration |
| `options?` | \{ `colorEngineProvider?`: [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider); `domain?`: `string`; `engineVersion?`: `string`; `policy?`: [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy); \} | Additional options |
| `options.colorEngineProvider?` | [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider) | Shared provider |
| `options.domain?` | `string` | Domain context for policy severity |
| `options.engineVersion?` | `string` | Color engine version for policy rules |
| `options.policy?` | [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy) | Custom policy |

###### Returns

[`PDFImageColorSampler`](#pdfimagecolorsampler)

###### Overrides

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`constructor`](PDFImageColorConverter.md#constructor)

#### Accessors

##### colorEngineProvider

###### Get Signature

> **get** **colorEngineProvider**(): [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider)

Defined in: [classes/color-converter.js:323](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L323)

Gets the ColorEngineProvider instance.

###### Returns

[`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider)

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`colorEngineProvider`](PDFImageColorConverter.md#colorengineprovider)

##### colorEngineService

###### Get Signature

> **get** **colorEngineService**(): `ColorEngineService`

Defined in: [classes/color-converter.js:344](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L344)

Gets the ColorEngineService instance.

###### Deprecated

This getter provides backward compatibility for unmigrated subclasses.
Use `colorEngineProvider` and `convertColorsBuffer()` instead.
Will be removed once all subclasses are migrated to use ColorEngineProvider.

###### Returns

`ColorEngineService`

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`colorEngineService`](PDFImageColorConverter.md#colorengineservice)

##### compressOutput

###### Get Signature

> **get** **compressOutput**(): `boolean`

Defined in: [classes/pdf-image-color-converter.js:175](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L175)

Whether to compress output streams.

###### Returns

`boolean`

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`compressOutput`](PDFImageColorConverter.md#compressoutput)

##### configuration

###### Get Signature

> **get** **configuration**(): `Readonly`\<[`PDFImageColorConverterConfiguration`](PDFImageColorConverter.md#pdfimagecolorconverterconfiguration-1)\>

Defined in: [classes/pdf-image-color-converter.js:167](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L167)

Gets the configuration as PDFImageColorConverterConfiguration.

###### Returns

`Readonly`\<[`PDFImageColorConverterConfiguration`](PDFImageColorConverter.md#pdfimagecolorconverterconfiguration-1)\>

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`configuration`](PDFImageColorConverter.md#configuration)

##### diagnostics

###### Get Signature

> **get** **diagnostics**(): [`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector) \| [`NoOpDiagnostics`](DiagnosticsCollector.md#noopdiagnostics)

Defined in: [classes/color-converter.js:356](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L356)

Gets the DiagnosticsCollector instance.

Returns the configured diagnostics collector, or NO_OP_DIAGNOSTICS if none provided.
This allows instrumentation code to always call diagnostics methods without null checks.

###### Returns

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector) \| [`NoOpDiagnostics`](DiagnosticsCollector.md#noopdiagnostics)

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`diagnostics`](PDFImageColorConverter.md#diagnostics)

##### inputType

###### Get Signature

> **get** **inputType**(): [`ColorType`](ImageColorConverter.md#colortype)

Defined in: [classes/image-color-converter.js:220](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L220)

Gets the input color type.

###### Returns

[`ColorType`](ImageColorConverter.md#colortype)

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`inputType`](PDFImageColorConverter.md#inputtype)

##### parentConverter

###### Get Signature

> **get** **parentConverter**(): [`ColorConverter`](ColorConverter.md#colorconverter)

Defined in: [classes/color-converter.js:365](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L365)

Gets the parent converter in the hierarchy.

###### Returns

[`ColorConverter`](ColorConverter.md#colorconverter)

Parent converter or null if root

###### Set Signature

> **set** **parentConverter**(`parent`: [`ColorConverter`](ColorConverter.md#colorconverter)): `void`

Defined in: [classes/color-converter.js:374](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L374)

Sets the parent converter in the hierarchy.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `parent` | [`ColorConverter`](ColorConverter.md#colorconverter) | Parent converter or null |

###### Returns

`void`

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`parentConverter`](PDFImageColorConverter.md#parentconverter)

##### policy

###### Get Signature

> **get** **policy**(): [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy)

Defined in: [classes/color-converter.js:331](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L331)

Gets the conversion policy.

###### Returns

[`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy)

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`policy`](PDFImageColorConverter.md#policy)

##### supportsWorkerMode

###### Get Signature

> **get** **supportsWorkerMode**(): `boolean`

Defined in: [classes/pdf-image-color-converter.js:546](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L546)

###### Returns

`boolean`

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`supportsWorkerMode`](PDFImageColorConverter.md#supportsworkermode)

#### Methods

##### applyWorkerResult()

> **applyWorkerResult**(`input`: [`PDFImageColorConverterInput`](PDFImageColorConverter.md#pdfimagecolorconverterinput), `workerResult`: [`WorkerResult`](ColorConverter.md#workerresult), `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<`void`\>

Defined in: [classes/pdf-image-color-converter.js:623](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L623)

Applies worker result back to the PDF.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFImageColorConverterInput`](PDFImageColorConverter.md#pdfimagecolorconverterinput) |  |
| `workerResult` | [`WorkerResult`](ColorConverter.md#workerresult) |  |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) |  |

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`applyWorkerResult`](PDFImageColorConverter.md#applyworkerresult)

##### clearConfigurationOverrides()

> **clearConfigurationOverrides**(): `void`

Defined in: [classes/color-converter.js:935](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L935)

Clears all per-reference overrides.

###### Returns

`void`

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`clearConfigurationOverrides`](PDFImageColorConverter.md#clearconfigurationoverrides)

##### convertColor()

> **convertColor**(`input`: [`PDFImageColorConverterInput`](PDFImageColorConverter.md#pdfimagecolorconverterinput), `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<`never`\>

Defined in: [classes/pdf-image-color-sampler.js:327](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L327)

Throws error - PDFImageColorSampler cannot produce PDF-compatible output.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFImageColorConverterInput`](PDFImageColorConverter.md#pdfimagecolorconverterinput) |  |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) |  |

###### Returns

`Promise`\<`never`\>

###### Overrides

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`convertColor`](PDFImageColorConverter.md#convertcolor)

##### convertColorsBuffer()

> **convertColorsBuffer**(`inputBuffer`: `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `options`: \{ `bitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `blackPointCompensation?`: `boolean`; `destinationProfile?`: [`ProfileType`](ColorConverter.md#profiletype); `endianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `inputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `inputColorSpace`: [`ColorSpace`](ColorConversionPolicy.md#colorspace); `inputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `outputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `outputColorSpace`: [`ColorSpace`](ColorConversionPolicy.md#colorspace); `outputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `renderingIntent?`: [`RenderingIntent`](ColorConverter.md#renderingintent-1); `sourceProfile`: [`ProfileType`](ColorConverter.md#profiletype); \}): `Promise`\<\{ `bpcStats?`: `any`; `inputChannels`: `number`; `outputChannels`: `number`; `outputPixels`: `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>; `pixelCount`: `number`; \}\>

Defined in: [classes/color-converter.js:416](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L416)

Converts a buffer of color values using SIMD-optimized batch conversion.

This is the core TypedArray-to-TypedArray conversion method that all
subclasses should use for efficient color conversion.

Bit depth parameters:
- `bitsPerComponent`: Fallback for both input and output
- `inputBitsPerComponent`: Explicit bit depth for input (overrides bitsPerComponent)
- `outputBitsPerComponent`: Explicit bit depth for output (overrides bitsPerComponent)

Endianness parameters (conditional on bit depth):
- `endianness`: Fallback for both input and output
- `inputEndianness`: Explicit endianness for input (overrides endianness)
- `outputEndianness`: Explicit endianness for output (overrides endianness)

Endianness is required for 16-bit, ignored for 8-bit, warns if specified for 32-bit.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `inputBuffer` | `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | Input color values |
| `options` | \{ `bitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `blackPointCompensation?`: `boolean`; `destinationProfile?`: [`ProfileType`](ColorConverter.md#profiletype); `endianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `inputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `inputColorSpace`: [`ColorSpace`](ColorConversionPolicy.md#colorspace); `inputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `outputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `outputColorSpace`: [`ColorSpace`](ColorConversionPolicy.md#colorspace); `outputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `renderingIntent?`: [`RenderingIntent`](ColorConverter.md#renderingintent-1); `sourceProfile`: [`ProfileType`](ColorConverter.md#profiletype); \} | Conversion options |
| `options.bitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | Bit depth (fallback for input/output) |
| `options.blackPointCompensation?` | `boolean` | Enable BPC (uses config if not provided) |
| `options.destinationProfile?` | [`ProfileType`](ColorConverter.md#profiletype) | Destination ICC profile (uses config if not provided) |
| `options.endianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | Endianness (fallback for input/output) |
| `options.inputBitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | Input bit depth (overrides bitsPerComponent) |
| `options.inputColorSpace` | [`ColorSpace`](ColorConversionPolicy.md#colorspace) | Input color space |
| `options.inputEndianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | Input endianness (overrides endianness) |
| `options.outputBitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | Output bit depth (overrides bitsPerComponent) |
| `options.outputColorSpace` | [`ColorSpace`](ColorConversionPolicy.md#colorspace) | Output color space |
| `options.outputEndianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | Output endianness (overrides endianness) |
| `options.renderingIntent?` | [`RenderingIntent`](ColorConverter.md#renderingintent-1) | Rendering intent (uses config if not provided) |
| `options.sourceProfile` | [`ProfileType`](ColorConverter.md#profiletype) | Source ICC profile (ArrayBuffer required except Lab) |

###### Returns

`Promise`\<\{ `bpcStats?`: `any`; `inputChannels`: `number`; `outputChannels`: `number`; `outputPixels`: `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>; `pixelCount`: `number`; \}\>

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`convertColorsBuffer`](PDFImageColorConverter.md#convertcolorsbuffer)

##### convertImageColor()

> **convertImageColor**(`input`: [`ImageColorConverterInput`](ImageColorConverter.md#imagecolorconverterinput), `context?`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<[`ImageColorConverterResult`](ImageColorConverter.md#imagecolorconverterresult)\>

Defined in: [classes/image-color-converter.js:337](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L337)

Converts image pixel buffer - alias for convertColor.

This method exists for compatibility with subclasses that
call convertImageColor explicitly.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`ImageColorConverterInput`](ImageColorConverter.md#imagecolorconverterinput) | Image data to convert |
| `context?` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context (unused) |

###### Returns

`Promise`\<[`ImageColorConverterResult`](ImageColorConverter.md#imagecolorconverterresult)\>

Converted image data

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`convertImageColor`](PDFImageColorConverter.md#convertimagecolor)

##### convertPDFImageColor()

> **convertPDFImageColor**(`input`: [`PDFImageColorConverterInput`](PDFImageColorConverter.md#pdfimagecolorconverterinput), `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<`never`\>

Defined in: [classes/pdf-image-color-sampler.js:343](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L343)

Throws error - PDFImageColorSampler cannot produce PDF-compatible output.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFImageColorConverterInput`](PDFImageColorConverter.md#pdfimagecolorconverterinput) |  |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) |  |

###### Returns

`Promise`\<`never`\>

###### Overrides

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`convertPDFImageColor`](PDFImageColorConverter.md#convertpdfimagecolor)

##### createChildConverter()

> **createChildConverter**\<`T`\>(`ConverterClass`: `T`, `configOverrides?`: `Partial`\<[`ColorConverterConfiguration`](ColorConverter.md#colorconverterconfiguration-1)\>): `InstanceType`\<`T`\>

Defined in: [classes/color-converter.js:961](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L961)

Creates a child converter with merged configuration.

The child converter inherits base configuration, merged with
any provided overrides. Parent-child relationship is established.

###### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| `T` *extends* *typeof* [`ColorConverter`](ColorConverter.md#colorconverter) |  |

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `ConverterClass` | `T` | Child converter class |
| `configOverrides?` | `Partial`\<[`ColorConverterConfiguration`](ColorConverter.md#colorconverterconfiguration-1)\> | Configuration overrides |

###### Returns

`InstanceType`\<`T`\>

New child converter instance

###### Example

```javascript
const pageConverter = documentConverter.createChildConverter(
    PDFPageColorConverter,
    { convertImages: true }
);
```

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`createChildConverter`](PDFImageColorConverter.md#createchildconverter)

##### dispose()

> **dispose**(): `void`

Defined in: [classes/image-color-converter.js:411](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L411)

###### Returns

`void`

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`dispose`](PDFImageColorConverter.md#dispose)

##### ensureReady()

> **ensureReady**(): `Promise`\<`void`\>

Defined in: [classes/color-converter.js:298](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L298)

Ensures the converter is ready for use.

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`ensureReady`](PDFImageColorConverter.md#ensureready)

##### extractAllPixels()

> **extractAllPixels**(`input`: `Omit`\<[`PDFImageColorSamplerInput`](#pdfimagecolorsamplerinput), `"pixelIndices"`\>): `Promise`\<[`PDFImageColorSamplerResult`](#pdfimagecolorsamplerresult)\>

Defined in: [classes/pdf-image-color-sampler.js:305](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L305)

Extract full image and convert to Lab Float32.

Convenience method when you need all pixels, not just samples.
For large images, prefer samplePixels() with ImageSampler.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | `Omit`\<[`PDFImageColorSamplerInput`](#pdfimagecolorsamplerinput), `"pixelIndices"`\> | Image data |

###### Returns

`Promise`\<[`PDFImageColorSamplerResult`](#pdfimagecolorsamplerresult)\>

Lab values for all pixels

##### getConfigurationFor()

> **getConfigurationFor**(`reference`: `any`): `Readonly`\<`Partial`\<[`ColorConverterConfiguration`](ColorConverter.md#colorconverterconfiguration-1)\>\>

Defined in: [classes/color-converter.js:886](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L886)

Gets raw override for a reference (without base merge).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `reference` | `any` | PDF reference or string key |

###### Returns

`Readonly`\<`Partial`\<[`ColorConverterConfiguration`](ColorConverter.md#colorconverterconfiguration-1)\>\>

Override or undefined

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`getConfigurationFor`](PDFImageColorConverter.md#getconfigurationfor)

##### getEffectiveConfigurationFor()

> **getEffectiveConfigurationFor**(`reference`: `any`): `Readonly`\<[`ColorConverterConfiguration`](ColorConverter.md#colorconverterconfiguration-1)\>

Defined in: [classes/color-converter.js:902](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L902)

Gets effective configuration for a reference (base + override merged).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `reference` | `any` | PDF reference or string key |

###### Returns

`Readonly`\<[`ColorConverterConfiguration`](ColorConverter.md#colorconverterconfiguration-1)\>

Merged configuration

###### Example

```javascript
const effectiveConfig = converter.getEffectiveConfigurationFor(imageRef);
console.log(effectiveConfig.renderingIntent);
```

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`getEffectiveConfigurationFor`](PDFImageColorConverter.md#geteffectiveconfigurationfor)

##### getEffectiveRenderingIntent()

> **getEffectiveRenderingIntent**(`colorType`: [`ColorType`](ImageColorConverter.md#colortype)): [`RenderingIntent`](ColorConverter.md#renderingintent-1)

Defined in: [classes/image-color-converter.js:233](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L233)

Gets the effective rendering intent for a given input type.
K-Only GCR doesn't work for:
- Lab images (produces incorrect K=1 output)
- RGB destination (K-Only GCR is CMYK-specific, no K channel in RGB)

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `colorType` | [`ColorType`](ImageColorConverter.md#colortype) | Input color type |

###### Returns

[`RenderingIntent`](ColorConverter.md#renderingintent-1)

Effective rendering intent

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`getEffectiveRenderingIntent`](PDFImageColorConverter.md#geteffectiverenderingintent)

##### hasConfigurationFor()

> **hasConfigurationFor**(`reference`: `any`): `boolean`

Defined in: [classes/color-converter.js:916](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L916)

Checks if an override exists for a reference.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `reference` | `any` | PDF reference or string key |

###### Returns

`boolean`

True if override exists

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`hasConfigurationFor`](PDFImageColorConverter.md#hasconfigurationfor)

##### prepareWorkerTask()

> **prepareWorkerTask**(`input`: [`PDFImageColorConverterInput`](PDFImageColorConverter.md#pdfimagecolorconverterinput), `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): [`WorkerTask`](ColorConverter.md#workertask)

Defined in: [classes/pdf-image-color-converter.js:558](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L558)

Prepares a task for worker thread execution.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFImageColorConverterInput`](PDFImageColorConverter.md#pdfimagecolorconverterinput) |  |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) |  |

###### Returns

[`WorkerTask`](ColorConverter.md#workertask)

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`prepareWorkerTask`](PDFImageColorConverter.md#prepareworkertask)

##### removeConfigurationFor()

> **removeConfigurationFor**(`reference`: `any`): `boolean`

Defined in: [classes/color-converter.js:927](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L927)

Removes override for a reference.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `reference` | `any` | PDF reference or string key |

###### Returns

`boolean`

True if override was removed

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`removeConfigurationFor`](PDFImageColorConverter.md#removeconfigurationfor)

##### samplePixels()

> **samplePixels**(`input`: [`PDFImageColorSamplerInput`](#pdfimagecolorsamplerinput)): `Promise`\<[`PDFImageColorSamplerResult`](#pdfimagecolorsamplerresult)\>

Defined in: [classes/pdf-image-color-sampler.js:208](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L208)

Extract and convert sampled pixels to Lab Float32.

This method:
1. Decompresses the image stream (if compressed)
2. Normalizes bit depth to 8-bit (if non-standard)
3. Extracts only the specified pixel indices
4. Converts to Lab using the source ICC profile
5. Returns Float32Array with Lab values

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFImageColorSamplerInput`](#pdfimagecolorsamplerinput) | Image data with pixel indices |

###### Returns

`Promise`\<[`PDFImageColorSamplerResult`](#pdfimagecolorsamplerresult)\>

Lab values for sampled pixels

##### setConfigurationFor()

> **setConfigurationFor**(`reference`: `any`, `configuration`: `Partial`\<[`ColorConverterConfiguration`](ColorConverter.md#colorconverterconfiguration-1)\>): `void`

Defined in: [classes/color-converter.js:875](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L875)

Sets configuration override for a specific reference.

Overrides are merged with base configuration when processing
the specified reference (e.g., specific page or image).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `reference` | `any` | PDF reference or string key |
| `configuration` | `Partial`\<[`ColorConverterConfiguration`](ColorConverter.md#colorconverterconfiguration-1)\> | Partial override |

###### Returns

`void`

###### Example

```javascript
// Override settings for a specific page
converter.setConfigurationFor(page3Ref, {
    renderingIntent: 'perceptual',
    convertImages: false,
});
```

###### Inherited from

[`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter).[`setConfigurationFor`](PDFImageColorConverter.md#setconfigurationfor)

##### toString()

> **toString**(): `string`

Defined in: [classes/pdf-image-color-sampler.js:515](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L515)

Describe the sampler's capabilities.

###### Returns

`string`

##### convertLab8ToFloat()

> `static` **convertLab8ToFloat**(`lab8Buffer`: `Uint8Array`\<`ArrayBufferLike`\>): `Float32Array`\<`ArrayBufferLike`\>

Defined in: [classes/pdf-image-color-sampler.js:493](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L493)

Create a Lab Float32Array from 8-bit Lab data.

Utility method for converting legacy 8-bit Lab output to Float32.
Lab 8-bit encoding: L = 0-255 → 0-100, a/b = 0-255 → -128 to 127

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `lab8Buffer` | `Uint8Array`\<`ArrayBufferLike`\> | 8-bit Lab data |

###### Returns

`Float32Array`\<`ArrayBufferLike`\>

Float32 Lab values

## Type Aliases

### PDFImageColorSamplerConfiguration

> **PDFImageColorSamplerConfiguration**\<\> = [`PDFImageColorConverterConfiguration`](PDFImageColorConverter.md#pdfimagecolorconverterconfiguration-1) & \{ `outputBitDepth?`: `8` \| `16` \| `32`; \}

Defined in: [classes/pdf-image-color-sampler.js:29](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L29)

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `outputBitDepth?` | `8` \| `16` \| `32` | [classes/pdf-image-color-sampler.js:28](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L28) |

#### Type Parameters

| Type Parameter |
| ------ |

***

### PDFImageColorSamplerInput

> **PDFImageColorSamplerInput**\<\> = \{ `bitsPerComponent`: [`BitDepth`](ColorConversionPolicy.md#bitdepth) \| `1` \| `2` \| `4`; `colorSpace`: [`ColorType`](ImageColorConverter.md#colortype); `height`: `number`; `isCompressed`: `boolean`; `pixelIndices`: `number`[]; `sourceProfile?`: `ArrayBuffer` \| `"Lab"`; `streamData`: `Uint8Array`; `streamRef`: `any`; `width`: `number`; \}

Defined in: [classes/pdf-image-color-sampler.js:48](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L48)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="bitspercomponent"></a> `bitsPerComponent` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) \| `1` \| `2` \| `4` | [classes/pdf-image-color-sampler.js:45](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L45) |
| <a id="colorspace"></a> `colorSpace` | [`ColorType`](ImageColorConverter.md#colortype) | [classes/pdf-image-color-sampler.js:44](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L44) |
| <a id="height"></a> `height` | `number` | [classes/pdf-image-color-sampler.js:43](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L43) |
| <a id="iscompressed"></a> `isCompressed` | `boolean` | [classes/pdf-image-color-sampler.js:41](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L41) |
| <a id="pixelindices"></a> `pixelIndices` | `number`[] | [classes/pdf-image-color-sampler.js:47](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L47) |
| <a id="sourceprofile"></a> `sourceProfile?` | `ArrayBuffer` \| `"Lab"` | [classes/pdf-image-color-sampler.js:46](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L46) |
| <a id="streamdata"></a> `streamData` | `Uint8Array` | [classes/pdf-image-color-sampler.js:40](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L40) |
| <a id="streamref"></a> `streamRef` | `any` | [classes/pdf-image-color-sampler.js:39](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L39) |
| <a id="width"></a> `width` | `number` | [classes/pdf-image-color-sampler.js:42](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L42) |

***

### PDFImageColorSamplerResult

> **PDFImageColorSamplerResult**\<\> = \{ `height`: `number`; `labValues`: `Float32Array`; `originalColorSpace`: [`ColorType`](ImageColorConverter.md#colortype); `pixelCount`: `number`; `sampledIndices`: `number`[]; `width`: `number`; \}

Defined in: [classes/pdf-image-color-sampler.js:64](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L64)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="height-1"></a> `height` | `number` | [classes/pdf-image-color-sampler.js:62](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L62) |
| <a id="labvalues"></a> `labValues` | `Float32Array` | [classes/pdf-image-color-sampler.js:58](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L58) |
| <a id="originalcolorspace"></a> `originalColorSpace` | [`ColorType`](ImageColorConverter.md#colortype) | [classes/pdf-image-color-sampler.js:63](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L63) |
| <a id="pixelcount"></a> `pixelCount` | `number` | [classes/pdf-image-color-sampler.js:59](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L59) |
| <a id="sampledindices"></a> `sampledIndices` | `number`[] | [classes/pdf-image-color-sampler.js:60](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L60) |
| <a id="width-1"></a> `width` | `number` | [classes/pdf-image-color-sampler.js:61](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-sampler.js#L61) |
