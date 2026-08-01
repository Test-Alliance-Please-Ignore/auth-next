import { describe, expect, it, vi } from 'vitest'

import { findPaymentsForBill } from '../../../workflows/steps/find-payments/find-payments'

function createContext(overrides?: { rows?: unknown[]; pages?: unknown[][] }) {
	const execute = vi.fn()
	if (overrides?.pages) {
		for (const page of overrides.pages) {
			execute.mockResolvedValueOnce({ rows: page })
		}
	} else {
		execute.mockResolvedValue({ rows: overrides?.rows ?? [] })
	}
	const recordWalletPayments = vi.fn().mockResolvedValue(1)

	return {
		ctx: {
			db: { execute },
			env: {},
			workflowInstanceId: 'workflow-1',
			billId: 'bill-1',
			billService: { recordWalletPayments },
		},
		execute,
		recordWalletPayments,
	}
}

describe('findPaymentsForBill', () => {
	it('validates candidates and records them in one batch', async () => {
		const { ctx, recordWalletPayments } = createContext({
			pages: [
				[
					{
						journalId: 'journal-1',
						amount: '100',
						firstPartyId: 'character-1',
						entryDate: new Date(),
					},
					{
						journalId: 'journal-invalid-amount',
						amount: 'not-a-number',
						firstPartyId: 'character-1',
						entryDate: new Date(),
					},
					{
						journalId: 'journal-missing-payer',
						amount: '100',
						firstPartyId: null,
						entryDate: new Date(),
					},
				],
				[],
			],
		})

		const result = await findPaymentsForBill(ctx as never, {
			id: 'bill-1',
			status: 'issued',
			payeeId: '987',
			payeeType: 'corporation',
			payerType: 'character',
			paymentToken: 'PAYTOKEN',
			paymentStartAt: new Date(0).toISOString(),
			paymentLastCheckedAt: null,
			externalSourceType: null,
		})

		expect(result).toEqual({ newPaymentsRecorded: 1 })
		expect(recordWalletPayments).toHaveBeenCalledTimes(1)
		expect(recordWalletPayments).toHaveBeenCalledWith('bill-1', [
			{
				amount: 100n,
				paidById: 'character-1',
				paidByType: 'corporation',
				esiTransactionId: 'journal-1',
			},
		])
	})

	it('drains every payment page within the lookbehind boundary', async () => {
		const firstPage = Array.from({ length: 100 }, (_, index) => ({
			journalId: `journal-${index}`,
			amount: '100',
			firstPartyId: 'character-1',
			entryDate: new Date(1_000 + index),
		}))
		const secondPage = [
			{
				journalId: 'journal-100',
				amount: '100',
				firstPartyId: 'character-1',
				entryDate: new Date(2_000),
			},
		]
		const { ctx, recordWalletPayments, execute } = createContext({
			pages: [firstPage, secondPage, []],
		})
		recordWalletPayments.mockResolvedValueOnce(100).mockResolvedValueOnce(1)

		const result = await findPaymentsForBill(ctx as never, {
			id: 'bill-1',
			status: 'issued',
			payeeId: '987',
			payeeType: 'corporation',
			payerType: 'character',
			paymentToken: 'PAYTOKEN',
			paymentStartAt: new Date(0).toISOString(),
			paymentLastCheckedAt: null,
			externalSourceType: null,
		})

		expect(result).toEqual({ newPaymentsRecorded: 101 })
		expect(execute).toHaveBeenCalledTimes(3)
		expect(recordWalletPayments).toHaveBeenCalledTimes(2)
		expect(recordWalletPayments.mock.calls[0][1]).toHaveLength(100)
		expect(recordWalletPayments.mock.calls[1][1]).toHaveLength(1)
	})
})
