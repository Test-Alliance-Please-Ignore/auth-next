import { describe, expect, it, vi } from 'vitest'

import { BillService } from '../../../services/bill.service'

function sqlText(query: unknown): string {
	if (typeof query === 'string') return query
	if (query === null || typeof query !== 'object') return ''

	const node = query as { queryChunks?: unknown[]; value?: unknown }
	if (Array.isArray(node.queryChunks)) {
		return node.queryChunks.map(sqlText).join('')
	}
	if (Array.isArray(node.value)) return node.value.join('')
	return ''
}

function createService(overrides?: {
	bill?: {
		id: string
		issuerId: string
		amount: string
		lateFee: string
		payments: Array<{ amount: string }>
	}
}) {
	const bill = overrides?.bill ?? {
		id: 'bill-1',
		issuerId: 'owner-1',
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
				issuerId: 'owner-1',
				amount: '100.00',
				lateFee: '12.50',
				payments: [{ amount: '112.50' }],
			},
		})

		await expect(service.checkBillBalancePaid('bill-1')).resolves.toBe(true)
	})
})

describe('BillService mutation authorization', () => {
	it('creates all group children and creation events inside one transaction', async () => {
		const insertedBill = { id: 'bill-1', status: 'draft' }
		const returning = vi.fn().mockResolvedValue([insertedBill])
		const values = vi.fn().mockReturnValue({ returning })
		const insert = vi.fn().mockReturnValue({ values })
		const execute = vi.fn().mockResolvedValue({ rows: [] })
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback({ insert, execute })
		)
		const service = new BillService({ transaction } as any)
		const input = {
			payerId: 'character-1',
			payerType: 'character' as const,
			payeeId: 'corporation-1',
			payeeType: 'corporation' as const,
			title: 'Group charge',
			amount: '100',
			dueDate: new Date('2026-04-01'),
		}

		await service.createBillsBulk('issuer-1', [input, input])

		expect(transaction).toHaveBeenCalledOnce()
		expect(insert).toHaveBeenCalledTimes(2)
		expect(execute).toHaveBeenCalledTimes(2)
	})

	it('finalizes manual payment state and history in one SQL statement', async () => {
		const existingBill = {
			id: 'bill-1',
			issuerId: 'owner-1',
			paymentToken: 'token-1',
			status: 'issued',
			amount: '100',
			lateFee: '0',
		}
		const findFirst = vi
			.fn()
			.mockResolvedValueOnce(existingBill)
			.mockResolvedValueOnce({ ...existingBill, status: 'paid' })
		const execute = vi.fn().mockResolvedValue({ rows: [{ bill_id: 'bill-1' }] })
		const service = new BillService({
			query: { bills: { findFirst } },
			execute,
		} as any)

		await expect(
			service.markBillAsPaid('bill-1', 'user-1', 'owner_mark_paid')
		).resolves.toMatchObject({
			id: 'bill-1',
			status: 'paid',
		})
		expect(execute).toHaveBeenCalledTimes(1)
		const query = sqlText(execute.mock.calls[0]?.[0])
		expect(query).toContain('with updated_bill as')
		expect(query).toContain('insert into bill_payments')
		expect(query).toContain('inserted_paid_event')
		expect(query).toContain('inserted_payment_event')
	})

	it('rejects owner-scoped mutations from a different issuer', async () => {
		const { service } = createService()

		await expect(service.deleteBill('different-user', 'bill-1')).rejects.toThrow(
			'Only the bill issuer can mutate this bill'
		)
	})

	it('attributes manual mark-paid actions to the authenticated user', async () => {
		const { service } = createService()
		const markBillAsPaid = vi.spyOn(service, 'markBillAsPaid').mockResolvedValue({} as any)

		await service.markBillPaid('owner-1', 'bill-1', 'owner')
		await service.markBillPaid('admin-1', 'bill-1', 'admin')

		expect(markBillAsPaid).toHaveBeenNthCalledWith(1, 'bill-1', 'owner-1', 'owner_mark_paid')
		expect(markBillAsPaid).toHaveBeenNthCalledWith(2, 'bill-1', 'admin-1', 'admin_mark_paid')
	})

	it('requires an exact payer or payee relationship for related-party mark-paid', async () => {
		const { service } = createService()
		const markBillAsPaid = vi.spyOn(service, 'markBillAsPaid').mockResolvedValue({} as any)
		const findFirst = (service as any).db.query.bills.findFirst as ReturnType<typeof vi.fn>
		findFirst.mockResolvedValue({
			id: 'bill-1',
			issuerId: 'tax-issuer',
			payerId: 'payer-1',
			payerType: 'character',
			payeeId: 'payee-1',
			payeeType: 'corporation',
		})

		await service.markRelatedBillPaid('user-1', 'bill-1', [
			{ entityId: 'payer-1', entityType: 'character' },
		])
		await expect(
			service.markRelatedBillPaid('user-1', 'bill-1', [
				{ entityId: 'other-user', entityType: 'character' },
			])
		).rejects.toThrow('Only a bill payer or payee can mark this bill paid')

		expect(markBillAsPaid).toHaveBeenCalledWith('bill-1', 'user-1', 'related_mark_paid')
	})
})

describe('BillService read caching and statistics', () => {
	it('caches integration bill reads until a mutation clears the cache', async () => {
		const bill = {
			id: 'bill-1',
			issuerId: 'owner-1',
			payerId: 'payer-1',
			payerType: 'character',
			payeeId: null,
			payeeType: null,
			title: 'Cached bill',
			description: null,
			amount: '100',
			lateFee: '0',
			lateFeeType: 'none',
			lateFeeAmount: '0',
			lateFeeCompounding: 'none',
			dueDate: new Date(Date.now() + 60_000),
			status: 'issued',
			paidAt: null,
			paymentToken: 'token',
			externalSourceType: 'manual',
			externalSourceId: null,
			externalMetadata: null,
			groupBillId: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			payments: [],
		}
		const findFirst = vi.fn().mockResolvedValue(bill)
		const updateReturning = vi.fn().mockResolvedValue([bill])
		const service = new BillService({
			query: {
				bills: { findFirst },
				billPayments: { findFirst: vi.fn().mockResolvedValue(null) },
			},
			update: vi.fn().mockReturnValue({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({ returning: updateReturning }),
				}),
			}),
		} as any)

		await service.getBillIntegrationView('bill-1')
		await service.getBillIntegrationView('bill-1')
		expect(findFirst).toHaveBeenCalledTimes(1)

		await expect(
			service.updateBill('owner-1', 'bill-1', { title: 'Updated' })
		).resolves.toBeDefined()
		expect(findFirst).toHaveBeenCalledTimes(2)
	})

	it('uses one database aggregate for statistics instead of loading all bills', async () => {
		const execute = vi.fn().mockResolvedValue({
			rows: [
				{
					total_bills: 4,
					total_amount: '400.50',
					paid_amount: '110.50',
					overdue_amount: '200',
					draft_count: 1,
					issued_count: 1,
					paid_count: 1,
					cancelled_count: 0,
					overdue_count: 1,
				},
			],
		})
		const findMany = vi.fn()
		const service = new BillService({ query: { bills: { findMany } }, execute } as any)

		await expect(service.getBillStatistics('user-1')).resolves.toEqual({
			totalBills: 4,
			totalAmount: '400.50',
			paidAmount: '110.50',
			overdueAmount: '200',
			billsByStatus: { draft: 1, issued: 1, paid: 1, cancelled: 0, overdue: 1 },
		})
		expect(findMany).not.toHaveBeenCalled()
		expect(sqlText(execute.mock.calls[0]?.[0])).toContain('count(*) filter')
		expect(sqlText(execute.mock.calls[0]?.[0])).toContain('sum')
	})
})

describe('BillService coalesced bill pagination', () => {
	it('aggregates the full group after selecting matching groups', async () => {
		const representative = {
			id: 'bill-1',
			issuerId: 'owner-1',
			payerId: 'character-1',
			payerType: 'character',
			payeeId: 'corporation-1',
			payeeType: 'corporation',
			title: 'Group bill',
			description: null,
			amount: '100',
			lateFee: '0',
			lateFeeType: 'none',
			lateFeeAmount: '0',
			lateFeeCompounding: 'none',
			dueDate: new Date(Date.now() + 60_000),
			status: 'paid',
			paidAt: new Date(),
			paymentToken: 'token',
			externalSourceType: 'manual',
			externalSourceId: null,
			externalMetadata: { groupId: 'group-1' },
			groupBillId: 'group-bill-1',
			createdAt: new Date(),
			updatedAt: new Date(),
		}
		const execute = vi.fn().mockResolvedValue({
			rows: [
				{
					representative_id: 'bill-1',
					group_total_count: 20,
					group_paid_count: 1,
					group_status_count: 2,
					group_draft_count: 0,
					group_editable_count: 19,
					group_cancellable_count: 19,
					group_revertible_count: 1,
					is_group: true,
					row_count: 1,
				},
			],
		})
		const service = new BillService({
			query: { bills: { findMany: vi.fn().mockResolvedValue([representative]) } },
			execute,
		} as unknown as ConstructorParameters<typeof BillService>[0])

		const result = await service.listBillsPage({
			scope: { mode: 'all' },
			filters: { status: 'paid' },
			limit: 10,
			offset: 0,
			coalesced: true,
		})

		expect(result.rowCount).toBe(1)
		expect(result.rows[0]?.groupBillTotalCount).toBe(20)
		expect(result.rows[0]?.groupBillEditableCount).toBe(19)
		expect(result.rows[0]?.groupBillRevertibleCount).toBe(1)
		expect(sqlText(execute.mock.calls[0]?.[0])).toContain('filtered_groups')
		expect(sqlText(execute.mock.calls[0]?.[0])).toContain(
			'inner join filtered_groups on filtered_groups.group_key = scoped.group_key'
		)
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
		expect(sqlText(execute.mock.calls[0]?.[0])).toContain('::timestamptz')
	})
})
