[@conres.io/test-form-generator](README.md) / LookupTableColorConverter

# LookupTableColorConverter

Lookup Table Color Converter

Extends ColorConverter with caching for discrete color values.
Optimizes repeated conversions of the same color by storing
results in a lookup table.

## Classes

### LookupTableColorConverter

Defined in: [classes/lookup-table-color-converter.js:90](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L90)

Converts discrete color values with lookup table caching.

Optimizes repeated conversions by caching results keyed by
color space and values. Useful for content stream color conversion
where the same colors may appear multiple times.

#### Example

```javascript
const converter = new LookupTableColorConverter({
    renderingIntent: 'relative-colorimetric',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: false,
    destinationProfile: cmykProfileBuffer,
    destinationColorSpace: 'CMYK',
    useLookupTable: true,
    lookupTableThreshold: 5,
    verbose: false,
});

// First call: actual conversion
const result1 = await converter.convertColor({ colorSpace: 'RGB', values: [255, 0, 0] });

// Second call: cache hit
const result2 = await converter.convertColor({ colorSpace: 'RGB', values: [255, 0, 0] });
console.log(result2.cacheHit); // true
```

#### Extends

- [`ColorConverter`](ColorConverter.md#colorconverter)

#### Extended by

- [`PDFContentStreamColorConverter`](PDFContentStreamColorConverter.md#pdfcontentstreamcolorconverter)

#### Constructors

##### Constructor

> **new LookupTableColorConverter**(`configuration`: [`LookupTableColorConverterConfiguration`](#lookuptablecolorconverterconfiguration-1), `options?`: \{ `colorEngineService?`: `ColorEngineService`; \}): [`LookupTableColorConverter`](#lookuptablecolorconverter)

Defined in: [classes/lookup-table-color-converter.js:144](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L144)

Creates a new LookupTableColorConverter instance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `configuration` | [`LookupTableColorConverterConfiguration`](#lookuptablecolorconverterconfiguration-1) | Immutable configuration |
| `options?` | \{ `colorEngineService?`: `ColorEngineService`; \} | Additional options |
| `options.colorEngineService?` | `ColorEngineService` | Shared service |

###### Returns

[`LookupTableColorConverter`](#lookuptablecolorconverter)

###### Overrides

[`ColorConverter`](ColorConverter.md#colorconverter).[`constructor`](ColorConverter.md#constructor)

#### Accessors

##### bufferRegistry

###### Get Signature

> **get** **bufferRegistry**(): [`BufferRegistry`](BufferRegistry.md#bufferregistry)

Defined in: [classes/lookup-table-color-converter.js:158](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L158)

Gets the BufferRegistry if configured.

###### Returns

[`BufferRegistry`](BufferRegistry.md#bufferregistry)

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

> **get** **configuration**(): `Readonly`\<[`LookupTableColorConverterConfiguration`](#lookuptablecolorconverterconfiguration-1)\>

Defined in: [classes/lookup-table-color-converter.js:189](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L189)

Gets the configuration as LookupTableColorConverterConfiguration.

###### Returns

`Readonly`\<[`LookupTableColorConverterConfiguration`](#lookuptablecolorconverterconfiguration-1)\>

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

##### lookupTableStats

###### Get Signature

> **get** **lookupTableStats**(): \{ `hitRate`: `number`; `hits`: `number`; `misses`: `number`; `size`: `number`; \}

Defined in: [classes/lookup-table-color-converter.js:223](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L223)

Gets lookup table statistics.

###### Returns

\{ `hitRate`: `number`; `hits`: `number`; `misses`: `number`; `size`: `number`; \}

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `hitRate` | `number` | [classes/lookup-table-color-converter.js:220](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L220) |
| `hits` | `number` | [classes/lookup-table-color-converter.js:218](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L218) |
| `misses` | `number` | [classes/lookup-table-color-converter.js:219](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L219) |
| `size` | `number` | [classes/lookup-table-color-converter.js:217](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L217) |

##### lookupTableThreshold

###### Get Signature

> **get** **lookupTableThreshold**(): `number`

Defined in: [classes/lookup-table-color-converter.js:205](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L205)

Threshold before using lookup table.

###### Returns

`number`

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

Defined in: [classes/color-converter.js:823](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L823)

Indicates whether this converter supports worker mode.

Override in subclasses that can run in web workers.

###### Returns

`boolean`

True if worker mode is supported

###### Inherited from

[`ColorConverter`](ColorConverter.md#colorconverter).[`supportsWorkerMode`](ColorConverter.md#supportsworkermode)

##### useLookupTable

###### Get Signature

> **get** **useLookupTable**(): `boolean`

Defined in: [classes/lookup-table-color-converter.js:197](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L197)

Whether lookup table is enabled.

###### Returns

`boolean`

#### Methods

##### applyLookupTable()

> **applyLookupTable**(`lookupTable`: `Map`\<`string`, `number`[]\>, `input`: [`LookupTableColorConverterInput`](#lookuptablecolorconverterinput)): `number`[]

Defined in: [classes/lookup-table-color-converter.js:463](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L463)

Applies a lookup table to get converted color values.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `lookupTable` | `Map`\<`string`, `number`[]\> | Lookup table from buildLookupTable() |
| `input` | [`LookupTableColorConverterInput`](#lookuptablecolorconverterinput) | Color to look up |

###### Returns

`number`[]

Converted values or undefined if not found

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

##### buildLookupTable()

> **buildLookupTable**(`uniqueColors`: [`LookupTableColorConverterInput`](#lookuptablecolorconverterinput)[], `context?`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<`Map`\<`string`, `number`[]\>\>

Defined in: [classes/lookup-table-color-converter.js:409](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L409)

Builds a lookup table from unique colors using batch conversion.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `uniqueColors` | [`LookupTableColorConverterInput`](#lookuptablecolorconverterinput)[] | Unique colors to convert |
| `context?` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context |

###### Returns

`Promise`\<`Map`\<`string`, `number`[]\>\>

Lookup table mapping color keys to converted values

##### clearConfigurationOverrides()

> **clearConfigurationOverrides**(): `void`

Defined in: [classes/color-converter.js:935](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L935)

Clears all per-reference overrides.

###### Returns

`void`

###### Inherited from

[`ColorConverter`](ColorConverter.md#colorconverter).[`clearConfigurationOverrides`](ColorConverter.md#clearconfigurationoverrides)

##### clearLookupTable()

> **clearLookupTable**(): `void`

Defined in: [classes/lookup-table-color-converter.js:527](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L527)

Clears the lookup table cache.

Note: When using a shared BufferRegistry, this only clears instance-level
state. Call bufferRegistry.clearColorCache() to clear the shared cache.

###### Returns

`void`

##### convertBatch()

> **convertBatch**(`inputs`: [`LookupTableColorConverterInput`](#lookuptablecolorconverterinput)[], `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<[`LookupTableColorConverterResult`](#lookuptablecolorconverterresult)[]\>

Defined in: [classes/lookup-table-color-converter.js:316](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L316)

Converts multiple colors with lookup table optimization.

Separates colors into cached and uncached, processes uncached
in batch, then merges results.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `inputs` | [`LookupTableColorConverterInput`](#lookuptablecolorconverterinput)[] | Colors to convert |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context |

###### Returns

`Promise`\<[`LookupTableColorConverterResult`](#lookuptablecolorconverterresult)[]\>

Converted colors

##### convertBatchUncached()

> **convertBatchUncached**(`inputs`: [`LookupTableColorConverterInput`](#lookuptablecolorconverterinput)[], `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<`number`[][]\>

Defined in: [classes/lookup-table-color-converter.js:394](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L394)

Converts uncached colors in batch (abstract - subclasses must implement).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `inputs` | [`LookupTableColorConverterInput`](#lookuptablecolorconverterinput)[] | Uncached colors |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context |

###### Returns

`Promise`\<`number`[][]\>

Converted color values

##### convertColor()

> **convertColor**(`input`: [`LookupTableColorConverterInput`](#lookuptablecolorconverterinput), `context?`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<[`LookupTableColorConverterResult`](#lookuptablecolorconverterresult)\>

Defined in: [classes/lookup-table-color-converter.js:253](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L253)

Converts a color value with lookup table optimization.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`LookupTableColorConverterInput`](#lookuptablecolorconverterinput) | Color to convert |
| `context?` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context |

###### Returns

`Promise`\<[`LookupTableColorConverterResult`](#lookuptablecolorconverterresult)\>

Converted color

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

Defined in: [classes/lookup-table-color-converter.js:559](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L559)

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

##### populateLookupTable()

> **populateLookupTable**(`entries`: \{ `colorSpace`: `string`; `converted`: `number`[]; `values`: `number`[]; \}[]): `void`

Defined in: [classes/lookup-table-color-converter.js:539](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L539)

Pre-populates the lookup table with known conversions.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `entries` | \{ `colorSpace`: `string`; `converted`: `number`[]; `values`: `number`[]; \}[] |  |

###### Returns

`void`

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

### LookupTableColorConverterConfiguration

> **LookupTableColorConverterConfiguration**\<\> = [`ColorConverterConfiguration`](ColorConverter.md#colorconverterconfiguration-1) & \{ `bufferRegistry?`: [`BufferRegistry`](BufferRegistry.md#bufferregistry); `lookupTableThreshold?`: `number`; `sourceGrayProfile?`: `ArrayBuffer`; `sourceRGBProfile?`: `ArrayBuffer`; `useLookupTable`: `boolean`; \}

Defined in: [classes/lookup-table-color-converter.js:27](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L27)

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `bufferRegistry?` | [`BufferRegistry`](BufferRegistry.md#bufferregistry) | [classes/lookup-table-color-converter.js:24](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L24) |
| `lookupTableThreshold?` | `number` | [classes/lookup-table-color-converter.js:23](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L23) |
| `sourceGrayProfile?` | `ArrayBuffer` | [classes/lookup-table-color-converter.js:26](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L26) |
| `sourceRGBProfile?` | `ArrayBuffer` | [classes/lookup-table-color-converter.js:25](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L25) |
| `useLookupTable` | `boolean` | [classes/lookup-table-color-converter.js:22](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L22) |

#### Type Parameters

| Type Parameter |
| ------ |

***

### LookupTableColorConverterInput

> **LookupTableColorConverterInput**\<\> = \{ `colorSpace`: `"RGB"` \| `"Gray"` \| `"Lab"`; `sourceProfile?`: `ArrayBuffer`; `values`: `number`[]; \}

Defined in: [classes/lookup-table-color-converter.js:37](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L37)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="colorspace"></a> `colorSpace` | `"RGB"` \| `"Gray"` \| `"Lab"` | [classes/lookup-table-color-converter.js:34](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L34) |
| <a id="sourceprofile"></a> `sourceProfile?` | `ArrayBuffer` | [classes/lookup-table-color-converter.js:36](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L36) |
| <a id="values"></a> `values` | `number`[] | [classes/lookup-table-color-converter.js:35](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L35) |

***

### LookupTableColorConverterResult

> **LookupTableColorConverterResult**\<\> = \{ `cacheHit`: `boolean`; `colorSpace`: `"CMYK"` \| `"RGB"`; `values`: `number`[]; \}

Defined in: [classes/lookup-table-color-converter.js:47](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L47)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="cachehit"></a> `cacheHit` | `boolean` | [classes/lookup-table-color-converter.js:46](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L46) |
| <a id="colorspace-1"></a> `colorSpace` | `"CMYK"` \| `"RGB"` | [classes/lookup-table-color-converter.js:44](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L44) |
| <a id="values-1"></a> `values` | `number`[] | [classes/lookup-table-color-converter.js:45](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L45) |
