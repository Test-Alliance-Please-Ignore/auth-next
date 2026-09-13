import { describe, expect, it } from 'vitest'

import { ExpiryAlarmQueue } from '../src'

type StoredValue = Record<string, unknown>

class FakeStorage {
	private readonly values = new Map<string, StoredValue>()
	private alarmAt: number | null = null
	shouldFailAlarmWrites = false

	async get<T>(key: string): Promise<T | undefined> {
		const value = this.values.get(key)
		return value === undefined ? undefined : structuredClone(value) as T
	}

	async list<T>({ prefix }: { prefix?: string } = {}): Promise<Map<string, T>> {
		return new Map(
			[...this.values.entries()]
				.filter(([key]) => !prefix || key.startsWith(prefix))
				.map(([key, value]) => [key, structuredClone(value) as T])
		)
	}

	async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
		if (typeof keyOrEntries === 'string') {
			this.values.set(keyOrEntries, structuredClone(value) as StoredValue)
			return
		}
		for (const [key, entry] of Object.entries(keyOrEntries)) {
			this.values.set(key, structuredClone(entry) as StoredValue)
		}
	}

	async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
		if (Array.isArray(keyOrKeys)) {
			let count = 0
			for (const key of keyOrKeys) if (this.values.delete(key)) count++
			return count
		}
		return this.values.delete(keyOrKeys)
	}

	async transaction<T>(callback: (transaction: this) => Promise<T>): Promise<T> {
		return callback(this)
	}

	async setAlarm(value: number | Date): Promise<void> {
		if (this.shouldFailAlarmWrites) throw new Error('alarm write failed')
		this.alarmAt = value instanceof Date ? value.getTime() : value
	}

	async deleteAlarm(): Promise<void> {
		this.alarmAt = null
	}

	get scheduledAlarm(): number | null {
		return this.alarmAt
	}
}

function createQueue(storage: FakeStorage, now = 1_000) {
	return new ExpiryAlarmQueue(storage as unknown as DurableObjectStorage, {
		prefix: 'test:',
		now: () => now,
		random: () => 0.5,
	})
}

describe('ExpiryAlarmQueue', () => {
	it('arms the earliest item and replaces the full list atomically', async () => {
		const storage = new FakeStorage()
		const queue = createQueue(storage)

		await queue.replace([
			{ id: 'later', dueAt: 5_000, payload: { value: 2 } },
			{ id: 'first', dueAt: 2_000, payload: { value: 1 } },
		])

		expect(storage.scheduledAlarm).toBe(2_000)
		expect((await queue.list()).map((entry) => entry.id)).toEqual(['first', 'later'])

		await queue.replace([{ id: 'new', dueAt: 9_000, payload: { value: 3 } }])
		expect(storage.scheduledAlarm).toBe(9_000)
		expect((await queue.list()).map((entry) => entry.id)).toEqual(['new'])
	})

	it('claims due work and removes it after completion', async () => {
		const storage = new FakeStorage()
		const handled: string[] = []
		const queue = new ExpiryAlarmQueue(storage as unknown as DurableObjectStorage, {
			prefix: 'test:',
			now: () => 10_000,
			handler: async ({ id, claimId }) => {
				handled.push(`${id}:${claimId}`)
				return { action: 'complete' }
			},
		})

		await queue.upsert('due', 9_000, { value: true })
		const result = await queue.alarm()

		expect(result).toMatchObject({ claimed: 1, completed: 1 })
		expect(handled).toHaveLength(1)
		expect(await queue.list()).toEqual([])
	})

	it('generates an opaque ID when scheduling an item', async () => {
		const storage = new FakeStorage()
		const queue = createQueue(storage)
		const result = await queue.schedule(5_000, { value: 'generated' })

		expect(result.id).toMatch(/^[0-9a-f-]{36}$/)
		expect(result).toMatchObject({ generation: 1, dueAt: 5_000 })
		expect(await queue.list()).toEqual([
			expect.objectContaining({ id: result.id, payload: { value: 'generated' } }),
		])
	})

	it('initializes by repairing a persisted list and its alarm', async () => {
		const storage = new FakeStorage()
		const queue = createQueue(storage)
		await queue.upsert('persisted', 5_000, {})
		await storage.deleteAlarm()

		await queue.initialize()

		expect(storage.scheduledAlarm).toBe(5_000)
	})

	it('rejects duplicate IDs in a full replacement', async () => {
		const storage = new FakeStorage()
		const queue = createQueue(storage)

		await expect(
			queue.replace([
				{ id: 'duplicate', dueAt: 5_000, payload: 1 },
				{ id: 'duplicate', dueAt: 6_000, payload: 2 },
			])
		).rejects.toThrow('duplicate item ids')
	})

	it('cancels an item and removes the alarm when the list becomes empty', async () => {
		const storage = new FakeStorage()
		const queue = createQueue(storage)
		await queue.upsert('cancelled', 5_000, {})

		expect(await queue.cancel('cancelled')).toBe(true)
		expect(await queue.cancel('cancelled')).toBe(false)
		expect(await queue.list()).toEqual([])
		expect(storage.scheduledAlarm).toBeNull()
	})

	it('discards past-due items when configured to do so', async () => {
		const storage = new FakeStorage()
		const queue = new ExpiryAlarmQueue(storage as unknown as DurableObjectStorage, {
			prefix: 'test:',
			now: () => 10_000,
			pastDue: 'discard',
		})

		await queue.upsert('past', 9_000, {})

		expect(await queue.list()).toEqual([])
		expect(storage.scheduledAlarm).toBeNull()
	})

	it('supports explicit rescheduling and discarding from the handler', async () => {
		const storage = new FakeStorage()
		let calls = 0
		const queue = new ExpiryAlarmQueue(storage as unknown as DurableObjectStorage, {
			prefix: 'test:',
			now: () => 10_000,
			handler: async ({ id }) => {
				calls++
				return id === 'reschedule'
					? { action: 'reschedule', dueAt: 20_000, payload: { updated: true } }
					: { action: 'discard' }
			},
		})

		await queue.upsert('reschedule', 9_000, {})
		await queue.upsert('discard', 9_000, {})
		const result = await queue.alarm()

		expect(calls).toBe(2)
		expect(result).toMatchObject({ rescheduled: 1, discarded: 1 })
		expect(await queue.list()).toEqual([
			expect.objectContaining({ id: 'reschedule', dueAt: 20_000, payload: { updated: true } }),
		])
	})

	it('supports explicit retry delays from the handler', async () => {
		const storage = new FakeStorage()
		const queue = new ExpiryAlarmQueue(storage as unknown as DurableObjectStorage, {
			prefix: 'test:',
			now: () => 10_000,
			handler: async () => ({ action: 'retry', delayMs: 7_000, payload: { retried: true } }),
		})

		await queue.upsert('explicit-retry', 9_000, {})
		const result = await queue.alarm()

		expect(result.retried).toBe(1)
		expect(await queue.list()).toEqual([
			expect.objectContaining({ id: 'explicit-retry', dueAt: 17_000, payload: { retried: true } }),
		])
	})

	it('honors the batch limit and continues remaining due work', async () => {
		const storage = new FakeStorage()
		const handled: string[] = []
		const queue = new ExpiryAlarmQueue(storage as unknown as DurableObjectStorage, {
			prefix: 'test:',
			batchSize: 2,
			now: () => 10_000,
			handler: async ({ id }) => {
				handled.push(id)
				return { action: 'complete' }
			},
		})

		await queue.replace([
			{ id: 'a', dueAt: 9_000, payload: {} },
			{ id: 'b', dueAt: 9_000, payload: {} },
			{ id: 'c', dueAt: 9_000, payload: {} },
		])
		const first = await queue.alarm()

		expect(first.claimed).toBe(2)
		expect(handled).toEqual(['a', 'b'])
		expect(storage.scheduledAlarm).toBe(11_000)
		await queue.alarm()
		expect(handled).toEqual(['a', 'b', 'c'])
	})

	it('retries handler failures with configured backoff', async () => {
		const storage = new FakeStorage()
		const queue = new ExpiryAlarmQueue(storage as unknown as DurableObjectStorage, {
			prefix: 'test:',
			now: () => 10_000,
			retry: { maxAttempts: 2, baseDelayMs: 2_000, maxDelayMs: 10_000 },
			handler: async () => {
				throw new Error('temporary failure')
			},
		})

		await queue.upsert('retry', 9_000, {})
		const result = await queue.alarm()

		expect(result.retried).toBe(1)
		expect((await queue.list())[0]).toMatchObject({ dueAt: 12_000, attempt: 1, lastError: 'temporary failure' })
	})

	it('retains terminal failures for inspection by default', async () => {
		const storage = new FakeStorage()
		const queue = new ExpiryAlarmQueue(storage as unknown as DurableObjectStorage, {
			prefix: 'test:',
			now: () => 10_000,
			retry: { maxAttempts: 0 },
			handler: async () => {
				throw new Error('permanent failure')
			},
		})

		await queue.upsert('failed', 9_000, {})
		const result = await queue.alarm()

		expect(result.failed).toBe(1)
		expect(await queue.list()).toEqual([])
		expect(await queue.list({ includeFailed: true })).toEqual([
			expect.objectContaining({ id: 'failed', lastError: 'permanent failure' }),
		])
		expect(storage.scheduledAlarm).toBeNull()
	})

	it('can remove terminal failures instead of retaining them', async () => {
		const storage = new FakeStorage()
		const queue = new ExpiryAlarmQueue(storage as unknown as DurableObjectStorage, {
			prefix: 'test:',
			now: () => 10_000,
			retry: { maxAttempts: 0, onExhausted: 'remove' },
			handler: async () => {
				throw new Error('permanent failure')
			},
		})

		await queue.upsert('failed', 9_000, {})
		await queue.alarm()

		expect(await queue.list({ includeFailed: true })).toEqual([])
	})

	it('repairs a failed alarm write on the next reconciliation', async () => {
		const storage = new FakeStorage()
		const queue = createQueue(storage)
		storage.shouldFailAlarmWrites = true

		await expect(queue.upsert('repair', 5_000, {})).rejects.toThrow('alarm write failed')
		storage.shouldFailAlarmWrites = false
		await queue.repair()

		expect(storage.scheduledAlarm).toBe(5_000)
	})

	it('releases expired leases and re-arms the item for recovery', async () => {
		let now = 10_000
		const storage = new FakeStorage()
		let releaseHandler: (() => void) | undefined
		const handlerReady = new Promise<void>((resolve) => {
			releaseHandler = resolve
		})
		const queue = new ExpiryAlarmQueue(storage as unknown as DurableObjectStorage, {
			prefix: 'test:',
			now: () => now,
			leaseMs: 1_000,
			handler: async () => {
				await handlerReady
				return { action: 'complete' }
			},
		})

		await queue.upsert('leased', 9_000, {})
		const alarm = queue.alarm()
		await new Promise((resolve) => setTimeout(resolve, 0))
		now = 12_000
		await queue.repair()
		expect(await queue.list({ includeFailed: true })).toEqual([
			expect.objectContaining({ id: 'leased', dueAt: 9_000 }),
		])
		releaseHandler?.()
		await alarm

		expect(await queue.list()).toEqual([expect.objectContaining({ id: 'leased', dueAt: 9_000 })])
	})

	it('does not allow a stale handler result to complete a replacement', async () => {
		const storage = new FakeStorage()
		let resolveHandler: (() => void) | undefined
		const handlerStarted = new Promise<void>((resolve) => {
			resolveHandler = resolve
		})
		const queue = new ExpiryAlarmQueue(storage as unknown as DurableObjectStorage, {
			prefix: 'test:',
			now: () => 10_000,
			handler: async () => {
				await handlerStarted
				return { action: 'complete' }
			},
		})

		await queue.upsert('same', 9_000, { version: 1 })
		const alarm = queue.alarm()
		await new Promise((resolve) => setTimeout(resolve, 0))
		await queue.upsert('same', 20_000, { version: 2 })
		resolveHandler?.()
		await alarm

		expect(await queue.list()).toEqual([
			expect.objectContaining({ id: 'same', dueAt: 20_000, payload: { version: 2 } }),
		])
	})
})
