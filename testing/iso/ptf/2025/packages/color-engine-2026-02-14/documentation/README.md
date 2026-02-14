# @conres/color-engine

## Fileoverview

Color Engine - WebAssembly wrapper for Little-CMS
Provides lcms-wasm parity with support for K-Only BPC+GCR algorithm

## Classes

### ColorEngine

Defined in: [index.js:35](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L35)

Color Engine class - wraps Little-CMS WebAssembly module

#### Constructors

##### Constructor

> **new ColorEngine**(): [`ColorEngine`](#colorengine)

Defined in: [index.js:47](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L47)

###### Returns

[`ColorEngine`](#colorengine)

#### Accessors

##### HEAPF32

###### Get Signature

> **get** **HEAPF32**(): `Float32Array`\<`ArrayBufferLike`\>

Defined in: [index.js:405](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L405)

Get HEAPF32 view

###### Returns

`Float32Array`\<`ArrayBufferLike`\>

##### HEAPU8

###### Get Signature

> **get** **HEAPU8**(): `Uint8Array`\<`ArrayBufferLike`\>

Defined in: [index.js:395](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L395)

Get WASM module HEAPU8 view

###### Returns

`Uint8Array`\<`ArrayBufferLike`\>

#### Methods

##### clearBPCClamping()

> **clearBPCClamping**(`transform`: `number`): `void`

Defined in: [index.js:278](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L278)

Clear BPC clamping cache for a transform
Call this when deleting a transform to free memory

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `transform` | `number` | Transform handle |

###### Returns

`void`

##### closeProfile()

> **closeProfile**(`profile`: `number`): `void`

Defined in: [index.js:105](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L105)

Close ICC profile

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `profile` | `number` | Profile handle |

###### Returns

`void`

##### createGray2Profile()

> **createGray2Profile**(): `number`

Defined in: [index.js:376](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L376)

Create Gray profile with gamma 2.2 and D50 white point

###### Returns

`number`

Profile handle

##### createLab4Profile()

> **createLab4Profile**(`whitePoint`: `number`): `number`

Defined in: [index.js:358](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L358)

Create Lab profile

###### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `whitePoint` | `number` | `0` | White point (NULL for D50) |

###### Returns

`number`

Profile handle

##### createMultiprofileTransform()

> **createMultiprofileTransform**(`profiles`: `number`[], `inputFormat`: `number`, `outputFormat`: `number`, `intent`: `number`, `flags`: `number`): `number`

Defined in: [index.js:197](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L197)

Create multiprofile color transform

Chains multiple ICC profiles in a single transform pipeline for SIMD-optimized
conversions. This is the unified entry point that handles ALL multiprofile cases:

**Features:**
- Standard intents (RELATIVE_COLORIMETRIC, PERCEPTUAL, etc.) for any profile chain
- Gray workaround: Automatically handles Gray (PT_GRAY) in 3+ profile chains
  (LittleCMS natively only supports Gray in 2-profile transforms)
- K-Only GCR: When `INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR` is used
  with CMYK output, produces K-only output for neutral gray inputs

**K-Only GCR Behavior:**
- Only applies when output profile is CMYK
- For non-RGB input (Gray, Lab, CMYK), automatically inserts sRGB intermediate
- Neutral gray inputs produce K-only CMYK output (CMY ≈ 0, K > 0)
- Chromatic colors still produce CMY components as needed
- Returns 0 (failure) if K-Only intent used with non-CMYK output

**Gray Workaround Details:**
- LittleCMS limitation: Gray in 3+ profile chains fails natively
- This function detects Gray and builds a composite LUT by sampling
  chained 2-profile transforms (which do support Gray)
- Same runtime performance as native multiprofile after LUT creation

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `profiles` | `number`[] | Array of profile handles (2-255 profiles) |
| `inputFormat` | `number` | Input pixel format (e.g., TYPE_GRAY_8, TYPE_RGB_8) |
| `outputFormat` | `number` | Output pixel format (e.g., TYPE_CMYK_8) |
| `intent` | `number` | Rendering intent. Use INTENT_RELATIVE_COLORIMETRIC for standard behavior, or INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR for K-only output on CMYK targets. |
| `flags` | `number` | Transform flags (e.g., cmsFLAGS_BLACKPOINTCOMPENSATION) |

###### Returns

`number`

Transform handle (0 on failure)

###### Throws

If module not initialized

###### Examples

```ts
// Standard multiprofile: Gray → sRGB → CMYK
const transformHandle = engine.createMultiprofileTransform(
  [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
  TYPE_GRAY_8,
  TYPE_CMYK_8,
  INTENT_RELATIVE_COLORIMETRIC,
  cmsFLAGS_BLACKPOINTCOMPENSATION
);
```

```ts
// K-Only GCR: Gray → sRGB → CMYK with K-only output for neutrals
const transformHandle = engine.createMultiprofileTransform(
  [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
  TYPE_GRAY_8,
  TYPE_CMYK_8,
  INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
  cmsFLAGS_BLACKPOINTCOMPENSATION
);

// Transform 50% gray → CMYK(0, 0, 0, ~158) (K-only!)
const input = new Uint8Array([128]);
const output = new Uint8Array(4);
engine.doTransform(transformHandle, input, output, 1);
// output = [0, 0, 0, 158] (C=0, M=0, Y=0, K≈62%)

// Clean up
engine.deleteTransform(transformHandle);
```

##### createSRGBProfile()

> **createSRGBProfile**(): `number`

Defined in: [index.js:348](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L348)

Create sRGB profile

###### Returns

`number`

Profile handle

##### createTransform()

> **createTransform**(`inputProfile`: `number`, `inputFormat`: `number`, `outputProfile`: `number`, `outputFormat`: `number`, `intent`: `number`, `flags`: `number`): `number`

Defined in: [index.js:120](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L120)

Create color transform

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `inputProfile` | `number` | Input profile handle |
| `inputFormat` | `number` | Input pixel format |
| `outputProfile` | `number` | Output profile handle |
| `outputFormat` | `number` | Output pixel format |
| `intent` | `number` | Rendering intent |
| `flags` | `number` | Transform flags |

###### Returns

`number`

Transform handle

##### createXYZProfile()

> **createXYZProfile**(): `number`

Defined in: [index.js:367](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L367)

Create XYZ profile

###### Returns

`number`

Profile handle

##### deleteTransform()

> **deleteTransform**(`transform`: `number`): `void`

Defined in: [index.js:213](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L213)

Delete color transform

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `transform` | `number` | Transform handle |

###### Returns

`void`

##### doTransform()

> **doTransform**(`transform`: `number`, `inputBuffer`: `number` \| `any`[] \| `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `outputBuffer`: `number` \| `any`[] \| `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `pixelCount`: `number`): `void`

Defined in: [index.js:225](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L225)

Execute color transform on raw buffers

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `transform` | `number` | Transform handle |
| `inputBuffer` | `number` \| `any`[] \| `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | Input color buffer (pointer or array) |
| `outputBuffer` | `number` \| `any`[] \| `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | Output color buffer (pointer or array) |
| `pixelCount` | `number` | Number of pixels to transform |

###### Returns

`void`

##### doTransformAdaptive()

> **doTransformAdaptive**(`transform`: `number`, `inputBuffer`: `Uint8Array`\<`ArrayBufferLike`\>, `outputBuffer`: `Uint8Array`\<`ArrayBufferLike`\>, `pixelCount`: `number`): \{ `blackCount`: `number`; `optimizationSkipped`: `boolean`; `transformedCount`: `number`; `whiteCount`: `number`; \}

Defined in: [index.js:317](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L317)

Adaptive transform with automatic boundary detection

Automatically detects if an image is a pure mask (100% boundary pixels)
by sampling the first 256 pixels. Only applies BPC clamping optimization
for images >= 2MP that are detected as pure masks.

This is the recommended API for general use - it automatically routes
images to the optimal transform path without caller needing to know
the image content.

Must call initBPCClamping() first to enable detection.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `transform` | `number` | Transform handle |
| `inputBuffer` | `Uint8Array`\<`ArrayBufferLike`\> | Input pixel data (Uint8 only) |
| `outputBuffer` | `Uint8Array`\<`ArrayBufferLike`\> | Output pixel data |
| `pixelCount` | `number` | Number of pixels |

###### Returns

\{ `blackCount`: `number`; `optimizationSkipped`: `boolean`; `transformedCount`: `number`; `whiteCount`: `number`; \}

Statistics

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `blackCount` | `number` | [index.js:315](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L315) |
| `optimizationSkipped` | `boolean` | [index.js:315](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L315) |
| `transformedCount` | `number` | [index.js:315](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L315) |
| `whiteCount` | `number` | [index.js:315](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L315) |

##### doTransformWithBPCClamp()

> **doTransformWithBPCClamp**(`transform`: `number`, `inputBuffer`: `Uint8Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `outputBuffer`: `Uint8Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `pixelCount`: `number`): \{ `blackCount`: `number`; `transformedCount`: `number`; `whiteCount`: `number`; \}

Defined in: [index.js:293](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L293)

Transform pixels with BPC boundary clamping optimization
Skips full transform for pure black and pure white pixels.
Must call initBPCClamping() first to enable optimization.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `transform` | `number` | Transform handle |
| `inputBuffer` | `Uint8Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | Input pixel data |
| `outputBuffer` | `Uint8Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | Output pixel data |
| `pixelCount` | `number` | Number of pixels |

###### Returns

\{ `blackCount`: `number`; `transformedCount`: `number`; `whiteCount`: `number`; \}

Statistics

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `blackCount` | `number` | [index.js:291](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L291) |
| `transformedCount` | `number` | [index.js:291](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L291) |
| `whiteCount` | `number` | [index.js:291](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L291) |

##### free()

> **free**(`ptr`: `number`): `void`

Defined in: [index.js:85](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L85)

Free memory in WASM heap

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `ptr` | `number` | Pointer to free |

###### Returns

`void`

##### getD50()

> **getD50**(): `number`

Defined in: [index.js:385](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L385)

Get D50 white point

###### Returns

`number`

Pointer to D50 XYZ values

##### getValue()

> **getValue**(`ptr`: `number`, `type`: `string`): `number`

Defined in: [index.js:424](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L424)

Get value from heap

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `ptr` | `number` | Pointer |
| `type` | `string` | Type (i8, i16, i32, float, double) |

###### Returns

`number`

##### init()

> **init**(): `Promise`\<`void`\>

Defined in: [index.js:55](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L55)

Initialize the WebAssembly module

###### Returns

`Promise`\<`void`\>

##### initBPCClamping()

> **initBPCClamping**(`transform`: `number`, `inputChannels`: `number`, `outputChannels`: `number`, `inputIsFloat`: `boolean`, `outputIsFloat`: `boolean`): \{ `black`: `Uint8Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>; `white`: `Uint8Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>; \}

Defined in: [index.js:268](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L268)

Initialize BPC clamping optimization for a transform
Call this once after creating the transform to enable boundary clamping.
When enabled, pure black and pure white pixels skip the full transform pipeline.

###### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `transform` | `number` | `undefined` | Transform handle |
| `inputChannels` | `number` | `undefined` | Number of input channels (3 for RGB, 1 for Gray) |
| `outputChannels` | `number` | `undefined` | Number of output channels (4 for CMYK) |
| `inputIsFloat` | `boolean` | `false` | Whether input is float format |
| `outputIsFloat` | `boolean` | `false` | Whether output is float format |

###### Returns

\{ `black`: `Uint8Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>; `white`: `Uint8Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>; \}

Pre-computed boundary values

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `black` | `Uint8Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | [index.js:266](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L266) |
| `white` | `Uint8Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | [index.js:266](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L266) |

##### malloc()

> **malloc**(`size`: `number`): `number`

Defined in: [index.js:76](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L76)

Allocate memory in WASM heap

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `size` | `number` | Number of bytes to allocate |

###### Returns

`number`

Pointer to allocated memory

##### openProfileFromMem()

> **openProfileFromMem**(`buffer`: `Uint8Array`\<`ArrayBufferLike`\>): `number`

Defined in: [index.js:96](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L96)

Open ICC profile from memory buffer

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `buffer` | `Uint8Array`\<`ArrayBufferLike`\> | ICC profile data |

###### Returns

`number`

Profile handle

###### Note

Using cwrap with 'array' type - handles memory marshaling correctly

##### readU8()

> **readU8**(`ptr`: `number`, `offset`: `number`): `number`

Defined in: [index.js:339](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L339)

Read byte from heap at pointer location

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `ptr` | `number` | Pointer location |
| `offset` | `number` | Offset from pointer |

###### Returns

`number`

Byte value

##### setValue()

> **setValue**(`ptr`: `number`, `value`: `number`, `type`: `string`): `void`

Defined in: [index.js:435](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L435)

Set value in heap

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `ptr` | `number` | Pointer |
| `value` | `number` | Value to set |
| `type` | `string` | Type (i8, i16, i32, float, double) |

###### Returns

`void`

##### transformArray()

> **transformArray**(`transform`: `number`, `inputArray`: `any`[] \| `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `outputArray`: `any`[] \| `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `pixelCount`: `number`): `void`

Defined in: [index.js:239](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L239)

Transform an array of pixels

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `transform` | `number` | Transform handle |
| `inputArray` | `any`[] \| `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | Input pixel data |
| `outputArray` | `any`[] \| `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | Output pixel data |
| `pixelCount` | `number` | Number of pixels to transform |

###### Returns

`void`

###### Note

The wrapped doTransform function handles memory allocation internally

##### transformRGBtoCMYK()

> **transformRGBtoCMYK**(`transform`: `number`, `rgbArray`: `any`[] \| `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `cmykArray`: `any`[] \| `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `pixelCount`: `number`): `void`

Defined in: [index.js:253](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L253)

Transform an array of RGB pixels to CMYK
Convenience method for common use case

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `transform` | `number` | Transform handle |
| `rgbArray` | `any`[] \| `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | Input RGB data (length = pixelCount * 3) |
| `cmykArray` | `any`[] \| `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> | Output CMYK data (length = pixelCount * 4) |
| `pixelCount` | `number` | Number of pixels |

###### Returns

`void`

##### writeU8()

> **writeU8**(`ptr`: `number`, `offset`: `number`, `value`: `number`): `void`

Defined in: [index.js:328](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L328)

Write bytes to heap at pointer location

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `ptr` | `number` | Pointer location |
| `offset` | `number` | Offset from pointer |
| `value` | `number` | Byte value to write |

###### Returns

`void`

## Type Aliases

### PointerType

> **PointerType**\<\> = `number`

Defined in: [index.js:27](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L27)

#### Type Parameters

| Type Parameter |
| ------ |

## Variables

### cmsFLAGS\_BLACKPOINTCOMPENSATION

> `const` **cmsFLAGS\_BLACKPOINTCOMPENSATION**: `8192` = `0x2000`

Defined in: [index.js:498](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L498)

***

### cmsFLAGS\_BPC\_CLAMP\_OPTIMIZE

> `const` **cmsFLAGS\_BPC\_CLAMP\_OPTIMIZE**: `2147483648` = `0x80000000`

Defined in: [index.js:500](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L500)

***

### cmsFLAGS\_DEBUG\_K\_ONLY\_GCR

> `const` **cmsFLAGS\_DEBUG\_K\_ONLY\_GCR**: `1073741824` = `0x40000000`

Defined in: [index.js:499](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L499)

***

### cmsFLAGS\_FORCE\_CLUT

> `const` **cmsFLAGS\_FORCE\_CLUT**: `2` = `0x0002`

Defined in: [index.js:495](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L495)

***

### cmsFLAGS\_NOCACHE

> `const` **cmsFLAGS\_NOCACHE**: `64` = `0x0040`

Defined in: [index.js:496](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L496)

***

### cmsFLAGS\_NOOPTIMIZE

> `const` **cmsFLAGS\_NOOPTIMIZE**: `256` = `0x0100`

Defined in: [index.js:497](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L497)

***

### default

> **default**: \{ `ColorEngine`: *typeof* [`ColorEngine`](#colorengine); `createEngine`: () => `Promise`\<[`ColorEngine`](#colorengine)\>; \}

Defined in: [index.js:512](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L512)

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="colorengine-1"></a> `ColorEngine` | *typeof* [`ColorEngine`](#colorengine) | [index.js:512](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L512) |
| <a id="createengine"></a> `createEngine()` | () => `Promise`\<[`ColorEngine`](#colorengine)\> | [index.js:512](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L512) |

***

### getEmscriptenModuleForColorEngineInstance()

> **getEmscriptenModuleForColorEngineInstance**: (`instance`: [`ColorEngine`](#colorengine)) => `EmscriptenModule`

Defined in: [index.js:30](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L30)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `instance` | [`ColorEngine`](#colorengine) |

#### Returns

`EmscriptenModule`

***

### INTENT\_ABSOLUTE\_COLORIMETRIC

> `const` **INTENT\_ABSOLUTE\_COLORIMETRIC**: `3` = `3`

Defined in: [index.js:461](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L461)

***

### INTENT\_PERCEPTUAL

> `const` **INTENT\_PERCEPTUAL**: `0` = `0`

Defined in: [index.js:458](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L458)

***

### INTENT\_PRESERVE\_K\_ONLY\_RELATIVE\_COLORIMETRIC\_GCR

> `const` **INTENT\_PRESERVE\_K\_ONLY\_RELATIVE\_COLORIMETRIC\_GCR**: `number` = `20`

Defined in: [index.js:492](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L492)

Custom intent: K-Only Black Point Compensation with Gray Component Replacement

**Purpose:** Guarantees neutral gray inputs convert to K-only CMYK output.

**Behavior:**
- Uses CMYK(0,0,0,100) as black reference instead of CMYK(100,100,100,100)
- Neutral gray inputs → CMYK with C=0, M=0, Y=0, K>0
- Black input → CMYK(0,0,0,255) (pure K)
- White input → CMYK(0,0,0,0) (no ink)
- Chromatic colors still produce CMY components as needed

**Requirements:**
- Output profile must be CMYK
- Works with both 2-profile and multiprofile transforms
- For multiprofile with non-RGB input, sRGB intermediate is automatically inserted

#### Constant

#### Example

```ts
// K-Only GCR with multiprofile transform
const transformHandle = engine.createMultiprofileTransform(
  [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
  TYPE_GRAY_8,
  TYPE_CMYK_8,
  INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
  cmsFLAGS_BLACKPOINTCOMPENSATION
);
```

***

### INTENT\_RELATIVE\_COLORIMETRIC

> `const` **INTENT\_RELATIVE\_COLORIMETRIC**: `1` = `1`

Defined in: [index.js:459](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L459)

***

### INTENT\_SATURATION

> `const` **INTENT\_SATURATION**: `2` = `2`

Defined in: [index.js:460](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L460)

***

### PT\_ANY

> `const` **PT\_ANY**: `0` = `0`

Defined in: [constants.js:23](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L23)

***

### PT\_CMY

> `const` **PT\_CMY**: `5` = `5`

Defined in: [constants.js:26](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L26)

***

### PT\_CMYK

> `const` **PT\_CMYK**: `6` = `6`

Defined in: [constants.js:27](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L27)

***

### PT\_GRAY

> `const` **PT\_GRAY**: `3` = `3`

Defined in: [constants.js:24](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L24)

***

### PT\_HLS

> `const` **PT\_HLS**: `13` = `13`

Defined in: [constants.js:34](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L34)

***

### PT\_HSV

> `const` **PT\_HSV**: `12` = `12`

Defined in: [constants.js:33](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L33)

***

### PT\_Lab

> `const` **PT\_Lab**: `10` = `10`

Defined in: [constants.js:31](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L31)

***

### PT\_LabV2

> `const` **PT\_LabV2**: `30` = `30`

Defined in: [constants.js:51](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L51)

***

### PT\_MCH1

> `const` **PT\_MCH1**: `15` = `15`

Defined in: [constants.js:36](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L36)

***

### PT\_MCH10

> `const` **PT\_MCH10**: `24` = `24`

Defined in: [constants.js:45](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L45)

***

### PT\_MCH11

> `const` **PT\_MCH11**: `25` = `25`

Defined in: [constants.js:46](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L46)

***

### PT\_MCH12

> `const` **PT\_MCH12**: `26` = `26`

Defined in: [constants.js:47](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L47)

***

### PT\_MCH13

> `const` **PT\_MCH13**: `27` = `27`

Defined in: [constants.js:48](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L48)

***

### PT\_MCH14

> `const` **PT\_MCH14**: `28` = `28`

Defined in: [constants.js:49](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L49)

***

### PT\_MCH15

> `const` **PT\_MCH15**: `29` = `29`

Defined in: [constants.js:50](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L50)

***

### PT\_MCH2

> `const` **PT\_MCH2**: `16` = `16`

Defined in: [constants.js:37](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L37)

***

### PT\_MCH3

> `const` **PT\_MCH3**: `17` = `17`

Defined in: [constants.js:38](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L38)

***

### PT\_MCH4

> `const` **PT\_MCH4**: `18` = `18`

Defined in: [constants.js:39](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L39)

***

### PT\_MCH5

> `const` **PT\_MCH5**: `19` = `19`

Defined in: [constants.js:40](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L40)

***

### PT\_MCH6

> `const` **PT\_MCH6**: `20` = `20`

Defined in: [constants.js:41](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L41)

***

### PT\_MCH7

> `const` **PT\_MCH7**: `21` = `21`

Defined in: [constants.js:42](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L42)

***

### PT\_MCH8

> `const` **PT\_MCH8**: `22` = `22`

Defined in: [constants.js:43](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L43)

***

### PT\_MCH9

> `const` **PT\_MCH9**: `23` = `23`

Defined in: [constants.js:44](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L44)

***

### PT\_RGB

> `const` **PT\_RGB**: `4` = `4`

Defined in: [constants.js:25](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L25)

***

### PT\_XYZ

> `const` **PT\_XYZ**: `9` = `9`

Defined in: [constants.js:30](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L30)

***

### PT\_YCbCr

> `const` **PT\_YCbCr**: `7` = `7`

Defined in: [constants.js:28](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L28)

***

### PT\_YUV

> `const` **PT\_YUV**: `8` = `8`

Defined in: [constants.js:29](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L29)

***

### PT\_YUVK

> `const` **PT\_YUVK**: `11` = `11`

Defined in: [constants.js:32](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L32)

***

### PT\_Yxy

> `const` **PT\_Yxy**: `14` = `14`

Defined in: [constants.js:35](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L35)

***

### TYPE\_ABGR\_16

> `const` **TYPE\_ABGR\_16**: `number`

Defined in: [constants.js:91](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L91)

***

### TYPE\_ABGR\_16\_PLANAR

> `const` **TYPE\_ABGR\_16\_PLANAR**: `number`

Defined in: [constants.js:93](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L93)

***

### TYPE\_ABGR\_16\_PREMUL

> `const` **TYPE\_ABGR\_16\_PREMUL**: `number`

Defined in: [constants.js:92](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L92)

***

### TYPE\_ABGR\_16\_SE

> `const` **TYPE\_ABGR\_16\_SE**: `number`

Defined in: [constants.js:94](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L94)

***

### TYPE\_ABGR\_8

> `const` **TYPE\_ABGR\_8**: `number`

Defined in: [constants.js:88](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L88)

***

### TYPE\_ABGR\_8\_PLANAR

> `const` **TYPE\_ABGR\_8\_PLANAR**: `number`

Defined in: [constants.js:90](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L90)

***

### TYPE\_ABGR\_8\_PREMUL

> `const` **TYPE\_ABGR\_8\_PREMUL**: `number`

Defined in: [constants.js:89](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L89)

***

### TYPE\_ABGR\_FLT

> `const` **TYPE\_ABGR\_FLT**: `number`

Defined in: [constants.js:214](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L214)

***

### TYPE\_ABGR\_FLT\_PREMUL

> `const` **TYPE\_ABGR\_FLT\_PREMUL**: `number`

Defined in: [constants.js:215](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L215)

***

### TYPE\_ABGR\_HALF\_FLT

> `const` **TYPE\_ABGR\_HALF\_FLT**: `number`

Defined in: [constants.js:231](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L231)

***

### TYPE\_ALab\_8

> `const` **TYPE\_ALab\_8**: `number`

Defined in: [constants.js:174](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L174)

***

### TYPE\_ALabV2\_8

> `const` **TYPE\_ALabV2\_8**: `number`

Defined in: [constants.js:175](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L175)

***

### TYPE\_ARGB\_16

> `const` **TYPE\_ARGB\_16**: `number`

Defined in: [constants.js:86](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L86)

***

### TYPE\_ARGB\_16\_PREMUL

> `const` **TYPE\_ARGB\_16\_PREMUL**: `number`

Defined in: [constants.js:87](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L87)

***

### TYPE\_ARGB\_8

> `const` **TYPE\_ARGB\_8**: `number`

Defined in: [constants.js:83](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L83)

***

### TYPE\_ARGB\_8\_PLANAR

> `const` **TYPE\_ARGB\_8\_PLANAR**: `number`

Defined in: [constants.js:85](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L85)

***

### TYPE\_ARGB\_8\_PREMUL

> `const` **TYPE\_ARGB\_8\_PREMUL**: `number`

Defined in: [constants.js:84](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L84)

***

### TYPE\_ARGB\_FLT

> `const` **TYPE\_ARGB\_FLT**: `number`

Defined in: [constants.js:209](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L209)

***

### TYPE\_ARGB\_FLT\_PREMUL

> `const` **TYPE\_ARGB\_FLT\_PREMUL**: `number`

Defined in: [constants.js:210](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L210)

***

### TYPE\_ARGB\_HALF\_FLT

> `const` **TYPE\_ARGB\_HALF\_FLT**: `number`

Defined in: [constants.js:228](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L228)

***

### TYPE\_BGR\_16

> `const` **TYPE\_BGR\_16**: `number`

Defined in: [constants.js:73](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L73)

***

### TYPE\_BGR\_16\_PLANAR

> `const` **TYPE\_BGR\_16\_PLANAR**: `number`

Defined in: [constants.js:74](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L74)

***

### TYPE\_BGR\_16\_SE

> `const` **TYPE\_BGR\_16\_SE**: `number`

Defined in: [constants.js:75](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L75)

***

### TYPE\_BGR\_8

> `const` **TYPE\_BGR\_8**: `number`

Defined in: [constants.js:68](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L68)

***

### TYPE\_BGR\_8\_PLANAR

> `const` **TYPE\_BGR\_8\_PLANAR**: `number`

Defined in: [constants.js:69](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L69)

***

### TYPE\_BGR\_DBL

> `const` **TYPE\_BGR\_DBL**: `number`

Defined in: [constants.js:221](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L221)

***

### TYPE\_BGR\_FLT

> `const` **TYPE\_BGR\_FLT**: `number`

Defined in: [constants.js:211](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L211)

***

### TYPE\_BGR\_HALF\_FLT

> `const` **TYPE\_BGR\_HALF\_FLT**: `number`

Defined in: [constants.js:229](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L229)

***

### TYPE\_BGRA\_16

> `const` **TYPE\_BGRA\_16**: `number`

Defined in: [constants.js:98](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L98)

***

### TYPE\_BGRA\_16\_PREMUL

> `const` **TYPE\_BGRA\_16\_PREMUL**: `number`

Defined in: [constants.js:99](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L99)

***

### TYPE\_BGRA\_16\_SE

> `const` **TYPE\_BGRA\_16\_SE**: `number`

Defined in: [constants.js:100](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L100)

***

### TYPE\_BGRA\_8

> `const` **TYPE\_BGRA\_8**: `number`

Defined in: [constants.js:95](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L95)

***

### TYPE\_BGRA\_8\_PLANAR

> `const` **TYPE\_BGRA\_8\_PLANAR**: `number`

Defined in: [constants.js:97](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L97)

***

### TYPE\_BGRA\_8\_PREMUL

> `const` **TYPE\_BGRA\_8\_PREMUL**: `number`

Defined in: [constants.js:96](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L96)

***

### TYPE\_BGRA\_FLT

> `const` **TYPE\_BGRA\_FLT**: `number`

Defined in: [constants.js:212](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L212)

***

### TYPE\_BGRA\_FLT\_PREMUL

> `const` **TYPE\_BGRA\_FLT\_PREMUL**: `number`

Defined in: [constants.js:213](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L213)

***

### TYPE\_BGRA\_HALF\_FLT

> `const` **TYPE\_BGRA\_HALF\_FLT**: `number`

Defined in: [constants.js:230](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L230)

***

### TYPE\_CMY\_16

> `const` **TYPE\_CMY\_16**: `number`

Defined in: [constants.js:103](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L103)

***

### TYPE\_CMY\_16\_PLANAR

> `const` **TYPE\_CMY\_16\_PLANAR**: `number`

Defined in: [constants.js:104](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L104)

***

### TYPE\_CMY\_16\_SE

> `const` **TYPE\_CMY\_16\_SE**: `number`

Defined in: [constants.js:105](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L105)

***

### TYPE\_CMY\_8

> `const` **TYPE\_CMY\_8**: `number`

Defined in: [constants.js:101](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L101)

***

### TYPE\_CMY\_8\_PLANAR

> `const` **TYPE\_CMY\_8\_PLANAR**: `number`

Defined in: [constants.js:102](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L102)

***

### TYPE\_CMYK\_16

> `const` **TYPE\_CMYK\_16**: `number`

Defined in: [constants.js:111](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L111)

***

### TYPE\_CMYK\_16\_PLANAR

> `const` **TYPE\_CMYK\_16\_PLANAR**: `number`

Defined in: [constants.js:114](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L114)

***

### TYPE\_CMYK\_16\_REV

> `const` **TYPE\_CMYK\_16\_REV**: `number`

Defined in: [constants.js:112](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L112)

***

### TYPE\_CMYK\_16\_SE

> `const` **TYPE\_CMYK\_16\_SE**: `number`

Defined in: [constants.js:115](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L115)

***

### TYPE\_CMYK\_8

> `const` **TYPE\_CMYK\_8**: `number`

Defined in: [constants.js:106](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L106)

***

### TYPE\_CMYK\_8\_PLANAR

> `const` **TYPE\_CMYK\_8\_PLANAR**: `number`

Defined in: [constants.js:110](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L110)

***

### TYPE\_CMYK\_8\_REV

> `const` **TYPE\_CMYK\_8\_REV**: `number`

Defined in: [constants.js:108](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L108)

***

### TYPE\_CMYK\_DBL

> `const` **TYPE\_CMYK\_DBL**: `number`

Defined in: [constants.js:222](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L222)

***

### TYPE\_CMYK\_FLT

> `const` **TYPE\_CMYK\_FLT**: `number`

Defined in: [constants.js:216](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L216)

***

### TYPE\_CMYK\_HALF\_FLT

> `const` **TYPE\_CMYK\_HALF\_FLT**: `number`

Defined in: [constants.js:226](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L226)

***

### TYPE\_CMYK10\_16

> `const` **TYPE\_CMYK10\_16**: `number`

Defined in: [constants.js:154](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L154)

***

### TYPE\_CMYK10\_16\_SE

> `const` **TYPE\_CMYK10\_16\_SE**: `number`

Defined in: [constants.js:155](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L155)

***

### TYPE\_CMYK10\_8

> `const` **TYPE\_CMYK10\_8**: `number`

Defined in: [constants.js:153](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L153)

***

### TYPE\_CMYK11\_16

> `const` **TYPE\_CMYK11\_16**: `number`

Defined in: [constants.js:160](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L160)

***

### TYPE\_CMYK11\_16\_SE

> `const` **TYPE\_CMYK11\_16\_SE**: `number`

Defined in: [constants.js:161](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L161)

***

### TYPE\_CMYK11\_8

> `const` **TYPE\_CMYK11\_8**: `number`

Defined in: [constants.js:159](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L159)

***

### TYPE\_CMYK12\_16

> `const` **TYPE\_CMYK12\_16**: `number`

Defined in: [constants.js:166](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L166)

***

### TYPE\_CMYK12\_16\_SE

> `const` **TYPE\_CMYK12\_16\_SE**: `number`

Defined in: [constants.js:167](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L167)

***

### TYPE\_CMYK12\_8

> `const` **TYPE\_CMYK12\_8**: `number`

Defined in: [constants.js:165](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L165)

***

### TYPE\_CMYK5\_16

> `const` **TYPE\_CMYK5\_16**: `number`

Defined in: [constants.js:125](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L125)

***

### TYPE\_CMYK5\_16\_SE

> `const` **TYPE\_CMYK5\_16\_SE**: `number`

Defined in: [constants.js:126](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L126)

***

### TYPE\_CMYK5\_8

> `const` **TYPE\_CMYK5\_8**: `number`

Defined in: [constants.js:124](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L124)

***

### TYPE\_CMYK6\_16

> `const` **TYPE\_CMYK6\_16**: `number`

Defined in: [constants.js:132](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L132)

***

### TYPE\_CMYK6\_16\_PLANAR

> `const` **TYPE\_CMYK6\_16\_PLANAR**: `number`

Defined in: [constants.js:133](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L133)

***

### TYPE\_CMYK6\_16\_SE

> `const` **TYPE\_CMYK6\_16\_SE**: `number`

Defined in: [constants.js:134](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L134)

***

### TYPE\_CMYK6\_8

> `const` **TYPE\_CMYK6\_8**: `number`

Defined in: [constants.js:130](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L130)

***

### TYPE\_CMYK6\_8\_PLANAR

> `const` **TYPE\_CMYK6\_8\_PLANAR**: `number`

Defined in: [constants.js:131](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L131)

***

### TYPE\_CMYK7\_16

> `const` **TYPE\_CMYK7\_16**: `number`

Defined in: [constants.js:136](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L136)

***

### TYPE\_CMYK7\_16\_SE

> `const` **TYPE\_CMYK7\_16\_SE**: `number`

Defined in: [constants.js:137](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L137)

***

### TYPE\_CMYK7\_8

> `const` **TYPE\_CMYK7\_8**: `number`

Defined in: [constants.js:135](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L135)

***

### TYPE\_CMYK8\_16

> `const` **TYPE\_CMYK8\_16**: `number`

Defined in: [constants.js:142](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L142)

***

### TYPE\_CMYK8\_16\_SE

> `const` **TYPE\_CMYK8\_16\_SE**: `number`

Defined in: [constants.js:143](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L143)

***

### TYPE\_CMYK8\_8

> `const` **TYPE\_CMYK8\_8**: `number`

Defined in: [constants.js:141](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L141)

***

### TYPE\_CMYK9\_16

> `const` **TYPE\_CMYK9\_16**: `number`

Defined in: [constants.js:148](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L148)

***

### TYPE\_CMYK9\_16\_SE

> `const` **TYPE\_CMYK9\_16\_SE**: `number`

Defined in: [constants.js:149](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L149)

***

### TYPE\_CMYK9\_8

> `const` **TYPE\_CMYK9\_8**: `number`

Defined in: [constants.js:147](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L147)

***

### TYPE\_CMYKA\_8

> `const` **TYPE\_CMYKA\_8**: `number`

Defined in: [constants.js:107](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L107)

***

### TYPE\_GRAY\_16

> `const` **TYPE\_GRAY\_16**: `number`

Defined in: [constants.js:56](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L56)

***

### TYPE\_GRAY\_16\_REV

> `const` **TYPE\_GRAY\_16\_REV**: `number`

Defined in: [constants.js:57](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L57)

***

### TYPE\_GRAY\_16\_SE

> `const` **TYPE\_GRAY\_16\_SE**: `number`

Defined in: [constants.js:58](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L58)

***

### TYPE\_GRAY\_8

> `const` **TYPE\_GRAY\_8**: `number`

Defined in: [constants.js:54](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L54)

***

### TYPE\_GRAY\_8\_REV

> `const` **TYPE\_GRAY\_8\_REV**: `number`

Defined in: [constants.js:55](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L55)

***

### TYPE\_GRAY\_DBL

> `const` **TYPE\_GRAY\_DBL**: `number`

Defined in: [constants.js:219](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L219)

***

### TYPE\_GRAY\_FLT

> `const` **TYPE\_GRAY\_FLT**: `number`

Defined in: [constants.js:203](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L203)

***

### TYPE\_GRAY\_HALF\_FLT

> `const` **TYPE\_GRAY\_HALF\_FLT**: `number`

Defined in: [constants.js:224](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L224)

***

### TYPE\_GRAYA\_16

> `const` **TYPE\_GRAYA\_16**: `number`

Defined in: [constants.js:61](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L61)

***

### TYPE\_GRAYA\_16\_PLANAR

> `const` **TYPE\_GRAYA\_16\_PLANAR**: `number`

Defined in: [constants.js:65](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L65)

***

### TYPE\_GRAYA\_16\_PREMUL

> `const` **TYPE\_GRAYA\_16\_PREMUL**: `number`

Defined in: [constants.js:62](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L62)

***

### TYPE\_GRAYA\_16\_SE

> `const` **TYPE\_GRAYA\_16\_SE**: `number`

Defined in: [constants.js:63](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L63)

***

### TYPE\_GRAYA\_8

> `const` **TYPE\_GRAYA\_8**: `number`

Defined in: [constants.js:59](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L59)

***

### TYPE\_GRAYA\_8\_PLANAR

> `const` **TYPE\_GRAYA\_8\_PLANAR**: `number`

Defined in: [constants.js:64](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L64)

***

### TYPE\_GRAYA\_8\_PREMUL

> `const` **TYPE\_GRAYA\_8\_PREMUL**: `number`

Defined in: [constants.js:60](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L60)

***

### TYPE\_GRAYA\_FLT

> `const` **TYPE\_GRAYA\_FLT**: `number`

Defined in: [constants.js:204](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L204)

***

### TYPE\_GRAYA\_FLT\_PREMUL

> `const` **TYPE\_GRAYA\_FLT\_PREMUL**: `number`

Defined in: [constants.js:205](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L205)

***

### TYPE\_HLS\_16

> `const` **TYPE\_HLS\_16**: `number`

Defined in: [constants.js:191](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L191)

***

### TYPE\_HLS\_16\_PLANAR

> `const` **TYPE\_HLS\_16\_PLANAR**: `number`

Defined in: [constants.js:192](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L192)

***

### TYPE\_HLS\_16\_SE

> `const` **TYPE\_HLS\_16\_SE**: `number`

Defined in: [constants.js:193](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L193)

***

### TYPE\_HLS\_8

> `const` **TYPE\_HLS\_8**: `number`

Defined in: [constants.js:189](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L189)

***

### TYPE\_HLS\_8\_PLANAR

> `const` **TYPE\_HLS\_8\_PLANAR**: `number`

Defined in: [constants.js:190](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L190)

***

### TYPE\_HSV\_16

> `const` **TYPE\_HSV\_16**: `number`

Defined in: [constants.js:196](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L196)

***

### TYPE\_HSV\_16\_PLANAR

> `const` **TYPE\_HSV\_16\_PLANAR**: `number`

Defined in: [constants.js:197](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L197)

***

### TYPE\_HSV\_16\_SE

> `const` **TYPE\_HSV\_16\_SE**: `number`

Defined in: [constants.js:198](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L198)

***

### TYPE\_HSV\_8

> `const` **TYPE\_HSV\_8**: `number`

Defined in: [constants.js:194](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L194)

***

### TYPE\_HSV\_8\_PLANAR

> `const` **TYPE\_HSV\_8\_PLANAR**: `number`

Defined in: [constants.js:195](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L195)

***

### TYPE\_KCMY\_16

> `const` **TYPE\_KCMY\_16**: `number`

Defined in: [constants.js:121](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L121)

***

### TYPE\_KCMY\_16\_REV

> `const` **TYPE\_KCMY\_16\_REV**: `number`

Defined in: [constants.js:122](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L122)

***

### TYPE\_KCMY\_16\_SE

> `const` **TYPE\_KCMY\_16\_SE**: `number`

Defined in: [constants.js:123](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L123)

***

### TYPE\_KCMY\_8

> `const` **TYPE\_KCMY\_8**: `number`

Defined in: [constants.js:119](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L119)

***

### TYPE\_KCMY\_8\_REV

> `const` **TYPE\_KCMY\_8\_REV**: `number`

Defined in: [constants.js:120](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L120)

***

### TYPE\_KYMC\_16

> `const` **TYPE\_KYMC\_16**: `number`

Defined in: [constants.js:117](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L117)

***

### TYPE\_KYMC\_16\_SE

> `const` **TYPE\_KYMC\_16\_SE**: `number`

Defined in: [constants.js:118](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L118)

***

### TYPE\_KYMC\_8

> `const` **TYPE\_KYMC\_8**: `number`

Defined in: [constants.js:116](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L116)

***

### TYPE\_KYMC10\_16

> `const` **TYPE\_KYMC10\_16**: `number`

Defined in: [constants.js:157](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L157)

***

### TYPE\_KYMC10\_16\_SE

> `const` **TYPE\_KYMC10\_16\_SE**: `number`

Defined in: [constants.js:158](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L158)

***

### TYPE\_KYMC10\_8

> `const` **TYPE\_KYMC10\_8**: `number`

Defined in: [constants.js:156](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L156)

***

### TYPE\_KYMC11\_16

> `const` **TYPE\_KYMC11\_16**: `number`

Defined in: [constants.js:163](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L163)

***

### TYPE\_KYMC11\_16\_SE

> `const` **TYPE\_KYMC11\_16\_SE**: `number`

Defined in: [constants.js:164](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L164)

***

### TYPE\_KYMC11\_8

> `const` **TYPE\_KYMC11\_8**: `number`

Defined in: [constants.js:162](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L162)

***

### TYPE\_KYMC12\_16

> `const` **TYPE\_KYMC12\_16**: `number`

Defined in: [constants.js:169](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L169)

***

### TYPE\_KYMC12\_16\_SE

> `const` **TYPE\_KYMC12\_16\_SE**: `number`

Defined in: [constants.js:170](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L170)

***

### TYPE\_KYMC12\_8

> `const` **TYPE\_KYMC12\_8**: `number`

Defined in: [constants.js:168](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L168)

***

### TYPE\_KYMC5\_16

> `const` **TYPE\_KYMC5\_16**: `number`

Defined in: [constants.js:128](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L128)

***

### TYPE\_KYMC5\_16\_SE

> `const` **TYPE\_KYMC5\_16\_SE**: `number`

Defined in: [constants.js:129](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L129)

***

### TYPE\_KYMC5\_8

> `const` **TYPE\_KYMC5\_8**: `number`

Defined in: [constants.js:127](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L127)

***

### TYPE\_KYMC7\_16

> `const` **TYPE\_KYMC7\_16**: `number`

Defined in: [constants.js:139](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L139)

***

### TYPE\_KYMC7\_16\_SE

> `const` **TYPE\_KYMC7\_16\_SE**: `number`

Defined in: [constants.js:140](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L140)

***

### TYPE\_KYMC7\_8

> `const` **TYPE\_KYMC7\_8**: `number`

Defined in: [constants.js:138](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L138)

***

### TYPE\_KYMC8\_16

> `const` **TYPE\_KYMC8\_16**: `number`

Defined in: [constants.js:145](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L145)

***

### TYPE\_KYMC8\_16\_SE

> `const` **TYPE\_KYMC8\_16\_SE**: `number`

Defined in: [constants.js:146](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L146)

***

### TYPE\_KYMC8\_8

> `const` **TYPE\_KYMC8\_8**: `number`

Defined in: [constants.js:144](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L144)

***

### TYPE\_KYMC9\_16

> `const` **TYPE\_KYMC9\_16**: `number`

Defined in: [constants.js:151](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L151)

***

### TYPE\_KYMC9\_16\_SE

> `const` **TYPE\_KYMC9\_16\_SE**: `number`

Defined in: [constants.js:152](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L152)

***

### TYPE\_KYMC9\_8

> `const` **TYPE\_KYMC9\_8**: `number`

Defined in: [constants.js:150](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L150)

***

### TYPE\_Lab\_16

> `const` **TYPE\_Lab\_16**: `number`

Defined in: [constants.js:176](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L176)

***

### TYPE\_Lab\_8

> `const` **TYPE\_Lab\_8**: `number`

Defined in: [constants.js:172](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L172)

***

### TYPE\_Lab\_DBL

> `const` **TYPE\_Lab\_DBL**: `number`

Defined in: [constants.js:218](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L218)

***

### TYPE\_Lab\_FLT

> `const` **TYPE\_Lab\_FLT**: `number`

Defined in: [constants.js:201](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L201)

***

### TYPE\_LabA\_FLT

> `const` **TYPE\_LabA\_FLT**: `number`

Defined in: [constants.js:202](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L202)

***

### TYPE\_LabV2\_16

> `const` **TYPE\_LabV2\_16**: `number`

Defined in: [constants.js:177](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L177)

***

### TYPE\_LabV2\_8

> `const` **TYPE\_LabV2\_8**: `number`

Defined in: [constants.js:173](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L173)

***

### TYPE\_NAMED\_COLOR\_INDEX

> `const` **TYPE\_NAMED\_COLOR\_INDEX**: `number`

Defined in: [constants.js:199](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L199)

***

### TYPE\_OKLAB\_DBL

> `const` **TYPE\_OKLAB\_DBL**: `number`

Defined in: [constants.js:223](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L223)

***

### TYPE\_RGB\_16

> `const` **TYPE\_RGB\_16**: `number`

Defined in: [constants.js:70](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L70)

***

### TYPE\_RGB\_16\_PLANAR

> `const` **TYPE\_RGB\_16\_PLANAR**: `number`

Defined in: [constants.js:71](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L71)

***

### TYPE\_RGB\_16\_SE

> `const` **TYPE\_RGB\_16\_SE**: `number`

Defined in: [constants.js:72](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L72)

***

### TYPE\_RGB\_8

> `const` **TYPE\_RGB\_8**: `number`

Defined in: [constants.js:66](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L66)

***

### TYPE\_RGB\_8\_PLANAR

> `const` **TYPE\_RGB\_8\_PLANAR**: `number`

Defined in: [constants.js:67](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L67)

***

### TYPE\_RGB\_DBL

> `const` **TYPE\_RGB\_DBL**: `number`

Defined in: [constants.js:220](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L220)

***

### TYPE\_RGB\_FLT

> `const` **TYPE\_RGB\_FLT**: `number`

Defined in: [constants.js:206](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L206)

***

### TYPE\_RGB\_HALF\_FLT

> `const` **TYPE\_RGB\_HALF\_FLT**: `number`

Defined in: [constants.js:225](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L225)

***

### TYPE\_RGBA\_16

> `const` **TYPE\_RGBA\_16**: `number`

Defined in: [constants.js:79](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L79)

***

### TYPE\_RGBA\_16\_PLANAR

> `const` **TYPE\_RGBA\_16\_PLANAR**: `number`

Defined in: [constants.js:81](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L81)

***

### TYPE\_RGBA\_16\_PREMUL

> `const` **TYPE\_RGBA\_16\_PREMUL**: `number`

Defined in: [constants.js:80](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L80)

***

### TYPE\_RGBA\_16\_SE

> `const` **TYPE\_RGBA\_16\_SE**: `number`

Defined in: [constants.js:82](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L82)

***

### TYPE\_RGBA\_8

> `const` **TYPE\_RGBA\_8**: `number`

Defined in: [constants.js:76](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L76)

***

### TYPE\_RGBA\_8\_PLANAR

> `const` **TYPE\_RGBA\_8\_PLANAR**: `number`

Defined in: [constants.js:78](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L78)

***

### TYPE\_RGBA\_8\_PREMUL

> `const` **TYPE\_RGBA\_8\_PREMUL**: `number`

Defined in: [constants.js:77](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L77)

***

### TYPE\_RGBA\_FLT

> `const` **TYPE\_RGBA\_FLT**: `number`

Defined in: [constants.js:207](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L207)

***

### TYPE\_RGBA\_FLT\_PREMUL

> `const` **TYPE\_RGBA\_FLT\_PREMUL**: `number`

Defined in: [constants.js:208](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L208)

***

### TYPE\_RGBA\_HALF\_FLT

> `const` **TYPE\_RGBA\_HALF\_FLT**: `number`

Defined in: [constants.js:227](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L227)

***

### TYPE\_XYZ\_16

> `const` **TYPE\_XYZ\_16**: `number`

Defined in: [constants.js:171](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L171)

***

### TYPE\_XYZ\_DBL

> `const` **TYPE\_XYZ\_DBL**: `number`

Defined in: [constants.js:217](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L217)

***

### TYPE\_XYZ\_FLT

> `const` **TYPE\_XYZ\_FLT**: `number`

Defined in: [constants.js:200](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L200)

***

### TYPE\_YCbCr\_16

> `const` **TYPE\_YCbCr\_16**: `number`

Defined in: [constants.js:181](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L181)

***

### TYPE\_YCbCr\_16\_PLANAR

> `const` **TYPE\_YCbCr\_16\_PLANAR**: `number`

Defined in: [constants.js:182](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L182)

***

### TYPE\_YCbCr\_16\_SE

> `const` **TYPE\_YCbCr\_16\_SE**: `number`

Defined in: [constants.js:183](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L183)

***

### TYPE\_YCbCr\_8

> `const` **TYPE\_YCbCr\_8**: `number`

Defined in: [constants.js:179](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L179)

***

### TYPE\_YCbCr\_8\_PLANAR

> `const` **TYPE\_YCbCr\_8\_PLANAR**: `number`

Defined in: [constants.js:180](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L180)

***

### TYPE\_YUV\_16

> `const` **TYPE\_YUV\_16**: `number`

Defined in: [constants.js:186](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L186)

***

### TYPE\_YUV\_16\_PLANAR

> `const` **TYPE\_YUV\_16\_PLANAR**: `number`

Defined in: [constants.js:187](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L187)

***

### TYPE\_YUV\_16\_SE

> `const` **TYPE\_YUV\_16\_SE**: `number`

Defined in: [constants.js:188](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L188)

***

### TYPE\_YUV\_8

> `const` **TYPE\_YUV\_8**: `number`

Defined in: [constants.js:184](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L184)

***

### TYPE\_YUV\_8\_PLANAR

> `const` **TYPE\_YUV\_8\_PLANAR**: `number`

Defined in: [constants.js:185](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L185)

***

### TYPE\_YUVK\_16

> `const` **TYPE\_YUVK\_16**: `number` = `TYPE_CMYK_16_REV`

Defined in: [constants.js:113](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L113)

***

### TYPE\_YUVK\_8

> `const` **TYPE\_YUVK\_8**: `number` = `TYPE_CMYK_8_REV`

Defined in: [constants.js:109](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L109)

***

### TYPE\_Yxy\_16

> `const` **TYPE\_Yxy\_16**: `number`

Defined in: [constants.js:178](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L178)

***

### TYPES

> `const` **TYPES**: \{ `CMYK_16`: `number`; `CMYK_8`: `number`; `CMYK_FLT`: `number`; `GRAY_16`: `number`; `GRAY_8`: `number`; `GRAY_FLT`: `number`; `Lab_16`: `number`; `Lab_8`: `number`; `Lab_FLT`: `number`; `RGB_16`: `number`; `RGB_8`: `number`; `RGB_FLT`: `number`; `RGBA_8`: `number`; \}

Defined in: [index.js:441](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L441)

#### Type Declaration

| Name | Type | Default value | Defined in |
| ------ | ------ | ------ | ------ |
| <a id="cmyk_16"></a> `CMYK_16` | `number` | `TYPE_CMYK_16` | [index.js:450](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L450) |
| <a id="cmyk_8"></a> `CMYK_8` | `number` | `TYPE_CMYK_8` | [index.js:449](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L449) |
| <a id="cmyk_flt"></a> `CMYK_FLT` | `number` | `TYPE_CMYK_FLT` | [index.js:451](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L451) |
| <a id="gray_16"></a> `GRAY_16` | `number` | `TYPE_GRAY_16` | [index.js:443](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L443) |
| <a id="gray_8"></a> `GRAY_8` | `number` | `TYPE_GRAY_8` | [index.js:442](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L442) |
| <a id="gray_flt"></a> `GRAY_FLT` | `number` | `TYPE_GRAY_FLT` | [index.js:444](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L444) |
| <a id="lab_16"></a> `Lab_16` | `number` | `TYPE_Lab_16` | [index.js:453](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L453) |
| <a id="lab_8"></a> `Lab_8` | `number` | `TYPE_Lab_8` | [index.js:452](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L452) |
| <a id="lab_flt"></a> `Lab_FLT` | `number` | `TYPE_Lab_FLT` | [index.js:454](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L454) |
| <a id="rgb_16"></a> `RGB_16` | `number` | `TYPE_RGB_16` | [index.js:446](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L446) |
| <a id="rgb_8"></a> `RGB_8` | `number` | `TYPE_RGB_8` | [index.js:445](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L445) |
| <a id="rgb_flt"></a> `RGB_FLT` | `number` | `TYPE_RGB_FLT` | [index.js:448](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L448) |
| <a id="rgba_8"></a> `RGBA_8` | `number` | `TYPE_RGBA_8` | [index.js:447](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L447) |

## Functions

### BYTES\_SH()

> **BYTES\_SH**(`b`: `any`): `any`

Defined in: [constants.js:20](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L20)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `b` | `any` |

#### Returns

`any`

***

### CHANNELS\_SH()

> **CHANNELS\_SH**(`c`: `any`): `number`

Defined in: [constants.js:19](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L19)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | `any` |

#### Returns

`number`

***

### COLORSPACE\_SH()

> **COLORSPACE\_SH**(`s`: `any`): `number`

Defined in: [constants.js:12](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L12)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `any` |

#### Returns

`number`

***

### createEngine()

> **createEngine**(): `Promise`\<[`ColorEngine`](#colorengine)\>

Defined in: [index.js:506](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/index.js#L506)

Create and initialize a ColorEngine instance

#### Returns

`Promise`\<[`ColorEngine`](#colorengine)\>

***

### DOSWAP\_SH()

> **DOSWAP\_SH**(`e`: `any`): `number`

Defined in: [constants.js:17](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L17)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `e` | `any` |

#### Returns

`number`

***

### ENDIAN16\_SH()

> **ENDIAN16\_SH**(`e`: `any`): `number`

Defined in: [constants.js:16](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L16)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `e` | `any` |

#### Returns

`number`

***

### EXTRA\_SH()

> **EXTRA\_SH**(`e`: `any`): `number`

Defined in: [constants.js:18](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L18)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `e` | `any` |

#### Returns

`number`

***

### FLAVOR\_SH()

> **FLAVOR\_SH**(`s`: `any`): `number`

Defined in: [constants.js:14](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L14)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `any` |

#### Returns

`number`

***

### FLOAT\_SH()

> **FLOAT\_SH**(`a`: `any`): `number`

Defined in: [constants.js:10](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L10)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `a` | `any` |

#### Returns

`number`

***

### OPTIMIZED\_SH()

> **OPTIMIZED\_SH**(`s`: `any`): `number`

Defined in: [constants.js:11](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L11)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `any` |

#### Returns

`number`

***

### PLANAR\_SH()

> **PLANAR\_SH**(`p`: `any`): `number`

Defined in: [constants.js:15](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L15)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `p` | `any` |

#### Returns

`number`

***

### PREMUL\_SH()

> **PREMUL\_SH**(`m`: `any`): `number`

Defined in: [constants.js:9](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L9)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `m` | `any` |

#### Returns

`number`

***

### SWAPFIRST\_SH()

> **SWAPFIRST\_SH**(`s`: `any`): `number`

Defined in: [constants.js:13](https://github.com/SMotaal/conres-color-management/blob/d5147f5ebcbb3680826860b010f24d5672280993/packages/color-engine/src/constants.js#L13)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `any` |

#### Returns

`number`
