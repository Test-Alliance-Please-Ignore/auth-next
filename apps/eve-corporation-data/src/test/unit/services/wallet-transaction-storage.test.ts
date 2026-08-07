import { describe, expect, it, vi } from 'vitest'

import { corporationWalletTransactions } from '../../../db/schema'
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

function createDb(
	maxTransactionId: string | null,
	maxTransactionDate: string | null,
	insertedTransactionIds: string[]
) {
	const where = vi.fn().mockResolvedValue([{ maxTransactionId, maxTransactionDate }])
	const from = vi.fn(() => ({ where }))
	const select = vi.fn(() => ({ from }))
	const returning = vi
		.fn()
		.mockResolvedValue(insertedTransactionIds.map((transactionId) => ({ transactionId })))
	const onConflictDoNothing = vi.fn(() => ({ returning }))
	const values = vi.fn(() => ({ onConflictDoNothing }))
	const insert = vi.fn(() => ({ values }))

	return {
		db: {
			insert,
			select,
		},
		insert,
		select,
		values,
	}
}

const transaction = (transactionId: string, date = '2026-08-04T00:00:00Z') => ({
	transaction_id: transactionId,
	client_id: '100',
	date,
	is_buy: true,
	is_personal: false,
	journal_ref_id: '200',
	location_id: '300',
	quantity: 1,
	type_id: '400',
	unit_price: '500',
})

describe('wallet transaction storage', () => {
	it('uses the SQL watermark and inserts only qualifying transactions in date order', async () => {
		const { db, insert, select, values } = createDb('2', '2026-08-05T00:00:00Z', ['3', '4', '5'])
		const instance = createDoInstance(db)

		const result = await instance.storeWalletTransactions('123', 1, [
			transaction('1'),
			transaction('5', '2026-08-06T00:00:00Z'),
			transaction('3', '2026-08-06T00:00:00Z'),
			transaction('4', '2026-08-06T00:00:00Z'),
		])

		expect(result).toEqual({ persistedNewRows: 3 })
		expect(select).toHaveBeenCalledTimes(1)
		expect(insert).toHaveBeenCalledWith(corporationWalletTransactions)
		const valuesCalls = values.mock.calls as unknown as Array<[unknown]>
		const insertedValues = valuesCalls[0]?.[0] as Array<{ transactionId: string }>
		expect(insertedValues.map((row) => row.transactionId)).toEqual(['3', '4', '5'])
	})

	it('accepts late higher IDs and wrapped lower IDs', async () => {
		const { db, values } = createDb('500', '2026-08-05T00:00:00Z', ['501', '400', '402'])
		const instance = createDoInstance(db)

		await instance.storeWalletTransactions('123', 1, [
			transaction('501', '2026-08-04T00:00:00Z'),
			transaction('400', '2026-08-05T00:00:00Z'),
			transaction('402', '2026-08-06T00:00:00Z'),
		])

		const valuesCalls = values.mock.calls as unknown as Array<[unknown]>
		const insertedValues = valuesCalls[0]?.[0] as Array<{ transactionId: string }>
		expect(insertedValues.map((row) => row.transactionId)).toEqual(['501', '400', '402'])
	})

	it('does not issue an insert when the transaction window is already stored', async () => {
		const { db, insert } = createDb('2', '2026-08-05T00:00:00Z', [])
		const instance = createDoInstance(db)

		const result = await instance.storeWalletTransactions('123', 1, [
			transaction('1'),
			transaction('2'),
		])

		expect(result).toEqual({ persistedNewRows: 0 })
		expect(insert).not.toHaveBeenCalled()
	})

	it('uses the fetch-time watermark without rereading a moving watermark', async () => {
		const { db, insert, select, values } = createDb('999', '2026-08-07T00:00:00Z', ['3'])
		const instance = createDoInstance(db)

		const result = await instance.storeWalletTransactions(
			'123',
			1,
			[transaction('3', '2026-08-06T00:00:00Z')],
			{
				maxTransactionId: '2',
				maxTransactionDate: new Date('2026-08-05T00:00:00Z'),
			}
		)

		expect(result).toEqual({ persistedNewRows: 1 })
		expect(select).not.toHaveBeenCalled()
		const valuesCalls = values.mock.calls as unknown as Array<[unknown]>
		const insertedValues = valuesCalls[0]?.[0] as Array<{ transactionId: string }>
		expect(insertedValues.map((row) => row.transactionId)).toEqual(['3'])
		expect(insert).toHaveBeenCalledTimes(1)
	})
})
