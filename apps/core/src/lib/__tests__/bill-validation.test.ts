import { describe, expect, it } from 'vitest'

import { manualBillCreateSchema, manualBillUpdateSchema } from '../bill-validation'

const validBill = {
	payerId: '7001',
	payerType: 'character' as const,
	payeeId: '9001',
	payeeType: 'corporation' as const,
	title: 'Manual charge',
	amount: '1000',
	dueDate: '2026-05-01T00:00:00.000Z',
}

describe('manual bill validation', () => {
	it('rejects amounts larger than the supported ISK range', () => {
		expect(
			manualBillCreateSchema.safeParse({
				...validBill,
				amount: '1000000000000000',
			}).success
		).toBe(false)
	})

	it('rejects percentage late fees above 100', () => {
		expect(
			manualBillCreateSchema.safeParse({
				...validBill,
				lateFeeType: 'percentage',
				lateFeeAmount: '100.01',
			}).success
		).toBe(false)
	})

	it('applies the same bounds to manual updates', () => {
		expect(manualBillUpdateSchema.safeParse({ amount: '1000000000000000' }).success).toBe(false)
		expect(
			manualBillUpdateSchema.safeParse({ lateFeeType: 'percentage', lateFeeAmount: '100.01' })
				.success
		).toBe(false)
	})
})
