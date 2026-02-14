[@conres.io/test-form-generator](README.md) / MainDiagnosticsCollector

# MainDiagnosticsCollector

Main Diagnostics Collector

Extends DiagnosticsCollector to receive diagnostics from auxiliary collectors
running in worker threads via MessageChannel.

The "one cook" model: MainDiagnosticsCollector owns all diagnostics data.
Auxiliary collectors send their data via MessageChannel, and this class
integrates it into the single diagnostics tree.

## Classes

### MainDiagnosticsCollector

Defined in: [classes/main-diagnostics-collector.js:101](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L101)

Main thread diagnostics collector that receives from auxiliary collectors.

Features:
- Inherits all DiagnosticsCollector functionality
- Manages MessageChannel ports from worker threads
- Integrates auxiliary spans/events/counters into main tree
- Automatically remaps span IDs to avoid collisions

#### Example

```javascript
const mainDiagnostics = new MainDiagnosticsCollector();

// Create channel for a worker
const { port1, port2 } = new MessageChannel();
mainDiagnostics.registerAuxiliary('worker-1', port1, parentSpanId);

// Pass port2 to worker via workerData or postMessage
worker.postMessage({ diagnosticsPort: port2 }, [port2]);
```

#### Extends

- [`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector)

#### Constructors

##### Constructor

> **new MainDiagnosticsCollector**(`options?`: \{ `enabled?`: `boolean`; `gracefulCleanupTimeout?`: `number`; \}): [`MainDiagnosticsCollector`](#maindiagnosticscollector)

Defined in: [classes/main-diagnostics-collector.js:129](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L129)

Creates a new MainDiagnosticsCollector instance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | \{ `enabled?`: `boolean`; `gracefulCleanupTimeout?`: `number`; \} | Configuration options |
| `options.enabled?` | `boolean` | Whether collection is enabled |
| `options.gracefulCleanupTimeout?` | `number` | Base timeout in ms for lingering spans |

###### Returns

[`MainDiagnosticsCollector`](#maindiagnosticscollector)

###### Overrides

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`constructor`](DiagnosticsCollector.md#constructor)

#### Accessors

##### auxiliaryWorkerIds

###### Get Signature

> **get** **auxiliaryWorkerIds**(): `string`[]

Defined in: [classes/main-diagnostics-collector.js:217](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L217)

Gets all registered auxiliary worker IDs.

###### Returns

`string`[]

##### counters

###### Get Signature

> **get** **counters**(): `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [classes/diagnostics-collector.js:540](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L540)

Gets all counters.

###### Returns

`Readonly`\<`Record`\<`string`, `number`\>\>

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`counters`](DiagnosticsCollector.md#counters)

##### currentSpanId

###### Get Signature

> **get** **currentSpanId**(): `number`

Defined in: [classes/diagnostics-collector.js:467](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L467)

Gets the currently active span ID.

###### Returns

`number`

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`currentSpanId`](DiagnosticsCollector.md#currentspanid)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

Defined in: [classes/diagnostics-collector.js:169](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L169)

Whether diagnostics collection is enabled.

###### Returns

`boolean`

###### Set Signature

> **set** **enabled**(`value`: `boolean`): `void`

Defined in: [classes/diagnostics-collector.js:177](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L177)

Enables or disables diagnostics collection.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | `boolean` |  |

###### Returns

`void`

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`enabled`](DiagnosticsCollector.md#enabled)

#### Methods

##### abortSpan()

> **abortSpan**(`handle`: [`SpanHandle`](DiagnosticsCollector.md#spanhandle), `data`: [`AbortData`](DiagnosticsCollector.md#abortdata)): `void`

Defined in: [classes/diagnostics-collector.js:435](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L435)

Aborts a span due to an error.

Use this in a catch block before re-throwing or collecting the error.
The subsequent endSpan() in the finally block will be a no-op.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `handle` | [`SpanHandle`](DiagnosticsCollector.md#spanhandle) | Handle from startSpan or startNestedSpan |
| `data` | [`AbortData`](DiagnosticsCollector.md#abortdata) | Abort reason: { reason: string } or { timeout: number } |

###### Returns

`void`

###### Example

```javascript
const span = diagnostics.startSpan('operation');
try {
    // ... work that may throw ...
} catch (error) {
    diagnostics.abortSpan(span, { reason: error.message });
    throw error;
} finally {
    diagnostics.endSpan(span); // No-op since abortSpan was called
}
```

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`abortSpan`](DiagnosticsCollector.md#abortspan)

##### createAuxiliaryChannel()

> **createAuxiliaryChannel**(`workerId`: `string`, `parentSpanId?`: `number`): \{ `mainPort`: `MessagePort`; `workerPort`: `MessagePort`; \}

Defined in: [classes/main-diagnostics-collector.js:207](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L207)

Creates a MessageChannel pair for a worker and registers one port.

###### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `workerId` | `string` | `undefined` | Unique identifier for the worker |
| `parentSpanId?` | `number` | `null` | Parent span ID for worker spans |

###### Returns

\{ `mainPort`: `MessagePort`; `workerPort`: `MessagePort`; \}

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `mainPort` | `MessagePort` | [classes/main-diagnostics-collector.js:199](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L199) |
| `workerPort` | `MessagePort` | [classes/main-diagnostics-collector.js:199](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L199) |

###### Example

```javascript
const { mainPort, workerPort } = mainDiagnostics.createAuxiliaryChannel('worker-1');
// Pass workerPort to the worker
```

##### dispose()

> **dispose**(): `void`

Defined in: [classes/main-diagnostics-collector.js:619](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L619)

Disposes of the collector and all resources.

###### Returns

`void`

##### endSpan()

> **endSpan**(`handle`: [`SpanHandle`](DiagnosticsCollector.md#spanhandle), `metrics?`: `Record`\<`string`, `number`\>): `void`

Defined in: [classes/main-diagnostics-collector.js:494](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L494)

Override endSpan to handle root span timeout logic.

When a root span ends, any lingering open descendant spans will be
aborted after a graceful timeout period.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `handle` | [`SpanHandle`](DiagnosticsCollector.md#spanhandle) |  |
| `metrics?` | `Record`\<`string`, `number`\> |  |

###### Returns

`void`

###### Overrides

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`endSpan`](DiagnosticsCollector.md#endspan)

##### getCounter()

> **getCounter**(`name`: `string`): `number`

Defined in: [classes/diagnostics-collector.js:532](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L532)

Gets the current value of a counter.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `name` | `string` | Counter name |

###### Returns

`number`

Counter value (0 if not set)

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`getCounter`](DiagnosticsCollector.md#getcounter)

##### incrementCounter()

> **incrementCounter**(`name`: `string`, `delta?`: `number`): `void`

Defined in: [classes/diagnostics-collector.js:518](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L518)

Increments a named counter.

###### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `name` | `string` | `undefined` | Counter name (e.g., 'hits', 'misses', 'pixels') |
| `delta?` | `number` | `1` | Amount to increment |

###### Returns

`void`

###### Example

```javascript
diagnostics.incrementCounter('cache-hits');
diagnostics.incrementCounter('pixels', 2073600);
```

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`incrementCounter`](DiagnosticsCollector.md#incrementcounter)

##### merge()

> **merge**(`workerData`: [`SerializedDiagnostics`](DiagnosticsCollector.md#serializeddiagnostics), `parentSpanId?`: `number`): `void`

Defined in: [classes/diagnostics-collector.js:571](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L571)

Merges serialized diagnostics from a worker.

Worker spans are attached as children of the specified parent span.
Timestamps are adjusted relative to the main collector's start time.

###### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `workerData` | [`SerializedDiagnostics`](DiagnosticsCollector.md#serializeddiagnostics) | `undefined` | Serialized data from worker |
| `parentSpanId?` | `number` | `null` | Parent span to attach worker spans to |

###### Returns

`void`

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`merge`](DiagnosticsCollector.md#merge)

##### recordEvent()

> **recordEvent**(`name`: `string`, `data?`: `Record`\<`string`, `any`\>): `void`

Defined in: [classes/diagnostics-collector.js:489](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L489)

Records an instant event.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `name` | `string` | Event name (e.g., 'profile-loaded', 'cache-hit') |
| `data?` | `Record`\<`string`, `any`\> | Event data |

###### Returns

`void`

###### Example

```javascript
diagnostics.recordEvent('cache-hit', {
    key: 'RGB:128,64,32',
    source: 'color-lookup',
});
```

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`recordEvent`](DiagnosticsCollector.md#recordevent)

##### registerAuxiliary()

> **registerAuxiliary**(`workerId`: `string`, `port`: `MessagePort`, `parentSpanId?`: `number`): `void`

Defined in: [classes/main-diagnostics-collector.js:158](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L158)

Registers an auxiliary collector's MessageChannel port.

The auxiliary collector in the worker will send messages through this port,
and this collector will integrate them into the main span tree.

###### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `workerId` | `string` | `undefined` | Unique identifier for the worker |
| `port` | `MessagePort` | `undefined` | MessagePort to receive messages on |
| `parentSpanId?` | `number` | `null` | Parent span ID for worker spans |

###### Returns

`void`

###### Example

```javascript
const { port1, port2 } = new MessageChannel();
mainDiagnostics.registerAuxiliary('worker-1', port1, currentSpanId);
// Pass port2 to worker
```

##### reset()

> **reset**(): `void`

Defined in: [classes/main-diagnostics-collector.js:598](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L598)

Resets the collector and closes all auxiliary channels.

###### Returns

`void`

###### Overrides

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`reset`](DiagnosticsCollector.md#reset)

##### serialize()

> **serialize**(): [`SerializedDiagnostics`](DiagnosticsCollector.md#serializeddiagnostics)

Defined in: [classes/diagnostics-collector.js:553](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L553)

Serializes the collector state for transfer to/from workers.

###### Returns

[`SerializedDiagnostics`](DiagnosticsCollector.md#serializeddiagnostics)

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`serialize`](DiagnosticsCollector.md#serialize)

##### startNestedSpan()

> **startNestedSpan**(`parentHandle`: [`SpanHandle`](DiagnosticsCollector.md#spanhandle), `name`: `string`, `attributes?`: `Record`\<`string`, `any`\>): [`SpanHandle`](DiagnosticsCollector.md#spanhandle)

Defined in: [classes/diagnostics-collector.js:277](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L277)

Starts a nested span with an explicit parent.

Unlike startSpan(), this does NOT modify the current span context.
Use this for concurrent operations where multiple spans run in parallel
under the same parent.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `parentHandle` | [`SpanHandle`](DiagnosticsCollector.md#spanhandle) | Parent span handle (from startSpan or startNestedSpan) |
| `name` | `string` | Operation name |
| `attributes?` | `Record`\<`string`, `any`\> | Initial attributes |

###### Returns

[`SpanHandle`](DiagnosticsCollector.md#spanhandle)

Handle to use with endSpan

###### Example

```javascript
const batchSpan = diagnostics.startSpan('image-batch');
const imagePromises = images.map(async (image) => {
    const imageSpan = diagnostics.startNestedSpan(batchSpan, 'image-conversion', {
        ref: image.ref,
    });
    try {
        await convertImage(image);
    } finally {
        diagnostics.endSpan(imageSpan);
    }
});
await Promise.all(imagePromises);
diagnostics.endSpan(batchSpan);
```

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`startNestedSpan`](DiagnosticsCollector.md#startnestedspan)

##### startSpan()

> **startSpan**(`name`: `string`, `attributes?`: `Record`\<`string`, `any`\>): [`SpanHandle`](DiagnosticsCollector.md#spanhandle)

Defined in: [classes/diagnostics-collector.js:202](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L202)

Starts a new span for tracking a timed operation.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `name` | `string` | Operation name (e.g., 'document-conversion', 'page', 'image') |
| `attributes?` | `Record`\<`string`, `any`\> | Initial attributes (file, ref, colorSpace, etc.) |

###### Returns

[`SpanHandle`](DiagnosticsCollector.md#spanhandle)

Handle to use with endSpan

###### Example

```javascript
const span = diagnostics.startSpan('image-conversion', {
    ref: 'Im0',
    colorSpace: 'RGB',
    width: 1920,
    height: 1080,
});
```

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`startSpan`](DiagnosticsCollector.md#startspan)

##### toJSON()

> **toJSON**(): [`DiagnosticsNode`](DiagnosticsCollector.md#diagnosticsnode)[]

Defined in: [classes/diagnostics-collector.js:649](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L649)

Converts to Hatchet-compatible JSON format for Performance Profile Viewer.

###### Returns

[`DiagnosticsNode`](DiagnosticsCollector.md#diagnosticsnode)[]

###### Example

```javascript
const json = diagnostics.toJSON();
await writeFile('profile.json', JSON.stringify(json, null, 2));
```

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`toJSON`](DiagnosticsCollector.md#tojson)

##### toText()

> **toText**(): `string`

Defined in: [classes/diagnostics-collector.js:751](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L751)

Converts to human-readable hierarchical text.

###### Returns

`string`

###### Example

```javascript
console.log(diagnostics.toText());
// Document Conversion (12,847ms)
// ├── Page 1 (4,231ms)
// │   ├── Images: 3 converted
// │   └── Content Streams: 2
// └── Cache Stats
//     └── Hits: 12,847 / Misses: 234
```

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`toText`](DiagnosticsCollector.md#totext)

##### toTraceLog()

> **toTraceLog**(): `string`

Defined in: [classes/diagnostics-collector.js:851](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L851)

Converts to flat trace log format.

###### Returns

`string`

###### Example

```javascript
console.log(diagnostics.toTraceLog());
//      0.000ms  [START] document-conversion
//      0.012ms  [START] page-1
//    847.234ms  [END]   page-1 elapsed=847.222ms
```

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`toTraceLog`](DiagnosticsCollector.md#totracelog)

##### unregisterAuxiliary()

> **unregisterAuxiliary**(`workerId`: `string`): `void`

Defined in: [classes/main-diagnostics-collector.js:186](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L186)

Unregisters an auxiliary collector.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `workerId` | `string` | Worker identifier |

###### Returns

`void`

##### updateSpan()

> **updateSpan**(`handle`: [`SpanHandle`](DiagnosticsCollector.md#spanhandle), `data?`: `Record`\<`string`, `any`\>): `void`

Defined in: [classes/diagnostics-collector.js:386](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L386)

Updates a span with additional attributes or metrics.

Use this to add data during a span's lifetime without ending it.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `handle` | [`SpanHandle`](DiagnosticsCollector.md#spanhandle) | Handle from startSpan |
| `data?` | `Record`\<`string`, `any`\> | Attributes and/or metrics to add |

###### Returns

`void`

###### Example

```javascript
const span = diagnostics.startSpan('image-conversion');
try {
    // ... work ...
    diagnostics.updateSpan(span, { indexed: true, pixels: 1000 });
} finally {
    diagnostics.endSpan(span);
}
```

###### Inherited from

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`updateSpan`](DiagnosticsCollector.md#updatespan)

## Type Aliases

### AuxiliaryChannel

> **AuxiliaryChannel**\<\> = \{ `idMap`: `Map`\<`number`, `number`\>; `parentSpanId`: `number` \| `null`; `port`: `MessagePort`; `startTime`: `number`; `workerId`: `string`; \}

Defined in: [classes/main-diagnostics-collector.js:71](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L71)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="idmap"></a> `idMap` | `Map`\<`number`, `number`\> | [classes/main-diagnostics-collector.js:69](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L69) |
| <a id="parentspanid"></a> `parentSpanId` | `number` \| `null` | [classes/main-diagnostics-collector.js:68](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L68) |
| <a id="port"></a> `port` | `MessagePort` | [classes/main-diagnostics-collector.js:67](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L67) |
| <a id="starttime"></a> `startTime` | `number` | [classes/main-diagnostics-collector.js:70](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L70) |
| <a id="workerid"></a> `workerId` | `string` | [classes/main-diagnostics-collector.js:66](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L66) |

***

### AuxiliaryMessage

> **AuxiliaryMessage**\<\> = \{ `attributes`: `Record`\<`string`, `any`\>; `id`: `number`; `name`: `string`; `parentId`: `number` \| `null`; `timestamp`: `number`; `type`: `"span-start"`; `workerId`: `string`; \} \| \{ `id`: `number`; `metrics`: `Record`\<`string`, `number`\>; `timestamp`: `number`; `type`: `"span-end"`; `workerId`: `string`; \} \| \{ `data`: `Record`\<`string`, `any`\>; `id`: `number`; `type`: `"span-update"`; `workerId`: `string`; \} \| \{ `abortData`: [`AbortData`](DiagnosticsCollector.md#abortdata); `id`: `number`; `timestamp`: `number`; `type`: `"span-abort"`; `workerId`: `string`; \} \| \{ `data`: `Record`\<`string`, `any`\>; `name`: `string`; `spanId`: `number` \| `null`; `timestamp`: `number`; `type`: `"event"`; `workerId`: `string`; \} \| \{ `delta`: `number`; `name`: `string`; `type`: `"counter"`; `workerId`: `string`; \}

Defined in: [classes/main-diagnostics-collector.js:60](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/main-diagnostics-collector.js#L60)

#### Type Parameters

| Type Parameter |
| ------ |
