[@conres.io/test-form-generator](README.md) / BufferRegistry

# BufferRegistry

Buffer Registry

Maps pdf-lib stream references to SharedArrayBuffer views for zero-copy
sharing between main thread and workers. Uses WeakMap for automatic
cleanup when pdf-lib objects are garbage collected.

## Classes

### BufferRegistry

Defined in: [classes/buffer-registry.js:118](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L118)

Manages SharedArrayBuffer views for pdf-lib stream objects.

Features:
- WeakMap-based storage allows automatic cleanup when streams are GC'd
- SharedArrayBuffer creation for zero-copy worker sharing (when supported)
- Fallback to regular Uint8Array when SharedArrayBuffer unavailable
- Bulk registration for batch PDF processing

#### Example

```javascript
const registry = new BufferRegistry();

// Get shared view for a PDF stream
const { view, isShared } = registry.getSharedView(pdfStream);

// Bulk register multiple streams
const views = registry.registerStreams([stream1, stream2, stream3]);

// When done
registry.dispose();
```

#### Constructors

##### Constructor

> **new BufferRegistry**(`options?`: \{ `diagnostics?`: [`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector); \}): [`BufferRegistry`](#bufferregistry)

Defined in: [classes/buffer-registry.js:214](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L214)

Creates a new BufferRegistry instance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | \{ `diagnostics?`: [`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector); \} | Configuration options |
| `options.diagnostics?` | [`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector) | Diagnostics collector |

###### Returns

[`BufferRegistry`](#bufferregistry)

###### Example

```javascript
const registry = new BufferRegistry();
// Or with diagnostics:
const registry = new BufferRegistry({ diagnostics: collector });
```

#### Accessors

##### diagnostics

###### Get Signature

> **get** **diagnostics**(): [`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector) \| [`NoOpDiagnostics`](DiagnosticsCollector.md#noopdiagnostics)

Defined in: [classes/buffer-registry.js:229](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L229)

Gets the diagnostics collector.

###### Returns

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector) \| [`NoOpDiagnostics`](DiagnosticsCollector.md#noopdiagnostics)

###### Set Signature

> **set** **diagnostics**(`value`: [`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector) \| [`NoOpDiagnostics`](DiagnosticsCollector.md#noopdiagnostics)): `void`

Defined in: [classes/buffer-registry.js:237](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L237)

Sets the diagnostics collector.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | [`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector) \| [`NoOpDiagnostics`](DiagnosticsCollector.md#noopdiagnostics) |  |

###### Returns

`void`

##### stats

###### Get Signature

> **get** **stats**(): \{ `colorCache`: \{ `configCount`: `number`; `conversions`: `number`; `hitRate`: `number`; `hits`: `number`; `misses`: `number`; `totalColors`: `number`; \}; `sharedBufferCount`: `number`; `supportsSharedBuffers`: `boolean`; `totalBytes`: `number`; \}

Defined in: [classes/buffer-registry.js:816](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L816)

Gets current registry statistics.

###### Example

```javascript
console.log(registry.stats);
// { sharedBufferCount: 12, totalBytes: 5234567, supportsSharedBuffers: true, colorCache: {...} }
```

###### Returns

\{ `colorCache`: \{ `configCount`: `number`; `conversions`: `number`; `hitRate`: `number`; `hits`: `number`; `misses`: `number`; `totalColors`: `number`; \}; `sharedBufferCount`: `number`; `supportsSharedBuffers`: `boolean`; `totalBytes`: `number`; \}

Registry statistics

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `colorCache` | \{ `configCount`: `number`; `conversions`: `number`; `hitRate`: `number`; `hits`: `number`; `misses`: `number`; `totalColors`: `number`; \} | [classes/buffer-registry.js:801](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L801) |
| `colorCache.configCount` | `number` | [classes/buffer-registry.js:802](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L802) |
| `colorCache.conversions` | `number` | [classes/buffer-registry.js:806](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L806) |
| `colorCache.hitRate` | `number` | [classes/buffer-registry.js:807](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L807) |
| `colorCache.hits` | `number` | [classes/buffer-registry.js:804](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L804) |
| `colorCache.misses` | `number` | [classes/buffer-registry.js:805](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L805) |
| `colorCache.totalColors` | `number` | [classes/buffer-registry.js:803](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L803) |
| `sharedBufferCount` | `number` | [classes/buffer-registry.js:798](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L798) |
| `supportsSharedBuffers` | `boolean` | [classes/buffer-registry.js:800](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L800) |
| `totalBytes` | `number` | [classes/buffer-registry.js:799](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L799) |

##### supportsSharedBuffers

###### Get Signature

> **get** `static` **supportsSharedBuffers**(): `boolean`

Defined in: [classes/buffer-registry.js:249](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L249)

Whether SharedArrayBuffer is available for zero-copy sharing.

###### Returns

`boolean`

#### Methods

##### applyToStream()

> **applyToStream**(`stream`: [`PDFStream`](#pdfstream), `convertedData`: `Uint8Array`\<`ArrayBufferLike`\>): `void`

Defined in: [classes/buffer-registry.js:413](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L413)

Applies converted data back to a stream.

Replaces the stream's contents with the converted data.
Note: This modifies the pdf-lib stream object directly.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `stream` | [`PDFStream`](#pdfstream) | pdf-lib stream object |
| `convertedData` | `Uint8Array`\<`ArrayBufferLike`\> | New stream contents |

###### Returns

`void`

##### clearColorCache()

> **clearColorCache**(): `void`

Defined in: [classes/buffer-registry.js:750](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L750)

Clears the color lookup cache.

###### Returns

`void`

##### convertPending()

> **convertPending**(`colorEngineService`: `ColorEngineService`, `config`: [`ColorConversionConfig`](#colorconversionconfig)): `Promise`\<`number`\>

Defined in: [classes/buffer-registry.js:571](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L571)

Converts all pending colors using batch WASM calls.

Groups colors by color space and converts each group with a single
WASM call for optimal performance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `colorEngineService` | `ColorEngineService` | Color engine service |
| `config` | [`ColorConversionConfig`](#colorconversionconfig) | Conversion configuration |

###### Returns

`Promise`\<`number`\>

Number of colors converted

##### createSharedBuffer()

> **createSharedBuffer**(`data`: `ArrayBuffer` \| `Uint8Array`\<`ArrayBufferLike`\>): [`SharedViewResult`](#sharedviewresult)

Defined in: [classes/buffer-registry.js:337](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L337)

Creates a shared buffer from raw data (not tied to a stream).

Useful for creating shared buffers from arbitrary data.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | `ArrayBuffer` \| `Uint8Array`\<`ArrayBufferLike`\> | Data to share |

###### Returns

[`SharedViewResult`](#sharedviewresult)

View and shared status

###### Example

```javascript
const { view, isShared } = registry.createSharedBuffer(rawPixelData);
```

##### dispose()

> **dispose**(): `void`

Defined in: [classes/buffer-registry.js:429](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L429)

Releases all tracked SharedArrayBuffers.

Note: WeakMap entries are automatically cleaned up when
stream objects are garbage collected.

###### Returns

`void`

##### getPendingCount()

> **getPendingCount**(`config`: [`ColorConversionConfig`](#colorconversionconfig)): `number`

Defined in: [classes/buffer-registry.js:742](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L742)

Gets the number of pending colors for a config.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `config` | [`ColorConversionConfig`](#colorconversionconfig) | Conversion configuration |

###### Returns

`number`

Number of pending colors

##### getSharedView()

> **getSharedView**(`stream`: [`PDFStream`](#pdfstream)): [`SharedViewResult`](#sharedviewresult)

Defined in: [classes/buffer-registry.js:277](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L277)

Gets or creates a SharedArrayBuffer view for a PDF stream.

If SharedArrayBuffer is available, creates a shared buffer copy
that can be efficiently shared with workers. Otherwise, returns
the original contents.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `stream` | [`PDFStream`](#pdfstream) | pdf-lib stream object with contents property |

###### Returns

[`SharedViewResult`](#sharedviewresult)

View and shared status

###### Example

```javascript
const imageStream = pdfDoc.context.lookup(imageRef);
const { view, isShared } = registry.getSharedView(imageStream);

if (isShared) {
    // Can pass view to worker without copying
    worker.postMessage({ data: view });
}
```

##### hasColor()

> **hasColor**(`config`: [`ColorConversionConfig`](#colorconversionconfig), `colorSpace`: `"RGB"` \| `"Gray"` \| `"Lab"`, `values`: `number`[]): `boolean`

Defined in: [classes/buffer-registry.js:494](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L494)

Checks if a color has already been converted for the given config.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `config` | [`ColorConversionConfig`](#colorconversionconfig) | Conversion configuration |
| `colorSpace` | `"RGB"` \| `"Gray"` \| `"Lab"` | Color space |
| `values` | `number`[] | Color values |

###### Returns

`boolean`

True if conversion result is cached

##### hasMapping()

> **hasMapping**(`stream`: [`PDFStream`](#pdfstream)): `boolean`

Defined in: [classes/buffer-registry.js:366](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L366)

Checks if a stream has an existing shared mapping.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `stream` | [`PDFStream`](#pdfstream) | pdf-lib stream object |

###### Returns

`boolean`

True if mapping exists

##### lookupColor()

> **lookupColor**(`config`: [`ColorConversionConfig`](#colorconversionconfig), `colorSpace`: `"RGB"` \| `"Gray"` \| `"Lab"`, `values`: `number`[]): `number`[]

Defined in: [classes/buffer-registry.js:509](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L509)

Looks up a previously converted color.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `config` | [`ColorConversionConfig`](#colorconversionconfig) | Conversion configuration |
| `colorSpace` | `"RGB"` \| `"Gray"` \| `"Lab"` | Color space |
| `values` | `number`[] | Color values |

###### Returns

`number`[]

Converted values or undefined if not cached

##### registerColor()

> **registerColor**(`config`: [`ColorConversionConfig`](#colorconversionconfig), `colorSpace`: `"RGB"` \| `"Gray"` \| `"Lab"`, `values`: `number`[]): `boolean`

Defined in: [classes/buffer-registry.js:534](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L534)

Registers a color for batch conversion.

Colors are queued until convertPending() is called.
If the color is already cached, it's not queued.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `config` | [`ColorConversionConfig`](#colorconversionconfig) | Conversion configuration |
| `colorSpace` | `"RGB"` \| `"Gray"` \| `"Lab"` | Color space |
| `values` | `number`[] | Color values |

###### Returns

`boolean`

True if color was queued (not already cached)

##### registerStreams()

> **registerStreams**(`streams`: [`PDFStream`](#pdfstream)[]): `Map`\<[`PDFStream`](#pdfstream), `Uint8Array`\<`ArrayBufferLike`\>\>

Defined in: [classes/buffer-registry.js:392](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L392)

Pre-registers multiple streams for batch conversion.

Creates SharedArrayBuffer views for all streams in a single pass.
Useful for preparing an entire PDF document for worker processing.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `streams` | [`PDFStream`](#pdfstream)[] | Array of pdf-lib stream objects |

###### Returns

`Map`\<[`PDFStream`](#pdfstream), `Uint8Array`\<`ArrayBufferLike`\>\>

Map of streams to their views

###### Example

```javascript
const imageStreams = collectImageXObjects(pdfDoc);
const views = registry.registerStreams(imageStreams);

for (const [stream, view] of views) {
    workerTasks.push({ streamRef, data: view });
}
```

##### storeColor()

> **storeColor**(`config`: [`ColorConversionConfig`](#colorconversionconfig), `colorSpace`: `"RGB"` \| `"Gray"` \| `"Lab"`, `values`: `number`[], `convertedValues`: `number`[]): `void`

Defined in: [classes/buffer-registry.js:686](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L686)

Stores a converted color directly in the cache.

Used when colors are converted through other means (e.g., buildLookupTable).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `config` | [`ColorConversionConfig`](#colorconversionconfig) | Conversion configuration |
| `colorSpace` | `"RGB"` \| `"Gray"` \| `"Lab"` | Color space |
| `values` | `number`[] | Original color values |
| `convertedValues` | `number`[] | Converted color values |

###### Returns

`void`

## Type Aliases

### ColorConversionConfig

> **ColorConversionConfig**\<\> = \{ `blackPointCompensation`: `boolean`; `destinationProfile`: `ArrayBuffer` \| `string`; `renderingIntent`: `string`; `sourceGrayProfile?`: `ArrayBuffer`; `sourceRGBProfile?`: `ArrayBuffer`; \}

Defined in: [classes/buffer-registry.js:79](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L79)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="blackpointcompensation"></a> `blackPointCompensation` | `boolean` | [classes/buffer-registry.js:76](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L76) |
| <a id="destinationprofile"></a> `destinationProfile` | `ArrayBuffer` \| `string` | [classes/buffer-registry.js:74](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L74) |
| <a id="renderingintent"></a> `renderingIntent` | `string` | [classes/buffer-registry.js:75](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L75) |
| <a id="sourcegrayprofile"></a> `sourceGrayProfile?` | `ArrayBuffer` | [classes/buffer-registry.js:78](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L78) |
| <a id="sourcergbprofile"></a> `sourceRGBProfile?` | `ArrayBuffer` | [classes/buffer-registry.js:77](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L77) |

***

### PDFStream

> **PDFStream**\<\> = \{ `contents`: `Uint8Array`; \}

Defined in: [classes/buffer-registry.js:67](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L67)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="contents"></a> `contents` | `Uint8Array` | [classes/buffer-registry.js:66](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L66) |

***

### PendingColorEntry

> **PendingColorEntry**\<\> = \{ `colorSpace`: `"RGB"` \| `"Gray"` \| `"Lab"`; `key`: `string`; `values`: `number`[]; \}

Defined in: [classes/buffer-registry.js:88](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L88)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="colorspace"></a> `colorSpace` | `"RGB"` \| `"Gray"` \| `"Lab"` | [classes/buffer-registry.js:85](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L85) |
| <a id="key"></a> `key` | `string` | [classes/buffer-registry.js:87](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L87) |
| <a id="values"></a> `values` | `number`[] | [classes/buffer-registry.js:86](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L86) |

***

### SharedBufferMapping

> **SharedBufferMapping**\<\> = \{ `byteLength`: `number`; `byteOffset`: `number`; `sharedBuffer`: `SharedArrayBuffer`; \}

Defined in: [classes/buffer-registry.js:52](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L52)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="bytelength"></a> `byteLength` | `number` | [classes/buffer-registry.js:51](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L51) |
| <a id="byteoffset"></a> `byteOffset` | `number` | [classes/buffer-registry.js:50](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L50) |
| <a id="sharedbuffer"></a> `sharedBuffer` | `SharedArrayBuffer` | [classes/buffer-registry.js:49](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L49) |

***

### SharedViewResult

> **SharedViewResult**\<\> = \{ `isShared`: `boolean`; `view`: `Uint8Array`; \}

Defined in: [classes/buffer-registry.js:60](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L60)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="isshared"></a> `isShared` | `boolean` | [classes/buffer-registry.js:59](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L59) |
| <a id="view"></a> `view` | `Uint8Array` | [classes/buffer-registry.js:58](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/buffer-registry.js#L58) |
