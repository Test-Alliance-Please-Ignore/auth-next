# `@repo/expiry-alarms`

Generic Durable Object alarm-list coordination for logical items with individual due times.

The package is instantiated inside a consumer Durable Object. It stores opaque item IDs, consumer-owned structured-clone payloads, and millisecond timestamps accepted by `DurableObjectStorage.setAlarm()`. It maintains one alarm for the earliest item, supports individual mutation and atomic full-list replacement, and processes bounded due batches.

```ts
import { ExpiryAlarmQueue } from '@repo/expiry-alarms'

const queue = new ExpiryAlarmQueue(state.storage, {
	prefix: 'my-feature:expiry:',
	pastDue: 'process',
	retry: {
		maxAttempts: 3,
		baseDelayMs: 5_000,
		maxDelayMs: 60_000,
	},
	handler: async ({ id, payload }) => {
		await processItem(id, payload)
		return { action: 'complete' }
	},
})

// In the DO constructor, call this from blockConcurrencyWhile.
await queue.initialize()
```

Consumer handlers must be safe to invoke more than once. A handler receives a claim ID, but the claim ID is a fencing token for storage state, not an exactly-once external-effect guarantee. The consumer owns task durability, idempotency, and any authoritative database state.

Use `upsert()` for a known logical ID, `schedule()` when the library should generate an ID, and `cancel()` for individual changes. Use `replace()` when an authoritative source produces a new complete list. Call `repair()` from a bounded low-frequency consumer-owned reconciliation path so a failed alarm write can be repaired even when no alarm is pending.

The package does not create a Durable Object, perform database reconciliation, or persist secrets on behalf of consumers. Payloads should normally be small opaque identifiers or sanitized snapshots; consumers should re-read authoritative state before performing external work.
