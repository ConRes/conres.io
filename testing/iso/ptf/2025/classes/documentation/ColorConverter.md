[@conres.io/test-form-generator](README.md) / ColorConverter

# ColorConverter

Color Converter Base Class

Abstract base class for color conversion operations.
Provides configuration management and per-reference overrides
that subclasses can use for fine-grained control.

Uses ColorEngineProvider for WASM color engine access and
ColorConversionPolicy for format/transform decisions.

## Enumerations

### RENDERING\_INTENT\_CODE

Defined in: [classes/color-converter.js:38](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L38)

Numeric rendering intent codes for fast comparison.

Using numeric codes instead of string comparison provides ~10x faster
comparisons in hot paths (e.g., per color space group processing).

Values match LittleCMS intent constants where applicable:
- 0-3: Standard ICC intents
- 20: Custom K-Only GCR intent

#### Enumeration Members

| Enumeration Member | Value | Defined in |
| ------ | ------ | ------ |
| <a id="absolute_colorimetric"></a> `ABSOLUTE_COLORIMETRIC` | `3` | [classes/color-converter.js:42](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L42) |
| <a id="k_only_gcr"></a> `K_ONLY_GCR` | `20` | [classes/color-converter.js:43](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L43) |
| <a id="perceptual"></a> `PERCEPTUAL` | `0` | [classes/color-converter.js:39](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L39) |
| <a id="relative_colorimetric"></a> `RELATIVE_COLORIMETRIC` | `1` | [classes/color-converter.js:40](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L40) |
| <a id="saturation"></a> `SATURATION` | `2` | [classes/color-converter.js:41](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L41) |

## Classes

### `abstract` ColorConverter

Defined in: [classes/color-converter.js:166](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L166)

Abstract base class for color conversion operations.

Provides a consistent structure for color conversion operations with:
- Immutable configuration frozen at construction
- Per-reference overrides for fine-grained control
- Parent-child relationships for hierarchical converters
- Worker mode support for parallel processing

#### Example

```javascript
class MyConverter extends ColorConverter {
    async convert(input) {
        // Use convertColorsBuffer for actual conversion
        return await this.convertColorsBuffer(input.buffer, {
            inputColorSpace: input.colorSpace,
            outputColorSpace: this.configuration.destinationColorSpace,
            sourceProfile: input.sourceProfile,
        });
    }
}

const converter = new MyConverter({
    renderingIntent: 'relative-colorimetric',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: true,
    destinationProfile: cmykProfileBuffer,
    destinationColorSpace: 'CMYK',
    verbose: false,
});

const result = await converter.convert({ buffer, colorSpace: 'RGB' });
```

#### Extended by

- [`CompositeColorConverter`](CompositeColorConverter.md#compositecolorconverter)
- [`ImageColorConverter`](ImageColorConverter.md#imagecolorconverter)
- [`LookupTableColorConverter`](LookupTableColorConverter.md#lookuptablecolorconverter)

#### Constructors

##### Constructor

> **new ColorConverter**(`configuration`: [`ColorConverterConfiguration`](#colorconverterconfiguration-1), `options?`: \{ `colorEnginePath?`: `string`; `colorEngineProvider?`: [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider); `colorEngineService?`: `ColorEngineService`; `domain?`: `string`; `engineVersion?`: `string`; `policy?`: [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy); \}): [`ColorConverter`](#colorconverter)

Defined in: [classes/color-converter.js:232](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L232)

Creates a new ColorConverter instance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `configuration` | [`ColorConverterConfiguration`](#colorconverterconfiguration-1) | Immutable configuration |
| `options?` | \{ `colorEnginePath?`: `string`; `colorEngineProvider?`: [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider); `colorEngineService?`: `ColorEngineService`; `domain?`: `string`; `engineVersion?`: `string`; `policy?`: [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy); \} | Additional options |
| `options.colorEnginePath?` | `string` | Path to color engine package (e.g., "../packages/color-engine-2026-01-30") |
| `options.colorEngineProvider?` | [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider) | Shared ColorEngineProvider |
| `options.colorEngineService?` | `ColorEngineService` |  |
| `options.domain?` | `string` | Domain context for policy severity |
| `options.engineVersion?` | `string` | Color engine version for policy rules (default: from symlinked color-engine) |
| `options.policy?` | [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy) | Custom conversion policy |

###### Returns

[`ColorConverter`](#colorconverter)

###### Deprecated

Shared ColorEngineService (for backward compatibility)

#### Accessors

##### colorEngineProvider

###### Get Signature

> **get** **colorEngineProvider**(): [`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider)

Defined in: [classes/color-converter.js:323](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L323)

Gets the ColorEngineProvider instance.

###### Returns

[`ColorEngineProvider`](ColorEngineProvider.md#colorengineprovider)

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

##### configuration

###### Get Signature

> **get** **configuration**(): `Readonly`\<[`ColorConverterConfiguration`](#colorconverterconfiguration-1)\>

Defined in: [classes/color-converter.js:315](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L315)

Gets the immutable configuration for this converter.

###### Example

```javascript
const intent = converter.configuration.renderingIntent;
```

###### Returns

`Readonly`\<[`ColorConverterConfiguration`](#colorconverterconfiguration-1)\>

Frozen configuration object

##### diagnostics

###### Get Signature

> **get** **diagnostics**(): [`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector) \| [`NoOpDiagnostics`](DiagnosticsCollector.md#noopdiagnostics)

Defined in: [classes/color-converter.js:356](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L356)

Gets the DiagnosticsCollector instance.

Returns the configured diagnostics collector, or NO_OP_DIAGNOSTICS if none provided.
This allows instrumentation code to always call diagnostics methods without null checks.

###### Returns

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector) \| [`NoOpDiagnostics`](DiagnosticsCollector.md#noopdiagnostics)

##### parentConverter

###### Get Signature

> **get** **parentConverter**(): [`ColorConverter`](#colorconverter)

Defined in: [classes/color-converter.js:365](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L365)

Gets the parent converter in the hierarchy.

###### Returns

[`ColorConverter`](#colorconverter)

Parent converter or null if root

###### Set Signature

> **set** **parentConverter**(`parent`: [`ColorConverter`](#colorconverter)): `void`

Defined in: [classes/color-converter.js:374](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L374)

Sets the parent converter in the hierarchy.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `parent` | [`ColorConverter`](#colorconverter) | Parent converter or null |

###### Returns

`void`

##### policy

###### Get Signature

> **get** **policy**(): [`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy)

Defined in: [classes/color-converter.js:331](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L331)

Gets the conversion policy.

###### Returns

[`ColorConversionPolicy`](ColorConversionPolicy.md#colorconversionpolicy)

##### supportsWorkerMode

###### Get Signature

> **get** **supportsWorkerMode**(): `boolean`

Defined in: [classes/color-converter.js:823](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L823)

Indicates whether this converter supports worker mode.

Override in subclasses that can run in web workers.

###### Returns

`boolean`

True if worker mode is supported

#### Methods

##### applyWorkerResult()

> **applyWorkerResult**(`input`: [`ColorConverterInput`](#colorconverterinput), `workerResult`: [`WorkerResult`](#workerresult), `context`: [`ColorConverterContext`](#colorconvertercontext)): `Promise`\<`void`\>

Defined in: [classes/color-converter.js:850](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L850)

Applies worker result back to the converter.

Override in subclasses to deserialize and apply worker output.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`ColorConverterInput`](#colorconverterinput) | Original input data |
| `workerResult` | [`WorkerResult`](#workerresult) | Result from worker |
| `context` | [`ColorConverterContext`](#colorconvertercontext) | Conversion context |

###### Returns

`Promise`\<`void`\>

##### clearConfigurationOverrides()

> **clearConfigurationOverrides**(): `void`

Defined in: [classes/color-converter.js:935](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L935)

Clears all per-reference overrides.

###### Returns

`void`

##### convertColorsBuffer()

> **convertColorsBuffer**(`inputBuffer`: `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `options`: \{ `bitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `blackPointCompensation?`: `boolean`; `destinationProfile?`: [`ProfileType`](#profiletype); `endianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `inputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `inputColorSpace`: [`ColorSpace`](ColorConversionPolicy.md#colorspace); `inputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `outputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `outputColorSpace`: [`ColorSpace`](ColorConversionPolicy.md#colorspace); `outputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `renderingIntent?`: [`RenderingIntent`](#renderingintent-1); `sourceProfile`: [`ProfileType`](#profiletype); \}): `Promise`\<\{ `bpcStats?`: `any`; `inputChannels`: `number`; `outputChannels`: `number`; `outputPixels`: `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>; `pixelCount`: `number`; \}\>

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
| `options` | \{ `bitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `blackPointCompensation?`: `boolean`; `destinationProfile?`: [`ProfileType`](#profiletype); `endianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `inputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `inputColorSpace`: [`ColorSpace`](ColorConversionPolicy.md#colorspace); `inputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `outputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `outputColorSpace`: [`ColorSpace`](ColorConversionPolicy.md#colorspace); `outputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `renderingIntent?`: [`RenderingIntent`](#renderingintent-1); `sourceProfile`: [`ProfileType`](#profiletype); \} | Conversion options |
| `options.bitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | Bit depth (fallback for input/output) |
| `options.blackPointCompensation?` | `boolean` | Enable BPC (uses config if not provided) |
| `options.destinationProfile?` | [`ProfileType`](#profiletype) | Destination ICC profile (uses config if not provided) |
| `options.endianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | Endianness (fallback for input/output) |
| `options.inputBitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | Input bit depth (overrides bitsPerComponent) |
| `options.inputColorSpace` | [`ColorSpace`](ColorConversionPolicy.md#colorspace) | Input color space |
| `options.inputEndianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | Input endianness (overrides endianness) |
| `options.outputBitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | Output bit depth (overrides bitsPerComponent) |
| `options.outputColorSpace` | [`ColorSpace`](ColorConversionPolicy.md#colorspace) | Output color space |
| `options.outputEndianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | Output endianness (overrides endianness) |
| `options.renderingIntent?` | [`RenderingIntent`](#renderingintent-1) | Rendering intent (uses config if not provided) |
| `options.sourceProfile` | [`ProfileType`](#profiletype) | Source ICC profile (ArrayBuffer required except Lab) |

###### Returns

`Promise`\<\{ `bpcStats?`: `any`; `inputChannels`: `number`; `outputChannels`: `number`; `outputPixels`: `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>; `pixelCount`: `number`; \}\>

##### createChildConverter()

> **createChildConverter**\<`T`\>(`ConverterClass`: `T`, `configOverrides?`: `Partial`\<[`ColorConverterConfiguration`](#colorconverterconfiguration-1)\>): `InstanceType`\<`T`\>

Defined in: [classes/color-converter.js:961](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L961)

Creates a child converter with merged configuration.

The child converter inherits base configuration, merged with
any provided overrides. Parent-child relationship is established.

###### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| `T` *extends* *typeof* [`ColorConverter`](#colorconverter) |  |

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `ConverterClass` | `T` | Child converter class |
| `configOverrides?` | `Partial`\<[`ColorConverterConfiguration`](#colorconverterconfiguration-1)\> | Configuration overrides |

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

##### dispose()

> **dispose**(): `void`

Defined in: [classes/color-converter.js:990](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L990)

Releases resources held by this converter.

Override in subclasses to clean up caches, handles, or pools.
Always call `super.dispose()` when overriding.

###### Returns

`void`

###### Example

```javascript
dispose() {
    this.#myCache.clear();
    super.dispose();
}
```

##### ensureReady()

> **ensureReady**(): `Promise`\<`void`\>

Defined in: [classes/color-converter.js:298](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L298)

Ensures the converter is ready for use.

###### Returns

`Promise`\<`void`\>

##### getConfigurationFor()

> **getConfigurationFor**(`reference`: `any`): `Readonly`\<`Partial`\<[`ColorConverterConfiguration`](#colorconverterconfiguration-1)\>\>

Defined in: [classes/color-converter.js:886](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L886)

Gets raw override for a reference (without base merge).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `reference` | `any` | PDF reference or string key |

###### Returns

`Readonly`\<`Partial`\<[`ColorConverterConfiguration`](#colorconverterconfiguration-1)\>\>

Override or undefined

##### getEffectiveConfigurationFor()

> **getEffectiveConfigurationFor**(`reference`: `any`): `Readonly`\<[`ColorConverterConfiguration`](#colorconverterconfiguration-1)\>

Defined in: [classes/color-converter.js:902](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L902)

Gets effective configuration for a reference (base + override merged).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `reference` | `any` | PDF reference or string key |

###### Returns

`Readonly`\<[`ColorConverterConfiguration`](#colorconverterconfiguration-1)\>

Merged configuration

###### Example

```javascript
const effectiveConfig = converter.getEffectiveConfigurationFor(imageRef);
console.log(effectiveConfig.renderingIntent);
```

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

##### prepareWorkerTask()

> **prepareWorkerTask**(`input`: [`ColorConverterInput`](#colorconverterinput), `context`: [`ColorConverterContext`](#colorconvertercontext)): [`WorkerTask`](#workertask)

Defined in: [classes/color-converter.js:836](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L836)

Prepares a task for worker thread execution.

Override in subclasses to serialize input for worker transfer.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `input` | [`ColorConverterInput`](#colorconverterinput) | Input data |
| `context` | [`ColorConverterContext`](#colorconvertercontext) | Conversion context |

###### Returns

[`WorkerTask`](#workertask)

Serializable task data or null if not supported

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

##### setConfigurationFor()

> **setConfigurationFor**(`reference`: `any`, `configuration`: `Partial`\<[`ColorConverterConfiguration`](#colorconverterconfiguration-1)\>): `void`

Defined in: [classes/color-converter.js:875](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L875)

Sets configuration override for a specific reference.

Overrides are merged with base configuration when processing
the specified reference (e.g., specific page or image).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `reference` | `any` | PDF reference or string key |
| `configuration` | `Partial`\<[`ColorConverterConfiguration`](#colorconverterconfiguration-1)\> | Partial override |

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

## Type Aliases

### ColorConverterConfiguration

> **ColorConverterConfiguration**\<\> = \{ `blackPointCompensation`: `boolean`; `destinationColorSpace`: `"CMYK"` \| `"RGB"`; `destinationProfile`: [`ProfileType`](#profiletype); `diagnostics?`: [`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector); `renderingIntent`: [`RenderingIntent`](#renderingintent-1); `useAdaptiveBPCClamping`: `boolean`; `verbose`: `boolean`; \}

Defined in: [classes/color-converter.js:99](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L99)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="blackpointcompensation"></a> `blackPointCompensation` | `boolean` | [classes/color-converter.js:93](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L93) |
| <a id="destinationcolorspace"></a> `destinationColorSpace` | `"CMYK"` \| `"RGB"` | [classes/color-converter.js:96](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L96) |
| <a id="destinationprofile"></a> `destinationProfile` | [`ProfileType`](#profiletype) | [classes/color-converter.js:95](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L95) |
| <a id="diagnostics-1"></a> `diagnostics?` | [`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector) | [classes/color-converter.js:98](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L98) |
| <a id="renderingintent"></a> `renderingIntent` | [`RenderingIntent`](#renderingintent-1) | [classes/color-converter.js:92](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L92) |
| <a id="useadaptivebpcclamping"></a> `useAdaptiveBPCClamping` | `boolean` | [classes/color-converter.js:94](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L94) |
| <a id="verbose"></a> `verbose` | `boolean` | [classes/color-converter.js:97](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L97) |

***

### ColorConverterContext

> **ColorConverterContext**\<\> = `Record`\<`string`, `any`\>

Defined in: [classes/color-converter.js:109](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L109)

#### Type Parameters

| Type Parameter |
| ------ |

***

### ColorConverterInput

> **ColorConverterInput**\<\> = `Record`\<`string`, `any`\>

Defined in: [classes/color-converter.js:104](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L104)

#### Type Parameters

| Type Parameter |
| ------ |

***

### ColorConverterResult

> **ColorConverterResult**\<\> = `Record`\<`string`, `any`\>

Defined in: [classes/color-converter.js:114](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L114)

#### Type Parameters

| Type Parameter |
| ------ |

***

### ProfileType

> **ProfileType**\<\> = `ArrayBuffer` \| `"Lab"` \| `"sRGB"`

Defined in: [classes/color-converter.js:85](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L85)

#### Type Parameters

| Type Parameter |
| ------ |

***

### RenderingIntent

> **RenderingIntent**\<\> = `"perceptual"` \| `"relative-colorimetric"` \| `"saturation"` \| `"absolute-colorimetric"` \| `"preserve-k-only-relative-colorimetric-gcr"`

Defined in: [classes/color-converter.js:80](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L80)

#### Type Parameters

| Type Parameter |
| ------ |

***

### WorkerResult

> **WorkerResult**\<\> = `Record`\<`string`, `any`\>

Defined in: [classes/color-converter.js:124](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L124)

#### Type Parameters

| Type Parameter |
| ------ |

***

### WorkerTask

> **WorkerTask**\<\> = `Record`\<`string`, `any`\>

Defined in: [classes/color-converter.js:119](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L119)

#### Type Parameters

| Type Parameter |
| ------ |

## Functions

### getRenderingIntentCode()

> **getRenderingIntentCode**(`intent`: [`RenderingIntent`](#renderingintent-1)): `number`

Defined in: [classes/color-converter.js:57](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-converter.js#L57)

Maps string rendering intent to numeric code.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `intent` | [`RenderingIntent`](#renderingintent-1) | String rendering intent |

#### Returns

`number`

Numeric intent code

#### Example

```javascript
const code = getRenderingIntentCode('preserve-k-only-relative-colorimetric-gcr');
// code === 20
```
