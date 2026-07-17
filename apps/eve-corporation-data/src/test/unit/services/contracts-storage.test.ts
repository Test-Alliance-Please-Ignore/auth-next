import { describe, expect, it, vi } from 'vitest'

import { corporationContracts } from '../../../db/schema'
import { EveCorporationDataDO } from '../../../durable-object'

function createDoInstance(db: any) {
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

describe('contract storage', () => {
	it('stores contracts keyed by contract id only', async () => {
		const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
		const values = vi.fn(() => ({ onConflictDoUpdate }))
		const insert = vi.fn(() => ({ values }))
		const db = { insert }
		const instance = createDoInstance(db)

		await instance.storeContracts('123', [
			{
				contract_id: '987',
				acceptor_id: '222',
				assignee_id: '333',
				availability: 'alliance',
				buyout: 10,
				collateral: 20,
				date_accepted: '2026-07-16T12:00:00Z',
				date_completed: null,
				date_expired: '2026-07-20T12:00:00Z',
				date_issued: '2026-07-15T12:00:00Z',
				days_to_complete: 7,
				end_location_id: '444',
				for_corporation: true,
				issuer_corporation_id: '555',
				issuer_id: '666',
				price: 30,
				reward: 40,
				start_location_id: '777',
				status: 'outstanding',
				title: 'Contract One',
				type: 'courier',
				volume: 50,
			},
			{
				contract_id: '987',
				acceptor_id: '222',
				assignee_id: '333',
				availability: 'alliance',
				buyout: 10,
				collateral: 20,
				date_accepted: '2026-07-16T12:00:00Z',
				date_completed: '2026-07-16T13:00:00Z',
				date_expired: '2026-07-20T12:00:00Z',
				date_issued: '2026-07-15T12:00:00Z',
				days_to_complete: 7,
				end_location_id: '444',
				for_corporation: true,
				issuer_corporation_id: '555',
				issuer_id: '666',
				price: 30,
				reward: 40,
				start_location_id: '777',
				status: 'finished',
				title: 'Contract One',
				type: 'courier',
				volume: 50,
			},
		])

		expect(insert).toHaveBeenCalledWith(corporationContracts)
		expect(values).toHaveBeenCalledTimes(1)

		const rows = (values.mock.calls[0] as unknown as [Array<Record<string, unknown>>])[0]
		expect(rows).toHaveLength(1)
		expect(rows[0]).not.toHaveProperty('corporationId')
		expect(rows[0]).toMatchObject({
			contractId: '987',
			acceptorId: '222',
			assigneeId: '333',
			status: 'finished',
		})

		expect(onConflictDoUpdate).toHaveBeenCalledTimes(1)
		expect(onConflictDoUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				target: [corporationContracts.contractId],
			})
		)
	})

	it('keeps the corporation context on reads without storing it in the table', async () => {
		const findMany = vi.fn().mockResolvedValue([
			{
				id: 'row-1',
				contractId: '987',
				acceptorId: '222',
				assigneeId: '333',
				availability: 'alliance',
				buyout: '10',
				collateral: '20',
				dateAccepted: null,
				dateCompleted: null,
				dateExpired: new Date('2026-07-20T12:00:00Z'),
				dateIssued: new Date('2026-07-15T12:00:00Z'),
				daysToComplete: 7,
				endLocationId: '444',
				forCorporation: true,
				issuerCorporationId: '555',
				issuerId: '666',
				price: '30',
				reward: '40',
				startLocationId: '777',
				status: 'outstanding',
				title: 'Contract One',
				type: 'courier',
				volume: '50',
				updatedAt: new Date('2026-07-16T14:00:00Z'),
			},
		])
		const db = {
			query: {
				corporationContracts: {
					findMany,
				},
			},
		}
		const instance = createDoInstance(db)

		const results = await instance.getContracts('123')

		expect(findMany).toHaveBeenCalledTimes(1)
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.anything() }))
		expect(results).toEqual([
			expect.objectContaining({
				contractId: '987',
				status: 'outstanding',
			}),
		])
	})
})
