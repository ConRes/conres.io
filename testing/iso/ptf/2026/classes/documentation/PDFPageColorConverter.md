[@conres.io/test-form-generator](README.md) / PDFPageColorConverter

# PDFPageColorConverter

PDFPageColorConverter - Page-level color conversion coordinator.

Coordinates image and content stream conversion for a single PDF page.
Manages worker pool (own or shared from document converter).

## Classes

### PDFPageColorConverter

Defined in: [classes/pdf-page-color-converter.js:90](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L90)

Coordinates color conversion for a single PDF page.

#### Example

```javascript
const pageConverter = new PDFPageColorConverter({
    destinationProfile: cmykProfile,
    destinationColorSpace: 'CMYK',
    renderingIntent: 'relative-colorimetric',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: true,
    convertImages: true,
    convertContentStreams: true,
    useWorkers: true,
    verbose: false,
});

await pageConverter.convertColor({
    pageLeaf: pageDict,
    pageRef: pageRef,
    pageIndex: 0,
    context: pdfDocument.context,
});

pageConverter.dispose();
```

#### Extends

- [`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter)

#### Constructors

##### Constructor

> **new PDFPageColorConverter**(`configuration`: [`PDFPageColorConverterConfiguration`](#pdfpagecolorconverterconfiguration-1), `options?`: `any`): [`PDFPageColorConverter`](#pdfpagecolorconverter)

Defined in: [classes/pdf-page-color-converter.js:106](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L106)

Creates a new PDFPageColorConverter.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `configuration` | [`PDFPageColorConverterConfiguration`](#pdfpagecolorconverterconfiguration-1) |  |
| `options?` | `any` | Additional options (passed to parent) |

###### Returns

[`PDFPageColorConverter`](#pdfpagecolorconverter)

###### Overrides

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`constructor`](CompositeColorConverter.md#constructor)

#### Accessors

##### colorEngineProvider

###### Get Signature

> **get** **colorEngineProvider**(): [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider)

Defined in: [classes/color-converter.js:323](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L323)

Gets the ColorEngineProvider instance.

###### Returns

[`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider)

###### Inherited from

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`colorEngineProvider`](CompositeColorConverter.md#colorengineprovider)

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

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`colorEngineService`](CompositeColorConverter.md#colorengineservice)

##### configuration

###### Get Signature

> **get** **configuration**(): `Readonly`\<[`PDFPageColorConverterConfiguration`](#pdfpagecolorconverterconfiguration-1)\>

Defined in: [classes/pdf-page-color-converter.js:146](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L146)

###### Returns

`Readonly`\<[`PDFPageColorConverterConfiguration`](#pdfpagecolorconverterconfiguration-1)\>

###### Overrides

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`configuration`](CompositeColorConverter.md#configuration)

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

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`diagnostics`](CompositeColorConverter.md#diagnostics)

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

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`parentConverter`](CompositeColorConverter.md#parentconverter)

##### policy

###### Get Signature

> **get** **policy**(): [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy)

Defined in: [classes/color-converter.js:331](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L331)

Gets the conversion policy.

###### Returns

[`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy)

###### Inherited from

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`policy`](CompositeColorConverter.md#policy)

##### supportsWorkerMode

###### Get Signature

> **get** **supportsWorkerMode**(): `boolean`

Defined in: [classes/composite-color-converter.js:174](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/composite-color-converter.js#L174)

Whether this converter supports worker mode.

###### Returns

`boolean`

###### Inherited from

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`supportsWorkerMode`](CompositeColorConverter.md#supportsworkermode)

##### workerPool

###### Get Signature

> **get** **workerPool**(): [`WorkerPool`](WorkerPool.md#workerpool)

Defined in: [classes/composite-color-converter.js:166](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/composite-color-converter.js#L166)

Gets the WorkerPool instance.

###### Returns

[`WorkerPool`](WorkerPool.md#workerpool)

###### Inherited from

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`workerPool`](CompositeColorConverter.md#workerpool)

#### Methods

##### applyWorkerResult()

> **applyWorkerResult**(`input`: [`PDFPageColorConverterInput`](#pdfpagecolorconverterinput), `workerResult`: [`WorkerResult`](ColorConverter.md#workerresult), `context`: `any`): `Promise`\<`void`\>

Defined in: [classes/pdf-page-color-converter.js:1028](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L1028)

Applies worker processing results back to the PDF structure.

Receives aggregated results for all images and content streams on this page.
Delegates to child converters (image and content stream) to apply their
respective results.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFPageColorConverterInput`](#pdfpagecolorconverterinput) | Original page input |
| `workerResult` | [`WorkerResult`](ColorConverter.md#workerresult) | Aggregated worker results |
| `context` | `any` | Conversion context |

###### Returns

`Promise`\<`void`\>

###### Overrides

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`applyWorkerResult`](CompositeColorConverter.md#applyworkerresult)

##### clearConfigurationOverrides()

> **clearConfigurationOverrides**(): `void`

Defined in: [classes/color-converter.js:935](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L935)

Clears all per-reference overrides.

###### Returns

`void`

###### Inherited from

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`clearConfigurationOverrides`](CompositeColorConverter.md#clearconfigurationoverrides)

##### convertColor()

> **convertColor**(`input`: [`PDFPageColorConverterInput`](#pdfpagecolorconverterinput), `context`: `any`): `Promise`\<[`PDFPageColorConverterResult`](#pdfpagecolorconverterresult)\>

Defined in: [classes/pdf-page-color-converter.js:463](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L463)

Converts colors on a PDF page.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFPageColorConverterInput`](#pdfpagecolorconverterinput) |  |
| `context` | `any` |  |

###### Returns

`Promise`\<[`PDFPageColorConverterResult`](#pdfpagecolorconverterresult)\>

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

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`convertColorsBuffer`](CompositeColorConverter.md#convertcolorsbuffer)

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

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`createChildConverter`](CompositeColorConverter.md#createchildconverter)

##### deriveContentStreamConfiguration()

> **deriveContentStreamConfiguration**(`streamRef?`: `any`): [`PDFContentStreamColorConverterConfiguration`](PDFContentStreamColorConverter.md#pdfcontentstreamcolorconverterconfiguration-1)

Defined in: [classes/pdf-page-color-converter.js:194](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L194)

Derives configuration for content stream conversion.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `streamRef?` | `any` | Optional stream reference for per-stream overrides |

###### Returns

[`PDFContentStreamColorConverterConfiguration`](PDFContentStreamColorConverter.md#pdfcontentstreamcolorconverterconfiguration-1)

##### deriveImageConfiguration()

> **deriveImageConfiguration**(`imageRef?`: `any`): [`PDFImageColorConverterConfiguration`](PDFImageColorConverter.md#pdfimagecolorconverterconfiguration-1)

Defined in: [classes/pdf-page-color-converter.js:160](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L160)

Derives configuration for image conversion.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `imageRef?` | `any` | Optional image reference for per-image overrides |

###### Returns

[`PDFImageColorConverterConfiguration`](PDFImageColorConverter.md#pdfimagecolorconverterconfiguration-1)

##### dispose()

> **dispose**(): `void`

Defined in: [classes/pdf-page-color-converter.js:1107](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L1107)

Disposes of resources.

###### Returns

`void`

###### Overrides

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`dispose`](CompositeColorConverter.md#dispose)

##### ensureReady()

> **ensureReady**(): `Promise`\<`void`\>

Defined in: [classes/pdf-page-color-converter.js:134](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L134)

Ensures the converter is ready for use.
Overrides parent to include page-level initialization.

###### Returns

`Promise`\<`void`\>

###### Overrides

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`ensureReady`](CompositeColorConverter.md#ensureready)

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

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`getConfigurationFor`](CompositeColorConverter.md#getconfigurationfor)

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

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`getEffectiveConfigurationFor`](CompositeColorConverter.md#geteffectiveconfigurationfor)

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

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`hasConfigurationFor`](CompositeColorConverter.md#hasconfigurationfor)

##### prepareWorkerTask()

> **prepareWorkerTask**(`input`: [`PDFPageColorConverterInput`](#pdfpagecolorconverterinput), `context`: `any`): `any`

Defined in: [classes/pdf-page-color-converter.js:975](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L975)

Prepares worker tasks for this page.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFPageColorConverterInput`](#pdfpagecolorconverterinput) |  |
| `context` | `any` |  |

###### Returns

`any`

###### Overrides

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`prepareWorkerTask`](CompositeColorConverter.md#prepareworkertask)

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

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`removeConfigurationFor`](CompositeColorConverter.md#removeconfigurationfor)

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

[`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter).[`setConfigurationFor`](CompositeColorConverter.md#setconfigurationfor)

## Type Aliases

### PDFPageColorConverterConfiguration

> **PDFPageColorConverterConfiguration**\<\> = [`ColorConverterConfiguration`](ColorConverter.md#colorconverterconfiguration-1) & \{ `bufferRegistry?`: [`BufferRegistry`](BufferRegistry.md#bufferregistry); `colorEnginePath?`: `string`; `contentStreamConfiguration?`: `Partial`\<[`PDFContentStreamColorConverterConfiguration`](PDFContentStreamColorConverter.md#pdfcontentstreamcolorconverterconfiguration-1)\>; `convertContentStreams`: `boolean`; `convertImages`: `boolean`; `imageConfiguration?`: `Partial`\<[`PDFImageColorConverterConfiguration`](PDFImageColorConverter.md#pdfimagecolorconverterconfiguration-1)\>; `sourceGrayProfile?`: `ArrayBuffer`; `sourceRGBProfile?`: `ArrayBuffer`; `useWorkers`: `boolean`; `workerPool?`: [`WorkerPool`](WorkerPool.md#workerpool); \}

Defined in: [classes/pdf-page-color-converter.js:29](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L29)

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `bufferRegistry?` | [`BufferRegistry`](BufferRegistry.md#bufferregistry) | [classes/pdf-page-color-converter.js:28](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L28) |
| `colorEnginePath?` | `string` | [classes/pdf-page-color-converter.js:23](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L23) |
| `contentStreamConfiguration?` | `Partial`\<[`PDFContentStreamColorConverterConfiguration`](PDFContentStreamColorConverter.md#pdfcontentstreamcolorconverterconfiguration-1)\> | [classes/pdf-page-color-converter.js:25](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L25) |
| `convertContentStreams` | `boolean` | [classes/pdf-page-color-converter.js:20](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L20) |
| `convertImages` | `boolean` | [classes/pdf-page-color-converter.js:19](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L19) |
| `imageConfiguration?` | `Partial`\<[`PDFImageColorConverterConfiguration`](PDFImageColorConverter.md#pdfimagecolorconverterconfiguration-1)\> | [classes/pdf-page-color-converter.js:24](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L24) |
| `sourceGrayProfile?` | `ArrayBuffer` | [classes/pdf-page-color-converter.js:27](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L27) |
| `sourceRGBProfile?` | `ArrayBuffer` | [classes/pdf-page-color-converter.js:26](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L26) |
| `useWorkers` | `boolean` | [classes/pdf-page-color-converter.js:21](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L21) |
| `workerPool?` | [`WorkerPool`](WorkerPool.md#workerpool) | [classes/pdf-page-color-converter.js:22](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L22) |

#### Type Parameters

| Type Parameter |
| ------ |

***

### PDFPageColorConverterInput

> **PDFPageColorConverterInput**\<\> = \{ `contentStreams?`: \{ `colorSpaceDefinitions`: `object`; `ref`: `any`; `stream`: `any`; \}[]; `context`: `any`; `images?`: [`PDFPageColorConverterInputImage`](#pdfpagecolorconverterinputimage)[]; `pageIndex`: `number`; `pageLeaf`: `any`; `pageRef`: `any`; \}

Defined in: [classes/pdf-page-color-converter.js:48](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L48)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="contentstreams"></a> `contentStreams?` | \{ `colorSpaceDefinitions`: `object`; `ref`: `any`; `stream`: `any`; \}[] | [classes/pdf-page-color-converter.js:47](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L47) |
| <a id="context"></a> `context` | `any` | [classes/pdf-page-color-converter.js:45](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L45) |
| <a id="images"></a> `images?` | [`PDFPageColorConverterInputImage`](#pdfpagecolorconverterinputimage)[] | [classes/pdf-page-color-converter.js:46](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L46) |
| <a id="pageindex"></a> `pageIndex` | `number` | [classes/pdf-page-color-converter.js:44](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L44) |
| <a id="pageleaf"></a> `pageLeaf` | `any` | [classes/pdf-page-color-converter.js:42](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L42) |
| <a id="pageref"></a> `pageRef` | `any` | [classes/pdf-page-color-converter.js:43](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L43) |

***

### PDFPageColorConverterInputImage

> **PDFPageColorConverterInputImage**\<\> = \{ `colorSpaceInfo`: `object`; `ref`: `any`; `stream`: `any`; \}

Defined in: [classes/pdf-page-color-converter.js:37](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L37)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="colorspaceinfo"></a> `colorSpaceInfo` | `object` | [classes/pdf-page-color-converter.js:36](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L36) |
| <a id="ref"></a> `ref` | `any` | [classes/pdf-page-color-converter.js:34](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L34) |
| <a id="stream"></a> `stream` | `any` | [classes/pdf-page-color-converter.js:35](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L35) |

***

### PDFPageColorConverterResult

> **PDFPageColorConverterResult**\<\> = \{ `contentStreamsConverted`: `number`; `errors`: `string`[]; `imagesConverted`: `number`; `pageIndex`: `number`; `pageRef`: `any`; `totalColorOperations`: `number`; \}

Defined in: [classes/pdf-page-color-converter.js:59](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L59)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="contentstreamsconverted"></a> `contentStreamsConverted` | `number` | [classes/pdf-page-color-converter.js:56](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L56) |
| <a id="errors"></a> `errors` | `string`[] | [classes/pdf-page-color-converter.js:58](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L58) |
| <a id="imagesconverted"></a> `imagesConverted` | `number` | [classes/pdf-page-color-converter.js:55](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L55) |
| <a id="pageindex-1"></a> `pageIndex` | `number` | [classes/pdf-page-color-converter.js:54](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L54) |
| <a id="pageref-1"></a> `pageRef` | `any` | [classes/pdf-page-color-converter.js:53](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L53) |
| <a id="totalcoloroperations"></a> `totalColorOperations` | `number` | [classes/pdf-page-color-converter.js:57](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-page-color-converter.js#L57) |
