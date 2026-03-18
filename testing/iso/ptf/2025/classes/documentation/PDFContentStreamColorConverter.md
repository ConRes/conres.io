[@conres.io/test-form-generator](README.md) / PDFContentStreamColorConverter

# PDFContentStreamColorConverter

PDF Content Stream Color Converter

Extends LookupTableColorConverter to handle PDF content stream color operations.
Parses content streams, extracts color operations, converts colors, and rebuilds
the stream with converted values.

## Classes

### PDFContentStreamColorConverter

Defined in: [classes/pdf-content-stream-color-converter.js:141](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L141)

Converts colors in PDF content streams.

Extends LookupTableColorConverter with content stream parsing:
- Parses color operations from stream text
- Converts RGB and Gray colors to destination color space
- Rebuilds stream with converted color values
- Caches repeated color conversions

Supported color operators:
- G/g: DeviceGray stroke/fill
- RG/rg: DeviceRGB stroke/fill
- K/k: DeviceCMYK stroke/fill (passed through)
- CS/cs: Color space selection
- SC/sc/SCN/scn: Color setting with current color space

#### Example

```javascript
const converter = new PDFContentStreamColorConverter({
    renderingIntent: 'relative-colorimetric',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: false,
    destinationProfile: cmykProfileBuffer,
    destinationColorSpace: 'CMYK',
    useLookupTable: true,
    sourceRGBProfile: 'sRGB',
    sourceGrayProfile: 'sGray',
    verbose: false,
});

const result = await converter.convertColor({
    streamRef: contentStreamRef,
    streamText: '1 0 0 rg 100 100 50 50 re f',
});
console.log(result.newText); // Converted to CMYK
```

#### Extends

- [`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter)

#### Constructors

##### Constructor

> **new PDFContentStreamColorConverter**(`configuration`: [`PDFContentStreamColorConverterConfiguration`](#pdfcontentstreamcolorconverterconfiguration-1), `options?`: \{ `colorEngineService?`: `ColorEngineService`; \}): [`PDFContentStreamColorConverter`](#pdfcontentstreamcolorconverter)

Defined in: [classes/pdf-content-stream-color-converter.js:153](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L153)

Creates a new PDFContentStreamColorConverter instance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `configuration` | [`PDFContentStreamColorConverterConfiguration`](#pdfcontentstreamcolorconverterconfiguration-1) | Immutable configuration |
| `options?` | \{ `colorEngineService?`: `ColorEngineService`; \} | Additional options |
| `options.colorEngineService?` | `ColorEngineService` | Shared service |

###### Returns

[`PDFContentStreamColorConverter`](#pdfcontentstreamcolorconverter)

###### Overrides

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`constructor`](LookupTableColorConverter.md#constructor)

#### Accessors

##### bufferRegistry

###### Get Signature

> **get** **bufferRegistry**(): [`BufferRegistry`](BufferRegistry.md#bufferregistry)

Defined in: [classes/lookup-table-color-converter.js:158](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L158)

Gets the BufferRegistry if configured.

###### Returns

[`BufferRegistry`](BufferRegistry.md#bufferregistry)

###### Inherited from

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`bufferRegistry`](LookupTableColorConverter.md#bufferregistry)

##### colorEngineProvider

###### Get Signature

> **get** **colorEngineProvider**(): [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider)

Defined in: [classes/color-converter.js:323](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L323)

Gets the ColorEngineProvider instance.

###### Returns

[`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider)

###### Inherited from

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`colorEngineProvider`](LookupTableColorConverter.md#colorengineprovider)

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

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`colorEngineService`](LookupTableColorConverter.md#colorengineservice)

##### configuration

###### Get Signature

> **get** **configuration**(): `Readonly`\<[`PDFContentStreamColorConverterConfiguration`](#pdfcontentstreamcolorconverterconfiguration-1)\>

Defined in: [classes/pdf-content-stream-color-converter.js:165](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L165)

Gets the configuration as PDFContentStreamColorConverterConfiguration.

###### Returns

`Readonly`\<[`PDFContentStreamColorConverterConfiguration`](#pdfcontentstreamcolorconverterconfiguration-1)\>

###### Overrides

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`configuration`](LookupTableColorConverter.md#configuration)

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

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`diagnostics`](LookupTableColorConverter.md#diagnostics)

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

###### Inherited from

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`lookupTableStats`](LookupTableColorConverter.md#lookuptablestats)

##### lookupTableThreshold

###### Get Signature

> **get** **lookupTableThreshold**(): `number`

Defined in: [classes/lookup-table-color-converter.js:205](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L205)

Threshold before using lookup table.

###### Returns

`number`

###### Inherited from

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`lookupTableThreshold`](LookupTableColorConverter.md#lookuptablethreshold)

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

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`parentConverter`](LookupTableColorConverter.md#parentconverter)

##### policy

###### Get Signature

> **get** **policy**(): [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy)

Defined in: [classes/color-converter.js:331](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L331)

Gets the conversion policy.

###### Returns

[`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy)

###### Inherited from

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`policy`](LookupTableColorConverter.md#policy)

##### sourceGrayProfile

###### Get Signature

> **get** **sourceGrayProfile**(): `string` \| `ArrayBuffer`

Defined in: [classes/pdf-content-stream-color-converter.js:181](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L181)

Gets source Gray profile.

###### Returns

`string` \| `ArrayBuffer`

##### sourceRGBProfile

###### Get Signature

> **get** **sourceRGBProfile**(): `string` \| `ArrayBuffer`

Defined in: [classes/pdf-content-stream-color-converter.js:173](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L173)

Gets source RGB profile.

###### Returns

`string` \| `ArrayBuffer`

##### supportsWorkerMode

###### Get Signature

> **get** **supportsWorkerMode**(): `boolean`

Defined in: [classes/pdf-content-stream-color-converter.js:766](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L766)

###### Returns

`boolean`

###### Overrides

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`supportsWorkerMode`](LookupTableColorConverter.md#supportsworkermode)

##### useLookupTable

###### Get Signature

> **get** **useLookupTable**(): `boolean`

Defined in: [classes/lookup-table-color-converter.js:197](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L197)

Whether lookup table is enabled.

###### Returns

`boolean`

###### Inherited from

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`useLookupTable`](LookupTableColorConverter.md#uselookuptable)

#### Methods

##### applyLookupTable()

> **applyLookupTable**(`lookupTable`: `Map`\<`string`, `number`[]\>, `input`: [`LookupTableColorConverterInput`](LookupTableColorConverter.md#lookuptablecolorconverterinput)): `number`[]

Defined in: [classes/lookup-table-color-converter.js:463](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L463)

Applies a lookup table to get converted color values.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `lookupTable` | `Map`\<`string`, `number`[]\> | Lookup table from buildLookupTable() |
| `input` | [`LookupTableColorConverterInput`](LookupTableColorConverter.md#lookuptablecolorconverterinput) | Color to look up |

###### Returns

`number`[]

Converted values or undefined if not found

###### Inherited from

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`applyLookupTable`](LookupTableColorConverter.md#applylookuptable)

##### applyWorkerResult()

> **applyWorkerResult**(`input`: [`PDFContentStreamColorConverterInput`](#pdfcontentstreamcolorconverterinput), `workerResult`: [`WorkerResult`](ColorConverter.md#workerresult), `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<`void`\>

Defined in: [classes/pdf-content-stream-color-converter.js:806](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L806)

Applies worker processing results back to the PDF structure.

Worker returns compressed content stream bytes that need to be written
back to the PDF stream object.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFContentStreamColorConverterInput`](#pdfcontentstreamcolorconverterinput) | Original input |
| `workerResult` | [`WorkerResult`](ColorConverter.md#workerresult) | Result from worker |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context |

###### Returns

`Promise`\<`void`\>

###### Overrides

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`applyWorkerResult`](LookupTableColorConverter.md#applyworkerresult)

##### buildLookupTable()

> **buildLookupTable**(`uniqueColors`: [`LookupTableColorConverterInput`](LookupTableColorConverter.md#lookuptablecolorconverterinput)[], `context?`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<`Map`\<`string`, `number`[]\>\>

Defined in: [classes/lookup-table-color-converter.js:409](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L409)

Builds a lookup table from unique colors using batch conversion.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `uniqueColors` | [`LookupTableColorConverterInput`](LookupTableColorConverter.md#lookuptablecolorconverterinput)[] | Unique colors to convert |
| `context?` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context |

###### Returns

`Promise`\<`Map`\<`string`, `number`[]\>\>

Lookup table mapping color keys to converted values

###### Inherited from

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`buildLookupTable`](LookupTableColorConverter.md#buildlookuptable)

##### clearConfigurationOverrides()

> **clearConfigurationOverrides**(): `void`

Defined in: [classes/color-converter.js:935](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L935)

Clears all per-reference overrides.

###### Returns

`void`

###### Inherited from

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`clearConfigurationOverrides`](LookupTableColorConverter.md#clearconfigurationoverrides)

##### clearLookupTable()

> **clearLookupTable**(): `void`

Defined in: [classes/lookup-table-color-converter.js:527](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L527)

Clears the lookup table cache.

Note: When using a shared BufferRegistry, this only clears instance-level
state. Call bufferRegistry.clearColorCache() to clear the shared cache.

###### Returns

`void`

###### Inherited from

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`clearLookupTable`](LookupTableColorConverter.md#clearlookuptable)

##### convertBatch()

> **convertBatch**(`inputs`: [`LookupTableColorConverterInput`](LookupTableColorConverter.md#lookuptablecolorconverterinput)[], `context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<[`LookupTableColorConverterResult`](LookupTableColorConverter.md#lookuptablecolorconverterresult)[]\>

Defined in: [classes/lookup-table-color-converter.js:316](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/lookup-table-color-converter.js#L316)

Converts multiple colors with lookup table optimization.

Separates colors into cached and uncached, processes uncached
in batch, then merges results.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `inputs` | [`LookupTableColorConverterInput`](LookupTableColorConverter.md#lookuptablecolorconverterinput)[] | Colors to convert |
| `context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context |

###### Returns

`Promise`\<[`LookupTableColorConverterResult`](LookupTableColorConverter.md#lookuptablecolorconverterresult)[]\>

Converted colors

###### Inherited from

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`convertBatch`](LookupTableColorConverter.md#convertbatch)

##### convertBatchUncached()

> **convertBatchUncached**(`inputs`: [`LookupTableColorConverterInput`](LookupTableColorConverter.md#lookuptablecolorconverterinput)[], `_context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<`number`[][]\>

Defined in: [classes/pdf-content-stream-color-converter.js:415](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L415)

Converts uncached colors in batch using inherited convertColorsBuffer().

Groups colors by colorSpace and converts each group with a single
policy-aware batch call for optimal performance. Uses the inherited
ColorConverter.convertColorsBuffer() method which properly evaluates
policy rules including engine-specific transforms.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `inputs` | [`LookupTableColorConverterInput`](LookupTableColorConverter.md#lookuptablecolorconverterinput)[] | Uncached colors |
| `_context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context (unused) |

###### Returns

`Promise`\<`number`[][]\>

Converted color values

###### Overrides

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`convertBatchUncached`](LookupTableColorConverter.md#convertbatchuncached)

##### convertColor()

> **convertColor**(`input`: [`PDFContentStreamColorConverterInput`](#pdfcontentstreamcolorconverterinput), `context?`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): `Promise`\<[`PDFContentStreamColorConverterResult`](#pdfcontentstreamcolorconverterresult)\>

Defined in: [classes/pdf-content-stream-color-converter.js:230](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L230)

Converts colors in a PDF content stream.

Parses color operations from stream text, converts RGB and Gray colors
to the destination color space, and rebuilds the stream with converted values.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFContentStreamColorConverterInput`](#pdfcontentstreamcolorconverterinput) | Content stream to convert |
| `context?` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context |

###### Returns

`Promise`\<[`PDFContentStreamColorConverterResult`](#pdfcontentstreamcolorconverterresult)\>

###### Overrides

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`convertColor`](LookupTableColorConverter.md#convertcolor)

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

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`convertColorsBuffer`](LookupTableColorConverter.md#convertcolorsbuffer)

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

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`createChildConverter`](LookupTableColorConverter.md#createchildconverter)

##### dispose()

> **dispose**(): `void`

Defined in: [classes/pdf-content-stream-color-converter.js:843](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L843)

###### Returns

`void`

###### Overrides

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`dispose`](LookupTableColorConverter.md#dispose)

##### ensureReady()

> **ensureReady**(): `Promise`\<`void`\>

Defined in: [classes/color-converter.js:298](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L298)

Ensures the converter is ready for use.

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`ensureReady`](LookupTableColorConverter.md#ensureready)

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

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`getConfigurationFor`](LookupTableColorConverter.md#getconfigurationfor)

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

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`getEffectiveConfigurationFor`](LookupTableColorConverter.md#geteffectiveconfigurationfor)

##### getEffectiveRenderingIntent()

> **getEffectiveRenderingIntent**(`colorType`: `"RGB"` \| `"Gray"` \| `"Lab"`): [`RenderingIntent`](ColorConverter.md#renderingintent-1)

Defined in: [classes/pdf-content-stream-color-converter.js:202](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L202)

Gets effective rendering intent for a color type.

K-Only GCR doesn't work for:
- Lab colors (produces incorrect K=1 output)
- RGB destination (K-Only GCR is CMYK-specific, no K channel in RGB)

This matches the logic in ImageColorConverter.getEffectiveRenderingIntent()
to ensure consistent behavior between image and content stream conversion.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `colorType` | `"RGB"` \| `"Gray"` \| `"Lab"` | Input color type |

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

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`hasConfigurationFor`](LookupTableColorConverter.md#hasconfigurationfor)

##### parseContentStream()

> **parseContentStream**(`streamText`: `string`, `initialState?`: [`ColorSpaceState`](#colorspacestate)): \{ `finalState`: [`ColorSpaceState`](#colorspacestate); `operations`: [`ParsedColorOperation`](#parsedcoloroperation)[]; \}

Defined in: [classes/pdf-content-stream-color-converter.js:566](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L566)

Parses a content stream to extract color operations.

Tracks stroke/fill color space contexts separately:
- Stroke: CS sets context, SC/SCN uses it
- Fill: cs sets context, sc/scn uses it

When multiple content streams share a page, the graphics state
(including current color space) carries over. Use initialState
to pass the color space context from previous streams.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `streamText` | `string` | Content stream text |
| `initialState?` | [`ColorSpaceState`](#colorspacestate) | Initial color space state from previous stream |

###### Returns

\{ `finalState`: [`ColorSpaceState`](#colorspacestate); `operations`: [`ParsedColorOperation`](#parsedcoloroperation)[]; \}

Parsed operations and final state

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `finalState` | [`ColorSpaceState`](#colorspacestate) | [classes/pdf-content-stream-color-converter.js:564](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L564) |
| `operations` | [`ParsedColorOperation`](#parsedcoloroperation)[] | [classes/pdf-content-stream-color-converter.js:564](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L564) |

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

###### Inherited from

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`populateLookupTable`](LookupTableColorConverter.md#populatelookuptable)

##### prepareWorkerTask()

> **prepareWorkerTask**(`input`: [`PDFContentStreamColorConverterInput`](#pdfcontentstreamcolorconverterinput), `_context`: [`ColorConverterContext`](ColorConverter.md#colorconvertercontext)): [`WorkerTask`](ColorConverter.md#workertask)

Defined in: [classes/pdf-content-stream-color-converter.js:778](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L778)

Prepares a task for worker thread execution.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`PDFContentStreamColorConverterInput`](#pdfcontentstreamcolorconverterinput) |  |
| `_context` | [`ColorConverterContext`](ColorConverter.md#colorconvertercontext) | Conversion context (unused) |

###### Returns

[`WorkerTask`](ColorConverter.md#workertask)

###### Overrides

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`prepareWorkerTask`](LookupTableColorConverter.md#prepareworkertask)

##### rebuildContentStream()

> **rebuildContentStream**(`originalText`: `string`, `replacements`: \{ `cacheHit`: `boolean`; `convertedValues`: `number`[]; `operation`: [`ParsedColorOperation`](#parsedcoloroperation); \}[]): `string`

Defined in: [classes/pdf-content-stream-color-converter.js:703](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L703)

Rebuilds content stream with converted color values.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `originalText` | `string` | Original stream text |
| `replacements` | \{ `cacheHit`: `boolean`; `convertedValues`: `number`[]; `operation`: [`ParsedColorOperation`](#parsedcoloroperation); \}[] |  |

###### Returns

`string`

Rebuilt stream text

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

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`removeConfigurationFor`](LookupTableColorConverter.md#removeconfigurationfor)

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

[`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter).[`setConfigurationFor`](LookupTableColorConverter.md#setconfigurationfor)

## Type Aliases

### ColorSpaceDefinition

> **ColorSpaceDefinition**\<\> = \{ `colorSpaceType?`: `string`; `range?`: `number`[]; \}

Defined in: [classes/pdf-content-stream-color-converter.js:23](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L23)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="colorspacetype"></a> `colorSpaceType?` | `string` | [classes/pdf-content-stream-color-converter.js:21](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L21) |
| <a id="range"></a> `range?` | `number`[] | [classes/pdf-content-stream-color-converter.js:22](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L22) |

***

### ColorSpaceState

> **ColorSpaceState**\<\> = \{ `fillColorSpace?`: `string`; `strokeColorSpace?`: `string`; \}

Defined in: [classes/pdf-content-stream-color-converter.js:45](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L45)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="fillcolorspace"></a> `fillColorSpace?` | `string` | [classes/pdf-content-stream-color-converter.js:44](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L44) |
| <a id="strokecolorspace"></a> `strokeColorSpace?` | `string` | [classes/pdf-content-stream-color-converter.js:43](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L43) |

***

### ParsedColorOperation

> **ParsedColorOperation**\<\> = \{ `colorSpaceName?`: `string`; `index`: `number`; `length`: `number`; `name?`: `string`; `operator?`: `string`; `raw?`: `string`; `type`: `"gray"` \| `"rgb"` \| `"cmyk"` \| `"colorspace"` \| `"indexed"` \| `"string"` \| `"head"`; `values?`: `number`[]; \}

Defined in: [classes/pdf-content-stream-color-converter.js:85](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L85)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="colorspacename"></a> `colorSpaceName?` | `string` | [classes/pdf-content-stream-color-converter.js:81](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L81) |
| <a id="index"></a> `index` | `number` | [classes/pdf-content-stream-color-converter.js:83](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L83) |
| <a id="length"></a> `length` | `number` | [classes/pdf-content-stream-color-converter.js:84](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L84) |
| <a id="name"></a> `name?` | `string` | [classes/pdf-content-stream-color-converter.js:80](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L80) |
| <a id="operator"></a> `operator?` | `string` | [classes/pdf-content-stream-color-converter.js:78](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L78) |
| <a id="raw"></a> `raw?` | `string` | [classes/pdf-content-stream-color-converter.js:82](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L82) |
| <a id="type"></a> `type` | `"gray"` \| `"rgb"` \| `"cmyk"` \| `"colorspace"` \| `"indexed"` \| `"string"` \| `"head"` | [classes/pdf-content-stream-color-converter.js:77](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L77) |
| <a id="values"></a> `values?` | `number`[] | [classes/pdf-content-stream-color-converter.js:79](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L79) |

***

### PDFContentStreamColorConverterConfiguration

> **PDFContentStreamColorConverterConfiguration**\<\> = [`LookupTableColorConverterConfiguration`](LookupTableColorConverter.md#lookuptablecolorconverterconfiguration-1) & \{ `colorSpaceDefinitions?`: `Record`\<`string`, [`ColorSpaceDefinition`](#colorspacedefinition)\>; `sourceGrayProfile?`: `ArrayBuffer`; `sourceRGBProfile?`: `ArrayBuffer`; \}

Defined in: [classes/pdf-content-stream-color-converter.js:33](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L33)

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `colorSpaceDefinitions?` | `Record`\<`string`, [`ColorSpaceDefinition`](#colorspacedefinition)\> | [classes/pdf-content-stream-color-converter.js:32](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L32) |
| `sourceGrayProfile?` | `ArrayBuffer` | [classes/pdf-content-stream-color-converter.js:31](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L31) |
| `sourceRGBProfile?` | `ArrayBuffer` | [classes/pdf-content-stream-color-converter.js:30](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L30) |

#### Type Parameters

| Type Parameter |
| ------ |

***

### PDFContentStreamColorConverterInput

> **PDFContentStreamColorConverterInput**\<\> = \{ `colorSpaceDefinitions?`: `Record`\<`string`, [`ColorSpaceDefinition`](#colorspacedefinition)\>; `initialColorSpaceState?`: [`ColorSpaceState`](#colorspacestate); `streamRef`: `any`; `streamText`: `string`; \}

Defined in: [classes/pdf-content-stream-color-converter.js:56](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L56)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="colorspacedefinitions"></a> `colorSpaceDefinitions?` | `Record`\<`string`, [`ColorSpaceDefinition`](#colorspacedefinition)\> | [classes/pdf-content-stream-color-converter.js:54](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L54) |
| <a id="initialcolorspacestate"></a> `initialColorSpaceState?` | [`ColorSpaceState`](#colorspacestate) | [classes/pdf-content-stream-color-converter.js:55](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L55) |
| <a id="streamref"></a> `streamRef` | `any` | [classes/pdf-content-stream-color-converter.js:52](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L52) |
| <a id="streamtext"></a> `streamText` | `string` | [classes/pdf-content-stream-color-converter.js:53](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L53) |

***

### PDFContentStreamColorConverterResult

> **PDFContentStreamColorConverterResult**\<\> = \{ `cacheHits`: `number`; `colorConversions`: `number`; `deviceColorCount`: `number`; `finalColorSpaceState`: [`ColorSpaceState`](#colorspacestate); `newText`: `string`; `originalText`: `string`; `replacementCount`: `number`; `streamRef`: `any`; \}

Defined in: [classes/pdf-content-stream-color-converter.js:71](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L71)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="cachehits"></a> `cacheHits` | `number` | [classes/pdf-content-stream-color-converter.js:68](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L68) |
| <a id="colorconversions"></a> `colorConversions` | `number` | [classes/pdf-content-stream-color-converter.js:67](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L67) |
| <a id="devicecolorcount"></a> `deviceColorCount` | `number` | [classes/pdf-content-stream-color-converter.js:69](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L69) |
| <a id="finalcolorspacestate"></a> `finalColorSpaceState` | [`ColorSpaceState`](#colorspacestate) | [classes/pdf-content-stream-color-converter.js:70](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L70) |
| <a id="newtext"></a> `newText` | `string` | [classes/pdf-content-stream-color-converter.js:65](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L65) |
| <a id="originaltext"></a> `originalText` | `string` | [classes/pdf-content-stream-color-converter.js:64](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L64) |
| <a id="replacementcount"></a> `replacementCount` | `number` | [classes/pdf-content-stream-color-converter.js:66](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L66) |
| <a id="streamref-1"></a> `streamRef` | `any` | [classes/pdf-content-stream-color-converter.js:63](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L63) |

## Variables

### COLOR\_OPERATOR\_REGEX

> `const` **COLOR\_OPERATOR\_REGEX**: `RegExp`

Defined in: [classes/pdf-content-stream-color-converter.js:97](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L97)

Regular expression for matching PDF content stream color operators.
Exported for reuse by verification tools.
