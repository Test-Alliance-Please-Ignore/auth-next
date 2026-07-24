import { describe, expect, it, vi } from 'vitest'

import { structureMiningExtractions } from '../../../db/schema'

const mocks = vi.hoisted(() => {
	const findMany = vi.fn()
	const onConflictDoUpdate = vi.fn()
	const values = vi.fn(() => ({ onConflictDoUpdate }))
	const insert = vi.fn(() => ({ values }))
	const deleteWhere = vi.fn().mockResolvedValue(undefined)
	const deleteMock = vi.fn(() => ({ where: deleteWhere }))
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
		deleteWhere,
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
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn().mockResolvedValue(undefined),
			})),
		})),
		delete: mocks.deleteMock,
	})),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: mocks.getStub,
}))

import { EveCorporationDataDO } from '../../../durable-object'

describe('storeMiningExtractions', () => {
	it('stamps mining snapshot rows with attempt and success timestamps on insert', async () => {
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
				EVE_TOKEN_STORE: {} as never,
			} as never
		)

		await doInstance.storeMiningExtractions('corp-1', [
			{
				structure_id: 'structure-1',
				moon_id: 'moon-1',
				extraction_start_time: '2026-07-01T00:00:00.000Z',
				chunk_arrival_time: '2026-07-02T00:00:00.000Z',
				natural_decay_time: '2026-07-03T00:00:00.000Z',
				raw: {},
			},
		] as never)

		expect(mocks.resolveMoonGeographyByIds).not.toHaveBeenCalled()
		expect(mocks.insert).toHaveBeenCalled()
		expect(mocks.values).toHaveBeenCalledWith([
			expect.objectContaining({
				structureId: 'structure-1',
				lastAttemptedSyncAt: expect.any(Date),
				lastSyncedAt: expect.any(Date),
				sourceSyncAt: expect.any(Date),
			}),
		])
	})

	it('clears stale mining extraction rows when the ESI extraction list is empty', async () => {
		vi.clearAllMocks()
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
				EVE_TOKEN_STORE: {} as never,
			} as never
		)

		await doInstance.storeMiningExtractions('corp-1', [])

		expect(mocks.deleteMock).toHaveBeenCalledWith(structureMiningExtractions)
		expect(mocks.values).not.toHaveBeenCalled()
	})
})
