[@conres.io/test-form-generator](README.md) / AuxiliaryDiagnosticsCollector

# AuxiliaryDiagnosticsCollector

Auxiliary Diagnostics Collector

Extends DiagnosticsCollector for use in worker threads.
Sends all diagnostic data via MessageChannel to MainDiagnosticsCollector.

The "one cook" model: AuxiliaryDiagnosticsCollector sends data to the main
thread, where MainDiagnosticsCollector integrates it into the single tree.

## Classes

### AuxiliaryDiagnosticsCollector

Defined in: [classes/auxiliary-diagnostics-collector.js:89](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/auxiliary-diagnostics-collector.js#L89)

Worker thread diagnostics collector that sends data via MessageChannel.

Features:
- Inherits all DiagnosticsCollector functionality for local tracking
- Sends span/event/counter data to main thread via MessagePort
- Maintains local span tracking for parent-child relationships

#### Example

```javascript
// In worker thread:
const diagnostics = new AuxiliaryDiagnosticsCollector({
    workerId: 'worker-1',
    port: workerData.diagnosticsPort,
});

const span = diagnostics.startSpan('image-conversion', { ref: 'Im0' });
// ... work ...
diagnostics.endSpan(span, { pixels: 2073600 });
```

#### Extends

- [`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector)

#### Constructors

##### Constructor

> **new AuxiliaryDiagnosticsCollector**(`options`: \{ `enabled?`: `boolean`; `port`: `MessagePort`; `workerId`: `string`; \}): [`AuxiliaryDiagnosticsCollector`](#auxiliarydiagnosticscollector)

Defined in: [classes/auxiliary-diagnostics-collector.js:115](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/auxiliary-diagnostics-collector.js#L115)

Creates a new AuxiliaryDiagnosticsCollector instance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | \{ `enabled?`: `boolean`; `port`: `MessagePort`; `workerId`: `string`; \} | Configuration options |
| `options.enabled?` | `boolean` | Whether collection is enabled |
| `options.port` | `MessagePort` | MessagePort to send data through |
| `options.workerId` | `string` | Unique identifier for this worker |

###### Returns

[`AuxiliaryDiagnosticsCollector`](#auxiliarydiagnosticscollector)

###### Overrides

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`constructor`](DiagnosticsCollector.md#constructor)

#### Accessors

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

##### workerId

###### Get Signature

> **get** **workerId**(): `string`

Defined in: [classes/auxiliary-diagnostics-collector.js:342](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/auxiliary-diagnostics-collector.js#L342)

Gets the worker ID.

###### Returns

`string`

#### Methods

##### abortSpan()

> **abortSpan**(`handle`: [`SpanHandle`](DiagnosticsCollector.md#spanhandle), `data`: [`AbortData`](DiagnosticsCollector.md#abortdata)): `void`

Defined in: [classes/auxiliary-diagnostics-collector.js:232](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/auxiliary-diagnostics-collector.js#L232)

Aborts a span and sends notification to main collector.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `handle` | [`SpanHandle`](DiagnosticsCollector.md#spanhandle) | Handle from startSpan |
| `data` | [`AbortData`](DiagnosticsCollector.md#abortdata) | Abort reason |

###### Returns

`void`

###### Overrides

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`abortSpan`](DiagnosticsCollector.md#abortspan)

##### close()

> **close**(): `void`

Defined in: [classes/auxiliary-diagnostics-collector.js:350](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/auxiliary-diagnostics-collector.js#L350)

Closes the port connection.
Call this when the worker is done.

###### Returns

`void`

##### endSpan()

> **endSpan**(`handle`: [`SpanHandle`](DiagnosticsCollector.md#spanhandle), `metrics?`: `Record`\<`string`, `number`\>): `void`

Defined in: [classes/auxiliary-diagnostics-collector.js:186](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/auxiliary-diagnostics-collector.js#L186)

Ends a span and sends notification to main collector.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `handle` | [`SpanHandle`](DiagnosticsCollector.md#spanhandle) | Handle from startSpan |
| `metrics?` | `Record`\<`string`, `number`\> | Final metrics |

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

Defined in: [classes/auxiliary-diagnostics-collector.js:283](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/auxiliary-diagnostics-collector.js#L283)

Increments a counter and sends notification to main collector.

###### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `name` | `string` | `undefined` | Counter name |
| `delta?` | `number` | `1` | Amount to increment |

###### Returns

`void`

###### Overrides

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

Defined in: [classes/auxiliary-diagnostics-collector.js:257](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/auxiliary-diagnostics-collector.js#L257)

Records an event and sends notification to main collector.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `name` | `string` | Event name |
| `data?` | `Record`\<`string`, `any`\> | Event data |

###### Returns

`void`

###### Overrides

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`recordEvent`](DiagnosticsCollector.md#recordevent)

##### reset()

> **reset**(): `void`

Defined in: [classes/auxiliary-diagnostics-collector.js:358](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/auxiliary-diagnostics-collector.js#L358)

Resets the collector and maintains port connection.

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

Defined in: [classes/auxiliary-diagnostics-collector.js:161](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/auxiliary-diagnostics-collector.js#L161)

Starts a nested span with explicit parent and sends notification to main collector.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `parentHandle` | [`SpanHandle`](DiagnosticsCollector.md#spanhandle) | Parent span handle |
| `name` | `string` | Operation name |
| `attributes?` | `Record`\<`string`, `any`\> | Initial attributes |

###### Returns

[`SpanHandle`](DiagnosticsCollector.md#spanhandle)

Handle to use with endSpan

###### Overrides

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`startNestedSpan`](DiagnosticsCollector.md#startnestedspan)

##### startSpan()

> **startSpan**(`name`: `string`, `attributes?`: `Record`\<`string`, `any`\>): [`SpanHandle`](DiagnosticsCollector.md#spanhandle)

Defined in: [classes/auxiliary-diagnostics-collector.js:134](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/auxiliary-diagnostics-collector.js#L134)

Starts a new span and sends notification to main collector.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `name` | `string` | Operation name |
| `attributes?` | `Record`\<`string`, `any`\> | Initial attributes |

###### Returns

[`SpanHandle`](DiagnosticsCollector.md#spanhandle)

Handle to use with endSpan

###### Overrides

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

##### updateSpan()

> **updateSpan**(`handle`: [`SpanHandle`](DiagnosticsCollector.md#spanhandle), `data?`: `Record`\<`string`, `any`\>): `void`

Defined in: [classes/auxiliary-diagnostics-collector.js:212](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/auxiliary-diagnostics-collector.js#L212)

Updates a span with additional data and sends notification to main collector.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `handle` | [`SpanHandle`](DiagnosticsCollector.md#spanhandle) | Handle from startSpan |
| `data?` | `Record`\<`string`, `any`\> | Attributes and/or metrics to add |

###### Returns

`void`

###### Overrides

[`DiagnosticsCollector`](DiagnosticsCollector.md#diagnosticscollector).[`updateSpan`](DiagnosticsCollector.md#updatespan)

## Type Aliases

### AuxiliaryMessage

> **AuxiliaryMessage**\<\> = \{ `attributes`: `Record`\<`string`, `any`\>; `id`: `number`; `name`: `string`; `parentId`: `number` \| `null`; `timestamp`: `number`; `type`: `"span-start"`; `workerId`: `string`; \} \| \{ `id`: `number`; `metrics`: `Record`\<`string`, `number`\>; `timestamp`: `number`; `type`: `"span-end"`; `workerId`: `string`; \} \| \{ `data`: `Record`\<`string`, `any`\>; `id`: `number`; `type`: `"span-update"`; `workerId`: `string`; \} \| \{ `abortData`: [`AbortData`](DiagnosticsCollector.md#abortdata); `id`: `number`; `timestamp`: `number`; `type`: `"span-abort"`; `workerId`: `string`; \} \| \{ `data`: `Record`\<`string`, `any`\>; `name`: `string`; `spanId`: `number` \| `null`; `timestamp`: `number`; `type`: `"event"`; `workerId`: `string`; \} \| \{ `delta`: `number`; `name`: `string`; `type`: `"counter"`; `workerId`: `string`; \}

Defined in: [classes/auxiliary-diagnostics-collector.js:59](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/auxiliary-diagnostics-collector.js#L59)

#### Type Parameters

| Type Parameter |
| ------ |
