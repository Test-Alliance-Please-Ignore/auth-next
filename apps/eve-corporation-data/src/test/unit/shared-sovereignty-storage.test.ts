import { describe, expect, it, vi } from 'vitest'

import { EveCorporationDataDO } from '../../durable-object'

type StoredValue = unknown

function createStorage() {
	const values = new Map<string, StoredValue>()
	const storage = {
		get: vi.fn(async (keyOrKeys: string | string[]) => {
			if (Array.isArray(keyOrKeys)) {
				return new Map(
					keyOrKeys.filter((key) => values.has(key)).map((key) => [key, values.get(key)])
				)
			}
			return values.get(keyOrKeys)
		}),
		list: vi.fn(
			async ({ prefix }: { prefix: string }) =>
				new Map([...values].filter(([key]) => key.startsWith(prefix)))
		),
		put: vi.fn(async (keyOrEntries: string | Record<string, StoredValue>, value?: StoredValue) => {
			if (typeof keyOrEntries === 'string') {
				values.set(keyOrEntries, value)
				return
			}
			for (const [key, entry] of Object.entries(keyOrEntries)) {
				values.set(key, entry)
			}
		}),
		delete: vi.fn(async (keyOrKeys: string | string[]) => {
			for (const key of Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]) {
				values.delete(key)
			}
		}),
		transaction: vi.fn(async (callback: (transaction: typeof storage) => Promise<void>) =>
			callback(storage)
		),
	}

	return { storage, values }
}

function createDoInstance(storage: ReturnType<typeof createStorage>['storage']) {
	const instance = Object.create(EveCorporationDataDO.prototype) as EveCorporationDataDO
	instance.state = { storage } as never
	return instance
}

describe('shared sovereignty storage', () => {
	it('reads only the requested corporation prefix while preserving full snapshots', async () => {
		const { storage, values } = createStorage()
		values.set('shared:sovereignty-systems:row:legacy-system', { system_id: 'legacy-system' })
		const instance = createDoInstance(storage)
		const systems = [
			{
				system_id: 'system-1',
				claim_type: 'alliance' as const,
				corporation_id: 'corp-1',
			},
			{
				system_id: 'system-2',
				claim_type: 'alliance' as const,
				corporation_id: 'corp-2',
			},
			{
				system_id: 'system-3',
				claim_type: 'unclaimed' as const,
				corporation_id: null,
			},
		]

		await instance.storeSharedSovereigntySystems(systems)

		const corporationSystems = await instance.getSharedSovereigntySystemsForCorporation('corp-1')
		const targetedSystems = await instance.getSharedSovereigntySystemsByIds('corp-1', [
			'system-1',
			'missing-system',
		])
		const snapshot = await instance.getSharedSovereigntySystemsSnapshot()

		expect(corporationSystems).toEqual([systems[0]])
		expect(targetedSystems).toEqual([systems[0]])
		expect(snapshot).toEqual(systems)
		expect(values.has('shared:sovereignty-systems:row:legacy-system')).toBe(false)
		expect(storage.list).toHaveBeenCalledWith({
			prefix: 'shared:sovereignty-systems:row:corporation:corp-1:',
		})
	})
})
