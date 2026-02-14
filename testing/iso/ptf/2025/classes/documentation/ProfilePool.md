[@conres.io/test-form-generator](README.md) / ProfilePool

# ProfilePool

Profile Pool

Centralized management of ICC profile buffers with SharedArrayBuffer support
for zero-copy sharing between main thread and workers. Provides automatic
cleanup via FinalizationRegistry and LRU eviction under memory pressure.

## Classes

### ProfilePool

Defined in: [classes/profile-pool.js:100](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L100)

Manages ICC profile buffers with optional SharedArrayBuffer support.

Features:
- SharedArrayBuffer for zero-copy worker sharing (when available)
- LRU eviction when memory limits are exceeded
- FinalizationRegistry for automatic cleanup when consumers are GC'd
- Deduplication of concurrent loads for the same profile
- FNV-1a hashing for ArrayBuffer key generation

#### Example

```javascript
const pool = new ProfilePool({ maxProfiles: 32, maxMemoryBytes: 64 * 1024 * 1024 });

// Load a profile (creates SharedArrayBuffer if supported)
const { buffer, isShared } = await pool.getProfile('/profiles/cmyk.icc');

// Register consumer for automatic cleanup
pool.registerConsumer(myConverter, '/profiles/cmyk.icc');

// When done
pool.dispose();
```

#### Constructors

##### Constructor

> **new ProfilePool**(`options?`: [`ProfilePoolOptions`](#profilepooloptions)): [`ProfilePool`](#profilepool)

Defined in: [classes/profile-pool.js:139](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L139)

Creates a new ProfilePool instance.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | [`ProfilePoolOptions`](#profilepooloptions) | Configuration options |

###### Returns

[`ProfilePool`](#profilepool)

###### Example

```javascript
const pool = new ProfilePool({
    maxProfiles: 32,           // Max cached profiles (default: 32)
    maxMemoryBytes: 67108864,  // Max memory in bytes (default: 64MB)
});
```

#### Accessors

##### stats

###### Get Signature

> **get** **stats**(): \{ `maxMemoryBytes`: `number`; `memoryBytes`: `number`; `pendingLoads`: `number`; `profileCount`: `number`; `supportsSharedBuffers`: `boolean`; \}

Defined in: [classes/profile-pool.js:462](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L462)

Gets current pool statistics.

###### Example

```javascript
console.log(pool.stats);
// { profileCount: 5, memoryBytes: 1234567, maxMemoryBytes: 67108864, ... }
```

###### Returns

\{ `maxMemoryBytes`: `number`; `memoryBytes`: `number`; `pendingLoads`: `number`; `profileCount`: `number`; `supportsSharedBuffers`: `boolean`; \}

Pool statistics

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `maxMemoryBytes` | `number` | [classes/profile-pool.js:452](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L452) |
| `memoryBytes` | `number` | [classes/profile-pool.js:451](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L451) |
| `pendingLoads` | `number` | [classes/profile-pool.js:453](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L453) |
| `profileCount` | `number` | [classes/profile-pool.js:450](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L450) |
| `supportsSharedBuffers` | `boolean` | [classes/profile-pool.js:454](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L454) |

##### supportsSharedBuffers

###### Get Signature

> **get** `static` **supportsSharedBuffers**(): `boolean`

Defined in: [classes/profile-pool.js:159](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L159)

Whether SharedArrayBuffer is available for zero-copy sharing.

###### Returns

`boolean`

#### Methods

##### dispose()

> **dispose**(): `void`

Defined in: [classes/profile-pool.js:436](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L436)

Releases all resources held by this pool.

Clears all cached profiles and pending loads.

###### Returns

`void`

##### getProfile()

> **getProfile**(`source`: `string` \| `ArrayBuffer`): `Promise`\<[`ProfileLookupResult`](#profilelookupresult)\>

Defined in: [classes/profile-pool.js:185](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L185)

Loads or retrieves a cached profile.

If the profile is already cached, increments its reference count
and updates last accessed time. If not cached, loads the profile
and creates a SharedArrayBuffer (if supported).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `source` | `string` \| `ArrayBuffer` | URL or raw profile data |

###### Returns

`Promise`\<[`ProfileLookupResult`](#profilelookupresult)\>

Profile buffer and shared status

###### Example

```javascript
// Load from URL
const { buffer, isShared } = await pool.getProfile('/profiles/cmyk.icc');

// Load from ArrayBuffer
const { buffer, isShared } = await pool.getProfile(rawProfileData);
```

##### hasProfile()

> **hasProfile**(`source`: `string` \| `ArrayBuffer`): `boolean`

Defined in: [classes/profile-pool.js:225](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L225)

Checks if a profile is cached.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `source` | `string` \| `ArrayBuffer` | URL or raw profile data |

###### Returns

`boolean`

True if profile is cached

##### registerConsumer()

> **registerConsumer**(`consumer`: `any`, `source`: `string` \| `ArrayBuffer`): `void`

Defined in: [classes/profile-pool.js:245](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L245)

Registers a consumer for automatic cleanup.

When the consumer object is garbage collected, the profile's
reference count is automatically decremented.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `consumer` | `any` | Object that uses the profile (weak reference target) |
| `source` | `string` \| `ArrayBuffer` | Profile source for key lookup |

###### Returns

`void`

###### Example

```javascript
const converter = new MyConverter(config);
pool.registerConsumer(converter, config.destinationProfile);
// When converter is GC'd, profile refCount decrements automatically
```

##### releaseProfile()

> **releaseProfile**(`source`: `string` \| `ArrayBuffer`): `void`

Defined in: [classes/profile-pool.js:261](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L261)

Explicitly releases a profile reference.

Use this when the consumer lifetime is managed manually
rather than relying on FinalizationRegistry.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `source` | `string` \| `ArrayBuffer` | Profile source |

###### Returns

`void`

## Type Aliases

### PooledProfile

> **PooledProfile**\<\> = \{ `buffer`: `SharedArrayBuffer` \| `ArrayBuffer`; `byteLength`: `number`; `isShared`: `boolean`; `lastAccessed`: `number`; `profileHandle?`: `any`; `refCount`: `number`; \}

Defined in: [classes/profile-pool.js:53](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L53)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="buffer"></a> `buffer` | `SharedArrayBuffer` \| `ArrayBuffer` | [classes/profile-pool.js:47](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L47) |
| <a id="bytelength"></a> `byteLength` | `number` | [classes/profile-pool.js:52](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L52) |
| <a id="isshared"></a> `isShared` | `boolean` | [classes/profile-pool.js:48](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L48) |
| <a id="lastaccessed"></a> `lastAccessed` | `number` | [classes/profile-pool.js:51](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L51) |
| <a id="profilehandle"></a> `profileHandle?` | `any` | [classes/profile-pool.js:50](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L50) |
| <a id="refcount"></a> `refCount` | `number` | [classes/profile-pool.js:49](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L49) |

***

### ProfileLookupResult

> **ProfileLookupResult**\<\> = \{ `buffer`: `SharedArrayBuffer` \| `ArrayBuffer`; `isShared`: `boolean`; \}

Defined in: [classes/profile-pool.js:69](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L69)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="buffer-1"></a> `buffer` | `SharedArrayBuffer` \| `ArrayBuffer` | [classes/profile-pool.js:67](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L67) |
| <a id="isshared-1"></a> `isShared` | `boolean` | [classes/profile-pool.js:68](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L68) |

***

### ProfilePoolOptions

> **ProfilePoolOptions**\<\> = \{ `maxMemoryBytes?`: `number`; `maxProfiles?`: `number`; \}

Defined in: [classes/profile-pool.js:61](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L61)

#### Type Parameters

| Type Parameter |
| ------ |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="maxmemorybytes"></a> `maxMemoryBytes?` | `number` | [classes/profile-pool.js:60](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L60) |
| <a id="maxprofiles"></a> `maxProfiles?` | `number` | [classes/profile-pool.js:59](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/profile-pool.js#L59) |
