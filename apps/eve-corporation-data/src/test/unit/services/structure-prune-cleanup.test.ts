import { describe, expect, it, vi } from 'vitest'

import {
	corporationStructures,
	structureMiningStates,
	structureSkyhookStates,
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
	const resolveSolarSystemsByIds = vi.fn()
	const getStub = vi.fn(() => ({
		resolveSolarSystemsByIds,
	}))

	return {
		findMany,
		onConflictDoUpdate,
		values,
		insert,
		deleteMock,
		resolveSolarSystemsByIds,
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
	const structureSkyhookStatesFindMany = vi
		.fn()
		.mockResolvedValue([{ structureId: 'stale-structure' }])
	const structureMiningStatesFindMany = vi
		.fn()
		.mockResolvedValue([{ structureId: 'stale-structure' }])
	const structureSovereigntyHubsFindMany = vi.fn().mockResolvedValue([])

	return {
		query: {
			corporationStructures: {
				findMany: corporationStructuresFindMany,
			},
			structureSkyhookStates: {
				findMany: structureSkyhookStatesFindMany,
			},
			structureMiningStates: {
				findMany: structureMiningStatesFindMany,
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

		expect(db.delete).toHaveBeenCalledTimes(3)
		expect(db.delete).toHaveBeenNthCalledWith(1, corporationStructures)
		expect(db.delete).toHaveBeenNthCalledWith(2, structureSkyhookStates)
		expect(db.delete).toHaveBeenNthCalledWith(3, structureMiningStates)
		expect(db._where).toHaveBeenCalledTimes(3)
	})

	it('clears all structure-side rows when the successful sync returns no structures', async () => {
		const db = makeDb()
		const instance = createDoInstance(db)

		;(instance as any).hydrateStructureRows = vi.fn().mockResolvedValue([])

		await instance.storeStructures('corp-1', [])

		expect(db.delete).toHaveBeenCalledTimes(3)
		expect(db.delete).toHaveBeenNthCalledWith(1, corporationStructures)
		expect(db.delete).toHaveBeenNthCalledWith(2, structureSkyhookStates)
		expect(db.delete).toHaveBeenNthCalledWith(3, structureMiningStates)
		expect(db._where).toHaveBeenCalledTimes(3)
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
})
