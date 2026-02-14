[@conres.io/test-form-generator](README.md) / CompositeColorConverter

# CompositeColorConverter

Composite Color Converter

Intermediate base class for converters that coordinate multiple child
conversion operations. Manages WorkerPool lifecycle with ownership semantics.

## Classes

### CompositeColorConverter

Defined in: [classes/composite-color-converter.js:53](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/composite-color-converter.js#L53)

Base class for converters that coordinate multiple child conversions.

Manages WorkerPool lifecycle with ownership semantics:
- If `workerPool` is provided in config, uses shared pool (does not own)
- If `useWorkers` is true and no pool provided, creates and owns pool

Subclasses (PDFDocumentColorConverter, PDFPageColorConverter) inherit
WorkerPool management instead of duplicating it.

#### Example

```javascript
class PDFPageColorConverter extends CompositeColorConverter {
    async convertColor(input, context) {
        await this.ensureReady();
        const pool = this.workerPool; // Access inherited pool
        // ... coordinate child conversions
    }
}
```

#### Extends

- [`ColorConverter`](ColorConverter.md#colorconverter)

#### Extended by

- [`PDFDocumentColorConverter`](PDFDocumentColorConverter.md#pdfdocumentcolorconverter)
- [`PDFPageColorConverter`](PDFPageColorConverter.md#pdfpagecolorconverter)

#### Constructors

##### Constructor

> **new CompositeColorConverter**(`configuration`: [`CompositeColorConverterConfiguration`](#compositecolorconverterconfiguration-1), `options?`: \{ `colorEngineProvider?`: [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider); \}): [`CompositeColorConverter`](#compositecolorconverter)

Defined in: [classes/composite-color-converter.js:78](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/composite-color-converter.js#L78)

Creates a new CompositeColorConverter instance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `configuration` | [`CompositeColorConverterConfiguration`](#compositecolorconverterconfiguration-1) | Immutable configuration |
| `options?` | \{ `colorEngineProvider?`: [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider); \} | Additional options |
| `options.colorEngineProvider?` | [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider) | Shared provider |

###### Returns

[`CompositeColorConverter`](#compositecolorconverter)

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

> **get** **configuration**(): `Readonly`\<[`CompositeColorConverterConfiguration`](#compositecolorconverterconfiguration-1)\>

Defined in: [classes/composite-color-converter.js:158](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/composite-color-converter.js#L158)

Gets the configuration as CompositeColorConverterConfiguration.

###### Returns

`Readonly`\<[`CompositeColorConverterConfiguration`](#compositecolorconverterconfiguration-1)\>

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

Defined in: [classes/composite-color-converter.js:174](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/composite-color-converter.js#L174)

Whether this converter supports worker mode.

###### Returns

`boolean`

###### Overrides

[`ColorConverter`](ColorConverter.md#colorconverter).[`supportsWorkerMode`](ColorConverter.md#supportsworkermode)

##### workerPool

###### Get Signature

> **get** **workerPool**(): [`WorkerPool`](WorkerPool.md#workerpool)

Defined in: [classes/composite-color-converter.js:166](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/composite-color-converter.js#L166)

Gets the WorkerPool instance.

###### Returns

[`WorkerPool`](WorkerPool.md#workerpool)

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

Defined in: [classes/composite-color-converter.js:185](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/composite-color-converter.js#L185)

###### Returns

`void`

###### Overrides

[`ColorConverter`](ColorConverter.md#colorconverter).[`dispose`](ColorConverter.md#dispose)

##### ensureReady()

> **ensureReady**(): `Promise`\<`void`\>

Defined in: [classes/composite-color-converter.js:145](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/composite-color-converter.js#L145)

Ensures the converter is ready for use.
Overrides parent to include WorkerPool initialization.

###### Returns

`Promise`\<`void`\>

###### Overrides

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

> **prepareWorkerTask**(`input`: [`ColorConverterInput`](ColorConverter.md#colorconverterinput), `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): [`WorkerTask`](ColorConverter.md#workertask)

Defined in: [classes/color-converter.js:836](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L836)

Prepares a task for worker thread execution.

Override in subclasses to serialize input for worker transfer.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`ColorConverterInput`](ColorConverter.md#colorconverterinput) | Input data |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context |

###### Returns

[`WorkerTask`](ColorConverter.md#workertask)

Serializable task data or null if not supported

###### Inherited from

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

### CompositeColorConverterConfiguration

> **CompositeColorConverterConfiguration**\<\> = [`ColorConverterConfiguration`](ColorConverter.md#colorconverterconfiguration-1) & \{ `colorEnginePath?`: `string`; `useWorkers?`: `boolean`; `workerPool?`: [`WorkerPool`](WorkerPool.md#workerpool); \}

Defined in: [classes/composite-color-converter.js:24](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/composite-color-converter.js#L24)

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `colorEnginePath?` | `string` | [classes/composite-color-converter.js:23](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/composite-color-converter.js#L23) |
| `useWorkers?` | `boolean` | [classes/composite-color-converter.js:21](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/composite-color-converter.js#L21) |
| `workerPool?` | [`WorkerPool`](WorkerPool.md#workerpool) | [classes/composite-color-converter.js:22](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/composite-color-converter.js#L22) |

#### Type Parameters

| Type Parameter |
| ------ |
