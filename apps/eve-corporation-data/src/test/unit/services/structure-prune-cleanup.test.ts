import { describe, expect, it, vi } from 'vitest'

import {
	corporationStructures,
	structureMoonDrills,
	structureSkyhooks,
	structureSovereigntyHubs,
} from '../../../db/schema'
import { EveCorporationDataDO } from '../../../durable-object'

const SOVEREIGNTY_HUB_TYPE_ID = '32458'

const mocks = vi.hoisted(() => {
	const findMany = vi.fn()
	const onConflictDoUpdate = vi.fn()
	const values = vi.fn(() => ({ onConflictDoUpdate }))
	const insert = vi.fn(() => ({ values }))
	const deleteMock = vi.fn()
	const resolvePlanetGeographyByIds = vi.fn()
	const resolveSolarSystemsByIds = vi.fn()
	const resolveRegionsByIds = vi.fn()
	const resolveNearestMoonGeographyBySystemPosition = vi.fn()
	const getStub = vi.fn(() => ({
		resolvePlanetGeographyByIds,
		resolveSolarSystemsByIds,
		resolveRegionsByIds,
		resolveNearestMoonGeographyBySystemPosition,
	}))

	return {
		findMany,
		onConflictDoUpdate,
		values,
		insert,
		deleteMock,
		resolvePlanetGeographyByIds,
		resolveSolarSystemsByIds,
		resolveRegionsByIds,
		resolveNearestMoonGeographyBySystemPosition,
		getStub,
	}
})

vi.mock('@repo/do-utils', () => ({
	getStub: mocks.getStub,
}))

function makeDb() {
	const where = vi.fn().mockResolvedValue(undefined)
	const deleteMock = vi.fn(() => ({ where }))
	const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
	const values = vi.fn((rows) => ({ onConflictDoUpdate, rows }))
	const insert = vi.fn(() => ({ values }))
	const corporationStructuresFindMany = vi
		.fn()
		.mockResolvedValue([{ structureId: 'stale-structure' }])
	const structureSkyhooksFindMany = vi
		.fn()
		.mockResolvedValue([{ structureId: 'stale-structure' }])
	const structureMiningExtractionsFindMany = vi
		.fn()
		.mockResolvedValue([{ structureId: 'stale-structure' }])
	const structureMoonDrillsFindMany = vi
		.fn()
		.mockResolvedValue([{ structureId: 'stale-structure' }])
	const structureSovereigntyHubsFindMany = vi.fn().mockResolvedValue([])

	return {
		query: {
			corporationStructures: {
				findMany: corporationStructuresFindMany,
			},
			structureSkyhooks: {
				findMany: structureSkyhooksFindMany,
			},
			structureMiningExtractions: {
				findMany: structureMiningExtractionsFindMany,
			},
			structureMoonDrills: {
				findMany: structureMoonDrillsFindMany,
			},
			structureSovereigntyHubs: {
				findMany: structureSovereigntyHubsFindMany,
			},
		},
		delete: deleteMock,
		insert,
		_where: where,
		_values: values,
	}
}

function createDoInstance(db: ReturnType<typeof makeDb>) {
	const instance = new EveCorporationDataDO(
		{} as DurableObjectState,
		{
			DATABASE_URL: 'postgres://example',
			UNIVERSE: {} as never,
			EVE_TOKEN_STORE: {} as never,
		} as never
	)

	;(instance as any).getDb = () => db

	return instance
}

describe('structure prune cleanup', () => {
	it('prunes stale skyhook and mining snapshots when structures disappear from a successful sync', async () => {
		const db = makeDb()
		const instance = createDoInstance(db)

		;(instance as any).hydrateStructureRows = vi.fn().mockResolvedValue([
			{
				corporationId: 'corp-1',
				structureId: 'structure-1',
				name: 'Structure One',
				typeId: '35832',
				typeName: 'Astrahus',
				systemId: '30000142',
				systemName: 'Jita',
				regionId: '10000002',
				regionName: 'The Forge',
				profileId: 'profile-1',
				fuelExpires: null,
				fuelAmount: null,
				nextReinforceApply: null,
				nextReinforceHour: null,
				reinforceHour: null,
				state: 'online',
				stateTimerEnd: null,
				stateTimerStart: null,
				unanchorsAt: null,
				lowPower: false,
				syncStatus: 'ok',
				syncFailureReason: null,
				lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
				services: null,
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
		])

		await instance.storeStructures('corp-1', [
			{
				structure_id: 'structure-1',
				type_id: '35832',
				system_id: '30000142',
				profile_id: 'profile-1',
				state: 'online',
			},
		])

		expect(db.delete).toHaveBeenCalledTimes(2)
		expect(db.delete).toHaveBeenNthCalledWith(1, corporationStructures)
		expect(db.delete).toHaveBeenNthCalledWith(2, structureMoonDrills)
		expect(db._where).toHaveBeenCalledTimes(2)
	})

	it('clears all structure-side rows when the successful sync returns no structures', async () => {
		const db = makeDb()
		const instance = createDoInstance(db)

		;(instance as any).hydrateStructureRows = vi.fn().mockResolvedValue([])

		await instance.storeStructures('corp-1', [])

		expect(db.delete).toHaveBeenCalledTimes(2)
		expect(db.delete).toHaveBeenNthCalledWith(1, corporationStructures)
		expect(db.delete).toHaveBeenNthCalledWith(2, structureMoonDrills)
		expect(db._where).toHaveBeenCalledTimes(2)
	})

	it('clears moon drill rows when the moon-drill synchronization returns no structures', async () => {
		const db = makeDb()
		const instance = createDoInstance(db)

		await (instance as any).storeMoonDrills('corp-1', [])

		expect(db.delete).toHaveBeenCalledTimes(1)
		expect(db.delete).toHaveBeenCalledWith(structureMoonDrills)
		expect(db._where).toHaveBeenCalledTimes(1)
	})

	it('preserves existing moon drill snapshots when synthesis fails for a live structure', async () => {
		const db = makeDb()
		const instance = createDoInstance(db)

		const resolveNearestMoonGeographyBySystemPosition = vi.fn().mockResolvedValue(null)
		mocks.getStub.mockReturnValue({
			resolvePlanetGeographyByIds: vi.fn(),
			resolveSolarSystemsByIds: vi.fn(),
			resolveRegionsByIds: vi.fn(),
			resolveNearestMoonGeographyBySystemPosition,
		})

		;(instance as any).hydrateStructureRows = vi.fn().mockResolvedValue([
			{
				corporationId: 'corp-1',
				structureId: 'moon-drill-1',
				name: null,
				typeId: '81826',
				typeName: 'Metenox Moon Drill',
				systemId: '30000142',
				systemName: 'Jita',
				regionId: '10000002',
				regionName: 'The Forge',
				profileId: 'profile-1',
				fuelExpires: null,
				fuelAmount: null,
				nextReinforceApply: null,
				nextReinforceHour: null,
				reinforceHour: null,
				state: 'online',
				stateTimerEnd: null,
				stateTimerStart: null,
				unanchorsAt: null,
				lowPower: false,
				syncStatus: 'warning',
				syncFailureReason: 'Moon drill snapshot has not been ingested yet for this structure.',
				lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
				services: null,
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
		])

		await (instance as any).storeMoonDrills('corp-1', [
			{
				structureId: 'moon-drill-1',
				corporationId: 'corp-1',
				typeId: '81826',
				typeName: 'Metenox Moon Drill',
				systemId: '30000142',
				systemName: 'Jita',
				structureInfo: {
					position: {
						x: 1,
						y: 2,
						z: 3,
					},
				},
			},
		])

		expect(resolveNearestMoonGeographyBySystemPosition).toHaveBeenCalledTimes(1)
		expect(db.insert).not.toHaveBeenCalled()
		expect(db.delete).not.toHaveBeenCalled()
	})

	it('stores sovereignty hub names using resolved solar system names', async () => {
		const db = makeDb()
		const instance = createDoInstance(db)

		await instance.storeSovereigntyHubs('corp-1', [
			{
				structure_id: 'hub-1',
				corporation_id: 'corp-1',
				system_id: '30000142',
				system_name: 'Jita',
				type_id: SOVEREIGNTY_HUB_TYPE_ID,
				name: 'Jita',
				fuel_access_list_id: null,
				controller_alliance_id: null,
				reagent_bay: {
					last_updated: '2026-07-12T19:36:46.834Z',
					reagents: [],
				},
				resources: {
					power: { allocated: 0, available: 0 },
					workforce: { allocated: 0, available: 0 },
				},
				upgrades: [],
				vulnerability_window: null,
				workforce_transport: {
					configuration: {
						import: {
							sources: [{ solar_system_id: 30000142 }, { solar_system_id: 30000143 }],
						},
					},
					state: {
						import: {
							sources: [
								{ solar_system_id: 30000142, amount: 12 },
								{ solar_system_id: 30000143, amount: 34 },
							],
						},
					},
				},
				raw: { detail: { id: 1 } },
			} as never,
		])

		expect(db._values).toHaveBeenCalled()
		expect(db._values.mock.calls[0][0][0]).toMatchObject({
			systemName: 'Jita',
			name: 'Jita',
			workforceTransport: {
				configuration: {
					mode: 'import',
					systems: [
						{ solarSystemId: '30000142', amount: null },
						{ solarSystemId: '30000143', amount: null },
					],
				},
				state: {
					mode: 'import',
					systems: [
						{ solarSystemId: '30000142', amount: 12 },
						{ solarSystemId: '30000143', amount: 34 },
					],
				},
			},
		})
		expect(db.delete).not.toHaveBeenCalled()
	})

	it('preserves existing skyhook snapshots when upstream skyhooks cannot be synthesized', async () => {
		const db = makeDb()
		db.query.corporationStructures.findMany = vi.fn().mockResolvedValue([])
		db.query.structureSkyhooks.findMany = vi.fn().mockResolvedValue([
			{
				structureId: 'skyhook-1',
				planetName: 'Planet One',
				systemName: 'Jita',
				name: 'Skyhook One',
			},
		])

		mocks.getStub.mockReturnValue({
			resolvePlanetGeographyByIds: vi.fn().mockResolvedValue({
				401: null,
			}),
			resolveSolarSystemsByIds: vi.fn().mockResolvedValue({}),
			resolveRegionsByIds: vi.fn().mockResolvedValue({}),
			resolveNearestMoonGeographyBySystemPosition: vi.fn().mockResolvedValue(null),
		})

		const instance = createDoInstance(db)

		await instance.storeSkyhooks('corp-1', [
			{
				structure_id: 'skyhook-1',
				planet_id: '401',
				corporation_id: 'corp-1',
				state: 'active',
				is_active: true,
				effective_workforce: 0,
				reagents: [],
				reinforcement_timer: null,
				theft_vulnerability: null,
				is_raidable: false,
				becomes_raidable_at: null,
				vulnerable_at: null,
				raw: { id: 1 },
			} as never,
		])

		expect(db.delete).not.toHaveBeenCalled()
		expect(db.insert).not.toHaveBeenCalled()
	})

	it('returns the number of skyhooks pruned when the upstream listing is empty', async () => {
		const db = makeDb()
		db.query.corporationStructures.findMany = vi.fn().mockResolvedValue([])
		db.query.structureSkyhooks.findMany = vi.fn().mockResolvedValue([
			{
				structureId: 'skyhook-1',
				planetName: 'Planet One',
				systemName: 'Jita',
				name: 'Skyhook One',
			},
		])

		mocks.getStub.mockReturnValue({
			resolvePlanetGeographyByIds: vi.fn().mockResolvedValue({}),
			resolveSolarSystemsByIds: vi.fn().mockResolvedValue({}),
			resolveRegionsByIds: vi.fn().mockResolvedValue({}),
			resolveNearestMoonGeographyBySystemPosition: vi.fn().mockResolvedValue(null),
		})

		const instance = createDoInstance(db)

		await expect(instance.storeSkyhooks('corp-1', [])).resolves.toEqual({ prunedCount: 1 })
		expect(db.delete).toHaveBeenCalledTimes(2)
		expect(db.delete).toHaveBeenNthCalledWith(1, structureSkyhooks)
		expect(db.delete).toHaveBeenNthCalledWith(2, corporationStructures)
	})
})
