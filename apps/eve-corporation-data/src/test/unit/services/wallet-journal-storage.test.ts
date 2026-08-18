import { describe, expect, it, vi } from 'vitest'

import { corporationWalletJournal } from '../../../db/schema'
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
	maxJournalId: string | null,
	maxJournalDate: string | null,
	insertedJournalIds: string[]
) {
	const where = vi.fn().mockResolvedValue([{ maxJournalId, maxJournalDate }])
	const from = vi.fn(() => ({ where }))
	const select = vi.fn(() => ({ from }))
	const returning = vi
		.fn()
		.mockResolvedValue(insertedJournalIds.map((journalId) => ({ journalId })))
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
		onConflictDoNothing,
	}
}

const journalEntry = (id: string) => ({
	id,
	amount: 100,
	balance: 200,
	context_id: 300,
	context_id_type: 'system_id',
	date: '2026-08-04T00:00:00Z',
	description: 'Test journal entry',
	first_party_id: 400,
	reason: null,
	ref_type: 'bounty_prizes',
	second_party_id: 500,
	tax: 0,
	tax_receiver_id: null,
})

describe('wallet journal storage', () => {
	it('uses the SQL watermark and inserts only newer journal entries in order', async () => {
		const { db, insert, select, values, onConflictDoNothing } = createDb(
			'2',
			'2026-08-05T00:00:00Z',
			['3', '4', '5']
		)
		const instance = createDoInstance(db)

		const result = await instance.storeWalletJournal('123', 1, [
			journalEntry('1'),
			journalEntry('5'),
			journalEntry('3'),
			journalEntry('4'),
		])

		expect(result).toEqual({ persistedNewRows: 3 })
		expect(select).toHaveBeenCalledTimes(1)
		expect(insert).toHaveBeenCalledWith(corporationWalletJournal)
		expect(values).toHaveBeenCalledTimes(1)
		const valuesCalls = values.mock.calls as unknown as Array<[unknown]>
		const insertedValues = valuesCalls[0]?.[0] as Array<{ journalId: string }>
		expect(insertedValues.map((row) => row.journalId)).toEqual(['3', '4', '5'])
		expect(onConflictDoNothing).toHaveBeenCalledWith(
			expect.objectContaining({
				target: [
					corporationWalletJournal.corporationId,
					corporationWalletJournal.division,
					corporationWalletJournal.journalId,
				],
			})
		)
	})

	it('does not issue an insert when the ESI window is already stored', async () => {
		const { db, insert, select } = createDb('2', '2026-08-05T00:00:00Z', [])
		const instance = createDoInstance(db)

		const result = await instance.storeWalletJournal('123', 1, [
			journalEntry('1'),
			journalEntry('2'),
		])

		expect(result).toEqual({ persistedNewRows: 0 })
		expect(select).toHaveBeenCalledTimes(1)
		expect(insert).not.toHaveBeenCalled()
	})

	it('uses a supplied watermark without re-reading it from the database', async () => {
		const { db, insert, select, values } = createDb('2', '2026-08-05T00:00:00Z', ['3'])
		const instance = createDoInstance(db)

		await instance.storeWalletJournal('123', 1, [journalEntry('3')], {
			maxJournalId: '2',
			maxJournalDate: new Date('2026-08-05T00:00:00Z'),
		})

		expect(select).not.toHaveBeenCalled()
		expect(insert).toHaveBeenCalledOnce()
		expect(values).toHaveBeenCalledOnce()
	})

	it('accepts late higher IDs and wrapped lower IDs', async () => {
		const { db, values } = createDb('500', '2026-08-05T00:00:00Z', ['501', '400', '402'])
		const instance = createDoInstance(db)

		await instance.storeWalletJournal('123', 1, [
			{ ...journalEntry('501'), date: '2026-08-04T00:00:00Z' },
			{ ...journalEntry('400'), date: '2026-08-05T00:00:00Z' },
			{ ...journalEntry('402'), date: '2026-08-06T00:00:00Z' },
		])

		const valuesCalls = values.mock.calls as unknown as Array<[unknown]>
		const insertedValues = valuesCalls[0]?.[0] as Array<{ journalId: string }>
		expect(insertedValues.map((row) => row.journalId)).toEqual(['501', '400', '402'])
	})

	it('filters same-party zero-sum journal pairs regardless of ref type', async () => {
		const { db, insert } = createDb(null, null, [])
		const instance = createDoInstance(db)
		const sharedFields = {
			balance: 1000,
			context_id: '666579046',
			context_id_type: 'industry_job_id',
			date: '2026-08-07T00:00:00Z',
			description: 'Industry facility tax',
			first_party_id: '123',
			reason: null,
			ref_type: 'brokers_fee',
			second_party_id: '123',
			tax: null,
			tax_receiver_id: null,
		}

		const result = await instance.storeWalletJournal('123', 1, [
			{ id: '100', amount: '-447', ...sharedFields },
			{ id: '100', amount: '447', ...sharedFields },
		])

		expect(result).toEqual({ persistedNewRows: 0 })
		expect(insert).not.toHaveBeenCalled()
	})

	it('does not filter opposite amounts for different parties', async () => {
		const { db, insert, values } = createDb(null, null, ['100', '100'])
		const instance = createDoInstance(db)
		const sharedFields = {
			balance: 1000,
			context_id: '666579046',
			context_id_type: 'industry_job_id',
			date: '2026-08-07T00:00:00Z',
			description: 'Industry facility tax',
			first_party_id: '123',
			reason: null,
			ref_type: 'industry_job_tax',
			tax: null,
			tax_receiver_id: null,
		}

		await instance.storeWalletJournal('123', 1, [
			{ id: '100', amount: '-447', second_party_id: '456', ...sharedFields },
			{ id: '100', amount: '447', second_party_id: '789', ...sharedFields },
		])

		expect(insert).toHaveBeenCalledTimes(1)
		expect(values).toHaveBeenCalledTimes(1)
	})
})
