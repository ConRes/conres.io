[@conres.io/test-form-generator](README.md) / ColorConversionPolicy

# ColorConversionPolicy

Color Conversion Policy

Flat, rules-driven class for determining color conversion parameters.
Centralizes format decisions and engine-specific behavior rules.

## Classes

### ColorConversionPolicy

Defined in: [classes/color-conversion-policy.js:526](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L526)

Flat, rules-driven policy for determining color conversion parameters.

Centralizes format decisions and engine-specific behavior. Uses declarative
rules to handle engine version differences and domain-specific severity.

#### Example

```javascript
// Default engineVersion is derived from packages/color-engine (symlink)
const policy = new ColorConversionPolicy({
    domain: 'PDF',
});

// Get format for 16-bit big-endian RGB (PDF standard)
const inputFormat = policy.getInputFormat({
    colorSpace: 'RGB',
    bitsPerComponent: 16,
    endianness: 'big',
});

// Evaluate conversion rules
const result = policy.evaluateConversion({
    sourceColorSpace: 'Lab',
    destinationColorSpace: 'CMYK',
    renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
});

if (result.overrides.renderingIntent) {
    // Use overridden intent
}
```

#### Constructors

##### Constructor

> **new ColorConversionPolicy**(`configuration?`: [`PolicyConfiguration`](#policyconfiguration)): [`ColorConversionPolicy`](#colorconversionpolicy)

Defined in: [classes/color-conversion-policy.js:548](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L548)

Creates a new ColorConversionPolicy instance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `configuration?` | [`PolicyConfiguration`](#policyconfiguration) |  |

###### Returns

[`ColorConversionPolicy`](#colorconversionpolicy)

#### Accessors

##### domain

###### Get Signature

> **get** **domain**(): `string`

Defined in: [classes/color-conversion-policy.js:575](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L575)

Gets the domain.

###### Returns

`string`

##### engineVersion

###### Get Signature

> **get** **engineVersion**(): `string`

Defined in: [classes/color-conversion-policy.js:567](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L567)

Gets the engine version.

###### Returns

`string`

##### wasmEndianness

###### Get Signature

> **get** **wasmEndianness**(): `"little"` \| `"big"`

Defined in: [classes/color-conversion-policy.js:559](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L559)

Gets the WebAssembly memory endianness.

###### Returns

`"little"` \| `"big"`

#### Methods

##### createInputBuffer()

> **createInputBuffer**(`format`: `number`, `pixelCount`: `number`, `channelsOverride?`: `number`): `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>

Defined in: [classes/color-conversion-policy.js:1219](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1219)

Creates appropriate TypedArray for input based on format.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `format` | `number` | TYPE_* constant |
| `pixelCount` | `number` | Number of pixels |
| `channelsOverride?` | `number` | Override channel count (optional) |

###### Returns

`Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>

##### createOutputBuffer()

> **createOutputBuffer**(`format`: `number`, `pixelCount`: `number`, `channelsOverride?`: `number`): `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>

Defined in: [classes/color-conversion-policy.js:1197](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1197)

Creates appropriate TypedArray for output based on format.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `format` | `number` | TYPE_* constant |
| `pixelCount` | `number` | Number of pixels |
| `channelsOverride?` | `number` | Override channel count (optional) |

###### Returns

`Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>

###### Throws

If format is not recognized

##### evaluateConversion()

> **evaluateConversion**(`descriptor`: [`ConversionDescriptor`](#conversiondescriptor)): [`EvaluationResult`](#evaluationresult)

Defined in: [classes/color-conversion-policy.js:747](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L747)

Evaluates conversion rules and returns results with overrides.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `descriptor` | [`ConversionDescriptor`](#conversiondescriptor) |  |

###### Returns

[`EvaluationResult`](#evaluationresult)

##### getBitDepth()

> **getBitDepth**(`format`: `number`): [`BitDepth`](#bitdepth)

Defined in: [classes/color-conversion-policy.js:1274](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1274)

Gets the bit depth for a format.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `format` | `number` | TYPE_* constant |

###### Returns

[`BitDepth`](#bitdepth)

##### getBytesPerPixel()

> **getBytesPerPixel**(`format`: `number`): `number`

Defined in: [classes/color-conversion-policy.js:1254](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1254)

Gets bytes per pixel for a format.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `format` | `number` | TYPE_* constant |

###### Returns

`number`

##### getBytesPerSample()

> **getBytesPerSample**(`format`: `number`): `1` \| `2` \| `4`

Defined in: [classes/color-conversion-policy.js:1233](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1233)

Gets bytes per sample (component) for a given format.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `format` | `number` | TYPE_* constant |

###### Returns

`1` \| `2` \| `4`

##### getChannels()

> **getChannels**(`format`: `number`): `number`

Defined in: [classes/color-conversion-policy.js:1244](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1244)

Gets the number of channels for a format.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `format` | `number` | TYPE_* constant |

###### Returns

`number`

##### getColorSpace()

> **getColorSpace**(`format`: `number`): [`ColorSpace`](#colorspace)

Defined in: [classes/color-conversion-policy.js:1264](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1264)

Gets the color space for a format.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `format` | `number` | TYPE_* constant |

###### Returns

[`ColorSpace`](#colorspace)

##### getEffectiveRenderingIntent()

> **getEffectiveRenderingIntent**(`descriptor`: [`ConversionDescriptor`](#conversiondescriptor)): [`RenderingIntent`](#renderingintent-1)

Defined in: [classes/color-conversion-policy.js:885](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L885)

Gets the effective rendering intent after applying rule overrides.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `descriptor` | [`ConversionDescriptor`](#conversiondescriptor) |  |

###### Returns

[`RenderingIntent`](#renderingintent-1)

##### getFormatProperties()

> **getFormatProperties**(`format`: `number`): [`FormatProperties`](#formatproperties)

Defined in: [classes/color-conversion-policy.js:1295](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1295)

Gets complete properties for a format.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `format` | `number` | TYPE_* constant |

###### Returns

[`FormatProperties`](#formatproperties)

###### Throws

If format is not recognized

##### getInputFormat()

> **getInputFormat**(`descriptor`: [`PixelFormatDescriptor`](#pixelformatdescriptor)): `number`

Defined in: [classes/color-conversion-policy.js:938](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L938)

Determines the input pixel format constant for the color engine.

Resolves `inputBitsPerComponent ?? bitsPerComponent` and
`inputEndianness ?? endianness` before format lookup.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `descriptor` | [`PixelFormatDescriptor`](#pixelformatdescriptor) | Description of input data |

###### Returns

`number`

TYPE_* constant for input format

###### Throws

If no matching format is found or endianness not specified for 16-bit

##### getIntermediateProfiles()

> **getIntermediateProfiles**(`descriptor`: [`ConversionDescriptor`](#conversiondescriptor)): `string`[]

Defined in: [classes/color-conversion-policy.js:907](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L907)

Gets intermediate profiles if required.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `descriptor` | [`ConversionDescriptor`](#conversiondescriptor) |  |

###### Returns

`string`[]

##### getOutputFormat()

> **getOutputFormat**(`descriptor`: [`PixelFormatDescriptor`](#pixelformatdescriptor)): `number`

Defined in: [classes/color-conversion-policy.js:953](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L953)

Determines the output pixel format constant for the color engine.

Resolves `outputBitsPerComponent ?? bitsPerComponent` and
`outputEndianness ?? endianness` before format lookup.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `descriptor` | [`PixelFormatDescriptor`](#pixelformatdescriptor) | Description of desired output |

###### Returns

`number`

TYPE_* constant for output format

###### Throws

If no matching format is found or endianness not specified for 16-bit

##### getRenderingIntentConstant()

> **getRenderingIntentConstant**(`intent`: [`RenderingIntent`](#renderingintent-1)): `number`

Defined in: [classes/color-conversion-policy.js:1450](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1450)

Maps rendering intent string to LittleCMS constant.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `intent` | [`RenderingIntent`](#renderingintent-1) |  |

###### Returns

`number`

##### getStandardFormat()

> **getStandardFormat**(`colorSpace`: [`ColorSpace`](#colorspace), `bitsPerComponent`: [`BitDepth`](#bitdepth), `endianness?`: [`Endianness`](#endianness)): `number`

Defined in: [classes/color-conversion-policy.js:1372](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1372)

Gets the standard format for a color space and bit depth.

###### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `colorSpace` | [`ColorSpace`](#colorspace) | `undefined` |  |
| `bitsPerComponent` | [`BitDepth`](#bitdepth) | `undefined` |  |
| `endianness?` | [`Endianness`](#endianness) | `'big'` | Required for 16-bit, ignored for 8/32-bit |

###### Returns

`number`

TYPE_* constant

##### getTypedArrayConstructor()

> **getTypedArrayConstructor**(`format`: `number`): `Uint8ArrayConstructor` \| `Uint16ArrayConstructor` \| `Float32ArrayConstructor`

Defined in: [classes/color-conversion-policy.js:1387](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1387)

Gets appropriate TypedArray constructor for a format.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `format` | `number` | TYPE_* constant |

###### Returns

`Uint8ArrayConstructor` \| `Uint16ArrayConstructor` \| `Float32ArrayConstructor`

##### isFloatFormat()

> **isFloatFormat**(`format`: `number`): `boolean`

Defined in: [classes/color-conversion-policy.js:1284](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1284)

Checks if format uses floating point values.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `format` | `number` | TYPE_* constant |

###### Returns

`boolean`

##### isKOnlyGCR()

> **isKOnlyGCR**(`intent`: [`RenderingIntent`](#renderingintent-1)): `boolean`

Defined in: [classes/color-conversion-policy.js:1440](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1440)

Checks if intent is K-Only GCR.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `intent` | [`RenderingIntent`](#renderingintent-1) |  |

###### Returns

`boolean`

##### requiresMultiprofileBlackPointScaling()

> **requiresMultiprofileBlackPointScaling**(`descriptor`: [`ConversionDescriptor`](#conversiondescriptor)): `boolean`

Defined in: [classes/color-conversion-policy.js:919](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L919)

Checks if multiprofile black point scaling is required.
When true, cmsFLAGS_MULTIPROFILE_BPC_SCALING should be added to transform flags.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `descriptor` | [`ConversionDescriptor`](#conversiondescriptor) |  |

###### Returns

`boolean`

##### requiresMultiprofileTransform()

> **requiresMultiprofileTransform**(`descriptor`: [`ConversionDescriptor`](#conversiondescriptor)): `boolean`

Defined in: [classes/color-conversion-policy.js:896](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L896)

Checks if multiprofile transform is required.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `descriptor` | [`ConversionDescriptor`](#conversiondescriptor) |  |

###### Returns

`boolean`

##### validateBuffer()

> **validateBuffer**(`buffer`: `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\>, `format`: `number`, `pixelCount`: `number`): \{ `error?`: `string`; `valid`: `boolean`; \}

Defined in: [classes/color-conversion-policy.js:1406](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1406)

Validates that a buffer matches the expected format.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `buffer` | `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\> \| `Float32Array`\<`ArrayBufferLike`\> |  |
| `format` | `number` |  |
| `pixelCount` | `number` |  |

###### Returns

\{ `error?`: `string`; `valid`: `boolean`; \}

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `error?` | `string` | [classes/color-conversion-policy.js:1404](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1404) |
| `valid` | `boolean` | [classes/color-conversion-policy.js:1404](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L1404) |

## Type Aliases

### BitDepth

> **BitDepth**\<\> = `8` \| `16` \| `32`

Defined in: [classes/color-conversion-policy.js:116](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L116)

#### Type Parameters

| Type Parameter |
| ------ |

***

### CMYKChannelOrder

> **CMYKChannelOrder**\<\> = `"CMYK"` \| `"KYMC"` \| `"KCMY"`

Defined in: [classes/color-conversion-policy.js:136](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L136)

#### Type Parameters

| Type Parameter |
| ------ |

***

### ColorSpace

> **ColorSpace**\<\> = `"Gray"` \| `"RGB"` \| `"CMYK"` \| `"Lab"`

Defined in: [classes/color-conversion-policy.js:111](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L111)

#### Type Parameters

| Type Parameter |
| ------ |

***

### ConversionDescriptor

> **ConversionDescriptor**\<\> = \{ `blackPointCompensation?`: `boolean`; `destinationColorSpace`: [`ColorSpace`](#colorspace); `destinationProfile?`: `string` \| `ArrayBuffer`; `renderingIntent`: [`RenderingIntent`](#renderingintent-1); `sourceColorSpace`: [`ColorSpace`](#colorspace); `sourceProfile?`: `string` \| `ArrayBuffer`; \}

Defined in: [classes/color-conversion-policy.js:209](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L209)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="blackpointcompensation"></a> `blackPointCompensation?` | `boolean` | [classes/color-conversion-policy.js:206](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L206) |
| <a id="destinationcolorspace"></a> `destinationColorSpace` | [`ColorSpace`](#colorspace) | [classes/color-conversion-policy.js:204](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L204) |
| <a id="destinationprofile"></a> `destinationProfile?` | `string` \| `ArrayBuffer` | [classes/color-conversion-policy.js:208](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L208) |
| <a id="renderingintent"></a> `renderingIntent` | [`RenderingIntent`](#renderingintent-1) | [classes/color-conversion-policy.js:205](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L205) |
| <a id="sourcecolorspace"></a> `sourceColorSpace` | [`ColorSpace`](#colorspace) | [classes/color-conversion-policy.js:203](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L203) |
| <a id="sourceprofile"></a> `sourceProfile?` | `string` \| `ArrayBuffer` | [classes/color-conversion-policy.js:207](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L207) |

***

### Endianness

> **Endianness**\<\> = `"native"` \| `"big"` \| `"little"`

Defined in: [classes/color-conversion-policy.js:121](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L121)

#### Type Parameters

| Type Parameter |
| ------ |

***

### EnginePolicy

> **EnginePolicy**\<\> = \{ `engines?`: `string`[]; `policyId`: `string`; `rules`: [`PolicyRule`](#policyrule)[]; \}

Defined in: [classes/color-conversion-policy.js:260](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L260)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="engines"></a> `engines?` | `string`[] | [classes/color-conversion-policy.js:258](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L258) |
| <a id="policyid"></a> `policyId` | `string` | [classes/color-conversion-policy.js:257](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L257) |
| <a id="rules"></a> `rules` | [`PolicyRule`](#policyrule)[] | [classes/color-conversion-policy.js:259](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L259) |

***

### EvaluationResult

> **EvaluationResult**\<\> = \{ `errors`: `string`[]; `matchedRules`: [`PolicyRule`](#policyrule)[]; `overrides`: [`RuleOverrides`](#ruleoverrides); `trace`: [`RuleTraceEntry`](#ruletraceentry)[]; `valid`: `boolean`; `warnings`: `string`[]; \}

Defined in: [classes/color-conversion-policy.js:295](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L295)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="errors"></a> `errors` | `string`[] | [classes/color-conversion-policy.js:291](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L291) |
| <a id="matchedrules"></a> `matchedRules` | [`PolicyRule`](#policyrule)[] | [classes/color-conversion-policy.js:293](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L293) |
| <a id="overrides"></a> `overrides` | [`RuleOverrides`](#ruleoverrides) | [classes/color-conversion-policy.js:292](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L292) |
| <a id="trace"></a> `trace` | [`RuleTraceEntry`](#ruletraceentry)[] | [classes/color-conversion-policy.js:294](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L294) |
| <a id="valid"></a> `valid` | `boolean` | [classes/color-conversion-policy.js:289](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L289) |
| <a id="warnings"></a> `warnings` | `string`[] | [classes/color-conversion-policy.js:290](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L290) |

***

### FormatProperties

> **FormatProperties**\<\> = \{ `bitsPerComponent`: [`BitDepth`](#bitdepth); `bytesPerPixel`: `number`; `channels`: `number`; `colorSpace`: [`ColorSpace`](#colorspace); `endianness`: [`Endianness`](#endianness); `hasAlpha`: `boolean`; `isFloat`: `boolean`; `layout`: [`Layout`](#layout-1); \}

Defined in: [classes/color-conversion-policy.js:191](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L191)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="bitspercomponent"></a> `bitsPerComponent` | [`BitDepth`](#bitdepth) | [classes/color-conversion-policy.js:184](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L184) |
| <a id="bytesperpixel"></a> `bytesPerPixel` | `number` | [classes/color-conversion-policy.js:186](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L186) |
| <a id="channels"></a> `channels` | `number` | [classes/color-conversion-policy.js:185](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L185) |
| <a id="colorspace-1"></a> `colorSpace` | [`ColorSpace`](#colorspace) | [classes/color-conversion-policy.js:183](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L183) |
| <a id="endianness-1"></a> `endianness` | [`Endianness`](#endianness) | [classes/color-conversion-policy.js:187](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L187) |
| <a id="hasalpha"></a> `hasAlpha` | `boolean` | [classes/color-conversion-policy.js:190](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L190) |
| <a id="isfloat"></a> `isFloat` | `boolean` | [classes/color-conversion-policy.js:189](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L189) |
| <a id="layout"></a> `layout` | [`Layout`](#layout-1) | [classes/color-conversion-policy.js:188](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L188) |

***

### GrayChannelOrder

> **GrayChannelOrder**\<\> = `"Gray"` \| `"GrayA"` \| `"AGray"`

Defined in: [classes/color-conversion-policy.js:141](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L141)

#### Type Parameters

| Type Parameter |
| ------ |

***

### LabChannelOrder

> **LabChannelOrder**\<\> = `"Lab"`

Defined in: [classes/color-conversion-policy.js:146](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L146)

#### Type Parameters

| Type Parameter |
| ------ |

***

### Layout

> **Layout**\<\> = `"packed"` \| `"planar"`

Defined in: [classes/color-conversion-policy.js:126](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L126)

#### Type Parameters

| Type Parameter |
| ------ |

***

### LoadedPolicyRule

> **LoadedPolicyRule**\<\> = \{ `policyId`: `string`; `rule`: [`PolicyRule`](#policyrule); `ruleIndex`: `number`; \}

Defined in: [classes/color-conversion-policy.js:270](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L270)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="policyid-1"></a> `policyId` | `string` | [classes/color-conversion-policy.js:267](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L267) |
| <a id="rule"></a> `rule` | [`PolicyRule`](#policyrule) | [classes/color-conversion-policy.js:269](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L269) |
| <a id="ruleindex"></a> `ruleIndex` | `number` | [classes/color-conversion-policy.js:268](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L268) |

***

### PixelFormatDescriptor

> **PixelFormatDescriptor**\<\> = \{ `alphaFirst?`: `boolean`; `bitsPerComponent?`: [`BitDepth`](#bitdepth); `channelOrder?`: [`RGBChannelOrder`](#rgbchannelorder) \| [`CMYKChannelOrder`](#cmykchannelorder) \| [`GrayChannelOrder`](#graychannelorder) \| [`LabChannelOrder`](#labchannelorder); `colorSpace`: [`ColorSpace`](#colorspace); `endianness?`: [`Endianness`](#endianness); `hasAlpha?`: `boolean`; `inputBitsPerComponent?`: [`BitDepth`](#bitdepth); `inputEndianness?`: [`Endianness`](#endianness); `layout?`: [`Layout`](#layout-1); `outputBitsPerComponent?`: [`BitDepth`](#bitdepth); `outputEndianness?`: [`Endianness`](#endianness); \}

Defined in: [classes/color-conversion-policy.js:177](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L177)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="alphafirst"></a> `alphaFirst?` | `boolean` | [classes/color-conversion-policy.js:176](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L176) |
| <a id="bitspercomponent-1"></a> `bitsPerComponent?` | [`BitDepth`](#bitdepth) | [classes/color-conversion-policy.js:167](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L167) |
| <a id="channelorder"></a> `channelOrder?` | [`RGBChannelOrder`](#rgbchannelorder) \| [`CMYKChannelOrder`](#cmykchannelorder) \| [`GrayChannelOrder`](#graychannelorder) \| [`LabChannelOrder`](#labchannelorder) | [classes/color-conversion-policy.js:174](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L174) |
| <a id="colorspace-2"></a> `colorSpace` | [`ColorSpace`](#colorspace) | [classes/color-conversion-policy.js:166](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L166) |
| <a id="endianness-2"></a> `endianness?` | [`Endianness`](#endianness) | [classes/color-conversion-policy.js:170](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L170) |
| <a id="hasalpha-1"></a> `hasAlpha?` | `boolean` | [classes/color-conversion-policy.js:175](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L175) |
| <a id="inputbitspercomponent"></a> `inputBitsPerComponent?` | [`BitDepth`](#bitdepth) | [classes/color-conversion-policy.js:168](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L168) |
| <a id="inputendianness"></a> `inputEndianness?` | [`Endianness`](#endianness) | [classes/color-conversion-policy.js:171](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L171) |
| <a id="layout-2"></a> `layout?` | [`Layout`](#layout-1) | [classes/color-conversion-policy.js:173](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L173) |
| <a id="outputbitspercomponent"></a> `outputBitsPerComponent?` | [`BitDepth`](#bitdepth) | [classes/color-conversion-policy.js:169](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L169) |
| <a id="outputendianness"></a> `outputEndianness?` | [`Endianness`](#endianness) | [classes/color-conversion-policy.js:172](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L172) |

***

### PolicyConfiguration

> **PolicyConfiguration**\<\> = \{ `domain?`: `string`; `engineVersion?`: `string`; \}

Defined in: [classes/color-conversion-policy.js:304](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L304)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="domain-1"></a> `domain?` | `string` | [classes/color-conversion-policy.js:303](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L303) |
| <a id="engineversion-1"></a> `engineVersion?` | `string` | [classes/color-conversion-policy.js:302](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L302) |

***

### PolicyRule

> **PolicyRule**\<\> = \{ `constraints`: [`RuleConstraints`](#ruleconstraints); `description`: `string`; `overrides`: [`RuleOverrides`](#ruleoverrides); `severity`: [`RuleSeverity`](#ruleseverity); \}

Defined in: [classes/color-conversion-policy.js:250](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L250)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="constraints"></a> `constraints` | [`RuleConstraints`](#ruleconstraints) | [classes/color-conversion-policy.js:248](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L248) |
| <a id="description"></a> `description` | `string` | [classes/color-conversion-policy.js:246](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L246) |
| <a id="overrides-1"></a> `overrides` | [`RuleOverrides`](#ruleoverrides) | [classes/color-conversion-policy.js:249](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L249) |
| <a id="severity"></a> `severity` | [`RuleSeverity`](#ruleseverity) | [classes/color-conversion-policy.js:247](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L247) |

***

### RenderingIntent

> **RenderingIntent**\<\> = `"perceptual"` \| `"relative-colorimetric"` \| `"saturation"` \| `"absolute-colorimetric"` \| `"preserve-k-only-relative-colorimetric-gcr"`

Defined in: [classes/color-conversion-policy.js:196](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L196)

#### Type Parameters

| Type Parameter |
| ------ |

***

### RGBChannelOrder

> **RGBChannelOrder**\<\> = `"RGB"` \| `"BGR"` \| `"RGBA"` \| `"ARGB"` \| `"BGRA"` \| `"ABGR"`

Defined in: [classes/color-conversion-policy.js:131](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L131)

#### Type Parameters

| Type Parameter |
| ------ |

***

### RuleConstraints

> **RuleConstraints**\<\> = \{ `blackPointCompensation?`: `boolean`[]; `destinationColorSpaces?`: [`ColorSpace`](#colorspace)[]; `multiprofileBlackPointScaling?`: `boolean`[]; `renderingIntents?`: [`RenderingIntent`](#renderingintent-1)[]; `sourceColorSpaces?`: [`ColorSpace`](#colorspace)[]; \}

Defined in: [classes/color-conversion-policy.js:221](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L221)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="blackpointcompensation-1"></a> `blackPointCompensation?` | `boolean`[] | [classes/color-conversion-policy.js:219](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L219) |
| <a id="destinationcolorspaces"></a> `destinationColorSpaces?` | [`ColorSpace`](#colorspace)[] | [classes/color-conversion-policy.js:218](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L218) |
| <a id="multiprofileblackpointscaling"></a> `multiprofileBlackPointScaling?` | `boolean`[] | [classes/color-conversion-policy.js:220](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L220) |
| <a id="renderingintents"></a> `renderingIntents?` | [`RenderingIntent`](#renderingintent-1)[] | [classes/color-conversion-policy.js:216](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L216) |
| <a id="sourcecolorspaces"></a> `sourceColorSpaces?` | [`ColorSpace`](#colorspace)[] | [classes/color-conversion-policy.js:217](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L217) |

***

### RuleOverrides

> **RuleOverrides**\<\> = \{ `blackPointCompensation?`: `boolean`; `intermediateProfiles?`: `string`[]; `multiprofileBlackPointScaling?`: `boolean`; `renderingIntent?`: [`RenderingIntent`](#renderingintent-1); `requiresMultiprofileTransform?`: `boolean`; \}

Defined in: [classes/color-conversion-policy.js:233](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L233)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="blackpointcompensation-2"></a> `blackPointCompensation?` | `boolean` | [classes/color-conversion-policy.js:231](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L231) |
| <a id="intermediateprofiles"></a> `intermediateProfiles?` | `string`[] | [classes/color-conversion-policy.js:230](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L230) |
| <a id="multiprofileblackpointscaling-1"></a> `multiprofileBlackPointScaling?` | `boolean` | [classes/color-conversion-policy.js:232](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L232) |
| <a id="renderingintent-2"></a> `renderingIntent?` | [`RenderingIntent`](#renderingintent-1) | [classes/color-conversion-policy.js:228](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L228) |
| <a id="requiresmultiprofiletransform-2"></a> `requiresMultiprofileTransform?` | `boolean` | [classes/color-conversion-policy.js:229](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L229) |

***

### RuleSeverity

> **RuleSeverity**\<\> = `"error"` \| `"warning"` \| \{\[`domain`: `string`\]: `"error"` \| `"warning"`; `default`: `"error"` \| `"warning"`; \}

Defined in: [classes/color-conversion-policy.js:239](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L239)

#### Type Parameters

| Type Parameter |
| ------ |

***

### RuleTraceEntry

> **RuleTraceEntry**\<\> = \{ `appliedOverrides`: keyof [`RuleOverrides`](#ruleoverrides)[]; `description`: `string`; `policyId`: `string`; `ruleIndex`: `number`; `severity`: `"error"` \| `"warning"`; \}

Defined in: [classes/color-conversion-policy.js:282](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L282)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="appliedoverrides"></a> `appliedOverrides` | keyof [`RuleOverrides`](#ruleoverrides)[] | [classes/color-conversion-policy.js:281](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L281) |
| <a id="description-1"></a> `description` | `string` | [classes/color-conversion-policy.js:279](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L279) |
| <a id="policyid-2"></a> `policyId` | `string` | [classes/color-conversion-policy.js:277](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L277) |
| <a id="ruleindex-1"></a> `ruleIndex` | `number` | [classes/color-conversion-policy.js:278](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L278) |
| <a id="severity-1"></a> `severity` | `"error"` \| `"warning"` | [classes/color-conversion-policy.js:280](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L280) |

## Variables

### TYPE\_ARGB\_8

> `const` **TYPE\_ARGB\_8**: `number`

Defined in: packages/color-engine/src/constants.js:83

***

### TYPE\_BGR\_16

> `const` **TYPE\_BGR\_16**: `number`

Defined in: packages/color-engine/src/constants.js:73

***

### TYPE\_BGR\_16\_SE

> `const` **TYPE\_BGR\_16\_SE**: `number`

Defined in: [classes/color-conversion-policy.js:66](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L66)

***

### TYPE\_BGR\_8

> `const` **TYPE\_BGR\_8**: `number`

Defined in: packages/color-engine/src/constants.js:68

***

### TYPE\_BGRA\_8

> `const` **TYPE\_BGRA\_8**: `number`

Defined in: packages/color-engine/src/constants.js:95

***

### TYPE\_CMYK\_16

> `const` **TYPE\_CMYK\_16**: `number`

Defined in: packages/color-engine/src/constants.js:111

***

### TYPE\_CMYK\_16\_SE

> `const` **TYPE\_CMYK\_16\_SE**: `number`

Defined in: packages/color-engine/src/constants.js:115

***

### TYPE\_CMYK\_8

> `const` **TYPE\_CMYK\_8**: `number`

Defined in: packages/color-engine/src/constants.js:106

***

### TYPE\_CMYK\_FLT

> `const` **TYPE\_CMYK\_FLT**: `number`

Defined in: packages/color-engine/src/constants.js:216

***

### TYPE\_GRAY\_16

> `const` **TYPE\_GRAY\_16**: `number`

Defined in: packages/color-engine/src/constants.js:56

***

### TYPE\_GRAY\_16\_SE

> `const` **TYPE\_GRAY\_16\_SE**: `number`

Defined in: packages/color-engine/src/constants.js:58

***

### TYPE\_GRAY\_8

> `const` **TYPE\_GRAY\_8**: `number`

Defined in: packages/color-engine/src/constants.js:54

***

### TYPE\_GRAY\_FLT

> `const` **TYPE\_GRAY\_FLT**: `number`

Defined in: packages/color-engine/src/constants.js:203

***

### TYPE\_GRAYA\_16

> `const` **TYPE\_GRAYA\_16**: `number`

Defined in: packages/color-engine/src/constants.js:61

***

### TYPE\_GRAYA\_16\_SE

> `const` **TYPE\_GRAYA\_16\_SE**: `number`

Defined in: [classes/color-conversion-policy.js:65](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L65)

***

### TYPE\_GRAYA\_8

> `const` **TYPE\_GRAYA\_8**: `number`

Defined in: packages/color-engine/src/constants.js:59

***

### TYPE\_KYMC\_16

> `const` **TYPE\_KYMC\_16**: `number`

Defined in: packages/color-engine/src/constants.js:117

***

### TYPE\_KYMC\_16\_SE

> `const` **TYPE\_KYMC\_16\_SE**: `number`

Defined in: [classes/color-conversion-policy.js:68](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L68)

***

### TYPE\_KYMC\_8

> `const` **TYPE\_KYMC\_8**: `number`

Defined in: packages/color-engine/src/constants.js:116

***

### TYPE\_Lab\_16

> `const` **TYPE\_Lab\_16**: `number`

Defined in: packages/color-engine/src/constants.js:176

***

### TYPE\_Lab\_16\_SE

> `const` **TYPE\_Lab\_16\_SE**: `number`

Defined in: [classes/color-conversion-policy.js:64](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L64)

***

### TYPE\_Lab\_8

> `const` **TYPE\_Lab\_8**: `number`

Defined in: packages/color-engine/src/constants.js:172

***

### TYPE\_Lab\_FLT

> `const` **TYPE\_Lab\_FLT**: `number`

Defined in: packages/color-engine/src/constants.js:201

***

### TYPE\_RGB\_16

> `const` **TYPE\_RGB\_16**: `number`

Defined in: packages/color-engine/src/constants.js:70

***

### TYPE\_RGB\_16\_SE

> `const` **TYPE\_RGB\_16\_SE**: `number`

Defined in: packages/color-engine/src/constants.js:72

***

### TYPE\_RGB\_8

> `const` **TYPE\_RGB\_8**: `number`

Defined in: packages/color-engine/src/constants.js:66

***

### TYPE\_RGB\_FLT

> `const` **TYPE\_RGB\_FLT**: `number`

Defined in: packages/color-engine/src/constants.js:206

***

### TYPE\_RGBA\_16

> `const` **TYPE\_RGBA\_16**: `number`

Defined in: packages/color-engine/src/constants.js:79

***

### TYPE\_RGBA\_16\_SE

> `const` **TYPE\_RGBA\_16\_SE**: `number`

Defined in: [classes/color-conversion-policy.js:67](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/color-conversion-policy.js#L67)

***

### TYPE\_RGBA\_8

> `const` **TYPE\_RGBA\_8**: `number`

Defined in: packages/color-engine/src/constants.js:76
