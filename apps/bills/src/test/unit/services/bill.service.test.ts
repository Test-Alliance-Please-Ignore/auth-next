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
	const bill =
		overrides?.bill ?? {
			id: 'bill-1',
			amount: '100.00',
			lateFee: '12.50',
			payments: [],
		}

	const findFirst = vi.fn().mockResolvedValue(bill)
	const db = {
		query: {
			bills: {
				findFirst,
			},
		},
	} as unknown as ConstructorParameters<typeof BillService>[0]

	return { service: new BillService(db), findFirst }
}

describe('BillService.checkBillBalancePaid', () => {
	it('handles decimal late fees without throwing and treats unpaid bills as unpaid', async () => {
		const { service, findFirst } = createService()

		await expect(service.checkBillBalancePaid('bill-1')).resolves.toBe(false)
		expect(findFirst).toHaveBeenCalledWith({
			where: expect.anything(),
			with: {
				payments: true,
			},
		})
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
