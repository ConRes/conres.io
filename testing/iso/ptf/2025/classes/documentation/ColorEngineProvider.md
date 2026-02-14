[@conres.io/test-form-generator](README.md) / ColorEngineProvider

# ColorEngineProvider

ColorEngineProvider - Thin WASM wrapper for LittleCMS color engine

Provides lifecycle management and pass-through access to the color engine.
Uses dynamic import for version flexibility.

IMPORTANT: This class does NOT provide fallback profiles (except Lab).
All ICCBased colorspaces (RGB, Gray, CMYK) require actual ICC profile data.
Lab is the only exception because it's device-independent (not ICCBased).

## Classes

### ColorEngineProvider

Defined in: [classes/color-engine-provider.js:114](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L114)

Thin wrapper providing lifecycle management for the LittleCMS WASM engine.

This class:
- Uses dynamic import for version flexibility
- Provides pass-through access to ColorEngine methods
- Enforces the "no fallback profiles" policy (except Lab)
- Re-exports LittleCMS constants

#### Constructors

##### Constructor

> **new ColorEngineProvider**(`options?`: \{ `enginePath?`: `string`; \}): [`ColorEngineProvider`](#colorengineprovider)

Defined in: [classes/color-engine-provider.js:158](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L158)

Creates a new ColorEngineProvider instance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | \{ `enginePath?`: `string`; \} |  |
| `options.enginePath?` | `string` | Path to color engine module (for version selection) |

###### Returns

[`ColorEngineProvider`](#colorengineprovider)

#### Accessors

##### engine

###### Get Signature

> **get** **engine**(): `ColorEngine`

Defined in: [classes/color-engine-provider.js:202](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L202)

Gets the underlying ColorEngine instance.

###### Throws

If not initialized

###### Returns

`ColorEngine`

##### isReady

###### Get Signature

> **get** **isReady**(): `boolean`

Defined in: [classes/color-engine-provider.js:223](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L223)

Whether the engine is initialized and ready.

###### Returns

`boolean`

##### module

###### Get Signature

> **get** **module**(): `__module`

Defined in: [classes/color-engine-provider.js:212](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L212)

Gets the loaded module (for constant access).

###### Throws

If not initialized

###### Returns

`__module`

##### RUNTIME\_ENDIANNESS

###### Get Signature

> **get** `static` **RUNTIME\_ENDIANNESS**(): `"little"` \| `"big"`

Defined in: [classes/color-engine-provider.js:123](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L123)

JavaScript runtime endianness.

###### Returns

`"little"` \| `"big"`

##### WEB\_ASSEMBLY\_ENDIANNESS

###### Get Signature

> **get** `static` **WEB\_ASSEMBLY\_ENDIANNESS**(): `"little"` \| `"big"`

Defined in: [classes/color-engine-provider.js:132](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L132)

WebAssembly memory endianness.
Used by ColorConversionPolicy to determine if TYPE_*_SE formats are needed.

###### Returns

`"little"` \| `"big"`

#### Methods

##### closeProfile()

> **closeProfile**(`handle`: `number`): `void`

Defined in: [classes/color-engine-provider.js:275](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L275)

Closes a profile handle.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `handle` | `number` | Profile handle to close |

###### Returns

`void`

##### createLab4Profile()

> **createLab4Profile**(): `number`

Defined in: [classes/color-engine-provider.js:252](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L252)

Creates a Lab D50 profile.

Lab is device-independent and not an ICCBased colorspace in PDF,
so it never has an embedded ICC profile.

###### Returns

`number`

Profile handle

##### createMultiprofileTransform()

> **createMultiprofileTransform**(`profiles`: `number`[], `inputFormat`: `number`, `outputFormat`: `number`, `intents`: `number`[], `flags`: `number`): `number`

Defined in: [classes/color-engine-provider.js:317](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L317)

Creates a multiprofile transform (for Gray -> sRGB -> CMYK chains).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `profiles` | `number`[] | Array of profile handles |
| `inputFormat` | `number` | Input pixel format |
| `outputFormat` | `number` | Output pixel format |
| `intents` | `number`[] | Array of rendering intents (one per profile transition) |
| `flags` | `number` | Transform flags |

###### Returns

`number`

Transform handle

##### createSRGBProfile()

> **createSRGBProfile**(): `number`

Defined in: [classes/color-engine-provider.js:265](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L265)

Creates an sRGB profile.

sRGB is the standard RGB working space used as an intermediate
for multiprofile transforms (e.g., Gray → sRGB → CMYK for K-Only GCR).

###### Returns

`number`

Profile handle

##### createTransform()

> **createTransform**(`inputProfile`: `number`, `inputFormat`: `number`, `outputProfile`: `number`, `outputFormat`: `number`, `intent`: `number`, `flags`: `number`): `number`

Defined in: [classes/color-engine-provider.js:295](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L295)

Creates a color transform between two profiles.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `inputProfile` | `number` | Input profile handle |
| `inputFormat` | `number` | Input pixel format (TYPE_* constant) |
| `outputProfile` | `number` | Output profile handle |
| `outputFormat` | `number` | Output pixel format (TYPE_* constant) |
| `intent` | `number` | Rendering intent (INTENT_* constant) |
| `flags` | `number` | Transform flags (cmsFLAGS_* constants) |

###### Returns

`number`

Transform handle

##### deleteTransform()

> **deleteTransform**(`transform`: `number`): `void`

Defined in: [classes/color-engine-provider.js:336](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L336)

Deletes a transform handle.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `transform` | `number` | Transform handle to delete |

###### Returns

`void`

##### dispose()

> **dispose**(): `void`

Defined in: [classes/color-engine-provider.js:403](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L403)

Disposes of the color engine and releases resources.

###### Returns

`void`

##### doTransformAdaptive()

> **doTransformAdaptive**(`transform`: `number`, `inputBuffer`: `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `outputBuffer`: `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `pixelCount`: `number`): `any`

Defined in: [classes/color-engine-provider.js:386](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L386)

Transforms pixels with adaptive BPC clamping.
Optional - only available in engines with adaptive BPC support.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `transform` | `number` | Transform handle |
| `inputBuffer` | `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | Input pixel data |
| `outputBuffer` | `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | Output pixel data |
| `pixelCount` | `number` | Number of pixels to transform |

###### Returns

`any`

BPC statistics, or null if not available

##### getConstants()

> **getConstants**(): [`ColorEngineConstants`](#colorengineconstants)

Defined in: [classes/color-engine-provider.js:419](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L419)

Gets all exported constants from the color engine module.
Must be called after initialize().

###### Returns

[`ColorEngineConstants`](#colorengineconstants)

Object containing all TYPE_*, INTENT_*, and cmsFLAGS_* constants

##### initBPCClamping()

> **initBPCClamping**(`transform`: `number`, `inputChannels`: `number`, `outputChannels`: `number`): `boolean`

Defined in: [classes/color-engine-provider.js:367](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L367)

Initializes BPC clamping optimization for a transform.
Optional - only available in engines with adaptive BPC support.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `transform` | `number` | Transform handle |
| `inputChannels` | `number` | Number of input channels |
| `outputChannels` | `number` | Number of output channels |

###### Returns

`boolean`

Whether initialization succeeded

##### initialize()

> **initialize**(): `Promise`\<`void`\>

Defined in: [classes/color-engine-provider.js:168](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L168)

Initializes the WASM color engine.
Safe to call multiple times - subsequent calls return the same promise.

###### Returns

`Promise`\<`void`\>

##### openProfileFromMem()

> **openProfileFromMem**(`buffer`: `ArrayBuffer` \| `Uint8Array`\<`ArrayBufferLike`\>): `number`

Defined in: [classes/color-engine-provider.js:238](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L238)

Opens an ICC profile from memory buffer.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `buffer` | `ArrayBuffer` \| `Uint8Array`\<`ArrayBufferLike`\> | ICC profile data |

###### Returns

`number`

Profile handle

###### Throws

If buffer is not valid ICC profile data

##### transformArray()

> **transformArray**(`transform`: `number`, `inputBuffer`: `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `outputBuffer`: `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `pixelCount`: `number`): `void`

Defined in: [classes/color-engine-provider.js:353](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L353)

Transforms an array of pixels.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `transform` | `number` | Transform handle |
| `inputBuffer` | `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | Input pixel data |
| `outputBuffer` | `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | Output pixel data |
| `pixelCount` | `number` | Number of pixels to transform |

###### Returns

`void`

## Type Aliases

### ColorEngine

> **ColorEngine**\<\> = `ColorEngine`

Defined in: [classes/color-engine-provider.js:16](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L16)

#### Type Parameters

| Type Parameter |
| ------ |

***

### ColorEngineConstants

> **ColorEngineConstants**\<\> = \{ `cmsFLAGS_BLACKPOINTCOMPENSATION`: `number`; `cmsFLAGS_MULTIPROFILE_BPC_SCALING`: `number`; `cmsFLAGS_NOCACHE`: `number`; `cmsFLAGS_NOOPTIMIZE`: `number`; `INTENT_ABSOLUTE_COLORIMETRIC`: `number`; `INTENT_PERCEPTUAL`: `number`; `INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR`: `number`; `INTENT_RELATIVE_COLORIMETRIC`: `number`; `INTENT_SATURATION`: `number`; `TYPE_ARGB_8`: `number`; `TYPE_BGR_16`: `number`; `TYPE_BGR_16_SE`: `number`; `TYPE_BGR_8`: `number`; `TYPE_BGRA_8`: `number`; `TYPE_CMYK_16`: `number`; `TYPE_CMYK_16_SE`: `number`; `TYPE_CMYK_8`: `number`; `TYPE_CMYK_FLT`: `number`; `TYPE_GRAY_16`: `number`; `TYPE_GRAY_16_SE`: `number`; `TYPE_GRAY_8`: `number`; `TYPE_GRAY_FLT`: `number`; `TYPE_Lab_16`: `number`; `TYPE_Lab_8`: `number`; `TYPE_Lab_FLT`: `number`; `TYPE_RGB_16`: `number`; `TYPE_RGB_16_SE`: `number`; `TYPE_RGB_8`: `number`; `TYPE_RGB_FLT`: `number`; `TYPE_RGBA_16`: `number`; `TYPE_RGBA_16_SE`: `number`; `TYPE_RGBA_8`: `number`; \}

Defined in: [classes/color-engine-provider.js:54](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L54)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="cmsflags_blackpointcompensation"></a> `cmsFLAGS_BLACKPOINTCOMPENSATION` | `number` | [classes/color-engine-provider.js:50](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L50) |
| <a id="cmsflags_multiprofile_bpc_scaling"></a> `cmsFLAGS_MULTIPROFILE_BPC_SCALING` | `number` | [classes/color-engine-provider.js:53](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L53) |
| <a id="cmsflags_nocache"></a> `cmsFLAGS_NOCACHE` | `number` | [classes/color-engine-provider.js:51](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L51) |
| <a id="cmsflags_nooptimize"></a> `cmsFLAGS_NOOPTIMIZE` | `number` | [classes/color-engine-provider.js:52](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L52) |
| <a id="intent_absolute_colorimetric"></a> `INTENT_ABSOLUTE_COLORIMETRIC` | `number` | [classes/color-engine-provider.js:48](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L48) |
| <a id="intent_perceptual"></a> `INTENT_PERCEPTUAL` | `number` | [classes/color-engine-provider.js:45](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L45) |
| <a id="intent_preserve_k_only_relative_colorimetric_gcr"></a> `INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR` | `number` | [classes/color-engine-provider.js:49](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L49) |
| <a id="intent_relative_colorimetric"></a> `INTENT_RELATIVE_COLORIMETRIC` | `number` | [classes/color-engine-provider.js:46](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L46) |
| <a id="intent_saturation"></a> `INTENT_SATURATION` | `number` | [classes/color-engine-provider.js:47](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L47) |
| <a id="type_argb_8"></a> `TYPE_ARGB_8` | `number` | [classes/color-engine-provider.js:26](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L26) |
| <a id="type_bgr_16"></a> `TYPE_BGR_16` | `number` | [classes/color-engine-provider.js:34](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L34) |
| <a id="type_bgr_16_se"></a> `TYPE_BGR_16_SE` | `number` | [classes/color-engine-provider.js:35](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L35) |
| <a id="type_bgr_8"></a> `TYPE_BGR_8` | `number` | [classes/color-engine-provider.js:24](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L24) |
| <a id="type_bgra_8"></a> `TYPE_BGRA_8` | `number` | [classes/color-engine-provider.js:27](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L27) |
| <a id="type_cmyk_16"></a> `TYPE_CMYK_16` | `number` | [classes/color-engine-provider.js:38](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L38) |
| <a id="type_cmyk_16_se"></a> `TYPE_CMYK_16_SE` | `number` | [classes/color-engine-provider.js:39](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L39) |
| <a id="type_cmyk_8"></a> `TYPE_CMYK_8` | `number` | [classes/color-engine-provider.js:28](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L28) |
| <a id="type_cmyk_flt"></a> `TYPE_CMYK_FLT` | `number` | [classes/color-engine-provider.js:43](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L43) |
| <a id="type_gray_16"></a> `TYPE_GRAY_16` | `number` | [classes/color-engine-provider.js:30](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L30) |
| <a id="type_gray_16_se"></a> `TYPE_GRAY_16_SE` | `number` | [classes/color-engine-provider.js:31](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L31) |
| <a id="type_gray_8"></a> `TYPE_GRAY_8` | `number` | [classes/color-engine-provider.js:22](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L22) |
| <a id="type_gray_flt"></a> `TYPE_GRAY_FLT` | `number` | [classes/color-engine-provider.js:41](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L41) |
| <a id="type_lab_16"></a> `TYPE_Lab_16` | `number` | [classes/color-engine-provider.js:40](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L40) |
| <a id="type_lab_8"></a> `TYPE_Lab_8` | `number` | [classes/color-engine-provider.js:29](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L29) |
| <a id="type_lab_flt"></a> `TYPE_Lab_FLT` | `number` | [classes/color-engine-provider.js:44](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L44) |
| <a id="type_rgb_16"></a> `TYPE_RGB_16` | `number` | [classes/color-engine-provider.js:32](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L32) |
| <a id="type_rgb_16_se"></a> `TYPE_RGB_16_SE` | `number` | [classes/color-engine-provider.js:33](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L33) |
| <a id="type_rgb_8"></a> `TYPE_RGB_8` | `number` | [classes/color-engine-provider.js:23](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L23) |
| <a id="type_rgb_flt"></a> `TYPE_RGB_FLT` | `number` | [classes/color-engine-provider.js:42](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L42) |
| <a id="type_rgba_16"></a> `TYPE_RGBA_16` | `number` | [classes/color-engine-provider.js:36](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L36) |
| <a id="type_rgba_16_se"></a> `TYPE_RGBA_16_SE` | `number` | [classes/color-engine-provider.js:37](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L37) |
| <a id="type_rgba_8"></a> `TYPE_RGBA_8` | `number` | [classes/color-engine-provider.js:25](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L25) |

## Variables

### DEFAULT\_ENGINE\_PATH

> `const` **DEFAULT\_ENGINE\_PATH**: `"../packages/color-engine/src/index.js"` = `'../packages/color-engine/src/index.js'`

Defined in: [classes/color-engine-provider.js:60](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L60)

Default engine path (symlink to active version)

***

### DEFAULT\_ENGINE\_VERSION

> `const` **DEFAULT\_ENGINE\_VERSION**: `string`

Defined in: [classes/color-engine-provider.js:103](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L103)

Default engine version identifier derived from the symlinked color-engine package.
Used for policy rule matching.

***

### RUNTIME\_ENDIANNESS

> `const` **RUNTIME\_ENDIANNESS**: `"little"` \| `"big"`

Defined in: [classes/color-engine-provider.js:71](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L71)

JavaScript runtime endianness detection.
Tests how multi-byte integers are stored in ArrayBuffer.

***

### WEB\_ASSEMBLY\_ENDIANNESS

> `const` **WEB\_ASSEMBLY\_ENDIANNESS**: `"little"` \| `"big"`

Defined in: [classes/color-engine-provider.js:84](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-engine-provider.js#L84)

WebAssembly linear memory endianness detection.
Tests how multi-byte integers are stored in WASM memory.

Note: WASM is always little-endian in practice, but we detect it explicitly to:
- Document the assumption in code
- Future-proof against hypothetical big-endian WASM runtimes
- Make the logic self-documenting and verifiable
