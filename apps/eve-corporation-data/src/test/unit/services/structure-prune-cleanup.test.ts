import { describe, expect, it, vi } from 'vitest'

import {
	corporationAssets,
	corporationStructureInventory,
	corporationStructures,
	structureMoonDrills,
	structureMoonGeographies,
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
	withRpcResult: async <T, R>(request: Promise<T>, consume: (result: T) => R | Promise<R>) =>
		consume(await request),
}))

function makeDb() {
	const returning = vi.fn().mockResolvedValue([])
	const where = vi.fn(() => ({ returning }))
	const deleteMock = vi.fn(() => ({ where }))
	const execute = vi.fn().mockResolvedValue({ rows: [] })
	const set = vi.fn(() => ({ where }))
	const update = vi.fn(() => ({ set }))
	const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
	const values = vi.fn((rows) => ({ onConflictDoUpdate, rows }))
	const insert = vi.fn(() => ({ values }))
	const corporationStructuresFindMany = vi
		.fn()
		.mockResolvedValue([{ structureId: 'stale-structure', corporationId: 'corp-1' }])
	const structureSkyhooksFindMany = vi.fn().mockResolvedValue([{ structureId: 'stale-structure' }])
	const structureMiningExtractionsFindMany = vi
		.fn()
		.mockResolvedValue([{ structureId: 'stale-structure' }])
	const structureMoonDrillsFindMany = vi
		.fn()
		.mockResolvedValue([{ structureId: 'stale-structure' }])
	const structureSovereigntySystemsFindMany = vi
		.fn()
		.mockResolvedValue([{ systemId: 'stale-system', systemName: 'Stale Name' }])
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
			structureMoonGeographies: {
				findMany: vi.fn().mockResolvedValue([{ structureId: 'stale-structure' }]),
			},
			structureMoonDrills: {
				findMany: structureMoonDrillsFindMany,
			},
			structureSovereigntySystems: {
				findMany: structureSovereigntySystemsFindMany,
			},
			structureSovereigntyHubs: {
				findMany: structureSovereigntyHubsFindMany,
			},
		},
		delete: deleteMock,
		execute,
		update,
		insert,
		_where: where,
		_returning: returning,
		_set: set,
		_values: values,
		_onConflictDoUpdate: onConflictDoUpdate,
		_execute: execute,
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
	it('stores all live moon drill rows from the corporation structure listing', async () => {
		const db = makeDb()
		const instance = createDoInstance(db)

		db.query.structureMoonDrills.findMany = vi.fn().mockResolvedValue([
			{
				structureId: 'stale-moon',
				updatedAt: new Date('2026-07-22T00:00:00.000Z'),
			},
		])

		await (instance as any).storeMoonDrills('corp-1', [
			{
				structureId: 'moon-1',
				corporationId: 'corp-1',
				typeId: '81826',
				typeName: 'Metenox Moon Drill',
			},
			{
				structureId: 'moon-2',
				corporationId: 'corp-1',
				typeId: '81826',
				typeName: 'Metenox Moon Drill',
			},
		])

		expect(db._values).toHaveBeenCalled()
		expect(
			db._values.mock.calls[0][0].map((row: { structureId: string }) => row.structureId)
		).toEqual(['moon-1', 'moon-2'])
		expect(db.delete).toHaveBeenCalledWith(structureMoonDrills)
	})

	it('moves transferred structures to the new corporation and clears old inventory projections', async () => {
		const db = makeDb()
		db.query.corporationStructures.findMany = vi
			.fn()
			.mockResolvedValueOnce([
				{
					structureId: 'transferred-structure',
					corporationId: 'old-corp',
				},
			])
			.mockResolvedValueOnce([])
		db.query.structureMoonGeographies.findMany = vi.fn().mockResolvedValue([])
		db.query.structureMoonDrills.findMany = vi.fn().mockResolvedValue([])
		const instance = createDoInstance(db)

		;(instance as any).hydrateStructureRows = vi.fn().mockResolvedValue([
			{
				corporationId: 'new-corp',
				structureId: 'transferred-structure',
				name: 'Transferred Structure',
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
				fuelBurnRate: null,
				structureInfo: null,
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
		])
		;(instance as any).resolveStructureFuelBurnRates = vi.fn().mockResolvedValue(new Map())

		await instance.storeStructures('new-corp', [
			{
				structure_id: 'transferred-structure',
				type_id: '35832',
				system_id: '30000142',
				profile_id: 'profile-1',
				state: 'online',
			},
		])

		expect(db.delete).toHaveBeenCalledWith(corporationStructureInventory)
		expect(db.delete).toHaveBeenCalledWith(corporationAssets)
		expect(db._values).toHaveBeenCalledWith([
			expect.objectContaining({
				corporationId: 'new-corp',
				structureId: 'transferred-structure',
			}),
		])
		expect(db._onConflictDoUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				set: expect.objectContaining({ corporationId: expect.anything() }),
			})
		)
	})

	it('does not reattach a structure from a stale former-owner listing', async () => {
		const db = makeDb()
		db.query.corporationStructures.findMany = vi.fn().mockResolvedValue([])
		db.query.structureMoonGeographies.findMany = vi.fn().mockResolvedValue([])
		db.query.structureMoonDrills.findMany = vi.fn().mockResolvedValue([])
		const instance = createDoInstance(db)

		;(instance as any).hydrateStructureRows = vi.fn().mockResolvedValue([
			{
				corporationId: 'old-corp',
				structureId: 'transferred-structure',
				typeId: '35832',
				typeName: 'Astrahus',
				structureInfo: { owner_id: 'new-corp' },
			},
		])
		;(instance as any).resolveStructureFuelBurnRates = vi.fn().mockResolvedValue(new Map())

		await instance.storeStructures('old-corp', [
			{
				structure_id: 'transferred-structure',
				type_id: '35832',
				system_id: '30000142',
				profile_id: 'profile-1',
				state: 'online',
			},
		])

		expect(db.insert).not.toHaveBeenCalled()
	})

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
				structureInfo: {
					position: { x: 1, y: 2, z: 3 },
				},
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

		expect(db.delete).toHaveBeenCalledTimes(3)
		expect(db.delete).toHaveBeenNthCalledWith(1, corporationStructures)
		expect(db.delete).toHaveBeenNthCalledWith(2, structureMoonGeographies)
		expect(db.delete).toHaveBeenNthCalledWith(3, structureMoonDrills)
		expect(db._where).toHaveBeenCalledTimes(3)
		expect(db._values).toHaveBeenCalledWith([
			expect.objectContaining({
				structureId: 'structure-1',
				lastSyncedAt: expect.any(Date),
			}),
		])
	})

	it('preserves existing POS rows and detail fuel when the listing is incomplete', async () => {
		const db = makeDb()
		db.query.corporationStructures.findMany = vi.fn().mockResolvedValue([
			{
				structureId: 'pos-1',
				corporationId: 'corp-1',
				typeId: '12235',
				fuelAmount: 55,
				updatedAt: new Date('2026-07-01T00:00:00.000Z'),
			},
		])
		const instance = createDoInstance(db)
		;(instance as any).hydrateStructureRows = vi.fn().mockResolvedValue([
			{
				corporationId: 'corp-1',
				structureId: 'pos-1',
				name: 'POS One',
				typeId: '12235',
				typeName: 'Control Tower',
				systemId: '30000142',
				systemName: 'Jita',
				regionId: '10000002',
				regionName: 'The Forge',
				profileId: 'pos',
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
				lastSyncedAt: new Date(),
				services: null,
				fuelBurnRate: null,
				structureInfo: null,
				updatedAt: new Date(),
			},
		])
		;(instance as any).resolveStructureFuelBurnRates = vi.fn().mockResolvedValue(new Map())
		;(instance as any).storeMoonGeographies = vi.fn()
		;(instance as any).storeMoonDrills = vi.fn()

		await instance.storeStructures(
			'corp-1',
			[
				{
					structure_id: 'pos-1',
					type_id: '12235',
					system_id: '30000142',
					profile_id: 'pos',
					state: 'online',
				},
			],
			{ posListingComplete: false }
		)

		expect(db.delete).not.toHaveBeenCalledWith(corporationStructures)
		expect(db._values).toHaveBeenCalledWith([
			expect.objectContaining({ structureId: 'pos-1', fuelAmount: 55 }),
		])
	})

	it('keeps recently seen structures and their dependent snapshots during the prune grace period', async () => {
		const db = makeDb()
		const instance = createDoInstance(db)
		const recent = new Date(Date.now() - 60 * 60 * 1000)

		db.query.corporationStructures.findMany = vi.fn().mockResolvedValue([
			{
				structureId: 'structure-1',
				typeId: '35832',
				updatedAt: recent,
			},
		])
		db.query.structureMoonGeographies.findMany = vi.fn().mockResolvedValue([
			{
				structureId: 'structure-1',
				updatedAt: recent,
			},
		])
		db.query.structureMoonDrills.findMany = vi.fn().mockResolvedValue([
			{
				structureId: 'structure-1',
				updatedAt: recent,
			},
		])
		;(instance as any).hydrateStructureRows = vi.fn().mockResolvedValue([])

		await instance.storeStructures('corp-1', [])

		expect(db.delete).not.toHaveBeenCalled()
	})

	it('clears all structure-side rows when the successful sync returns no structures', async () => {
		const db = makeDb()
		const instance = createDoInstance(db)

		;(instance as any).hydrateStructureRows = vi.fn().mockResolvedValue([])

		await instance.storeStructures('corp-1', [])

		expect(db.delete).toHaveBeenCalledTimes(3)
		expect(db.delete).toHaveBeenNthCalledWith(1, corporationStructures)
		expect(db.delete).toHaveBeenNthCalledWith(2, structureMoonGeographies)
		expect(db.delete).toHaveBeenNthCalledWith(3, structureMoonDrills)
		expect(db._where).toHaveBeenCalledTimes(3)
	})

	it('clears moon drill rows when the moon-drill synchronization returns no structures', async () => {
		const db = makeDb()
		const instance = createDoInstance(db)

		await (instance as any).storeMoonDrills('corp-1', [])

		expect(db.delete).toHaveBeenCalledTimes(1)
		expect(db.delete).toHaveBeenCalledWith(structureMoonDrills)
		expect(db._where).toHaveBeenCalledTimes(1)
	})

	it('preserves existing moon geography snapshots when synthesis fails for a live structure', async () => {
		const db = makeDb()
		const instance = createDoInstance(db)

		const resolveNearestMoonGeographyBySystemPosition = vi.fn().mockResolvedValue(null)
		mocks.getStub.mockReset().mockReturnValue({
			resolvePlanetGeographyByIds: vi.fn(),
			resolveSolarSystemsByIds: vi.fn(),
			resolveRegionsByIds: vi.fn(),
			resolveNearestMoonGeographyBySystemPosition,
		} as never)
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

		await (instance as any).storeMoonGeographies('corp-1', [
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

	it('does not recalculate moon geography for an existing structure', async () => {
		const db = makeDb()
		db.query.structureMoonGeographies.findMany = vi.fn().mockResolvedValue([
			{
				structureId: 'moon-drill-1',
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
		])
		const resolveNearestMoonGeographyBySystemPosition = vi.fn()
		mocks.getStub.mockReturnValue({
			resolveNearestMoonGeographyBySystemPosition,
		} as never)
		const instance = createDoInstance(db)

		await (instance as any).storeMoonGeographies('corp-1', [
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

		expect(resolveNearestMoonGeographyBySystemPosition).not.toHaveBeenCalled()
		expect(db.insert).not.toHaveBeenCalled()
		expect(db.delete).not.toHaveBeenCalled()
	})

	it('stores POS moon geography from the direct starbase moon id', async () => {
		const db = makeDb()
		const resolveMoonGeographyByIds = vi.fn().mockResolvedValue({
			'40100001': {
				moonId: '40100001',
				moonName: 'Jita IV - Moon 1',
				planetId: 'planets-1',
				planetName: 'Jita IV',
				solarSystemId: '30000142',
				solarSystemName: 'Jita',
			},
		})
		mocks.getStub.mockReturnValue({ resolveMoonGeographyByIds } as never)
		const instance = createDoInstance(db)

		await (instance as any).storeMoonGeographies(
			'corp-1',
			[
				{
					structureId: 'pos-1',
					corporationId: 'corp-1',
					typeId: '12235',
					typeName: 'Control Tower',
					systemId: '30000142',
					systemName: 'Jita',
					structureInfo: null,
				},
			],
			new Map([['pos-1', '40100001']])
		)

		expect(resolveMoonGeographyByIds).toHaveBeenCalledWith(['40100001'])
		expect(db.insert).toHaveBeenCalledWith(structureMoonGeographies)
		expect(db._values).toHaveBeenCalledWith([
			expect.objectContaining({
				structureId: 'pos-1',
				moonId: '40100001',
				planetId: 'planets-1',
				systemId: '30000142',
			}),
		])
	})

	it('stores sovereignty hub names using resolved solar system names', async () => {
		const db = makeDb()
		const instance = createDoInstance(db)

		mocks.getStub.mockReturnValue({
			resolveSolarSystemsByIds: vi.fn().mockResolvedValue({
				'30000142': {
					solarSystemName: 'Jita',
				},
			}),
		} as never)

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

	it('rebuilds sovereignty systems without preserving stale system names', async () => {
		const db = makeDb()
		db.query.structureSovereigntySystems.findMany = vi.fn().mockResolvedValue([
			{
				systemId: '30000142',
				systemName: 'Stale Name',
			},
		])
		const instance = createDoInstance(db)

		mocks.getStub.mockReturnValueOnce({
			resolveSolarSystemsByIds: vi.fn().mockResolvedValue({
				'30000142': {
					solarSystemName: 'Jita',
				},
			}),
		} as never)

		await instance.storeSovereigntySystems('corp-1', [
			{
				system_id: '30000142',
				claim_type: 'alliance',
				alliance_id: '123456789',
				corporation_id: '987654321',
				claimed_since: '2026-07-12T19:36:46.834Z',
				is_capital_system: false,
				sovereignty_hub_structure_id: 'hub-1',
				vulnerability_window: null,
				activity_defense_multiplier: '1.0000',
				military_level: 1,
				industrial_level: 1,
				strategic_level: 1,
			},
		])

		expect(db._values).toHaveBeenCalled()
		expect(db._values.mock.calls[0][0][0]).toMatchObject({
			systemName: 'Jita',
		})
	})

	it('preserves existing sovereignty hub geography without re-resolving it', async () => {
		const db = makeDb()
		db.query.structureSovereigntyHubs.findMany = vi.fn().mockResolvedValue([
			{
				structureId: 'hub-1',
				systemId: '30000142',
				systemName: 'Stale Name',
				name: 'Stale Hub',
			},
		])
		const instance = createDoInstance(db)

		mocks.getStub.mockReturnValueOnce({} as never)
		const resolveSolarSystemsByIds = vi.fn()
		mocks.getStub.mockReturnValueOnce({
			resolveSolarSystemsByIds,
		} as never)

		await instance.storeSovereigntyHubs('corp-1', [
			{
				structure_id: 'hub-1',
				corporation_id: 'corp-1',
				system_id: '30000142',
				system_name: null,
				type_id: SOVEREIGNTY_HUB_TYPE_ID,
				name: null,
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
							sources: [{ solar_system_id: 30000142 }],
						},
					},
					state: {
						import: {
							sources: [{ solar_system_id: 30000142, amount: 0 }],
						},
					},
				},
				raw: { detail: { id: 1 } },
			} as never,
		])

		expect(db._values).toHaveBeenCalled()
		expect(db._values.mock.calls[0][0][0]).toMatchObject({
			systemId: '30000142',
			systemName: 'Stale Name',
		})
		expect(resolveSolarSystemsByIds).not.toHaveBeenCalled()
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

		mocks.getStub.mockReset().mockReturnValue({
			resolvePlanetGeographyByIds: vi.fn().mockResolvedValue({
				401: null,
			}),
			resolveSolarSystemsByIds: vi.fn().mockResolvedValue({}),
			resolveRegionsByIds: vi.fn().mockResolvedValue({}),
			resolveNearestMoonGeographyBySystemPosition: vi.fn().mockResolvedValue(null),
		} as never)

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
				raw: { id: 1 },
			} as never,
		])

		expect(db.delete).not.toHaveBeenCalled()
		expect(db.insert).not.toHaveBeenCalled()
	})

	it('preserves existing skyhook geography without re-resolving it', async () => {
		const db = makeDb()
		db.query.corporationStructures.findMany = vi.fn().mockResolvedValue([
			{
				structureId: 'skyhook-1',
				corporationId: 'corp-1',
				typeId: '81826',
				systemId: '30000142',
				systemName: 'Jita',
				regionId: '10000002',
				regionName: 'The Forge',
				updatedAt: new Date('2026-07-12T19:36:46.834Z'),
			},
		])
		db.query.structureSkyhooks.findMany = vi.fn().mockResolvedValue([
			{
				structureId: 'skyhook-1',
				planetName: 'Planet One',
				systemName: 'Jita',
				updatedAt: new Date('2026-07-12T19:36:46.834Z'),
			},
		])
		const resolvePlanetGeographyByIds = vi.fn()
		const resolveSolarSystemsByIds = vi.fn()
		const resolveRegionsByIds = vi.fn()
		mocks.getStub.mockReturnValue({
			resolvePlanetGeographyByIds,
			resolveSolarSystemsByIds,
			resolveRegionsByIds,
			resolveNearestMoonGeographyBySystemPosition: vi.fn(),
		} as never)

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
				raw: { id: 1 },
			} as never,
		])

		expect(resolvePlanetGeographyByIds).not.toHaveBeenCalled()
		expect(resolveSolarSystemsByIds).not.toHaveBeenCalled()
		expect(resolveRegionsByIds).not.toHaveBeenCalled()
		expect(db._values.mock.calls[0][0][0]).toMatchObject({
			systemId: '30000142',
			systemName: 'Jita',
			regionId: '10000002',
			regionName: 'The Forge',
		})
		expect(db._values.mock.calls[1][0][0]).toMatchObject({
			planetName: 'Planet One',
			systemName: 'Jita',
		})
	})

	it('does not prune skyhooks without explicit prune candidates when the upstream listing is empty', async () => {
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
		} as never)

		const instance = createDoInstance(db)

		await expect(instance.storeSkyhooks('corp-1', [])).resolves.toEqual({ prunedCount: 0 })
		expect(db.delete).not.toHaveBeenCalled()
	})

	it('does not prune skyhook state rows or base rows without explicit prune candidates', async () => {
		const db = makeDb()
		const stale = new Date('2026-06-01T00:00:00.000Z')

		db.query.corporationStructures.findMany = vi.fn().mockResolvedValue([
			{
				structureId: 'skyhook-1',
				typeId: '35832',
				updatedAt: stale,
			},
		])
		db.query.structureSkyhooks.findMany = vi.fn().mockResolvedValue([
			{
				structureId: 'skyhook-1',
				planetName: 'Planet One',
				systemName: 'Jita',
				name: 'Skyhook One',
				updatedAt: stale,
			},
		])

		mocks.getStub.mockReturnValue({
			resolvePlanetGeographyByIds: vi.fn().mockResolvedValue({}),
			resolveSolarSystemsByIds: vi.fn().mockResolvedValue({}),
			resolveRegionsByIds: vi.fn().mockResolvedValue({}),
			resolveNearestMoonGeographyBySystemPosition: vi.fn().mockResolvedValue(null),
		} as never)

		const instance = createDoInstance(db)

		await expect(instance.storeSkyhooks('corp-1', [])).resolves.toEqual({ prunedCount: 0 })
		expect(db.delete).not.toHaveBeenCalled()
	})
})
