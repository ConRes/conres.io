[@conres.io/test-form-generator](README.md) / ImageColorConverter

# ImageColorConverter

Image Color Converter

Extends ColorConverter to handle pixel buffer color conversion.
Integrates with ColorEngineService for actual transformation.

## Classes

### ImageColorConverter

Defined in: [classes/image-color-converter.js:184](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L184)

Converts pixel buffer color data using ICC profiles.

Extends ColorConverter and integrates with ColorEngineService
for actual transformation.

Key features:
- Handles RGB, Gray, Lab, and CMYK input types
- Supports adaptive BPC clamping for large images
- Lab images automatically use Relative Colorimetric (not K-Only GCR)
- Efficient buffer management for large pixel arrays

#### Example

```javascript
const converter = new ImageColorConverter({
    renderingIntent: 'relative-colorimetric',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: true,
    destinationProfile: cmykProfileBuffer,
    destinationColorSpace: 'CMYK',
    inputType: 'RGB',
    verbose: false,
});

const result = await converter.convertColor({
    pixelBuffer: rgbPixels,
    width: 1920,
    height: 1080,
});
```

#### Extends

- [`ColorConverter`](ColorConverter.md#colorconverter)

#### Extended by

- [`PDFImageColorConverter`](PDFImageColorConverter.md#pdfimagecolorconverter)

#### Constructors

##### Constructor

> **new ImageColorConverter**(`configuration`: [`ImageColorConverterConfiguration`](#imagecolorconverterconfiguration-1), `options?`: \{ `colorEngineProvider?`: [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider); `colorEngineService?`: `ColorEngineService`; `domain?`: `string`; `engineVersion?`: `string`; `policy?`: [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy); \}): [`ImageColorConverter`](#imagecolorconverter)

Defined in: [classes/image-color-converter.js:200](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L200)

Creates a new ImageColorConverter instance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `configuration` | [`ImageColorConverterConfiguration`](#imagecolorconverterconfiguration-1) | Immutable configuration |
| `options?` | \{ `colorEngineProvider?`: [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider); `colorEngineService?`: `ColorEngineService`; `domain?`: `string`; `engineVersion?`: `string`; `policy?`: [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy); \} | Additional options |
| `options.colorEngineProvider?` | [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider) | Shared ColorEngineProvider |
| `options.colorEngineService?` | `ColorEngineService` |  |
| `options.domain?` | `string` | Domain context for policy severity |
| `options.engineVersion?` | `string` | Color engine version for policy rules |
| `options.policy?` | [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy) | Custom conversion policy |

###### Returns

[`ImageColorConverter`](#imagecolorconverter)

###### Deprecated

Shared ColorEngineService (backward compat)

###### Overrides

[`ColorConverter`](ColorConverter.md#colorconverter).[`constructor`](ColorConverter.md#constructor)

#### Accessors

##### colorEngineProvider

###### Get Signature

> **get** **colorEngineProvider**(): [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider)

Defined in: [classes/color-converter.js:323](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L323)

Gets the ColorEngineProvider instance.

###### Returns

[`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider)

###### Inherited from

[`ColorConverter`](ColorConverter.md#colorconverter).[`colorEngineProvider`](ColorConverter.md#colorengineprovider)

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

[`ColorConverter`](ColorConverter.md#colorconverter).[`colorEngineService`](ColorConverter.md#colorengineservice)

##### configuration

###### Get Signature

> **get** **configuration**(): `Readonly`\<[`ImageColorConverterConfiguration`](#imagecolorconverterconfiguration-1)\>

Defined in: [classes/image-color-converter.js:212](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L212)

Gets the configuration as ImageColorConverterConfiguration.

###### Returns

`Readonly`\<[`ImageColorConverterConfiguration`](#imagecolorconverterconfiguration-1)\>

###### Overrides

[`ColorConverter`](ColorConverter.md#colorconverter).[`configuration`](ColorConverter.md#configuration)

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

[`ColorConverter`](ColorConverter.md#colorconverter).[`diagnostics`](ColorConverter.md#diagnostics)

##### inputType

###### Get Signature

> **get** **inputType**(): [`ColorType`](#colortype)

Defined in: [classes/image-color-converter.js:220](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L220)

Gets the input color type.

###### Returns

[`ColorType`](#colortype)

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

[`ColorConverter`](ColorConverter.md#colorconverter).[`parentConverter`](ColorConverter.md#parentconverter)

##### policy

###### Get Signature

> **get** **policy**(): [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy)

Defined in: [classes/color-converter.js:331](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L331)

Gets the conversion policy.

###### Returns

[`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy)

###### Inherited from

[`ColorConverter`](ColorConverter.md#colorconverter).[`policy`](ColorConverter.md#policy)

##### supportsWorkerMode

###### Get Signature

> **get** **supportsWorkerMode**(): `boolean`

Defined in: [classes/image-color-converter.js:349](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L349)

###### Returns

`boolean`

###### Overrides

[`ColorConverter`](ColorConverter.md#colorconverter).[`supportsWorkerMode`](ColorConverter.md#supportsworkermode)

#### Methods

##### applyWorkerResult()

> **applyWorkerResult**(`input`: [`ColorConverterInput`](ColorConverter.md#colorconverterinput), `workerResult`: [`WorkerResult`](ColorConverter.md#workerresult), `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<`void`\>

Defined in: [classes/color-converter.js:850](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L850)

Applies worker result back to the converter.

Override in subclasses to deserialize and apply worker output.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`ColorConverterInput`](ColorConverter.md#colorconverterinput) | Original input data |
| `workerResult` | [`WorkerResult`](ColorConverter.md#workerresult) | Result from worker |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context |

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ColorConverter`](ColorConverter.md#colorconverter).[`applyWorkerResult`](ColorConverter.md#applyworkerresult)

##### clearConfigurationOverrides()

> **clearConfigurationOverrides**(): `void`

Defined in: [classes/color-converter.js:935](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L935)

Clears all per-reference overrides.

###### Returns

`void`

###### Inherited from

[`ColorConverter`](ColorConverter.md#colorconverter).[`clearConfigurationOverrides`](ColorConverter.md#clearconfigurationoverrides)

##### convertColor()

> **convertColor**(`input`: [`ImageColorConverterInput`](#imagecolorconverterinput)): `Promise`\<[`ImageColorConverterResult`](#imagecolorconverterresult)\>

Defined in: [classes/image-color-converter.js:257](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L257)

Converts pixel buffer from source color space to destination.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`ImageColorConverterInput`](#imagecolorconverterinput) | Image data to convert |

###### Returns

`Promise`\<[`ImageColorConverterResult`](#imagecolorconverterresult)\>

Converted image data

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

[`ColorConverter`](ColorConverter.md#colorconverter).[`convertColorsBuffer`](ColorConverter.md#convertcolorsbuffer)

##### convertImageColor()

> **convertImageColor**(`input`: [`ImageColorConverterInput`](#imagecolorconverterinput), `context?`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<[`ImageColorConverterResult`](#imagecolorconverterresult)\>

Defined in: [classes/image-color-converter.js:337](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L337)

Converts image pixel buffer - alias for convertColor.

This method exists for compatibility with subclasses that
call convertImageColor explicitly.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`ImageColorConverterInput`](#imagecolorconverterinput) | Image data to convert |
| `context?` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context (unused) |

###### Returns

`Promise`\<[`ImageColorConverterResult`](#imagecolorconverterresult)\>

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

[`ColorConverter`](ColorConverter.md#colorconverter).[`createChildConverter`](ColorConverter.md#createchildconverter)

##### dispose()

> **dispose**(): `void`

Defined in: [classes/image-color-converter.js:411](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L411)

###### Returns

`void`

###### Overrides

[`ColorConverter`](ColorConverter.md#colorconverter).[`dispose`](ColorConverter.md#dispose)

##### ensureReady()

> **ensureReady**(): `Promise`\<`void`\>

Defined in: [classes/color-converter.js:298](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L298)

Ensures the converter is ready for use.

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ColorConverter`](ColorConverter.md#colorconverter).[`ensureReady`](ColorConverter.md#ensureready)

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

[`ColorConverter`](ColorConverter.md#colorconverter).[`getConfigurationFor`](ColorConverter.md#getconfigurationfor)

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

[`ColorConverter`](ColorConverter.md#colorconverter).[`getEffectiveConfigurationFor`](ColorConverter.md#geteffectiveconfigurationfor)

##### getEffectiveRenderingIntent()

> **getEffectiveRenderingIntent**(`colorType`: [`ColorType`](#colortype)): [`RenderingIntent`](ColorConverter.md#renderingintent-1)

Defined in: [classes/image-color-converter.js:233](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L233)

Gets the effective rendering intent for a given input type.
K-Only GCR doesn't work for:
- Lab images (produces incorrect K=1 output)
- RGB destination (K-Only GCR is CMYK-specific, no K channel in RGB)

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `colorType` | [`ColorType`](#colortype) | Input color type |

###### Returns

[`RenderingIntent`](ColorConverter.md#renderingintent-1)

Effective rendering intent

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

[`ColorConverter`](ColorConverter.md#colorconverter).[`hasConfigurationFor`](ColorConverter.md#hasconfigurationfor)

##### prepareWorkerTask()

> **prepareWorkerTask**(`input`: [`ImageColorConverterInput`](#imagecolorconverterinput), `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): [`WorkerTask`](ColorConverter.md#workertask)

Defined in: [classes/image-color-converter.js:361](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L361)

Prepares a task for worker thread execution.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`ImageColorConverterInput`](#imagecolorconverterinput) |  |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) |  |

###### Returns

[`WorkerTask`](ColorConverter.md#workertask)

###### Overrides

[`ColorConverter`](ColorConverter.md#colorconverter).[`prepareWorkerTask`](ColorConverter.md#prepareworkertask)

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

[`ColorConverter`](ColorConverter.md#colorconverter).[`removeConfigurationFor`](ColorConverter.md#removeconfigurationfor)

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

[`ColorConverter`](ColorConverter.md#colorconverter).[`setConfigurationFor`](ColorConverter.md#setconfigurationfor)

## Type Aliases

### ColorType

> **ColorType**\<\> = `"RGB"` \| `"Gray"` \| `"Lab"` \| `"CMYK"`

Defined in: [classes/image-color-converter.js:32](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L32)

#### Type Parameters

| Type Parameter |
| ------ |

***

### ImageColorConverterConfiguration

> **ImageColorConverterConfiguration**\<\> = [`ColorConverterConfiguration`](ColorConverter.md#colorconverterconfiguration-1) & \{ `inputType`: [`ColorType`](#colortype); `sourceProfile?`: `ArrayBuffer` \| `"Lab"`; \}

Defined in: [classes/image-color-converter.js:44](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L44)

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `inputType` | [`ColorType`](#colortype) | [classes/image-color-converter.js:43](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L43) |
| `sourceProfile?` | `ArrayBuffer` \| `"Lab"` | [classes/image-color-converter.js:42](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L42) |

#### Type Parameters

| Type Parameter |
| ------ |

***

### ImageColorConverterInput

> **ImageColorConverterInput**\<\> = \{ `bitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `colorSpace?`: [`ColorType`](#colortype); `endianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `height`: `number`; `inputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `inputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `outputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `outputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `pixelBuffer`: `Uint8Array` \| `Uint16Array` \| `Float32Array`; `sourceProfile?`: `ArrayBuffer` \| `"Lab"`; `width`: `number`; \}

Defined in: [classes/image-color-converter.js:74](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L74)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="bitspercomponent"></a> `bitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | [classes/image-color-converter.js:67](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L67) |
| <a id="colorspace"></a> `colorSpace?` | [`ColorType`](#colortype) | [classes/image-color-converter.js:66](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L66) |
| <a id="endianness"></a> `endianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | [classes/image-color-converter.js:70](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L70) |
| <a id="height"></a> `height` | `number` | [classes/image-color-converter.js:65](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L65) |
| <a id="inputbitspercomponent"></a> `inputBitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | [classes/image-color-converter.js:68](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L68) |
| <a id="inputendianness"></a> `inputEndianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | [classes/image-color-converter.js:71](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L71) |
| <a id="outputbitspercomponent"></a> `outputBitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | [classes/image-color-converter.js:69](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L69) |
| <a id="outputendianness"></a> `outputEndianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | [classes/image-color-converter.js:72](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L72) |
| <a id="pixelbuffer"></a> `pixelBuffer` | `Uint8Array` \| `Uint16Array` \| `Float32Array` | [classes/image-color-converter.js:63](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L63) |
| <a id="sourceprofile"></a> `sourceProfile?` | `ArrayBuffer` \| `"Lab"` | [classes/image-color-converter.js:73](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L73) |
| <a id="width"></a> `width` | `number` | [classes/image-color-converter.js:64](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L64) |

***

### ImageColorConverterResult

> **ImageColorConverterResult**\<\> = \{ `bitsPerComponent`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `colorSpace`: `"CMYK"` \| `"RGB"`; `height`: `number`; `pixelBuffer`: `Uint8Array` \| `Uint16Array` \| `Float32Array`; `pixelCount`: `number`; `width`: `number`; \}

Defined in: [classes/image-color-converter.js:87](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L87)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="bitspercomponent-1"></a> `bitsPerComponent` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | [classes/image-color-converter.js:85](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L85) |
| <a id="colorspace-1"></a> `colorSpace` | `"CMYK"` \| `"RGB"` | [classes/image-color-converter.js:84](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L84) |
| <a id="height-1"></a> `height` | `number` | [classes/image-color-converter.js:83](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L83) |
| <a id="pixelbuffer-1"></a> `pixelBuffer` | `Uint8Array` \| `Uint16Array` \| `Float32Array` | [classes/image-color-converter.js:81](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L81) |
| <a id="pixelcount"></a> `pixelCount` | `number` | [classes/image-color-converter.js:86](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L86) |
| <a id="width-1"></a> `width` | `number` | [classes/image-color-converter.js:82](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L82) |

## Variables

### ~~ENGINE\_FLAGS~~

> `const` **ENGINE\_FLAGS**: \{ `BLACKPOINT_COMPENSATION`: `number`; \}

Defined in: [classes/image-color-converter.js:122](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L122)

Color engine flags.

#### Type Declaration

| Name | Type | Default value | Defined in |
| ------ | ------ | ------ | ------ |
| <a id="blackpoint_compensation"></a> `BLACKPOINT_COMPENSATION` | `number` | `cmsFLAGS_BLACKPOINTCOMPENSATION` | [classes/image-color-converter.js:123](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L123) |

#### Deprecated

Use ColorEngineProvider.getConstants() instead.

***

### ~~INTENT\_MAP~~

> `const` **INTENT\_MAP**: \{ `absolute-colorimetric`: `number`; `perceptual`: `number`; `preserve-k-only-relative-colorimetric-gcr`: `number`; `relative-colorimetric`: `number`; `saturation`: `number`; \}

Defined in: [classes/image-color-converter.js:130](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L130)

Mapping from rendering intent string to numeric value.

#### Type Declaration

| Name | Type | Default value | Defined in |
| ------ | ------ | ------ | ------ |
| <a id="absolute-colorimetric"></a> `absolute-colorimetric` | `number` | `RENDERING_INTENTS.ABSOLUTE_COLORIMETRIC` | [classes/image-color-converter.js:134](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L134) |
| <a id="perceptual"></a> `perceptual` | `number` | `RENDERING_INTENTS.PERCEPTUAL` | [classes/image-color-converter.js:131](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L131) |
| <a id="preserve-k-only-relative-colorimetric-gcr"></a> `preserve-k-only-relative-colorimetric-gcr` | `number` | `RENDERING_INTENTS.PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR` | [classes/image-color-converter.js:135](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L135) |
| <a id="relative-colorimetric"></a> `relative-colorimetric` | `number` | `RENDERING_INTENTS.RELATIVE_COLORIMETRIC` | [classes/image-color-converter.js:132](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L132) |
| <a id="saturation"></a> `saturation` | `number` | `RENDERING_INTENTS.SATURATION` | [classes/image-color-converter.js:133](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L133) |

#### Deprecated

Use ColorConversionPolicy.getRenderingIntentConstant() instead.

***

### ~~PIXEL\_FORMATS~~

> `const` **PIXEL\_FORMATS**: \{ `TYPE_CMYK_8`: `number`; `TYPE_GRAY_8`: `number`; `TYPE_Lab_16`: `number`; `TYPE_Lab_8`: `number`; `TYPE_RGB_8`: `number`; \}

Defined in: [classes/image-color-converter.js:98](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L98)

Color engine pixel format constants (from LittleCMS).

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="type_cmyk_8"></a> `TYPE_CMYK_8` | `number` | [classes/image-color-converter.js:100](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L100) |
| <a id="type_gray_8"></a> `TYPE_GRAY_8` | `number` | [classes/image-color-converter.js:101](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L101) |
| <a id="type_lab_16"></a> `TYPE_Lab_16` | `number` | [classes/image-color-converter.js:103](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L103) |
| <a id="type_lab_8"></a> `TYPE_Lab_8` | `number` | [classes/image-color-converter.js:102](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L102) |
| <a id="type_rgb_8"></a> `TYPE_RGB_8` | `number` | [classes/image-color-converter.js:99](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L99) |

#### Deprecated

Use ColorConversionPolicy.getInputFormat() / getOutputFormat() instead.

***

### ~~RENDERING\_INTENTS~~

> `const` **RENDERING\_INTENTS**: \{ `ABSOLUTE_COLORIMETRIC`: `number`; `PERCEPTUAL`: `number`; `PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR`: `number`; `RELATIVE_COLORIMETRIC`: `number`; `SATURATION`: `number`; \}

Defined in: [classes/image-color-converter.js:110](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L110)

Rendering intent constants.

#### Type Declaration

| Name | Type | Default value | Defined in |
| ------ | ------ | ------ | ------ |
| <a id="absolute_colorimetric"></a> `ABSOLUTE_COLORIMETRIC` | `number` | `INTENT_ABSOLUTE_COLORIMETRIC` | [classes/image-color-converter.js:114](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L114) |
| <a id="perceptual-1"></a> `PERCEPTUAL` | `number` | `INTENT_PERCEPTUAL` | [classes/image-color-converter.js:111](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L111) |
| <a id="preserve_k_only_relative_colorimetric_gcr"></a> `PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR` | `number` | `INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR` | [classes/image-color-converter.js:115](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L115) |
| <a id="relative_colorimetric"></a> `RELATIVE_COLORIMETRIC` | `number` | `INTENT_RELATIVE_COLORIMETRIC` | [classes/image-color-converter.js:112](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L112) |
| <a id="saturation-1"></a> `SATURATION` | `number` | `INTENT_SATURATION` | [classes/image-color-converter.js:113](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/image-color-converter.js#L113) |

#### Deprecated

Use ColorConversionPolicy.getRenderingIntentConstant() instead.
