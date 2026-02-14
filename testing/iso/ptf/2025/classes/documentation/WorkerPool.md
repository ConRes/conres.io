[@conres.io/test-form-generator](README.md) / WorkerPool

# WorkerPool

Isomorphic Worker Pool for parallel color transformations

Works in both Node.js (worker_threads) and browser (Web Workers).
Self-contained in classes/ - no dependencies on services/.

## Classes

### WorkerPool

Defined in: [classes/worker-pool.js:232](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L232)

Isomorphic worker pool for parallel color transformations.

Manages a pool of workers for parallel processing of color
transformation tasks. Works in both Node.js (worker_threads)
and browser (Web Workers) environments.

#### Example

```javascript
const pool = new WorkerPool({ workerCount: 4 });
await pool.initialize();

const result = await pool.submitTransform({
    type: 'transform',
    inputArray: pixels,
    inputFormat: TYPE_RGB_8,
    outputFormat: TYPE_CMYK_8,
    // ... other options
});

await pool.terminate();
```

#### Constructors

##### Constructor

> **new WorkerPool**(`options?`: [`WorkerPoolOptions`](#workerpooloptions)): [`WorkerPool`](#workerpool)

Defined in: [classes/worker-pool.js:272](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L272)

Creates a new WorkerPool.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | [`WorkerPoolOptions`](#workerpooloptions) | Pool configuration |

###### Returns

[`WorkerPool`](#workerpool)

#### Accessors

##### diagnosticsEnabled

###### Get Signature

> **get** **diagnosticsEnabled**(): `boolean`

Defined in: [classes/worker-pool.js:607](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L607)

Whether diagnostics collection is enabled.

###### Returns

`boolean`

##### isInitialized

###### Get Signature

> **get** **isInitialized**(): `boolean`

Defined in: [classes/worker-pool.js:599](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L599)

Whether the pool has been initialized.

###### Returns

`boolean`

#### Methods

##### getDiagnosticsPorts()

> **getDiagnosticsPorts**(): \{ `port`: `MessagePort`; `workerId`: `string`; \}[]

Defined in: [classes/worker-pool.js:627](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L627)

Get diagnostics ports for all workers.
Use these ports to register with MainDiagnosticsCollector.

###### Returns

\{ `port`: `MessagePort`; `workerId`: `string`; \}[]

###### Example

```javascript
const pool = new WorkerPool({ diagnosticsEnabled: true });
await pool.initialize();

for (const { workerId, port } of pool.getDiagnosticsPorts()) {
    mainDiagnostics.registerAuxiliary(workerId, port);
}
```

##### getStats()

> **getStats**(): [`WorkerPoolStats`](#workerpoolstats)

Defined in: [classes/worker-pool.js:586](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L586)

Get worker pool statistics.

###### Returns

[`WorkerPoolStats`](#workerpoolstats)

##### initialize()

> **initialize**(): `Promise`\<`void`\>

Defined in: [classes/worker-pool.js:301](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L301)

Initialize the worker pool.
Creates and initializes all workers.

###### Returns

`Promise`\<`void`\>

##### submitAll()

> **submitAll**(`tasks`: [`WorkerTask`](#workertask)[]): `Promise`\<[`TaskResult`](#taskresult)[]\>

Defined in: [classes/worker-pool.js:578](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L578)

Submit multiple tasks and wait for all to complete.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `tasks` | [`WorkerTask`](#workertask)[] | Tasks to execute |

###### Returns

`Promise`\<[`TaskResult`](#taskresult)[]\>

##### submitContentStream()

> **submitContentStream**(`task`: [`ContentStreamTask`](#contentstreamtask)): `Promise`\<[`TaskResult`](#taskresult)\>

Defined in: [classes/worker-pool.js:568](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L568)

Submit a content-stream task.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `task` | [`ContentStreamTask`](#contentstreamtask) | Content-stream task |

###### Returns

`Promise`\<[`TaskResult`](#taskresult)\>

##### submitImage()

> **submitImage**(`task`: [`ImageTask`](#imagetask)): `Promise`\<[`TaskResult`](#taskresult)\>

Defined in: [classes/worker-pool.js:558](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L558)

Submit an image task.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `task` | [`ImageTask`](#imagetask) | Image task |

###### Returns

`Promise`\<[`TaskResult`](#taskresult)\>

##### submitTask()

> **submitTask**(`task`: [`WorkerTask`](#workertask)): `Promise`\<[`TaskResult`](#taskresult)\>

Defined in: [classes/worker-pool.js:526](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L526)

Submit a task to the worker pool.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `task` | [`WorkerTask`](#workertask) | Task to execute |

###### Returns

`Promise`\<[`TaskResult`](#taskresult)\>

Task result

##### submitTransform()

> **submitTransform**(`task`: [`TransformTask`](#transformtask)): `Promise`\<[`TaskResult`](#taskresult)\>

Defined in: [classes/worker-pool.js:548](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L548)

Submit a transform task (alias for submitTask with type checking).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `task` | [`TransformTask`](#transformtask) | Transform task |

###### Returns

`Promise`\<[`TaskResult`](#taskresult)\>

##### terminate()

> **terminate**(): `Promise`\<`void`\>

Defined in: [classes/worker-pool.js:647](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L647)

Terminate all workers and clean up resources.

###### Returns

`Promise`\<`void`\>

## Type Aliases

### BenchmarkTask

> **BenchmarkTask**\<\> = \{ `arraySize`: `number`; `iterations`: `number`; `type`: `"benchmark"`; \}

Defined in: [classes/worker-pool.js:113](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L113)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="arraysize"></a> `arraySize` | `number` | [classes/worker-pool.js:112](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L112) |
| <a id="iterations"></a> `iterations` | `number` | [classes/worker-pool.js:111](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L111) |
| <a id="type"></a> `type` | `"benchmark"` | [classes/worker-pool.js:110](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L110) |

***

### ContentStreamTask

> **ContentStreamTask**\<\> = \{ `blackPointCompensation`: `boolean`; `colorSpaceDefinitions?`: `Record`\<`string`, [`ColorSpaceDefinition`](PDFContentStreamColorConverter.md#colorspacedefinition)\>; `destinationColorSpace`: `"CMYK"` \| `"RGB"`; `destinationProfile`: `ArrayBuffer`; `initialColorSpaceState?`: [`ColorSpaceState`](PDFContentStreamColorConverter.md#colorspacestate); `renderingIntent`: [`RenderingIntent`](ColorConverter.md#renderingintent-1); `sourceGrayProfile?`: `ArrayBuffer`; `sourceRGBProfile?`: `ArrayBuffer`; `streamText`: `string`; `type`: `"content-stream"`; \}

Defined in: [classes/worker-pool.js:104](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L104)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="blackpointcompensation"></a> `blackPointCompensation` | `boolean` | [classes/worker-pool.js:102](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L102) |
| <a id="colorspacedefinitions"></a> `colorSpaceDefinitions?` | `Record`\<`string`, [`ColorSpaceDefinition`](PDFContentStreamColorConverter.md#colorspacedefinition)\> | [classes/worker-pool.js:96](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L96) |
| <a id="destinationcolorspace"></a> `destinationColorSpace` | `"CMYK"` \| `"RGB"` | [classes/worker-pool.js:103](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L103) |
| <a id="destinationprofile"></a> `destinationProfile` | `ArrayBuffer` | [classes/worker-pool.js:100](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L100) |
| <a id="initialcolorspacestate"></a> `initialColorSpaceState?` | [`ColorSpaceState`](PDFContentStreamColorConverter.md#colorspacestate) | [classes/worker-pool.js:97](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L97) |
| <a id="renderingintent"></a> `renderingIntent` | [`RenderingIntent`](ColorConverter.md#renderingintent-1) | [classes/worker-pool.js:101](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L101) |
| <a id="sourcegrayprofile"></a> `sourceGrayProfile?` | `ArrayBuffer` | [classes/worker-pool.js:99](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L99) |
| <a id="sourcergbprofile"></a> `sourceRGBProfile?` | `ArrayBuffer` | [classes/worker-pool.js:98](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L98) |
| <a id="streamtext"></a> `streamText` | `string` | [classes/worker-pool.js:95](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L95) |
| <a id="type-1"></a> `type` | `"content-stream"` | [classes/worker-pool.js:94](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L94) |

***

### ImageTask

> **ImageTask**\<\> = \{ `bitsPerComponent`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `blackPointCompensation`: `boolean`; `colorSpace`: [`ColorType`](ImageColorConverter.md#colortype); `compressedData?`: `ArrayBuffer`; `compressOutput?`: `boolean`; `destinationColorSpace`: `"CMYK"` \| `"RGB"`; `destinationProfile`: `ArrayBuffer`; `endianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `height`: `number`; `inputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `inputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `isCompressed?`: `boolean`; `outputBitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `outputEndianness?`: [`Endianness`](ColorConversionPolicy.md#endianness); `pixelBuffer?`: `ArrayBuffer`; `renderingIntent`: [`RenderingIntent`](ColorConverter.md#renderingintent-1); `sourceProfile`: `ArrayBuffer` \| `"Lab"`; `streamRef?`: `string`; `type`: `"image"`; `useAdaptiveBPCClamping`: `boolean`; `width`: `number`; \}

Defined in: [classes/worker-pool.js:88](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L88)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="bitspercomponent"></a> `bitsPerComponent` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | [classes/worker-pool.js:75](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L75) |
| <a id="blackpointcompensation-1"></a> `blackPointCompensation` | `boolean` | [classes/worker-pool.js:84](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L84) |
| <a id="colorspace"></a> `colorSpace` | [`ColorType`](ImageColorConverter.md#colortype) | [classes/worker-pool.js:74](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L74) |
| <a id="compresseddata"></a> `compressedData?` | `ArrayBuffer` | [classes/worker-pool.js:69](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L69) |
| <a id="compressoutput"></a> `compressOutput?` | `boolean` | [classes/worker-pool.js:87](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L87) |
| <a id="destinationcolorspace-1"></a> `destinationColorSpace` | `"CMYK"` \| `"RGB"` | [classes/worker-pool.js:86](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L86) |
| <a id="destinationprofile-1"></a> `destinationProfile` | `ArrayBuffer` | [classes/worker-pool.js:82](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L82) |
| <a id="endianness"></a> `endianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | [classes/worker-pool.js:78](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L78) |
| <a id="height"></a> `height` | `number` | [classes/worker-pool.js:73](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L73) |
| <a id="inputbitspercomponent"></a> `inputBitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | [classes/worker-pool.js:76](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L76) |
| <a id="inputendianness"></a> `inputEndianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | [classes/worker-pool.js:79](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L79) |
| <a id="iscompressed"></a> `isCompressed?` | `boolean` | [classes/worker-pool.js:70](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L70) |
| <a id="outputbitspercomponent"></a> `outputBitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | [classes/worker-pool.js:77](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L77) |
| <a id="outputendianness"></a> `outputEndianness?` | [`Endianness`](ColorConversionPolicy.md#endianness) | [classes/worker-pool.js:80](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L80) |
| <a id="pixelbuffer"></a> `pixelBuffer?` | `ArrayBuffer` | [classes/worker-pool.js:68](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L68) |
| <a id="renderingintent-1"></a> `renderingIntent` | [`RenderingIntent`](ColorConverter.md#renderingintent-1) | [classes/worker-pool.js:83](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L83) |
| <a id="sourceprofile"></a> `sourceProfile` | `ArrayBuffer` \| `"Lab"` | [classes/worker-pool.js:81](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L81) |
| <a id="streamref"></a> `streamRef?` | `string` | [classes/worker-pool.js:71](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L71) |
| <a id="type-2"></a> `type` | `"image"` | [classes/worker-pool.js:67](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L67) |
| <a id="useadaptivebpcclamping"></a> `useAdaptiveBPCClamping` | `boolean` | [classes/worker-pool.js:85](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L85) |
| <a id="width"></a> `width` | `number` | [classes/worker-pool.js:72](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L72) |

***

### RuntimeEnvironment

> **RuntimeEnvironment**\<\> = `"node"` \| `"browser"`

Defined in: [classes/worker-pool.js:17](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L17)

#### Type Parameters

| Type Parameter |
| ------ |

***

### TaskResult

> **TaskResult**\<\> = \{ `bitsPerComponent?`: [`BitDepth`](ColorConversionPolicy.md#bitdepth); `duration?`: `number`; `error?`: `string`; `finalColorSpaceState?`: [`ColorSpaceState`](PDFContentStreamColorConverter.md#colorspacestate); `isCompressed?`: `boolean`; `newText?`: `string`; `outputArray?`: `Uint8Array` \| `Uint16Array` \| `Float32Array`; `pixelBuffer?`: `Uint8Array` \| `Uint16Array` \| `Float32Array`; `pixelCount?`: `number`; `replacementCount?`: `number`; `success`: `boolean`; `taskId?`: `number`; \}

Defined in: [classes/worker-pool.js:136](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L136)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="bitspercomponent-1"></a> `bitsPerComponent?` | [`BitDepth`](ColorConversionPolicy.md#bitdepth) | [classes/worker-pool.js:134](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L134) |
| <a id="duration"></a> `duration?` | `number` | [classes/worker-pool.js:132](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L132) |
| <a id="error"></a> `error?` | `string` | [classes/worker-pool.js:131](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L131) |
| <a id="finalcolorspacestate"></a> `finalColorSpaceState?` | [`ColorSpaceState`](PDFContentStreamColorConverter.md#colorspacestate) | [classes/worker-pool.js:130](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L130) |
| <a id="iscompressed-1"></a> `isCompressed?` | `boolean` | [classes/worker-pool.js:135](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L135) |
| <a id="newtext"></a> `newText?` | `string` | [classes/worker-pool.js:128](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L128) |
| <a id="outputarray"></a> `outputArray?` | `Uint8Array` \| `Uint16Array` \| `Float32Array` | [classes/worker-pool.js:126](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L126) |
| <a id="pixelbuffer-1"></a> `pixelBuffer?` | `Uint8Array` \| `Uint16Array` \| `Float32Array` | [classes/worker-pool.js:127](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L127) |
| <a id="pixelcount"></a> `pixelCount?` | `number` | [classes/worker-pool.js:133](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L133) |
| <a id="replacementcount"></a> `replacementCount?` | `number` | [classes/worker-pool.js:129](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L129) |
| <a id="success"></a> `success` | `boolean` | [classes/worker-pool.js:124](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L124) |
| <a id="taskid"></a> `taskId?` | `number` | [classes/worker-pool.js:125](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L125) |

***

### TaskType

> **TaskType**\<\> = `"transform"` \| `"image"` \| `"content-stream"` \| `"benchmark"`

Defined in: [classes/worker-pool.js:33](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L33)

#### Type Parameters

| Type Parameter |
| ------ |

***

### TransformTask

> **TransformTask**\<\> = \{ `destinationProfile`: `ArrayBuffer`; `flags`: `number`; `inputArray`: `Uint8Array` \| `Uint16Array` \| `Float32Array`; `inputFormat`: `number`; `outputComponentsPerPixel`: `number`; `outputFormat`: `number`; `pixelCount`: `number`; `renderingIntent`: `number`; `sourceProfile`: `ArrayBuffer` \| `"Lab"`; `type`: `"transform"`; \}

Defined in: [classes/worker-pool.js:49](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L49)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="destinationprofile-2"></a> `destinationProfile` | `ArrayBuffer` | [classes/worker-pool.js:46](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L46) |
| <a id="flags"></a> `flags` | `number` | [classes/worker-pool.js:48](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L48) |
| <a id="inputarray"></a> `inputArray` | `Uint8Array` \| `Uint16Array` \| `Float32Array` | [classes/worker-pool.js:40](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L40) |
| <a id="inputformat"></a> `inputFormat` | `number` | [classes/worker-pool.js:41](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L41) |
| <a id="outputcomponentsperpixel"></a> `outputComponentsPerPixel` | `number` | [classes/worker-pool.js:43](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L43) |
| <a id="outputformat"></a> `outputFormat` | `number` | [classes/worker-pool.js:42](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L42) |
| <a id="pixelcount-1"></a> `pixelCount` | `number` | [classes/worker-pool.js:44](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L44) |
| <a id="renderingintent-2"></a> `renderingIntent` | `number` | [classes/worker-pool.js:47](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L47) |
| <a id="sourceprofile-1"></a> `sourceProfile` | `ArrayBuffer` \| `"Lab"` | [classes/worker-pool.js:45](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L45) |
| <a id="type-3"></a> `type` | `"transform"` | [classes/worker-pool.js:39](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L39) |

***

### WorkerInfo

> **WorkerInfo**\<\> = \{ `busy`: `boolean`; `diagnosticsPort?`: `MessagePort`; `id`: `number`; `taskCount`: `number`; `worker`: `Worker` \| `Worker`; \}

Defined in: [classes/worker-pool.js:28](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L28)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="busy"></a> `busy` | `boolean` | [classes/worker-pool.js:25](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L25) |
| <a id="diagnosticsport"></a> `diagnosticsPort?` | `MessagePort` | [classes/worker-pool.js:27](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L27) |
| <a id="id"></a> `id` | `number` | [classes/worker-pool.js:23](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L23) |
| <a id="taskcount"></a> `taskCount` | `number` | [classes/worker-pool.js:26](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L26) |
| <a id="worker"></a> `worker` | `Worker` \| `Worker` | [classes/worker-pool.js:24](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L24) |

***

### WorkerPoolOptions

> **WorkerPoolOptions**\<\> = \{ `colorEnginePath?`: `string`; `diagnosticsEnabled?`: `boolean`; `workerCount?`: `number`; `workerScript?`: `string` \| `URL`; \}

Defined in: [classes/worker-pool.js:146](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L146)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="colorenginepath"></a> `colorEnginePath?` | `string` | [classes/worker-pool.js:144](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L144) |
| <a id="diagnosticsenabled-1"></a> `diagnosticsEnabled?` | `boolean` | [classes/worker-pool.js:145](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L145) |
| <a id="workercount"></a> `workerCount?` | `number` | [classes/worker-pool.js:142](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L142) |
| <a id="workerscript"></a> `workerScript?` | `string` \| `URL` | [classes/worker-pool.js:143](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L143) |

***

### WorkerPoolStats

> **WorkerPoolStats**\<\> = \{ `busyWorkers`: `number`; `queueLength`: `number`; `totalTasks`: `number`; `workerCount`: `number`; \}

Defined in: [classes/worker-pool.js:156](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L156)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="busyworkers"></a> `busyWorkers` | `number` | [classes/worker-pool.js:153](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L153) |
| <a id="queuelength"></a> `queueLength` | `number` | [classes/worker-pool.js:154](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L154) |
| <a id="totaltasks"></a> `totalTasks` | `number` | [classes/worker-pool.js:155](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L155) |
| <a id="workercount-1"></a> `workerCount` | `number` | [classes/worker-pool.js:152](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L152) |

***

### WorkerTask

> **WorkerTask**\<\> = [`TransformTask`](#transformtask) \| [`ImageTask`](#imagetask) \| [`ContentStreamTask`](#contentstreamtask) \| [`BenchmarkTask`](#benchmarktask)

Defined in: [classes/worker-pool.js:118](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L118)

#### Type Parameters

| Type Parameter |
| ------ |

## Functions

### benchmarkOptimalWorkerCount()

> **benchmarkOptimalWorkerCount**(`options?`: \{ `arraySize?`: `number`; `iterations?`: `number`; `maxWorkers?`: `number`; \}): `Promise`\<\{ `optimalWorkers`: `number`; `results`: \{ `avgTime`: `number`; `workers`: `number`; \}[]; \}\>

Defined in: [classes/worker-pool.js:683](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L683)

Run benchmark to determine optimal worker count.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | \{ `arraySize?`: `number`; `iterations?`: `number`; `maxWorkers?`: `number`; \} |  |
| `options.arraySize?` | `number` | Array size for benchmark |
| `options.iterations?` | `number` | Iterations per worker count |
| `options.maxWorkers?` | `number` | Maximum workers to test |

#### Returns

`Promise`\<\{ `optimalWorkers`: `number`; `results`: \{ `avgTime`: `number`; `workers`: `number`; \}[]; \}\>

***

### getDefaultWorkerCount()

> **getDefaultWorkerCount**(): `number`

Defined in: [classes/worker-pool.js:182](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool.js#L182)

Get estimated optimal worker count based on hardware.
Uses half of available CPU cores (minimum 1).

#### Returns

`number`
