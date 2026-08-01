import { describe, expect, it, vi } from 'vitest'

import { BillService } from '../../../services/bill.service'

function createService(overrides?: {
	bill?: {
		id: string
		amount: string
		lateFee: string
		payments: Array<{ amount: string }>
	}
}) {
	const bill = overrides?.bill ?? {
		id: 'bill-1',
		amount: '100.00',
		lateFee: '12.50',
		payments: [],
	}

	const findFirst = vi.fn().mockResolvedValue(bill)
	const paidAmount = bill.payments.reduce((total, payment) => total + Number(payment.amount), 0)
	const where = vi.fn().mockResolvedValue([{ paidAmount: String(paidAmount) }])
	const from = vi.fn().mockReturnValue({ where })
	const db = {
		query: {
			bills: {
				findFirst,
			},
		},
		select: vi.fn().mockReturnValue({ from }),
	} as unknown as ConstructorParameters<typeof BillService>[0]

	return { service: new BillService(db), findFirst }
}

describe('BillService.checkBillBalancePaid', () => {
	it('handles decimal late fees without throwing and treats unpaid bills as unpaid', async () => {
		const { service, findFirst } = createService()

		await expect(service.checkBillBalancePaid('bill-1')).resolves.toBe(false)
		expect(findFirst).toHaveBeenCalledWith({ where: expect.anything() })
	})

	it('counts payment amounts against the total due including late fee', async () => {
		const { service } = createService({
			bill: {
				id: 'bill-1',
				amount: '100.00',
				lateFee: '12.50',
				payments: [{ amount: '112.50' }],
			},
		})

		await expect(service.checkBillBalancePaid('bill-1')).resolves.toBe(true)
	})
})

describe('BillService.recordWalletPayments', () => {
	it('deduplicates journal IDs and records the batch with one SQL statement', async () => {
		const findFirst = vi.fn().mockResolvedValue({
			id: 'bill-1',
			paymentToken: 'PAYTOKEN',
			status: 'issued',
			dueDate: new Date(Date.now() + 60_000),
			amount: '100',
			lateFee: '0',
			lateFeeType: 'none',
			lateFeeAmount: '0',
			lateFeeCompounding: 'none',
		})
		const execute = vi.fn().mockResolvedValue({ rows: [{ insertedCount: 2 }] })
		const service = new BillService({
			query: { bills: { findFirst } },
			select: vi.fn(),
			execute,
		} as unknown as ConstructorParameters<typeof BillService>[0])

		await expect(
			service.recordWalletPayments('bill-1', [
				{
					amount: 100n,
					paidById: 'character-1',
					paidByType: 'character',
					esiTransactionId: 'journal-1',
				},
				{
					amount: 200n,
					paidById: 'character-2',
					paidByType: 'character',
					esiTransactionId: 'journal-1',
				},
				{
					amount: 300n,
					paidById: 'character-3',
					paidByType: 'character',
					esiTransactionId: 'journal-2',
				},
			])
		).resolves.toBe(2)

		expect(findFirst).toHaveBeenCalledTimes(1)
		expect(execute).toHaveBeenCalledTimes(1)
	})
})
