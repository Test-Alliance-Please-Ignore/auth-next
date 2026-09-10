import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { inArray } from '@repo/db-utils'

import { createDb } from '../../db'
import { bills } from '../../db/schema'
import { BillService } from '../../services/bill.service'

const hasDatabase = Boolean(process.env.TEST_DATABASE_URL)
const integration = hasDatabase ? describe : describe.skip

let db: ReturnType<typeof createDb>
let service: BillService
let billIds: string[] = []

async function cleanUpTestBills() {
	if (!db || billIds.length === 0) return
	await db.delete(bills).where(inArray(bills.id, billIds))
	billIds = []
}

function bill(issuerId: string, id: string, groupBillId: string | null, status: 'issued' | 'paid') {
	return {
		id,
		issuerId,
		payerId: `payer-${id}`,
		payerType: 'character' as const,
		payeeId: 'integration-payee',
		payeeType: 'corporation' as const,
		title: groupBillId ? 'Integration group bill' : 'Integration standalone bill',
		amount: '100.00',
		lateFee: '0',
		lateFeeType: 'none' as const,
		lateFeeAmount: '0',
		lateFeeCompounding: 'none' as const,
		dueDate: new Date(Date.now() + 86_400_000),
		status,
		paidAt: status === 'paid' ? new Date() : null,
		paymentToken: `integration-token-${id}`,
		externalSourceType: 'manual',
		externalSourceId: null,
		externalMetadata: null,
		groupBillId,
	}
}

integration('BillService coalesced billing SQL', () => {
	beforeAll(() => {
		if (!hasDatabase) return
		db = createDb(process.env.TEST_DATABASE_URL!)
		service = new BillService(db)
	})

	beforeEach(async () => {
		await cleanUpTestBills()
	})

	afterEach(cleanUpTestBills)

	it('paginates group bills as one row and aggregates all children', async () => {
		const issuerId = crypto.randomUUID()
		const groupBillId = crypto.randomUUID()
		const groupIds = Array.from({ length: 20 }, () => crypto.randomUUID())
		const standaloneIds = Array.from({ length: 9 }, () => crypto.randomUUID())
		billIds = [...groupIds, ...standaloneIds]

		await db
			.insert(bills)
			.values([
				...groupIds.map((id, index) =>
					bill(issuerId, id, groupBillId, index === 0 ? 'paid' : 'issued')
				),
				...standaloneIds.map((id) => bill(issuerId, id, null, 'issued')),
			])

		const page = await service.listBillsPage({
			scope: { mode: 'all' },
			filters: { issuerId },
			limit: 10,
			offset: 0,
			coalesced: true,
			sortBy: 'createdAt',
			sortDir: 'asc',
		})

		expect(page.rowCount).toBe(10)
		expect(page.rows).toHaveLength(10)
		const group = page.rows.find((row) => row.groupBillId === groupBillId)
		expect(group?.groupBillTotalCount).toBe(20)
		expect(group?.groupBillPaidCount).toBe(1)
		expect(group?.groupBillMixed).toBe(true)
	})

	it('filters matching children without shrinking the aggregate group counts', async () => {
		const issuerId = crypto.randomUUID()
		const groupBillId = crypto.randomUUID()
		const groupIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
		billIds = groupIds

		await db
			.insert(bills)
			.values([
				bill(issuerId, groupIds[0]!, groupBillId, 'paid'),
				bill(issuerId, groupIds[1]!, groupBillId, 'issued'),
				bill(issuerId, groupIds[2]!, groupBillId, 'issued'),
			])

		const page = await service.listBillsPage({
			scope: { mode: 'all' },
			filters: { issuerId, status: 'paid' },
			limit: 10,
			offset: 0,
			coalesced: true,
		})

		expect(page.rowCount).toBe(1)
		expect(page.rows[0]?.groupBillTotalCount).toBe(3)
		expect(page.rows[0]?.groupBillPaidCount).toBe(1)
		expect(page.rows[0]?.groupBillMixed).toBe(true)
	})
})
