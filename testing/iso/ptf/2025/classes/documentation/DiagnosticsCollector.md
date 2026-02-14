[@conres.io/test-form-generator](README.md) / DiagnosticsCollector

# DiagnosticsCollector

Diagnostics Collector

Collects timing, events, and counters during PDF color conversion.
Outputs Hatchet-compatible JSON for Performance Profile Viewer.

## Classes

### DiagnosticsCollector

Defined in: [classes/diagnostics-collector.js:120](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L120)

Collects diagnostics data during PDF color conversion operations.

Features:
- Hierarchical span tracking with parent-child relationships
- Instant event recording
- Counter tracking for aggregated metrics
- Hatchet-compatible JSON output for Performance Profile Viewer
- Human-readable text output
- Flat trace log output
- Serialization for worker thread coordination

#### Example

```javascript
const diagnostics = new DiagnosticsCollector();

const docSpan = diagnostics.startSpan('document-conversion', {
    file: 'test.pdf',
    renderingIntent: 'relative-colorimetric',
});

for (let i = 0; i < pages.length; i++) {
    const pageSpan = diagnostics.startSpan('page', { pageIndex: i });
    // ... process page ...
    diagnostics.endSpan(pageSpan, { images: 3, streams: 2 });
}

diagnostics.endSpan(docSpan, { pages: pages.length });

// Output
const json = diagnostics.toJSON();
const text = diagnostics.toText();
```

#### Extended by

- [`AuxiliaryDiagnosticsCollector`](AuxiliaryDiagnosticsCollector.md#auxiliarydiagnosticscollector)
- [`MainDiagnosticsCollector`](MainDiagnosticsCollector.md#maindiagnosticscollector)

#### Constructors

##### Constructor

> **new DiagnosticsCollector**(`options?`: \{ `enabled?`: `boolean`; \}): [`DiagnosticsCollector`](#diagnosticscollector)

Defined in: [classes/diagnostics-collector.js:156](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L156)

Creates a new DiagnosticsCollector instance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | \{ `enabled?`: `boolean`; \} | Configuration options |
| `options.enabled?` | `boolean` | Whether collection is enabled |

###### Returns

[`DiagnosticsCollector`](#diagnosticscollector)

#### Accessors

##### counters

###### Get Signature

> **get** **counters**(): `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [classes/diagnostics-collector.js:540](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L540)

Gets all counters.

###### Returns

`Readonly`\<`Record`\<`string`, `number`\>\>

##### currentSpanId

###### Get Signature

> **get** **currentSpanId**(): `number`

Defined in: [classes/diagnostics-collector.js:467](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L467)

Gets the currently active span ID.

###### Returns

`number`

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

#### Methods

##### abortSpan()

> **abortSpan**(`handle`: [`SpanHandle`](#spanhandle), `data`: [`AbortData`](#abortdata)): `void`

Defined in: [classes/diagnostics-collector.js:435](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L435)

Aborts a span due to an error.

Use this in a catch block before re-throwing or collecting the error.
The subsequent endSpan() in the finally block will be a no-op.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `handle` | [`SpanHandle`](#spanhandle) | Handle from startSpan or startNestedSpan |
| `data` | [`AbortData`](#abortdata) | Abort reason: { reason: string } or { timeout: number } |

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

##### endSpan()

> **endSpan**(`handle`: [`SpanHandle`](#spanhandle), `metrics?`: `Record`\<`string`, `number`\>): `void`

Defined in: [classes/diagnostics-collector.js:340](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L340)

Ends a span and records its metrics.

No-op if the span is already closed (completed or aborted).
Should only be called in a finally block.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `handle` | [`SpanHandle`](#spanhandle) | Handle from startSpan or startNestedSpan |
| `metrics?` | `Record`\<`string`, `number`\> | Final metrics (pixels, ops, images, etc.) |

###### Returns

`void`

###### Example

```javascript
const span = diagnostics.startSpan('operation');
try {
    // ... work ...
} finally {
    diagnostics.endSpan(span, { pixels: 2073600 });
}
```

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

##### merge()

> **merge**(`workerData`: [`SerializedDiagnostics`](#serializeddiagnostics), `parentSpanId?`: `number`): `void`

Defined in: [classes/diagnostics-collector.js:571](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L571)

Merges serialized diagnostics from a worker.

Worker spans are attached as children of the specified parent span.
Timestamps are adjusted relative to the main collector's start time.

###### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `workerData` | [`SerializedDiagnostics`](#serializeddiagnostics) | `undefined` | Serialized data from worker |
| `parentSpanId?` | `number` | `null` | Parent span to attach worker spans to |

###### Returns

`void`

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

##### reset()

> **reset**(): `void`

Defined in: [classes/diagnostics-collector.js:971](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L971)

Resets the collector to initial state.

###### Returns

`void`

##### serialize()

> **serialize**(): [`SerializedDiagnostics`](#serializeddiagnostics)

Defined in: [classes/diagnostics-collector.js:553](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L553)

Serializes the collector state for transfer to/from workers.

###### Returns

[`SerializedDiagnostics`](#serializeddiagnostics)

##### startNestedSpan()

> **startNestedSpan**(`parentHandle`: [`SpanHandle`](#spanhandle), `name`: `string`, `attributes?`: `Record`\<`string`, `any`\>): [`SpanHandle`](#spanhandle)

Defined in: [classes/diagnostics-collector.js:277](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L277)

Starts a nested span with an explicit parent.

Unlike startSpan(), this does NOT modify the current span context.
Use this for concurrent operations where multiple spans run in parallel
under the same parent.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `parentHandle` | [`SpanHandle`](#spanhandle) | Parent span handle (from startSpan or startNestedSpan) |
| `name` | `string` | Operation name |
| `attributes?` | `Record`\<`string`, `any`\> | Initial attributes |

###### Returns

[`SpanHandle`](#spanhandle)

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

##### startSpan()

> **startSpan**(`name`: `string`, `attributes?`: `Record`\<`string`, `any`\>): [`SpanHandle`](#spanhandle)

Defined in: [classes/diagnostics-collector.js:202](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L202)

Starts a new span for tracking a timed operation.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `name` | `string` | Operation name (e.g., 'document-conversion', 'page', 'image') |
| `attributes?` | `Record`\<`string`, `any`\> | Initial attributes (file, ref, colorSpace, etc.) |

###### Returns

[`SpanHandle`](#spanhandle)

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

##### toJSON()

> **toJSON**(): [`DiagnosticsNode`](#diagnosticsnode)[]

Defined in: [classes/diagnostics-collector.js:649](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L649)

Converts to Hatchet-compatible JSON format for Performance Profile Viewer.

###### Returns

[`DiagnosticsNode`](#diagnosticsnode)[]

###### Example

```javascript
const json = diagnostics.toJSON();
await writeFile('profile.json', JSON.stringify(json, null, 2));
```

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

##### updateSpan()

> **updateSpan**(`handle`: [`SpanHandle`](#spanhandle), `data?`: `Record`\<`string`, `any`\>): `void`

Defined in: [classes/diagnostics-collector.js:386](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L386)

Updates a span with additional attributes or metrics.

Use this to add data during a span's lifetime without ending it.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `handle` | [`SpanHandle`](#spanhandle) | Handle from startSpan |
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

## Type Aliases

### AbortData

> **AbortData**\<\> = \{ `reason`: `string`; \} \| \{ `timeout`: `number`; \}

Defined in: [classes/diagnostics-collector.js:22](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L22)

#### Type Parameters

| Type Parameter |
| ------ |

***

### DiagnosticsNode

> **DiagnosticsNode**\<\> = \{ `attributes`: `Record`\<`string`, `any`\>; `children`: [`DiagnosticsNode`](#diagnosticsnode)[]; `frame`: `string`[]; `metrics`: `Record`\<`string`, `number`\>; `name`: `string`; `status`: `"completed"` \| `"aborted"`; \}

Defined in: [classes/diagnostics-collector.js:69](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L69)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="attributes"></a> `attributes` | `Record`\<`string`, `any`\> | [classes/diagnostics-collector.js:66](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L66) |
| <a id="children"></a> `children` | [`DiagnosticsNode`](#diagnosticsnode)[] | [classes/diagnostics-collector.js:68](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L68) |
| <a id="frame"></a> `frame` | `string`[] | [classes/diagnostics-collector.js:64](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L64) |
| <a id="metrics"></a> `metrics` | `Record`\<`string`, `number`\> | [classes/diagnostics-collector.js:65](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L65) |
| <a id="name"></a> `name` | `string` | [classes/diagnostics-collector.js:63](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L63) |
| <a id="status"></a> `status` | `"completed"` \| `"aborted"` | [classes/diagnostics-collector.js:67](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L67) |

***

### Event

> **Event**\<\> = \{ `data`: `Record`\<`string`, `any`\>; `name`: `string`; `spanId`: `number` \| `null`; `timestamp`: `number`; \}

Defined in: [classes/diagnostics-collector.js:49](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L49)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="data"></a> `data` | `Record`\<`string`, `any`\> | [classes/diagnostics-collector.js:47](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L47) |
| <a id="name-1"></a> `name` | `string` | [classes/diagnostics-collector.js:46](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L46) |
| <a id="spanid"></a> `spanId` | `number` \| `null` | [classes/diagnostics-collector.js:48](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L48) |
| <a id="timestamp"></a> `timestamp` | `number` | [classes/diagnostics-collector.js:45](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L45) |

***

### NoOpDiagnostics

> **NoOpDiagnostics**\<\> = \{ `abortSpan`: () => `void`; `counters`: `Readonly`\<\{ \}\>; `currentSpanId`: `null`; `enabled`: `false`; `endSpan`: () => `void`; `getCounter`: () => `number`; `incrementCounter`: () => `void`; `merge`: () => `void`; `recordEvent`: () => `void`; `reset`: () => `void`; `serialize`: () => \{ `counters`: \{ \}; `events`: \[\]; `spans`: \[\]; `startTime`: `number`; \}; `startNestedSpan`: () => \{ `id`: `number`; `name`: `string`; \}; `startSpan`: () => \{ `id`: `number`; `name`: `string`; \}; `toJSON`: () => \[\]; `toText`: () => `string`; `toTraceLog`: () => `string`; `updateSpan`: () => `void`; \}

Defined in: [classes/diagnostics-collector.js:1005](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L1005)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="abortspan-2"></a> `abortSpan()` | () => `void` | [classes/diagnostics-collector.js:995](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L995) |
| <a id="counters-1"></a> `counters` | `Readonly`\<\{ \}\> | [classes/diagnostics-collector.js:990](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L990) |
| <a id="currentspanid-1"></a> `currentSpanId` | `null` | [classes/diagnostics-collector.js:989](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L989) |
| <a id="enabled-1"></a> `enabled` | `false` | [classes/diagnostics-collector.js:988](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L988) |
| <a id="endspan-2"></a> `endSpan()` | () => `void` | [classes/diagnostics-collector.js:993](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L993) |
| <a id="getcounter-2"></a> `getCounter()` | () => `number` | [classes/diagnostics-collector.js:998](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L998) |
| <a id="incrementcounter-2"></a> `incrementCounter()` | () => `void` | [classes/diagnostics-collector.js:997](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L997) |
| <a id="merge-2"></a> `merge()` | () => `void` | [classes/diagnostics-collector.js:1000](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L1000) |
| <a id="recordevent-2"></a> `recordEvent()` | () => `void` | [classes/diagnostics-collector.js:996](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L996) |
| <a id="reset-2"></a> `reset()` | () => `void` | [classes/diagnostics-collector.js:1004](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L1004) |
| <a id="serialize-2"></a> `serialize()` | () => \{ `counters`: \{ \}; `events`: \[\]; `spans`: \[\]; `startTime`: `number`; \} | [classes/diagnostics-collector.js:999](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L999) |
| <a id="startnestedspan-2"></a> `startNestedSpan()` | () => \{ `id`: `number`; `name`: `string`; \} | [classes/diagnostics-collector.js:992](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L992) |
| <a id="startspan-2"></a> `startSpan()` | () => \{ `id`: `number`; `name`: `string`; \} | [classes/diagnostics-collector.js:991](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L991) |
| <a id="tojson-2"></a> `toJSON()` | () => \[\] | [classes/diagnostics-collector.js:1001](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L1001) |
| <a id="totext-2"></a> `toText()` | () => `string` | [classes/diagnostics-collector.js:1002](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L1002) |
| <a id="totracelog-2"></a> `toTraceLog()` | () => `string` | [classes/diagnostics-collector.js:1003](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L1003) |
| <a id="updatespan-2"></a> `updateSpan()` | () => `void` | [classes/diagnostics-collector.js:994](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L994) |

***

### SerializedDiagnostics

> **SerializedDiagnostics**\<\> = \{ `counters`: `Record`\<`string`, `number`\>; `events`: [`Event`](#event)[]; `spans`: [`Span`](#span)[]; `startTime`: `number`; \}

Defined in: [classes/diagnostics-collector.js:79](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L79)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="counters-2"></a> `counters` | `Record`\<`string`, `number`\> | [classes/diagnostics-collector.js:77](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L77) |
| <a id="events"></a> `events` | [`Event`](#event)[] | [classes/diagnostics-collector.js:76](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L76) |
| <a id="spans"></a> `spans` | [`Span`](#span)[] | [classes/diagnostics-collector.js:75](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L75) |
| <a id="starttime"></a> `startTime` | `number` | [classes/diagnostics-collector.js:78](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L78) |

***

### Span

> **Span**\<\> = \{ `abortData`: [`AbortData`](#abortdata) \| `null`; `attributes`: `Record`\<`string`, `any`\>; `children`: `number`[]; `endTime`: `number` \| `null`; `id`: `number`; `metrics`: `Record`\<`string`, `number`\>; `name`: `string`; `parentId`: `number` \| `null`; `rootId`: `number`; `startTime`: `number`; `status`: [`SpanStatus`](#spanstatus-1); \}

Defined in: [classes/diagnostics-collector.js:39](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L39)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="abortdata-1"></a> `abortData` | [`AbortData`](#abortdata) \| `null` | [classes/diagnostics-collector.js:36](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L36) |
| <a id="attributes-1"></a> `attributes` | `Record`\<`string`, `any`\> | [classes/diagnostics-collector.js:31](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L31) |
| <a id="children-1"></a> `children` | `number`[] | [classes/diagnostics-collector.js:38](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L38) |
| <a id="endtime"></a> `endTime` | `number` \| `null` | [classes/diagnostics-collector.js:34](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L34) |
| <a id="id"></a> `id` | `number` | [classes/diagnostics-collector.js:28](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L28) |
| <a id="metrics-1"></a> `metrics` | `Record`\<`string`, `number`\> | [classes/diagnostics-collector.js:32](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L32) |
| <a id="name-2"></a> `name` | `string` | [classes/diagnostics-collector.js:29](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L29) |
| <a id="parentid"></a> `parentId` | `number` \| `null` | [classes/diagnostics-collector.js:37](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L37) |
| <a id="rootid"></a> `rootId` | `number` | [classes/diagnostics-collector.js:30](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L30) |
| <a id="starttime-1"></a> `startTime` | `number` | [classes/diagnostics-collector.js:33](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L33) |
| <a id="status-1"></a> `status` | [`SpanStatus`](#spanstatus-1) | [classes/diagnostics-collector.js:35](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L35) |

***

### SpanHandle

> **SpanHandle**\<\> = \{ `id`: `number`; `name`: `string`; \}

Defined in: [classes/diagnostics-collector.js:57](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L57)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="id-1"></a> `id` | `number` | [classes/diagnostics-collector.js:55](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L55) |
| <a id="name-3"></a> `name` | `string` | [classes/diagnostics-collector.js:56](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L56) |

***

### SpanStatus

> **SpanStatus**\<\> = `"open"` \| `"completed"` \| `"aborted"`

Defined in: [classes/diagnostics-collector.js:17](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L17)

#### Type Parameters

| Type Parameter |
| ------ |

## Variables

### NO\_OP\_DIAGNOSTICS

> `const` **NO\_OP\_DIAGNOSTICS**: [`NoOpDiagnostics`](#noopdiagnostics)

Defined in: [classes/diagnostics-collector.js:1019](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/diagnostics-collector.js#L1019)

A no-op collector that does nothing.
Use this when diagnostics are disabled to avoid null checks.

#### Example

```javascript
const diagnostics = options.diagnostics ?? NO_OP_DIAGNOSTICS;
const span = diagnostics.startSpan('operation'); // No-op if disabled
```
