[@conres.io/test-form-generator](README.md) / PDFImageColorConverter

# PDFImageColorConverter

PDF Image Color Converter

Extends ImageColorConverter to handle PDF image XObjects.
Manages stream compression/decompression, BitsPerComponent normalization,
and worker mode for parallel processing.

## Classes

### PDFImageColorConverter

Defined in: [classes/pdf-image-color-converter.js:110](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L110)

Converts PDF image XObjects to destination color space.

Extends ImageColorConverter with PDF-specific handling:
- FlateDecode compression/decompression
- BitsPerComponent normalization (ensures 8-bit output for CMYK)
- Lab image handling (automatic intent fallback)
- Worker mode support for parallel processing

#### Example

```javascript
const converter = new PDFImageColorConverter({
    renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: true,
    destinationProfile: cmykProfileBuffer,
    destinationColorSpace: 'CMYK',
    inputType: 'RGB',
    compressOutput: true,
    verbose: false,
});

const result = await converter.convertColor({
    streamRef: imageRef,
    streamData: compressedBytes,
    isCompressed: true,
    width: 800,
    height: 600,
    colorSpace: 'RGB',
    bitsPerComponent: 8,
});
```

#### Extends

- [`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter)

#### Extended by

- [`PDFImageColorSampler`](PDFImageColorSampler.md#pdfimagecolorsampler)

#### Constructors

##### Constructor

> **new PDFImageColorConverter**(`configuration`: [`PDFImageColorConverterConfiguration`](#pdfimagecolorconverterconfiguration-1), `options?`: \{ `colorEngineProvider?`: [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider); `colorEngineService?`: `ColorEngineService`; `domain?`: `string`; `engineVersion?`: `string`; `policy?`: [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy); \}): [`PDFImageColorConverter`](#pdfimagecolorconverter)

Defined in: [classes/pdf-image-color-converter.js:136](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L136)

Creates a new PDFImageColorConverter instance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `configuration` | [`PDFImageColorConverterConfiguration`](#pdfimagecolorconverterconfiguration-1) | Immutable configuration |
| `options?` | \{ `colorEngineProvider?`: [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider); `colorEngineService?`: `ColorEngineService`; `domain?`: `string`; `engineVersion?`: `string`; `policy?`: [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy); \} | Additional options |
| `options.colorEngineProvider?` | [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider) | Shared provider |
| `options.colorEngineService?` | `ColorEngineService` |  |
| `options.domain?` | `string` | Domain context for policy severity |
| `options.engineVersion?` | `string` | Color engine version for policy rules |
| `options.policy?` | [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy) | Custom policy |

###### Returns

[`PDFImageColorConverter`](#pdfimagecolorconverter)

###### Deprecated

Backward compat

###### Overrides

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`constructor`](ImageColorConverter.md#constructor)

#### Accessors

##### colorEngineProvider

###### Get Signature

> **get** **colorEngineProvider**(): [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider)

Defined in: [classes/color-converter.js:323](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L323)

Gets the ColorEngineProvider instance.

###### Returns

[`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider)

###### Inherited from

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`colorEngineProvider`](ImageColorConverter.md#colorengineprovider)

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

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`colorEngineService`](ImageColorConverter.md#colorengineservice)

##### compressOutput

###### Get Signature

> **get** **compressOutput**(): `boolean`

Defined in: [classes/pdf-image-color-converter.js:175](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L175)

Whether to compress output streams.

###### Returns

`boolean`

##### configuration

###### Get Signature

> **get** **configuration**(): `Readonly`\<[`PDFImageColorConverterConfiguration`](#pdfimagecolorconverterconfiguration-1)\>

Defined in: [classes/pdf-image-color-converter.js:167](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L167)

Gets the configuration as PDFImageColorConverterConfiguration.

###### Returns

`Readonly`\<[`PDFImageColorConverterConfiguration`](#pdfimagecolorconverterconfiguration-1)\>

###### Overrides

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`configuration`](ImageColorConverter.md#configuration)

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

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`diagnostics`](ImageColorConverter.md#diagnostics)

##### inputType

###### Get Signature

> **get** **inputType**(): [`ColorType`](ImageColorConverter.md#colortype)

Defined in: [classes/image-color-converter.js:220](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L220)

Gets the input color type.

###### Returns

[`ColorType`](ImageColorConverter.md#colortype)

###### Inherited from

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`inputType`](ImageColorConverter.md#inputtype)

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

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`parentConverter`](ImageColorConverter.md#parentconverter)

##### policy

###### Get Signature

> **get** **policy**(): [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy)

Defined in: [classes/color-converter.js:331](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L331)

Gets the conversion policy.

###### Returns

[`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy)

###### Inherited from

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`policy`](ImageColorConverter.md#policy)

##### supportsWorkerMode

###### Get Signature

> **get** **supportsWorkerMode**(): `boolean`

Defined in: [classes/pdf-image-color-converter.js:546](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L546)

###### Returns

`boolean`

###### Overrides

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`supportsWorkerMode`](ImageColorConverter.md#supportsworkermode)

#### Methods

##### applyWorkerResult()

> **applyWorkerResult**(`input`: [`PDFImageColorConverterInput`](#pdfimagecolorconverterinput), `workerResult`: [`WorkerResult`](ColorConverter.md#workerresult), `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<`void`\>

Defined in: [classes/pdf-image-color-converter.js:623](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L623)

Applies worker result back to the PDF.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFImageColorConverterInput`](#pdfimagecolorconverterinput) |  |
| `workerResult` | [`WorkerResult`](ColorConverter.md#workerresult) |  |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) |  |

###### Returns

`Promise`\<`void`\>

###### Overrides

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`applyWorkerResult`](ImageColorConverter.md#applyworkerresult)

##### clearConfigurationOverrides()

> **clearConfigurationOverrides**(): `void`

Defined in: [classes/color-converter.js:935](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L935)

Clears all per-reference overrides.

###### Returns

`void`

###### Inherited from

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`clearConfigurationOverrides`](ImageColorConverter.md#clearconfigurationoverrides)

##### convertColor()

> **convertColor**(`input`: [`PDFImageColorConverterInput`](#pdfimagecolorconverterinput), `context?`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<[`PDFImageColorConverterResult`](#pdfimagecolorconverterresult)\>

Defined in: [classes/pdf-image-color-converter.js:190](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L190)

Converts a PDF image XObject to destination color space.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFImageColorConverterInput`](#pdfimagecolorconverterinput) | PDF image data |
| `context?` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context |

###### Returns

`Promise`\<[`PDFImageColorConverterResult`](#pdfimagecolorconverterresult)\>

###### Overrides

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`convertColor`](ImageColorConverter.md#convertcolor)

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

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`convertColorsBuffer`](ImageColorConverter.md#convertcolorsbuffer)

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

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`convertImageColor`](ImageColorConverter.md#convertimagecolor)

##### convertPDFImageColor()

> **convertPDFImageColor**(`input`: [`PDFImageColorConverterInput`](#pdfimagecolorconverterinput), `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<[`PDFImageColorConverterResult`](#pdfimagecolorconverterresult)\>

Defined in: [classes/pdf-image-color-converter.js:204](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L204)

Converts a PDF image XObject to destination color space.

Supports standard bit depths (8, 16) natively via the color engine.
Non-standard PDF bit depths (1, 2, 4) are normalized to 8-bit first.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFImageColorConverterInput`](#pdfimagecolorconverterinput) | PDF image data |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context |

###### Returns

`Promise`\<[`PDFImageColorConverterResult`](#pdfimagecolorconverterresult)\>

Converted image data

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

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`createChildConverter`](ImageColorConverter.md#createchildconverter)

##### dispose()

> **dispose**(): `void`

Defined in: [classes/image-color-converter.js:411](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L411)

###### Returns

`void`

###### Inherited from

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`dispose`](ImageColorConverter.md#dispose)

##### ensureReady()

> **ensureReady**(): `Promise`\<`void`\>

Defined in: [classes/color-converter.js:298](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L298)

Ensures the converter is ready for use.

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`ensureReady`](ImageColorConverter.md#ensureready)

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

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`getConfigurationFor`](ImageColorConverter.md#getconfigurationfor)

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

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`getEffectiveConfigurationFor`](ImageColorConverter.md#geteffectiveconfigurationfor)

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

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`getEffectiveRenderingIntent`](ImageColorConverter.md#geteffectiverenderingintent)

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

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`hasConfigurationFor`](ImageColorConverter.md#hasconfigurationfor)

##### prepareWorkerTask()

> **prepareWorkerTask**(`input`: [`PDFImageColorConverterInput`](#pdfimagecolorconverterinput), `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): [`WorkerTask`](ColorConverter.md#workertask)

Defined in: [classes/pdf-image-color-converter.js:558](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L558)

Prepares a task for worker thread execution.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFImageColorConverterInput`](#pdfimagecolorconverterinput) |  |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) |  |

###### Returns

[`WorkerTask`](ColorConverter.md#workertask)

###### Overrides

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`prepareWorkerTask`](ImageColorConverter.md#prepareworkertask)

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

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`removeConfigurationFor`](ImageColorConverter.md#removeconfigurationfor)

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

[`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter).[`setConfigurationFor`](ImageColorConverter.md#setconfigurationfor)

## Type Aliases

### PDFImageColorConverterConfiguration

> **PDFImageColorConverterConfiguration**\<\> = [`ImageColorConverterConfiguration`](ImageColorConverter.md#imagecolorconverterconfiguration-1) & \{ `compressOutput`: `boolean`; \}

Defined in: [classes/pdf-image-color-converter.js:23](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L23)

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `compressOutput` | `boolean` | [classes/pdf-image-color-converter.js:22](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L22) |

#### Type Parameters

| Type Parameter |
| ------ |

***

### PDFImageColorConverterInput

> **PDFImageColorConverterInput**\<\> = \{ `bitsPerComponent`: [`BitDepth`](ColorConversionPolicy.md#bitdepth) \| `1` \| `2` \| `4`; `colorSpace`: [`ColorType`](ImageColorConverter.md#colortype); `endianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `height`: `number`; `imageDict?`: `any`; `inputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `inputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `isCompressed`: `boolean`; `outputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `outputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `sourceProfile?`: `ArrayBuffer` \| `"Lab"`; `streamData`: `Uint8Array`; `streamRef`: `any`; `width`: `number`; \}

Defined in: [classes/pdf-image-color-converter.js:54](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L54)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="bitspercomponent"></a> `bitsPerComponent` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) \| `1` \| `2` \| `4` | [classes/pdf-image-color-converter.js:46](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L46) |
| <a id="colorspace"></a> `colorSpace` | [`ColorType`](ImageColorConverter.md#colortype) | [classes/pdf-image-color-converter.js:45](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L45) |
| <a id="endianness"></a> `endianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | [classes/pdf-image-color-converter.js:49](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L49) |
| <a id="height"></a> `height` | `number` | [classes/pdf-image-color-converter.js:44](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L44) |
| <a id="imagedict"></a> `imageDict?` | `any` | [classes/pdf-image-color-converter.js:53](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L53) |
| <a id="inputbitspercomponent"></a> `inputBitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | [classes/pdf-image-color-converter.js:47](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L47) |
| <a id="inputendianness"></a> `inputEndianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | [classes/pdf-image-color-converter.js:50](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L50) |
| <a id="iscompressed"></a> `isCompressed` | `boolean` | [classes/pdf-image-color-converter.js:42](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L42) |
| <a id="outputbitspercomponent"></a> `outputBitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | [classes/pdf-image-color-converter.js:48](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L48) |
| <a id="outputendianness"></a> `outputEndianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | [classes/pdf-image-color-converter.js:51](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L51) |
| <a id="sourceprofile"></a> `sourceProfile?` | `ArrayBuffer` \| `"Lab"` | [classes/pdf-image-color-converter.js:52](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L52) |
| <a id="streamdata"></a> `streamData` | `Uint8Array` | [classes/pdf-image-color-converter.js:41](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L41) |
| <a id="streamref"></a> `streamRef` | `any` | [classes/pdf-image-color-converter.js:40](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L40) |
| <a id="width"></a> `width` | `number` | [classes/pdf-image-color-converter.js:43](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L43) |

***

### PDFImageColorConverterResult

> **PDFImageColorConverterResult**\<\> = \{ `bitsPerComponent`: `number`; `colorSpace`: `"CMYK"` \| `"RGB"`; `height`: `number`; `isCompressed`: `boolean`; `pixelCount`: `number`; `streamData`: `Uint8Array`; `streamRef`: `any`; `width`: `number`; \}

Defined in: [classes/pdf-image-color-converter.js:69](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L69)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="bitspercomponent-1"></a> `bitsPerComponent` | `number` | [classes/pdf-image-color-converter.js:67](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L67) |
| <a id="colorspace-1"></a> `colorSpace` | `"CMYK"` \| `"RGB"` | [classes/pdf-image-color-converter.js:66](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L66) |
| <a id="height-1"></a> `height` | `number` | [classes/pdf-image-color-converter.js:65](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L65) |
| <a id="iscompressed-1"></a> `isCompressed` | `boolean` | [classes/pdf-image-color-converter.js:63](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L63) |
| <a id="pixelcount"></a> `pixelCount` | `number` | [classes/pdf-image-color-converter.js:68](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L68) |
| <a id="streamdata-1"></a> `streamData` | `Uint8Array` | [classes/pdf-image-color-converter.js:62](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L62) |
| <a id="streamref-1"></a> `streamRef` | `any` | [classes/pdf-image-color-converter.js:61](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L61) |
| <a id="width-1"></a> `width` | `number` | [classes/pdf-image-color-converter.js:64](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-image-color-converter.js#L64) |
