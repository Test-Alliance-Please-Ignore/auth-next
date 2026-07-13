import { describe, expect, it, vi } from 'vitest'

import { EveCorporationDataDO } from '../../../durable-object'
import { corporationStructures, structureMiningStates, structureSkyhookStates } from '../../../db/schema'

function makeDb() {
	const where = vi.fn().mockResolvedValue(undefined)
	const deleteMock = vi.fn(() => ({ where }))
	const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
	const values = vi.fn(() => ({ onConflictDoUpdate }))
	const insert = vi.fn(() => ({ values }))

	return {
		delete: deleteMock,
		insert,
		_where: where,
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
})
