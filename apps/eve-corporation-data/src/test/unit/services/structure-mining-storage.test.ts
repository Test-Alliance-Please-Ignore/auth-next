import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
	const findMany = vi.fn()
	const onConflictDoUpdate = vi.fn()
	const values = vi.fn(() => ({ onConflictDoUpdate }))
	const insert = vi.fn(() => ({ values }))
	const deleteMock = vi.fn()
	const resolveMoonGeographyByIds = vi.fn()
	const getStub = vi.fn(() => ({
		resolveMoonGeographyByIds,
	}))

	return {
		findMany,
		onConflictDoUpdate,
		values,
		insert,
		deleteMock,
		resolveMoonGeographyByIds,
		getStub,
	}
})

vi.mock('../../../db', () => ({
	createDb: vi.fn(() => ({
			query: {
				structureMiningExtractions: {
					findMany: mocks.findMany,
				},
			},
		insert: mocks.insert,
		delete: mocks.deleteMock,
	})),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: mocks.getStub,
}))

import { EveCorporationDataDO } from '../../../durable-object'

describe('storeMiningExtractions', () => {
	it('preserves the last known mining snapshot when the extraction pull is empty', async () => {
		mocks.findMany.mockResolvedValue([
			{
				structureId: 'structure-1',
				corporationId: 'corp-1',
				moonId: 'moon-1',
				moonName: 'Old Moon',
				planetId: 'planet-1',
				planetName: 'Old Planet',
				systemId: 'system-1',
				systemName: 'Old System',
				extractionStartTime: new Date('2026-07-01T00:00:00.000Z'),
				chunkArrivalTime: new Date('2026-07-02T00:00:00.000Z'),
				naturalDecayTime: new Date('2026-07-03T00:00:00.000Z'),
				sourceSyncAt: new Date('2026-07-01T00:00:00.000Z'),
				lastSyncedAt: new Date('2026-07-01T00:00:00.000Z'),
				updatedAt: new Date('2026-07-01T00:00:00.000Z'),
			},
		])

		const doInstance = new EveCorporationDataDO(
			{} as DurableObjectState,
			{
				DATABASE_URL: 'postgres://example',
				UNIVERSE: {} as never,
			} as never
		)

		await doInstance.storeMiningExtractions('corp-1', [])

		expect(mocks.resolveMoonGeographyByIds).not.toHaveBeenCalled()
		expect(mocks.insert).not.toHaveBeenCalled()
		expect(mocks.deleteMock).not.toHaveBeenCalled()
	})
})
