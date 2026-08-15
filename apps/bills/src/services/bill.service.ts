import { and, asc, desc, eq, gte, inArray, lte, or, sql } from '@repo/db-utils'

import { billPayments, bills, billStatusEvents } from '../db/schema'
import { calculateLateFee } from '../utils/late-fees'
import { generatePaymentToken } from '../utils/token'
import { generateUuidV7 } from '../utils/uuid'

import type { SQL } from 'drizzle-orm'
import type {
	Bill,
	BillExternalRef,
	BillFilters,
	BillIntegrationView,
	BillListPage,
	BillListQuery,
	BillListScopeEntity,
	BillMetadata,
	BillPartySearchQuery,
	BillPartySearchRow,
	BillStatistics,
	BillStatus,
	BillStatusEvent,
	BillStatusEventByPayerPage,
	BillStatusEventByPayerPageQuery,
	BillStatusEventPage,
	BillStatusEventPageQuery,
	BillStatusEventType,
	BillWithDetails,
	CreateBillInput,
	EntityType,
	GroupBillAggregate,
	GroupBillEntry,
	GroupBillOperationResult,
	RegenerateTokenResponse,
	UpdateBillInput,
} from '@repo/bills'
import type { BillsDb } from '../db'

function parseISKToMinorUnits(value: string): bigint | null {
	const normalized = value.trim()
	if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
		return null
	}

	const [wholePart, fractionPart = ''] = normalized.split('.')
	const paddedFraction = `${fractionPart}00`.slice(0, 2)

	try {
		return BigInt(`${wholePart}${paddedFraction}`)
	} catch {
		return null
	}
}

export interface WalletPaymentInput {
	amount: bigint
	paidById: string
	paidByType: EntityType
	esiTransactionId: string
}

/**
 * Bill Service
 *
 * Handles bill lifecycle operations including:
 * - Creation, updates, and status transitions
 * - Late fee calculations
 * - Payment processing
 * - Authorization checks
 */
export class BillService {
	constructor(private db: BillsDb) {}

	/**
	 * Create a new bill
	 */
	async createBill(userId: string, data: CreateBillInput): Promise<Bill> {
		return this.createBillInternal(userId, data)
	}

	/**
	 * Create a bill from an external source idempotently.
	 */
	async createBillFromExternalSource(
		userId: string,
		externalRef: BillExternalRef,
		data: CreateBillInput
	): Promise<Bill> {
		const sourceType = externalRef.sourceType.trim()
		const sourceId = externalRef.sourceId.trim()
		if (!sourceType || !sourceId) {
			throw new Error('externalRef sourceType and sourceId are required')
		}

		const existing = await this.db.query.bills.findFirst({
			where: and(eq(bills.externalSourceType, sourceType), eq(bills.externalSourceId, sourceId)),
		})
		if (existing) {
			return this.toBillResponse(existing)
		}

		try {
			return await this.createBillInternal(userId, data, {
				sourceType,
				sourceId,
				metadata: externalRef.metadata ?? null,
			})
		} catch (error) {
			// Handle race conditions on unique external source key.
			const raced = await this.db.query.bills.findFirst({
				where: and(eq(bills.externalSourceType, sourceType), eq(bills.externalSourceId, sourceId)),
			})
			if (raced) {
				return this.toBillResponse(raced)
			}
			throw error
		}
	}

	async getBillIntegrationView(billId: string): Promise<BillIntegrationView | null> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
			with: {
				template: true,
				schedule: true,
				payments: true,
			},
		})
		if (!bill) {
			return null
		}

		const updatedBill = await this.updateLateFeeIfNeeded(bill)
		return this.toBillWithDetailsResponse(updatedBill)
	}

	async getGroupBillAggregate(groupBillId: string): Promise<GroupBillAggregate | null> {
		const rows = await this.db.query.bills.findMany({
			where: eq(bills.groupBillId, groupBillId),
			with: { payments: true },
			orderBy: (bills, { asc }) => [asc(bills.createdAt)],
		})

		if (rows.length === 0) {
			return null
		}

		const first = rows[0]
		const groupId = (first.externalMetadata as Record<string, unknown> | null)?.groupId as
			| string
			| undefined

		const billEntries: GroupBillEntry[] = rows.map((b) => {
			const totalDue = Number(b.amount) + Number(b.lateFee)
			const totalPaid = (b.payments ?? []).reduce((s, p) => s + Number(p.amount), 0)
			return {
				billId: b.id,
				payerId: b.payerId,
				status: b.status as BillStatus,
				amount: b.amount,
				lateFee: b.lateFee,
				totalDue: totalDue.toString(),
				totalPaid: totalPaid.toString(),
				paidAt: b.paidAt,
			}
		})

		const paidBills = rows.filter((b) => b.status === 'paid').length

		return {
			groupBillId,
			groupId: groupId ?? '',
			issuerId: first.issuerId,
			title: first.title,
			description: first.description,
			amount: first.amount,
			dueDate: first.dueDate,
			createdAt: first.createdAt,
			totalBills: rows.length,
			paidBills,
			bills: billEntries,
		}
	}

	async listBillsByExternalSource(
		sourceType: string,
		sourceIds: string[]
	): Promise<BillIntegrationView[]> {
		const normalizedSourceType = sourceType.trim()
		const normalizedSourceIds = sourceIds.map((sourceId) => sourceId.trim()).filter(Boolean)
		if (!normalizedSourceType || normalizedSourceIds.length === 0) {
			return []
		}

		const matchedBills = await this.db.query.bills.findMany({
			where: and(
				eq(bills.externalSourceType, normalizedSourceType),
				inArray(bills.externalSourceId, normalizedSourceIds)
			),
			with: {
				template: true,
				schedule: true,
				payments: true,
			},
			orderBy: (bills, { desc }) => [desc(bills.createdAt)],
		})

		const updatedResults = await Promise.all(
			matchedBills.map((bill) => this.updateLateFeeIfNeeded(bill))
		)
		return updatedResults.map((bill) => this.toBillWithDetailsResponse(bill))
	}

	async getBillTimeline(billId: string): Promise<BillStatusEvent[]> {
		const events = await this.db.query.billStatusEvents.findMany({
			where: eq(billStatusEvents.billId, billId),
			orderBy: (billStatusEvents, { asc }) => [asc(billStatusEvents.createdAt)],
		})

		return events.map((event) => ({
			id: event.id,
			billId: event.billId,
			eventType: event.eventType,
			fromStatus: event.fromStatus,
			toStatus: event.toStatus,
			actorUserId: event.actorUserId,
			metadata: event.metadata ?? null,
			createdAt: event.createdAt,
		}))
	}

	async getBillTimelines(billIds: string[]): Promise<Record<string, BillStatusEvent[]>> {
		const normalizedBillIds = Array.from(new Set(billIds.map((billId) => billId.trim()))).filter(
			Boolean
		)
		if (normalizedBillIds.length === 0) {
			return {}
		}

		const events = await this.db.query.billStatusEvents.findMany({
			where: inArray(billStatusEvents.billId, normalizedBillIds),
			orderBy: (billStatusEvents, { asc }) => [
				asc(billStatusEvents.billId),
				asc(billStatusEvents.createdAt),
			],
		})

		const timelinesByBillId: Record<string, BillStatusEvent[]> = {}
		for (const billId of normalizedBillIds) {
			timelinesByBillId[billId] = []
		}

		for (const event of events) {
			const bucket = timelinesByBillId[event.billId]
			if (!bucket) {
				continue
			}
			bucket.push({
				id: event.id,
				billId: event.billId,
				eventType: event.eventType,
				fromStatus: event.fromStatus,
				toStatus: event.toStatus,
				actorUserId: event.actorUserId,
				metadata: event.metadata ?? null,
				createdAt: event.createdAt,
			})
		}

		return timelinesByBillId
	}

	async listBillStatusEventsPage(query: BillStatusEventPageQuery): Promise<BillStatusEventPage> {
		const normalizedLimit = Number.isFinite(query.limit)
			? Math.max(1, Math.min(200, Math.floor(query.limit)))
			: 25
		const normalizedOffset = Number.isFinite(query.offset)
			? Math.max(0, Math.floor(query.offset))
			: 0
		const normalizedBillIds = [
			...new Set(query.billIds.map((billId) => billId.trim()).filter(Boolean)),
		]
		if (normalizedBillIds.length === 0) {
			return { rows: [], rowCount: 0 }
		}

		const countRows = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(billStatusEvents)
			.where(inArray(billStatusEvents.billId, normalizedBillIds))
		const rowCount = countRows[0]?.count ?? 0
		if (rowCount === 0) {
			return { rows: [], rowCount }
		}

		const rows = await this.db.query.billStatusEvents.findMany({
			where: inArray(billStatusEvents.billId, normalizedBillIds),
			orderBy: (events, operators) => [
				(query.sortDir === 'asc' ? operators.asc : operators.desc)(
					query.sortBy === 'eventType'
						? events.eventType
						: query.sortBy === 'billId'
							? events.billId
							: query.sortBy === 'actorUserId'
								? events.actorUserId
								: events.createdAt
				),
				operators.desc(events.id),
			],
			limit: normalizedLimit,
			offset: normalizedOffset,
		})

		return {
			rows: rows.map((event) => ({
				id: event.id,
				billId: event.billId,
				eventType: event.eventType,
				fromStatus: event.fromStatus,
				toStatus: event.toStatus,
				actorUserId: event.actorUserId,
				metadata: event.metadata ?? null,
				createdAt: event.createdAt,
			})),
			rowCount,
		}
	}

	async listBillStatusEventsByPayerPage(
		query: BillStatusEventByPayerPageQuery
	): Promise<BillStatusEventByPayerPage> {
		const normalizedLimit = Number.isFinite(query.limit)
			? Math.max(1, Math.min(200, Math.floor(query.limit)))
			: 25
		const normalizedOffset = Number.isFinite(query.offset)
			? Math.max(0, Math.floor(query.offset))
			: 0
		const conditions = [eq(bills.payerId, query.payerId), eq(bills.payerType, query.payerType)]
		if (query.externalSourceType) {
			conditions.push(eq(bills.externalSourceType, query.externalSourceType))
		}
		const where = and(...conditions)
		const countRows = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(billStatusEvents)
			.innerJoin(bills, eq(billStatusEvents.billId, bills.id))
			.where(where)
		const rowCount = countRows[0]?.count ?? 0
		if (rowCount === 0) return { rows: [], rowCount }

		const rows = await this.db
			.select({ event: billStatusEvents, bill: bills })
			.from(billStatusEvents)
			.innerJoin(bills, eq(billStatusEvents.billId, bills.id))
			.where(where)
			.orderBy(
				(query.sortDir === 'asc' ? asc : desc)(
					query.sortBy === 'eventType'
						? billStatusEvents.eventType
						: query.sortBy === 'billId'
							? billStatusEvents.billId
							: query.sortBy === 'actorUserId'
								? billStatusEvents.actorUserId
								: billStatusEvents.createdAt
				),
				desc(billStatusEvents.id)
			)
			.limit(normalizedLimit)
			.offset(normalizedOffset)

		return {
			rows: rows.map(({ event, bill }) => ({
				id: event.id,
				billId: event.billId,
				eventType: event.eventType,
				fromStatus: event.fromStatus,
				toStatus: event.toStatus,
				actorUserId: event.actorUserId,
				metadata: event.metadata ?? null,
				createdAt: event.createdAt,
				externalSourceType: bill.externalSourceType,
				externalSourceId: bill.externalSourceId,
			})),
			rowCount,
		}
	}

	/**
	 * Get a specific bill with authorization check
	 */
	async getBill(userId: string, billId: string): Promise<BillWithDetails | null> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
			with: {
				template: true,
				schedule: true,
				payments: true,
			},
		})

		if (!bill) {
			return null
		}

		// Authorization: User must be issuer or payer
		if (bill.issuerId !== userId && bill.payerId !== userId) {
			throw new Error('Not authorized to view this bill')
		}

		// Update late fees if bill is issued and overdue
		const updatedBill = await this.updateLateFeeIfNeeded(bill)

		return this.toBillWithDetailsResponse(updatedBill)
	}

	/**
	 * List bills with filters
	 */
	async listBills(userId: string, filters: BillFilters = {}): Promise<BillWithDetails[]> {
		const conditions: SQL[] = []
		const userAccessCondition = or(eq(bills.issuerId, userId), eq(bills.payerId, userId))
		if (userAccessCondition) {
			conditions.push(userAccessCondition)
		}

		conditions.push(...this.buildBillFilterConditions(filters))
		const whereCondition = this.buildWhereCondition(conditions)

		const results = await this.db.query.bills.findMany({
			where: whereCondition,
			orderBy: (bills, { desc }) => [desc(bills.createdAt)],
			with: {
				template: true,
				schedule: true,
				payments: true,
			},
		})

		// Update late fees for issued/overdue bills
		const updatedResults = await Promise.all(
			results.map((bill) => this.updateLateFeeIfNeeded(bill))
		)

		return updatedResults.map((bill) => this.toBillWithDetailsResponse(bill))
	}

	async listBillsPage(query: BillListQuery): Promise<BillListPage> {
		const normalizedLimit = Number.isFinite(query.limit)
			? Math.max(1, Math.min(200, Math.floor(query.limit)))
			: 25
		const normalizedOffset = Number.isFinite(query.offset)
			? Math.max(0, Math.floor(query.offset))
			: 0
		const sortBy = query.sortBy ?? 'dueDate'
		const sortDir = query.sortDir ?? 'asc'
		const conditions: SQL[] = []

		if (query.scope.mode === 'my') {
			const scopeCondition = this.buildMyScopeCondition(
				query.scope.issuerIds,
				query.scope.partyEntities
			)
			conditions.push(scopeCondition)
		}
		conditions.push(...this.buildBillFilterConditions(query.filters ?? {}))
		const whereCondition = this.buildWhereCondition(conditions)

		const [countRow] = await this.db
			.select({ rowCount: sql<number>`count(*)::int` })
			.from(bills)
			.where(whereCondition)
		const rowCount = countRow?.rowCount ?? 0
		if (rowCount === 0) {
			return { rows: [], rowCount: 0 }
		}

		const results = await this.db.query.bills.findMany({
			where: whereCondition,
			orderBy: (table, ordering) => {
				if (sortBy === 'createdAt') {
					return [
						sortDir === 'asc' ? ordering.asc(table.createdAt) : ordering.desc(table.createdAt),
						ordering.desc(table.id),
					]
				}
				if (sortBy === 'updatedAt') {
					return [
						sortDir === 'asc' ? ordering.asc(table.updatedAt) : ordering.desc(table.updatedAt),
						ordering.desc(table.id),
					]
				}
				if (sortBy === 'status') {
					return [
						sortDir === 'asc' ? ordering.asc(table.status) : ordering.desc(table.status),
						ordering.desc(table.id),
					]
				}
				if (sortBy === 'amount') {
					const amountOrder =
						sortDir === 'asc'
							? asc(sql<number>`(${table.amount})::numeric`)
							: desc(sql<number>`(${table.amount})::numeric`)
					return [amountOrder, ordering.desc(table.id)]
				}
				return [
					sortDir === 'asc' ? ordering.asc(table.dueDate) : ordering.desc(table.dueDate),
					ordering.desc(table.id),
				]
			},
			limit: normalizedLimit,
			offset: normalizedOffset,
		})
		const updatedResults = await Promise.all(
			results.map((bill) => this.updateLateFeeIfNeeded(bill))
		)
		return {
			rows: updatedResults.map((bill) => this.toBillWithDetailsResponse(bill)),
			rowCount,
		}
	}

	async searchBillParties(query: BillPartySearchQuery): Promise<BillPartySearchRow[]> {
		const normalizedLimit = Number.isFinite(query.limit)
			? Math.max(1, Math.min(100, Math.floor(query.limit ?? 25)))
			: 25
		const direction = query.direction ?? 'any'
		const normalizedEntityType = query.entityType
		const normalizedQ = query.q?.trim()
		const scopeConditions: SQL[] = []
		if (query.scope.mode === 'my') {
			scopeConditions.push(
				this.buildMyScopeCondition(query.scope.issuerIds, query.scope.partyEntities)
			)
		}
		const scopeWhere = this.buildSqlWhere(scopeConditions)

		const payerSource = sql`
			select
				b.payer_id as entity_id,
				b.payer_type::text as entity_type
			from ${bills} b
			${scopeWhere}
			and b.payer_id is not null
		`
		const payeeSource = sql`
			select
				b.payee_id as entity_id,
				b.payee_type::text as entity_type
			from ${bills} b
			${scopeWhere}
			and b.payee_id is not null
			and b.payee_type is not null
		`
		const partyRowsSql =
			direction === 'payer'
				? payerSource
				: direction === 'payee'
					? payeeSource
					: sql`${payerSource} union all ${payeeSource}`

		const postFilters: SQL[] = []
		if (normalizedEntityType) {
			postFilters.push(sql`entity_type = ${normalizedEntityType}`)
		}
		if (normalizedQ && normalizedQ.length > 0) {
			postFilters.push(sql`entity_id ilike ${`%${normalizedQ}%`}`)
		}
		const postFilterSql = this.buildSqlWhere(postFilters)

		const rows = await this.db.execute<{
			entity_id: string
			entity_type: string
			usage_count: number
		}>(sql`
			with party_rows as (
				${partyRowsSql}
			)
			select
				entity_id,
				entity_type,
				count(*)::int as usage_count
			from party_rows
			${postFilterSql}
			group by entity_id, entity_type
			order by usage_count desc, entity_id asc
			limit ${normalizedLimit}
		`)

		return rows.rows
			.filter((row) => row.entity_id && row.entity_type)
			.map((row) => ({
				entityId: row.entity_id,
				entityType: row.entity_type as BillPartySearchRow['entityType'],
				usageCount: Number(row.usage_count || 0),
			}))
	}

	/**
	 * Update a bill (permissions enforced by caller route; blocked when paid or when payments exist)
	 */
	async updateBill(actorUserId: string, billId: string, data: UpdateBillInput): Promise<Bill> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) {
			throw new Error('Bill not found')
		}

		if (bill.status === 'paid') {
			throw new Error('Cannot update a paid bill')
		}

		if (await this.hasPayments(billId)) {
			throw new Error('Cannot update a bill that has payments')
		}

		const [updated] = await this.db
			.update(bills)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(eq(bills.id, billId))
			.returning()

		return this.toBillResponse(updated)
	}

	/**
	 * Issue a bill (change status from draft to issued)
	 */
	async issueBill(actorUserId: string, billId: string): Promise<Bill> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) {
			throw new Error('Bill not found')
		}

		if (bill.status !== 'draft') {
			throw new Error('Only draft bills can be issued')
		}

		const transitioned = await this.applyStatusTransitionAtomic({
			billId,
			fromStatus: bill.status,
			toStatus: 'issued',
			eventType: 'issued',
			actorUserId,
		})
		if (!transitioned) {
			throw new Error('Bill status changed during issue; please retry')
		}

		const updated = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})
		if (!updated) {
			throw new Error('Bill not found after issue')
		}
		return this.toBillResponse(updated)
	}

	/**
	 * Cancel a bill (permissions enforced by caller route)
	 */
	async cancelBill(actorUserId: string, billId: string): Promise<Bill> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) {
			throw new Error('Bill not found')
		}

		if (bill.status === 'paid') {
			throw new Error('Cannot cancel a paid bill')
		}

		if (bill.status === 'cancelled') {
			throw new Error('Bill is already cancelled')
		}

		const transitioned = await this.applyStatusTransitionAtomic({
			billId,
			fromStatus: bill.status,
			toStatus: 'cancelled',
			eventType: 'cancelled',
			actorUserId,
		})
		if (!transitioned) {
			throw new Error('Bill status changed during cancel; please retry')
		}

		const updated = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})
		if (!updated) {
			throw new Error('Bill not found after cancel')
		}
		return this.toBillResponse(updated)
	}

	/**
	 * Mark bill as paid from an admin action.
	 */
	async markBillPaid(actorUserId: string, billId: string): Promise<Bill> {
		return this.markBillAsPaid(billId, actorUserId)
	}

	/**
	 * Revert a bill to draft (permissions enforced by caller route; blocked when paid or when payments exist)
	 */
	async revertBillToDraft(actorUserId: string, billId: string): Promise<Bill> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) {
			throw new Error('Bill not found')
		}

		if (bill.status === 'draft') {
			return this.toBillResponse(bill)
		}

		if (bill.status === 'paid') {
			throw new Error('Cannot revert a paid bill to draft')
		}

		if (await this.hasPayments(billId)) {
			throw new Error('Cannot revert a bill with payments to draft')
		}

		// Keep event type within existing enum while tracking the explicit target status.
		const transitioned = await this.applyStatusTransitionAtomic({
			billId,
			fromStatus: bill.status,
			toStatus: 'draft',
			eventType: 'created',
			actorUserId,
			metadata: {
				reason: 'reverted_to_draft',
			},
		})
		if (!transitioned) {
			throw new Error('Bill status changed during draft revert; please retry')
		}

		const updated = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})
		if (!updated) {
			throw new Error('Bill not found after draft revert')
		}
		return this.toBillResponse(updated)
	}

	/**
	 * Record wallet payments in bounded, idempotent batches.
	 */
	async recordWalletPayments(
		billId: string,
		payments: readonly WalletPaymentInput[]
	): Promise<number> {
		const uniquePayments = Array.from(
			new Map(payments.map((payment) => [payment.esiTransactionId, payment])).values()
		)
		if (uniquePayments.length === 0) {
			return 0
		}

		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) {
			throw new Error('Bill not found')
		}

		if (bill.status === 'paid') {
			throw new Error('Bill is already paid')
		}

		if (bill.status === 'cancelled') {
			throw new Error('Bill has been cancelled')
		}

		if (bill.status === 'draft') {
			throw new Error('Bill has not been issued yet')
		}

		// Late fees and the issued-to-overdue transition only need to be evaluated once for the
		// batch. Each batch insert below is atomic with its payment-recorded events.
		const updatedBill = await this.updateLateFeeIfNeeded(bill)
		let insertedCount = 0
		const batchSize = 50

		for (let offset = 0; offset < uniquePayments.length; offset += batchSize) {
			insertedCount += await this.insertWalletPaymentBatch(
				updatedBill,
				uniquePayments.slice(offset, offset + batchSize)
			)
		}

		return insertedCount
	}

	private async insertWalletPaymentBatch(
		bill: typeof bills.$inferSelect,
		payments: readonly WalletPaymentInput[]
	): Promise<number> {
		const inputValues = sql.join(
			payments.map((payment) => {
				const paymentId = generateUuidV7()
				const eventId = generateUuidV7()
				const paidAt = new Date()

				return sql`(
					${paymentId}::uuid,
					${eventId}::uuid,
					${bill.id}::uuid,
					${bill.paymentToken},
					${payment.esiTransactionId},
					${payment.amount.toString()},
					${payment.paidById},
					${payment.paidByType}::bill_entity_type,
					${paidAt}::timestamptz
				)`
			}),
			sql`, `
		)

		const result = await this.db.execute<{ insertedCount: number | string }>(sql`
			with payment_input (
				payment_id,
				event_id,
				bill_id,
				payment_token,
				esi_transaction_id,
				amount,
				paid_by_id,
				paid_by_type,
				paid_at
			) as (
				values ${inputValues}
			), inserted_payments as (
				insert into bill_payments (
					id,
					bill_id,
					payment_token,
					esi_transaction_id,
					amount,
					paid_by_id,
					paid_by_type,
					paid_at
				)
				select
					payment_id,
					bill_id,
					payment_token,
					esi_transaction_id,
					amount,
					paid_by_id,
					paid_by_type,
					paid_at
				from payment_input
				on conflict (esi_transaction_id) do nothing
				returning bill_id, esi_transaction_id, amount, paid_by_id, paid_by_type
			), inserted_events as (
				insert into bill_status_events (
					id,
					bill_id,
					event_type,
					from_status,
					to_status,
					actor_user_id,
					metadata
				)
				select
					payment_input.event_id,
					inserted_payments.bill_id,
					'payment_recorded'::bill_status_event_type,
					null::bill_status,
					null::bill_status,
					null,
					jsonb_build_object(
						'amount', inserted_payments.amount,
						'paidById', inserted_payments.paid_by_id,
						'paidByType', inserted_payments.paid_by_type,
						'esiTransactionId', inserted_payments.esi_transaction_id
					)
				from inserted_payments
				inner join payment_input
					on payment_input.bill_id = inserted_payments.bill_id
					and payment_input.esi_transaction_id = inserted_payments.esi_transaction_id
				returning id
			)
			select count(*)::int as "insertedCount"
			from inserted_payments
		`)

		return Number(result.rows[0]?.insertedCount ?? 0)
	}

	/**
	 * Pay a bill using payment token
	 */
	async payBill(
		paymentToken: string,
		{
			amount,
			paidById,
			paidByType,
			esiTransactionId,
		}: {
			amount: bigint
			paidById: string
			paidByType: EntityType
			esiTransactionId: string
		}
	): Promise<typeof billPayments.$inferSelect> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.paymentToken, paymentToken),
		})

		if (!bill) {
			throw new Error('Invalid payment token')
		}

		if (bill.status === 'paid') {
			throw new Error('Bill is already paid')
		}

		if (bill.status === 'cancelled') {
			throw new Error('Bill has been cancelled')
		}

		if (bill.status === 'draft') {
			throw new Error('Bill has not been issued yet')
		}

		// Update late fee before marking as paid
		const updatedBill = await this.updateLateFeeIfNeeded(bill)

		const existingPayment = await this.db.query.billPayments.findFirst({
			where: eq(billPayments.esiTransactionId, esiTransactionId),
		})

		if (existingPayment) {
			return existingPayment
		}

		const [payment] = await this.db
			.insert(billPayments)
			.values({
				billId: updatedBill.id,
				paymentToken,
				amount: amount.toString(),
				paidById,
				paidByType,
				paidAt: new Date(),
				esiTransactionId,
			})
			.returning()

		await this.createStatusEvent({
			billId: updatedBill.id,
			eventType: 'payment_recorded',
			fromStatus: null,
			toStatus: null,
			actorUserId: null,
			metadata: {
				amount: payment.amount,
				paidById,
				paidByType,
				esiTransactionId: payment.esiTransactionId,
			},
		})

		return payment
	}

	/**
	 * Regenerate payment token for a bill (permissions enforced by caller route)
	 */
	async regeneratePaymentToken(
		actorUserId: string,
		billId: string
	): Promise<RegenerateTokenResponse> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) {
			throw new Error('Bill not found')
		}

		if (bill.status === 'paid' || bill.status === 'cancelled') {
			throw new Error('Cannot regenerate token for paid or cancelled bills')
		}

		if (await this.hasPayments(billId)) {
			throw new Error('Cannot regenerate token for a bill that has payments')
		}

		const newToken = generatePaymentToken()

		await this.db
			.update(bills)
			.set({
				paymentToken: newToken,
				updatedAt: new Date(),
			})
			.where(eq(bills.id, billId))

		await this.createStatusEvent({
			billId: bill.id,
			eventType: 'payment_token_regenerated',
			fromStatus: bill.status,
			toStatus: bill.status,
			actorUserId,
		})

		return {
			token: newToken,
			billId,
		}
	}

	private async hasPayments(billId: string): Promise<boolean> {
		const existingPayment = await this.db.query.billPayments.findFirst({
			where: eq(billPayments.billId, billId),
			columns: { id: true },
		})
		return Boolean(existingPayment)
	}

	/**
	 * Delete a bill (draft only)
	 */
	async deleteBill(_actorUserId: string, billId: string): Promise<void> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) {
			throw new Error('Bill not found')
		}

		if (bill.status !== 'draft') {
			throw new Error('Only draft bills can be deleted')
		}

		await this.db.delete(bills).where(eq(bills.id, billId))
	}

	/**
	 * Issue all eligible (draft) sub-bills sharing a groupBillId
	 */
	async issueGroupBill(
		actorUserId: string,
		groupBillId: string
	): Promise<GroupBillOperationResult> {
		const subBills = await this.db.query.bills.findMany({
			where: eq(bills.groupBillId, groupBillId),
		})
		const result: GroupBillOperationResult = { succeeded: 0, skipped: 0, bills: [] }
		for (const bill of subBills) {
			if (bill.status !== 'draft') {
				result.skipped++
				continue
			}
			const updated = await this.issueBill(actorUserId, bill.id)
			result.succeeded++
			result.bills.push(updated)
		}
		return result
	}

	/**
	 * Cancel all eligible sub-bills sharing a groupBillId
	 */
	async cancelGroupBill(
		actorUserId: string,
		groupBillId: string
	): Promise<GroupBillOperationResult> {
		const subBills = await this.db.query.bills.findMany({
			where: eq(bills.groupBillId, groupBillId),
		})
		const result: GroupBillOperationResult = { succeeded: 0, skipped: 0, bills: [] }
		for (const bill of subBills) {
			if (bill.status === 'paid' || bill.status === 'cancelled') {
				result.skipped++
				continue
			}
			const updated = await this.cancelBill(actorUserId, bill.id)
			result.succeeded++
			result.bills.push(updated)
		}
		return result
	}

	/**
	 * Revert all eligible sub-bills sharing a groupBillId to draft
	 */
	async revertGroupBillToDraft(
		actorUserId: string,
		groupBillId: string
	): Promise<GroupBillOperationResult> {
		const subBills = await this.db.query.bills.findMany({
			where: eq(bills.groupBillId, groupBillId),
		})
		const result: GroupBillOperationResult = { succeeded: 0, skipped: 0, bills: [] }
		for (const bill of subBills) {
			if (bill.status === 'draft' || bill.status === 'paid') {
				result.skipped++
				continue
			}
			if (await this.hasPayments(bill.id)) {
				result.skipped++
				continue
			}
			const updated = await this.revertBillToDraft(actorUserId, bill.id)
			result.succeeded++
			result.bills.push(updated)
		}
		return result
	}

	/**
	 * Delete all eligible (draft) sub-bills sharing a groupBillId
	 */
	async deleteGroupBill(
		actorUserId: string,
		groupBillId: string
	): Promise<GroupBillOperationResult> {
		const subBills = await this.db.query.bills.findMany({
			where: eq(bills.groupBillId, groupBillId),
		})
		const result: GroupBillOperationResult = { succeeded: 0, skipped: 0, bills: [] }
		for (const bill of subBills) {
			if (bill.status !== 'draft') {
				result.skipped++
				continue
			}
			await this.deleteBill(actorUserId, bill.id)
			result.succeeded++
		}
		return result
	}

	/**
	 * Update shared fields on all eligible sub-bills sharing a groupBillId
	 */
	async updateGroupBill(
		actorUserId: string,
		groupBillId: string,
		data: UpdateBillInput
	): Promise<GroupBillOperationResult> {
		const subBills = await this.db.query.bills.findMany({
			where: eq(bills.groupBillId, groupBillId),
		})
		const result: GroupBillOperationResult = { succeeded: 0, skipped: 0, bills: [] }
		for (const bill of subBills) {
			if (bill.status === 'paid') {
				result.skipped++
				continue
			}
			if (await this.hasPayments(bill.id)) {
				result.skipped++
				continue
			}
			const updated = await this.updateBill(actorUserId, bill.id, data)
			result.succeeded++
			result.bills.push(updated)
		}
		return result
	}

	async checkBillBalancePaid(billId: string): Promise<boolean> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) {
			throw new Error('Bill not found')
		}
		const totalAmount = parseISKToMinorUnits(bill.amount)
		const lateFeeAmount = parseISKToMinorUnits(bill.lateFee)
		if (totalAmount === null || lateFeeAmount === null) {
			throw new Error('Bill amount or late fee is invalid')
		}

		const [paymentTotal] = await this.db
			.select({
				paidAmount: sql<string>`coalesce(sum(${billPayments.amount}::numeric), 0)`,
			})
			.from(billPayments)
			.where(eq(billPayments.billId, billId))
		const paidAmount = parseISKToMinorUnits(paymentTotal?.paidAmount ?? '0')
		if (paidAmount === null) {
			throw new Error(`Invalid payment amount for bill ${billId}`)
		}

		return paidAmount >= totalAmount + lateFeeAmount
	}

	async markBillAsPaid(billId: string, actorUserId: string | null = null): Promise<Bill> {
		const existingBill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})
		if (!existingBill) {
			throw new Error('Bill not found')
		}
		if (existingBill.status === 'paid') {
			return this.toBillResponse(existingBill)
		}
		if (existingBill.status === 'draft') {
			throw new Error('Cannot mark a draft bill as paid')
		}
		if (existingBill.status === 'cancelled') {
			throw new Error('Cannot mark a cancelled bill as paid')
		}

		const paidAt = new Date()

		const transitioned = await this.applyStatusTransitionAtomic({
			billId,
			fromStatus: existingBill.status,
			toStatus: 'paid',
			eventType: 'paid',
			actorUserId,
			paidAt,
			metadata: actorUserId ? { source: 'admin_mark_paid' } : { source: 'system_mark_paid' },
		})
		if (!transitioned) {
			const currentBill = await this.db.query.bills.findFirst({
				where: eq(bills.id, billId),
			})
			if (currentBill?.status === 'paid') {
				return this.toBillResponse(currentBill)
			}
			throw new Error('Bill status changed during payment finalization; please retry')
		}

		// Ensure manual/system mark-paid operations leave an explicit status-only payment-history marker.
		const manualTransactionId = `manual-status-paid:${billId}:${generateUuidV7()}`
		await this.db.insert(billPayments).values({
			billId,
			paymentToken: existingBill.paymentToken,
			esiTransactionId: manualTransactionId,
			amount: '0',
			paidById: actorUserId ?? 'system',
			paidByType: 'character',
			paidAt,
		})
		await this.createStatusEvent({
			billId,
			eventType: 'payment_recorded',
			fromStatus: null,
			toStatus: null,
			actorUserId,
			metadata: {
				amount: '0',
				source: actorUserId ? 'admin_mark_paid' : 'system_mark_paid',
				manual: true,
				statusOnly: true,
			},
		})

		const updatedBill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})
		if (!updatedBill) {
			throw new Error('Bill not found after payment finalization')
		}
		return this.toBillResponse(updatedBill)
	}

	/**
	 * Re-evaluate bill lifecycle status for overdue/late-fee transitions.
	 * Returns transition flags so callers can trigger downstream sync only when needed.
	 */
	async refreshBillLifecycleStatus(billId: string): Promise<{
		overdueMarked: boolean
		lateFeeChanged: boolean
		billStatus: BillStatus
	}> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})
		if (!bill) {
			throw new Error('Bill not found')
		}

		const previousStatus = bill.status
		const previousLateFee = bill.lateFee
		const updatedBill = await this.updateLateFeeIfNeeded(bill)

		return {
			overdueMarked: previousStatus !== 'overdue' && updatedBill.status === 'overdue',
			lateFeeChanged: previousLateFee !== updatedBill.lateFee,
			billStatus: updatedBill.status,
		}
	}
	/**
	 * Get bill statistics for a user
	 */
	async getBillStatistics(userId: string, filters: BillFilters = {}): Promise<BillStatistics> {
		const conditions: SQL[] = []
		const userAccessCondition = or(eq(bills.issuerId, userId), eq(bills.payerId, userId))
		if (userAccessCondition) {
			conditions.push(userAccessCondition)
		}

		conditions.push(...this.buildBillFilterConditions(filters))
		const whereCondition = this.buildWhereCondition(conditions)

		const userBills = await this.db.query.bills.findMany({
			where: whereCondition,
		})

		// Calculate statistics
		const stats: BillStatistics = {
			totalBills: userBills.length,
			totalAmount: '0',
			paidAmount: '0',
			overdueAmount: '0',
			billsByStatus: {
				draft: 0,
				issued: 0,
				paid: 0,
				cancelled: 0,
				overdue: 0,
			},
		}

		let totalAmount = 0
		let paidAmount = 0
		let overdueAmount = 0

		for (const bill of userBills) {
			const amount = parseFloat(bill.amount)
			totalAmount += amount

			if (bill.status === 'paid') {
				paidAmount += amount + parseFloat(bill.lateFee)
			} else if (
				bill.status === 'overdue' ||
				(bill.status === 'issued' && new Date() > bill.dueDate)
			) {
				overdueAmount += amount
			}

			stats.billsByStatus[bill.status as BillStatus]++
		}

		stats.totalAmount = totalAmount.toString()
		stats.paidAmount = paidAmount.toString()
		stats.overdueAmount = overdueAmount.toString()

		return stats
	}

	private async createBillInternal(
		userId: string,
		data: CreateBillInput,
		externalRef?: {
			sourceType: string
			sourceId: string
			metadata: BillMetadata | null
		}
	): Promise<Bill> {
		const billId = generateUuidV7()
		const paymentToken = generatePaymentToken()
		const dueDate = typeof data.dueDate === 'string' ? new Date(data.dueDate) : data.dueDate

		const [bill] = await this.db
			.insert(bills)
			.values({
				id: billId,
				issuerId: userId,
				payerId: data.payerId,
				payerType: data.payerType,
				payeeId: data.payeeId,
				payeeType: data.payeeType,
				title: data.title,
				description: data.description || null,
				amount: data.amount,
				lateFee: '0',
				lateFeeType: data.lateFeeType || 'none',
				lateFeeAmount: data.lateFeeAmount || '0',
				lateFeeCompounding: data.lateFeeCompounding || 'none',
				dueDate,
				status: 'draft',
				paymentToken,
				externalSourceType: externalRef?.sourceType ?? null,
				externalSourceId: externalRef?.sourceId ?? null,
				externalMetadata: data.externalMetadata ?? externalRef?.metadata ?? null,
				groupBillId: data.groupBillId ?? null,
			})
			.returning()

		await this.createStatusEvent({
			billId: bill.id,
			eventType: 'created',
			fromStatus: null,
			toStatus: bill.status,
			actorUserId: userId,
			metadata: externalRef
				? {
						sourceType: externalRef.sourceType,
						sourceId: externalRef.sourceId,
					}
				: null,
		})

		return this.toBillResponse(bill)
	}

	private buildWhereCondition(conditions: SQL[]): SQL | undefined {
		if (conditions.length === 0) {
			return undefined
		}
		if (conditions.length === 1) {
			return conditions[0]
		}
		return and(...conditions)
	}

	private buildBillFilterConditions(filters: BillFilters): SQL[] {
		const conditions: SQL[] = []
		if (filters.status) {
			conditions.push(eq(bills.status, filters.status))
		}
		if (filters.payerId) {
			conditions.push(eq(bills.payerId, filters.payerId))
		}
		if (filters.payeeId) {
			conditions.push(eq(bills.payeeId, filters.payeeId))
		}
		if (filters.issuerId) {
			conditions.push(eq(bills.issuerId, filters.issuerId))
		}
		if (filters.payerType) {
			conditions.push(eq(bills.payerType, filters.payerType))
		}
		if (filters.payeeType) {
			conditions.push(eq(bills.payeeType, filters.payeeType))
		}
		if (filters.dueAfter) {
			conditions.push(gte(bills.dueDate, filters.dueAfter))
		}
		if (filters.dueBefore) {
			conditions.push(lte(bills.dueDate, filters.dueBefore))
		}
		if (filters.createdAfter) {
			conditions.push(gte(bills.createdAt, filters.createdAfter))
		}
		if (filters.createdBefore) {
			conditions.push(lte(bills.createdAt, filters.createdBefore))
		}
		if (filters.templateId) {
			conditions.push(eq(bills.templateId, filters.templateId))
		}
		if (filters.scheduleId) {
			conditions.push(eq(bills.scheduleId, filters.scheduleId))
		}
		return conditions
	}

	private buildMyScopeCondition(issuerIds: string[], partyEntities: BillListScopeEntity[]): SQL {
		const normalizedIssuerIds = [...new Set(issuerIds.map((id) => id.trim()).filter(Boolean))]
		const normalizedPartyEntities = partyEntities
			.map((party) => ({ entityId: party.entityId.trim(), entityType: party.entityType }))
			.filter((party) => party.entityId.length > 0)
		const partyConditions: SQL[] = []
		for (const party of normalizedPartyEntities) {
			const payerMatch = and(
				eq(bills.payerId, party.entityId),
				eq(bills.payerType, party.entityType)
			)
			if (payerMatch) {
				partyConditions.push(payerMatch)
			}
			// Group-scoped visibility only applies to payer entities.
			if (party.entityType !== 'group') {
				const payeeMatch = and(
					eq(bills.payeeId, party.entityId),
					eq(bills.payeeType, party.entityType)
				)
				if (payeeMatch) {
					partyConditions.push(payeeMatch)
				}
			}
		}
		const accessConditions: SQL[] = []
		if (normalizedIssuerIds.length > 0) {
			accessConditions.push(inArray(bills.issuerId, normalizedIssuerIds))
		}
		accessConditions.push(...partyConditions)
		if (accessConditions.length === 0) {
			return sql`false`
		}
		const combined = or(...accessConditions)
		return combined ?? sql`false`
	}

	private buildSqlWhere(conditions: SQL[]): SQL {
		const normalized = conditions.filter(Boolean)
		if (normalized.length === 0) {
			return sql`where true`
		}
		return sql`where ${sql.join(normalized, sql` and `)}`
	}

	private async createStatusEvent(input: {
		billId: string
		eventType: BillStatusEventType
		fromStatus: BillStatus | null
		toStatus: BillStatus | null
		actorUserId: string | null
		metadata?: BillMetadata | null
	}): Promise<void> {
		const fromStatusSql = input.fromStatus
			? sql`${input.fromStatus}::bill_status`
			: sql`null::bill_status`
		const toStatusSql = input.toStatus
			? sql`${input.toStatus}::bill_status`
			: sql`null::bill_status`
		const metadataSql = input.metadata
			? sql`${JSON.stringify(input.metadata)}::jsonb`
			: sql`null::jsonb`

		await this.db.execute(sql`
			insert into bill_status_events (
				id,
				bill_id,
				event_type,
				from_status,
				to_status,
				actor_user_id,
				metadata
			)
			values (
				${generateUuidV7()}::uuid,
				${input.billId}::uuid,
				${input.eventType}::bill_status_event_type,
				${fromStatusSql},
				${toStatusSql},
				${input.actorUserId},
				${metadataSql}
			)
		`)
	}

	private async applyStatusTransitionAtomic(input: {
		billId: string
		fromStatus: BillStatus
		toStatus: BillStatus
		eventType: BillStatusEventType
		actorUserId: string | null
		metadata?: BillMetadata | null
		paidAt?: Date
		lateFee?: string
	}): Promise<boolean> {
		const transitionAt = new Date()
		const paidAtSql = input.paidAt ? sql`, paid_at = ${input.paidAt}` : sql``
		const lateFeeSql = input.lateFee !== undefined ? sql`, late_fee = ${input.lateFee}` : sql``
		const metadataSql = input.metadata
			? sql`${JSON.stringify(input.metadata)}::jsonb`
			: sql`null::jsonb`

		const result = await this.db.execute(sql`
			with updated as (
				update bills
				set
					status = ${input.toStatus}::bill_status,
					updated_at = ${transitionAt}
					${paidAtSql}
					${lateFeeSql}
				where id = ${input.billId}
					and status = ${input.fromStatus}::bill_status
				returning id
			),
			inserted as (
				insert into bill_status_events (
					id,
					bill_id,
					event_type,
					from_status,
					to_status,
					actor_user_id,
					metadata
				)
				select
					${generateUuidV7()}::uuid,
					u.id,
					${input.eventType}::bill_status_event_type,
					${input.fromStatus}::bill_status,
					${input.toStatus}::bill_status,
					${input.actorUserId},
					${metadataSql}
				from updated u
			)
			select id
			from updated
		`)

		return result.rows.length > 0
	}

	/**
	 * Update late fee if bill is overdue
	 * Also updates status to 'overdue' if issued and past due date
	 */
	private async updateLateFeeIfNeeded(bill: any): Promise<any> {
		const now = new Date()

		// Check if bill should be marked as overdue
		if (bill.status === 'issued' && now > bill.dueDate) {
			const lateFee = calculateLateFee({
				amount: bill.amount,
				dueDate: bill.dueDate,
				currentDate: now,
				lateFeeType: bill.lateFeeType,
				lateFeeAmount: bill.lateFeeAmount,
				lateFeeCompounding: bill.lateFeeCompounding,
			})

			const transitioned = await this.applyStatusTransitionAtomic({
				billId: bill.id,
				fromStatus: 'issued',
				toStatus: 'overdue',
				eventType: 'overdue',
				actorUserId: null,
				metadata: {
					dueDate: bill.dueDate.toISOString(),
				},
				lateFee,
			})
			if (transitioned) {
				const updated = await this.db.query.bills.findFirst({
					where: eq(bills.id, bill.id),
				})
				if (updated) {
					return updated
				}
			}

			const current = await this.db.query.bills.findFirst({
				where: eq(bills.id, bill.id),
			})
			return current ?? bill
		}

		// Update late fee for already overdue bills
		if (bill.status === 'overdue') {
			const lateFee = calculateLateFee({
				amount: bill.amount,
				dueDate: bill.dueDate,
				currentDate: now,
				lateFeeType: bill.lateFeeType,
				lateFeeAmount: bill.lateFeeAmount,
				lateFeeCompounding: bill.lateFeeCompounding,
			})

			if (lateFee !== bill.lateFee) {
				const [updated] = await this.db
					.update(bills)
					.set({
						lateFee,
						updatedAt: now,
					})
					.where(eq(bills.id, bill.id))
					.returning()

				return updated
			}
		}

		return bill
	}

	/**
	 * Convert database record to Bill response
	 */
	private toBillResponse(bill: any): Bill {
		return {
			id: bill.id,
			issuerId: bill.issuerId,
			payerId: bill.payerId,
			payerType: bill.payerType,
			payeeId: bill.payeeId,
			payeeType: bill.payeeType,
			templateId: bill.templateId,
			scheduleId: bill.scheduleId,
			title: bill.title,
			description: bill.description,
			amount: bill.amount,
			lateFee: bill.lateFee,
			lateFeeType: bill.lateFeeType,
			lateFeeAmount: bill.lateFeeAmount,
			lateFeeCompounding: bill.lateFeeCompounding,
			dueDate: bill.dueDate,
			status: bill.status,
			paidAt: bill.paidAt,
			paymentToken: bill.paymentToken,
			externalSourceType: bill.externalSourceType,
			externalSourceId: bill.externalSourceId,
			externalMetadata: bill.externalMetadata ?? null,
			groupBillId: bill.groupBillId ?? null,
			createdAt: bill.createdAt,
			updatedAt: bill.updatedAt,
		}
	}

	/**
	 * Convert database record to BillWithDetails response
	 */
	private toBillWithDetailsResponse(bill: any): BillWithDetails {
		return {
			...this.toBillResponse(bill),
			template: bill.template || null,
			schedule: bill.schedule || null,
			payments: bill.payments?.map((p: any) => ({
				id: p.id,
				billId: p.billId,
				paymentToken: p.paymentToken,
				esiTransactionId: p.esiTransactionId,
				amount: p.amount,
				paidById: p.paidById,
				paidByType: p.paidByType,
				paidAt: p.paidAt,
				createdAt: p.createdAt,
			})),
		}
	}
}
