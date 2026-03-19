[@conres.io/test-form-generator](README.md) / WorkerPoolEntrypoint

# WorkerPoolEntrypoint

Worker Pool Entrypoint

Worker script for classes/worker-pool.js that uses ColorConverter classes
for consistent behavior between main thread and workers.

Self-contained in classes/ - no dependencies on services/.

## Type Aliases

### ModuleRecord

> **ModuleRecord**\<`T`\> = \{ `location`: `string`; `promise`: `Promise`\<`T`\>; `specifier`: `string`; \}

Defined in: [classes/worker-pool-entrypoint.js:30](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool-entrypoint.js#L30)

#### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| `T` |  |

#### Type Declaration

| Name | Type | Defined in |
| ------ | ------ | ------ |
| <a id="location"></a> `location` | `string` | [classes/worker-pool-entrypoint.js:28](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool-entrypoint.js#L28) |
| <a id="promise"></a> `promise` | `Promise`\<`T`\> | [classes/worker-pool-entrypoint.js:29](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool-entrypoint.js#L29) |
| <a id="specifier"></a> `specifier` | `string` | [classes/worker-pool-entrypoint.js:27](https://github.com/conres/conres.io/blob/a6407538f66706a285e3113508f619671a966fee/testing/iso/ptf/2025/classes/worker-pool-entrypoint.js#L27) |
