import { MANUAL_BILL_SOURCE } from '@repo/bills'
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
	BillMutationAuthorization,
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

function addISKAmounts(left: string, right: string): string {
	const leftMinor = parseISKToMinorUnits(left)
	const rightMinor = parseISKToMinorUnits(right)
	if (leftMinor === null || rightMinor === null) {
		throw new Error('Invalid ISK amount')
	}
	const total = leftMinor + rightMinor
	const sign = total < 0n ? '-' : ''
	const absolute = total < 0n ? -total : total
	const whole = absolute / 100n
	const fraction = (absolute % 100n).toString().padStart(2, '0').replace(/0+$/, '')
	return `${sign}${whole}${fraction ? `.${fraction}` : ''}`
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
	private static readonly READ_CACHE_TTL_MS = 30 * 1000
	private static readonly READ_CACHE_MAX_ENTRIES = 2000
	private readonly readCache = new Map<string, { expiresAt: number; value: unknown }>()

	constructor(private db: BillsDb) {}

	private clearReadCache(): void {
		this.readCache.clear()
	}

	private getCached<T>(key: string): T | undefined {
		const cached = this.readCache.get(key)
		if (!cached) return undefined
		if (cached.expiresAt <= Date.now()) {
			this.readCache.delete(key)
			return undefined
		}
		return structuredClone(cached.value) as T
	}

	private setCached<T>(key: string, value: T): void {
		while (this.readCache.size >= BillService.READ_CACHE_MAX_ENTRIES && !this.readCache.has(key)) {
			const oldestKey = this.readCache.keys().next().value
			if (!oldestKey) break
			this.readCache.delete(oldestKey)
		}
		this.readCache.set(key, {
			expiresAt: Date.now() + BillService.READ_CACHE_TTL_MS,
			value: structuredClone(value),
		})
	}

	private async getBillForMutation(
		actorUserId: string,
		billId: string,
		authorization: BillMutationAuthorization = 'owner'
	) {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) throw new Error('Bill not found')
		if (authorization !== 'admin' && bill.issuerId !== actorUserId) {
			throw new Error('Only the bill issuer can mutate this bill')
		}
		return bill
	}

	/**
	 * Create a new bill
	 */
	async createBill(userId: string, data: CreateBillInput): Promise<Bill> {
		const bill = await this.createBillInternal(userId, data)
		this.clearReadCache()
		return bill
	}

	async createBillsBulk(userId: string, data: CreateBillInput[]): Promise<Bill[]> {
		if (data.length === 0) {
			throw new Error('At least one bill is required')
		}

		const createdBills = await this.db.transaction(async (transaction) => {
			const writeDb = transaction as unknown as BillsDb
			const bills = []
			for (const billData of data) {
				bills.push(await this.createBillInternal(userId, billData, undefined, writeDb))
			}
			return bills
		})
		this.clearReadCache()
		return createdBills
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
			const bill = await this.createBillInternal(userId, data, {
				sourceType,
				sourceId,
				metadata: externalRef.metadata ?? null,
			})
			this.clearReadCache()
			return bill
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
		const cached = this.getCached<BillIntegrationView | null>(`bill:${billId}`)
		if (cached !== undefined) return cached

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
		const response = this.toBillWithDetailsResponse(updatedBill)
		this.setCached(`bill:${billId}`, response)
		return response
	}

	async getGroupBillAggregate(groupBillId: string): Promise<GroupBillAggregate | null> {
		const cached = this.getCached<GroupBillAggregate | null>(`group:${groupBillId}`)
		if (cached !== undefined) return cached

		const loadRows = () =>
			this.db.query.bills.findMany({
				where: eq(bills.groupBillId, groupBillId),
				with: { payments: true },
				orderBy: (bills, { asc }) => [asc(bills.createdAt)],
			})
		let rows = await loadRows()

		if (rows.length === 0) {
			return null
		}

		const updatedRows = await Promise.all(rows.map((row) => this.updateLateFeeIfNeeded(row)))
		const lifecycleChanged = updatedRows.some(
			(row, index) => row.status !== rows[index]?.status || row.lateFee !== rows[index]?.lateFee
		)
		if (lifecycleChanged) rows = await loadRows()

		const first = rows[0]
		const groupId = (first.externalMetadata as Record<string, unknown> | null)?.groupId as
			| string
			| undefined

		const billEntries: GroupBillEntry[] = rows.map((b) => {
			const totalDue = addISKAmounts(b.amount, b.lateFee)
			const totalPaid = (b.payments ?? []).reduce((total, payment) => {
				return addISKAmounts(total, payment.amount)
			}, '0')
			return {
				billId: b.id,
				payerId: b.payerId,
				status: b.status as BillStatus,
				amount: b.amount,
				lateFee: b.lateFee,
				totalDue,
				totalPaid,
				paidAt: b.paidAt,
				hasPayments: (b.payments ?? []).length > 0,
			}
		})

		const paidBills = rows.filter((b) => b.status === 'paid').length

		const aggregate = {
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
		this.setCached(`group:${groupBillId}`, aggregate)
		return aggregate
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
		const cacheKey = `external:${normalizedSourceType}:${[...normalizedSourceIds].sort().join(',')}`
		const cached = this.getCached<BillIntegrationView[]>(cacheKey)
		if (cached !== undefined) return cached

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
		const response = updatedResults.map((bill) => this.toBillWithDetailsResponse(bill))
		for (const bill of response) this.setCached(`bill:${bill.id}`, bill)
		this.setCached(cacheKey, response)
		return response
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
		const bill = await this.getBillIntegrationView(billId)
		if (!bill) {
			return null
		}

		// Authorization: User must be issuer or payer
		if (bill.issuerId !== userId && bill.payerId !== userId) {
			throw new Error('Not authorized to view this bill')
		}

		// Update late fees if bill is issued and overdue
		return bill
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
		const filters = { ...(query.filters ?? {}) }
		const scopeCondition =
			query.scope.mode === 'my'
				? this.buildMyScopeCondition(query.scope.issuerIds, query.scope.partyEntities)
				: sql`true`
		const effectiveStatus = query.coalesced
			? this.buildEffectiveBillStatusExpression()
			: sql`${bills.status}`
		const filterConditions: SQL[] = []
		if (query.coalesced && filters.payerType === 'group') {
			// Group payer rows are represented by character sub-bills. The group identity is
			// the groupBillId, so apply this filter to the grouped projection instead.
			delete filters.payerType
			filterConditions.push(sql`${bills.groupBillId} is not null`)
		}
		filterConditions.push(...this.buildBillFilterConditions(filters, effectiveStatus))
		const whereCondition = this.buildWhereCondition([scopeCondition, ...filterConditions])

		if (query.coalesced) {
			return this.listCoalescedBillsPage({
				scopeCondition,
				filterCondition: this.buildWhereCondition(filterConditions) ?? sql`true`,
				effectiveStatus,
				limit: normalizedLimit,
				offset: normalizedOffset,
				sortBy,
				sortDir,
			})
		}

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
		const paymentRows = await this.db
			.select({ billId: billPayments.billId })
			.from(billPayments)
			.where(
				inArray(
					billPayments.billId,
					updatedResults.map((bill) => bill.id)
				)
			)
		const billIdsWithPayments = new Set(paymentRows.map((row) => row.billId))
		return {
			rows: updatedResults.map((bill) => ({
				...this.toBillWithDetailsResponse(bill),
				canRevertToDraft:
					bill.status !== 'draft' && bill.status !== 'paid' && !billIdsWithPayments.has(bill.id),
			})),
			rowCount,
		}
	}

	private async listCoalescedBillsPage(input: {
		scopeCondition: SQL
		filterCondition: SQL
		limit: number
		offset: number
		sortBy: BillListQuery['sortBy']
		sortDir: BillListQuery['sortDir']
		effectiveStatus: SQL
	}): Promise<BillListPage> {
		const sortBy = input.sortBy ?? 'dueDate'
		const sortDir = input.sortDir ?? 'asc'
		const direction = sql.raw(sortDir === 'desc' ? 'desc' : 'asc')
		const sortValue =
			sortBy === 'createdAt'
				? sql`${bills.createdAt}`
				: sortBy === 'updatedAt'
					? sql`${bills.updatedAt}`
					: sortBy === 'amount'
						? sql`(${bills.amount})::numeric`
						: sortBy === 'status'
							? sql`${input.effectiveStatus}::text`
							: sql`${bills.dueDate}`
		const groupSort = sortDir === 'desc' ? sql`max(sort_value)` : sql`min(sort_value)`

		const result = await this.db.execute<{
			representative_id: string
			group_total_count: number
			group_paid_count: number
			group_status_count: number
			group_draft_count: number
			group_editable_count: number
			group_cancellable_count: number
			group_revertible_count: number
			is_group: boolean
			row_count: number
		}>(sql`
			with scoped as materialized (
					select
						${bills.id} as bill_id,
							${input.effectiveStatus} as status,
						coalesce(${bills.groupBillId}::text, ${bills.id}::text) as group_key,
						${sortValue} as sort_value,
						(${input.filterCondition}) as matches_filter
					from ${bills}
					where ${input.scopeCondition}
				), filtered_groups as (
					select
						group_key,
						(array_agg(bill_id order by sort_value ${direction}, bill_id desc))[1] as representative_id,
						${groupSort} as group_sort
					from scoped
					where matches_filter
					group by group_key
			), aggregates as (
				select
					scoped.group_key,
					count(*)::int as group_total_count,
						count(*) filter (where scoped.status = 'paid')::int as group_paid_count,
						count(distinct scoped.status)::int as group_status_count,
						count(*) filter (where scoped.status = 'draft')::int as group_draft_count,
						count(*) filter (
							where scoped.status <> 'paid'
							and not exists (
								select 1 from bill_payments
								where bill_payments.bill_id = scoped.bill_id
							)
						)::int as group_editable_count,
						count(*) filter (where scoped.status not in ('paid', 'cancelled'))::int as group_cancellable_count,
						count(*) filter (
							where scoped.status not in ('draft', 'paid')
							and not exists (
								select 1 from bill_payments
								where bill_payments.bill_id = scoped.bill_id
							)
						)::int as group_revertible_count,
						bool_or(scoped.group_key <> scoped.bill_id::text) as is_group
				from scoped
				inner join filtered_groups on filtered_groups.group_key = scoped.group_key
				group by scoped.group_key
			)
			select
				filtered_groups.representative_id,
				aggregates.group_total_count,
				aggregates.group_paid_count,
				aggregates.group_status_count,
				aggregates.group_draft_count,
				aggregates.group_editable_count,
				aggregates.group_cancellable_count,
				aggregates.group_revertible_count,
				aggregates.is_group,
				count(*) over()::int as row_count
			from filtered_groups
			inner join aggregates on aggregates.group_key = filtered_groups.group_key
			order by filtered_groups.group_sort ${direction}, filtered_groups.representative_id desc
			limit ${input.limit}
			offset ${input.offset}
		`)

		const rows = result.rows
		if (rows.length === 0) {
			const countResult = await this.db.execute<{ row_count: number }>(sql`
				with filtered_groups as (
					select coalesce(${bills.groupBillId}::text, ${bills.id}::text) as group_key
					from ${bills}
					where ${input.scopeCondition} and ${input.filterCondition}
					group by group_key
				)
				select count(*)::int as row_count from filtered_groups
			`)
			return { rows: [], rowCount: Number(countResult.rows[0]?.row_count ?? 0) }
		}

		const representatives = await this.db.query.bills.findMany({
			where: inArray(
				bills.id,
				rows.map((row) => row.representative_id)
			),
		})
		const byId = new Map(representatives.map((bill) => [bill.id, bill] as const))
		const lateFeeRows = await Promise.all(
			rows.map(async (row) => {
				const bill = byId.get(row.representative_id)
				if (!bill) return null
				const updated = await this.updateLateFeeIfNeeded(bill)
				const metadata = updated.externalMetadata as Record<string, unknown> | null
				const groupId = typeof metadata?.groupId === 'string' ? metadata.groupId : null
				return {
					...this.toBillWithDetailsResponse(updated),
					...(row.is_group
						? {
								...(groupId ? { payerId: groupId, payerType: 'group' as const } : {}),
								groupBillTotalCount: Number(row.group_total_count),
								groupBillPaidCount: Number(row.group_paid_count),
								groupBillDraftCount: Number(row.group_draft_count ?? 0),
								groupBillEditableCount: Number(row.group_editable_count ?? 0),
								groupBillCancellableCount: Number(row.group_cancellable_count ?? 0),
								groupBillRevertibleCount: Number(row.group_revertible_count ?? 0),
								...(Number(row.group_status_count) > 1 ? { groupBillMixed: true } : {}),
							}
						: {}),
				}
			})
		)

		return {
			rows: lateFeeRows.filter((row): row is NonNullable<typeof row> => row !== null),
			rowCount: Number(rows[0]?.row_count ?? 0),
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
		const normalizedEntityIds = [
			...new Set((query.entityIds ?? []).map((id) => id.trim()).filter(Boolean)),
		]
		if (query.entityIds && normalizedEntityIds.length === 0) {
			postFilters.push(sql`false`)
		} else if (normalizedEntityIds.length > 0) {
			postFilters.push(
				sql`entity_id in (${sql.join(
					normalizedEntityIds.map((id) => sql`${id}`),
					sql`, `
				)})`
			)
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
	 * Update a bill (owner-scoped by default; admin scope is explicit)
	 */
	async updateBill(
		actorUserId: string,
		billId: string,
		data: UpdateBillInput,
		authorization: BillMutationAuthorization = 'owner'
	): Promise<Bill> {
		const bill = await this.getBillForMutation(actorUserId, billId, authorization)

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

		this.clearReadCache()
		return this.toBillResponse(updated)
	}

	/**
	 * Issue a bill (change status from draft to issued)
	 */
	async issueBill(
		actorUserId: string,
		billId: string,
		authorization: BillMutationAuthorization = 'owner'
	): Promise<Bill> {
		const bill = await this.getBillForMutation(actorUserId, billId, authorization)

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
		this.clearReadCache()
		return this.toBillResponse(updated)
	}

	/**
	 * Cancel a bill (owner-scoped by default; admin scope is explicit)
	 */
	async cancelBill(
		actorUserId: string,
		billId: string,
		authorization: BillMutationAuthorization = 'owner'
	): Promise<Bill> {
		const bill = await this.getBillForMutation(actorUserId, billId, authorization)

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
		this.clearReadCache()
		return this.toBillResponse(updated)
	}

	/**
	 * Mark bill as paid from an admin action.
	 */
	async markBillPaid(
		actorUserId: string,
		billId: string,
		authorization: BillMutationAuthorization = 'owner'
	): Promise<Bill> {
		await this.getBillForMutation(actorUserId, billId, authorization)
		return this.markBillAsPaid(
			billId,
			actorUserId,
			authorization === 'admin' ? 'admin_mark_paid' : 'owner_mark_paid'
		)
	}

	/**
	 * Mark a bill paid for a user who is an authorized payer or payee.
	 * The relationship is passed from Core after resolving the authenticated
	 * user's scope and is checked again here before the mutation occurs.
	 */
	async markRelatedBillPaid(
		actorUserId: string,
		billId: string,
		relatedEntities: BillListScopeEntity[]
	): Promise<Bill> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})
		if (!bill) throw new Error('Bill not found')

		const isRelated = relatedEntities.some(
			(entity) =>
				(entity.entityId === bill.payerId && entity.entityType === bill.payerType) ||
				(entity.entityType !== 'group' &&
					entity.entityId === bill.payeeId &&
					entity.entityType === bill.payeeType)
		)
		if (!isRelated) {
			throw new Error('Only a bill payer or payee can mark this bill paid')
		}

		return this.markBillAsPaid(billId, actorUserId, 'related_mark_paid')
	}

	/**
	 * Revert a bill to draft (owner-scoped by default; admin scope is explicit)
	 */
	async revertBillToDraft(
		actorUserId: string,
		billId: string,
		authorization: BillMutationAuthorization = 'owner'
	): Promise<Bill> {
		const bill = await this.getBillForMutation(actorUserId, billId, authorization)

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
		this.clearReadCache()
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

		this.clearReadCache()
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

		this.clearReadCache()
		return payment
	}

	/**
	 * Regenerate payment token for a bill (owner-scoped by default; admin scope is explicit)
	 */
	async regeneratePaymentToken(
		actorUserId: string,
		billId: string,
		authorization: BillMutationAuthorization = 'owner'
	): Promise<RegenerateTokenResponse> {
		const bill = await this.getBillForMutation(actorUserId, billId, authorization)

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

		this.clearReadCache()
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
	async deleteBill(
		actorUserId: string,
		billId: string,
		authorization: BillMutationAuthorization = 'owner'
	): Promise<void> {
		const bill = await this.getBillForMutation(actorUserId, billId, authorization)

		if (bill.status !== 'draft') {
			throw new Error('Only draft bills can be deleted')
		}

		await this.db.delete(bills).where(eq(bills.id, billId))
		this.clearReadCache()
	}

	/**
	 * Issue all eligible (draft) sub-bills sharing a groupBillId
	 */
	async issueGroupBill(
		actorUserId: string,
		groupBillId: string,
		authorization: BillMutationAuthorization = 'owner'
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
			const updated = await this.issueBill(actorUserId, bill.id, authorization)
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
		groupBillId: string,
		authorization: BillMutationAuthorization = 'owner'
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
			const updated = await this.cancelBill(actorUserId, bill.id, authorization)
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
		groupBillId: string,
		authorization: BillMutationAuthorization = 'owner'
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
			const updated = await this.revertBillToDraft(actorUserId, bill.id, authorization)
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
		groupBillId: string,
		authorization: BillMutationAuthorization = 'owner'
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
			await this.deleteBill(actorUserId, bill.id, authorization)
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
		data: UpdateBillInput,
		authorization: BillMutationAuthorization = 'owner'
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
			const updated = await this.updateBill(actorUserId, bill.id, data, authorization)
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

	async markBillAsPaid(
		billId: string,
		actorUserId: string | null = null,
		source:
			| 'admin_mark_paid'
			| 'owner_mark_paid'
			| 'related_mark_paid'
			| 'system_mark_paid' = 'system_mark_paid'
	): Promise<Bill> {
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
		const manualTransactionId = `manual-status-paid:${billId}:${generateUuidV7()}`
		const paymentId = generateUuidV7()
		const paidEventId = generateUuidV7()
		const paymentEventId = generateUuidV7()
		// Manual status changes are attributed to the authenticated user ID. Core resolves
		// that ID to the user's primary character for display; wallet payments retain their
		// ESI-derived character attribution through recordWalletPayments.
		const paidById = actorUserId ?? 'system'
		const result = await this.db.execute(sql`
			with updated_bill as (
				update bills
				set status = 'paid'::bill_status,
					paid_at = ${paidAt},
					updated_at = ${paidAt}
				where id = ${billId}::uuid
				  and status = ${existingBill.status}::bill_status
				returning id
			), inserted_payment as (
				insert into bill_payments (
					id, bill_id, payment_token, esi_transaction_id, amount,
					paid_by_id, paid_by_type, paid_at
				)
				select
					${paymentId}::uuid,
					id,
					${existingBill.paymentToken},
					${manualTransactionId},
					'0',
					${paidById},
					'character'::entity_type,
					${paidAt}
				from updated_bill
				returning bill_id
			), inserted_paid_event as (
				insert into bill_status_events (
					id, bill_id, event_type, from_status, to_status, actor_user_id, metadata
				)
				select
					${paidEventId}::uuid,
					id,
					'paid'::bill_status_event_type,
					${existingBill.status}::bill_status,
					'paid'::bill_status,
					${actorUserId},
					${JSON.stringify({ source })}::jsonb
				from updated_bill
				returning id
			), inserted_payment_event as (
				insert into bill_status_events (
					id, bill_id, event_type, from_status, to_status, actor_user_id, metadata
				)
				select
					${paymentEventId}::uuid,
					bill_id,
					'payment_recorded'::bill_status_event_type,
					null::bill_status,
					null::bill_status,
					${actorUserId},
					${JSON.stringify({ amount: '0', source, manual: true, statusOnly: true })}::jsonb
				from inserted_payment
				returning id
			)
			select id as bill_id from updated_bill
		`)
		if (!result.rows?.length) {
			const currentBill = await this.db.query.bills.findFirst({
				where: eq(bills.id, billId),
			})
			if (currentBill?.status === 'paid') {
				return this.toBillResponse(currentBill)
			}
			throw new Error('Bill status changed during payment finalization; please retry')
		}

		const updatedBill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})
		if (!updatedBill) {
			throw new Error('Bill not found after payment finalization')
		}
		this.clearReadCache()
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

		const whereSql = whereCondition ?? sql`true`
		const effectiveStatus = this.buildEffectiveBillStatusExpression()
		const [row] = (
			await this.db.execute<{
				total_bills: number | string
				total_amount: string | null
				paid_amount: string | null
				overdue_amount: string | null
				draft_count: number | string
				issued_count: number | string
				paid_count: number | string
				cancelled_count: number | string
				overdue_count: number | string
			}>(sql`
				select
					count(*)::int as total_bills,
					coalesce(sum(${bills.amount}::numeric), 0)::text as total_amount,
					coalesce(sum(${bills.amount}::numeric + ${bills.lateFee}::numeric)
						filter (where ${effectiveStatus} = 'paid'::bill_status), 0)::text as paid_amount,
					coalesce(sum(${bills.amount}::numeric)
						filter (where ${effectiveStatus} = 'overdue'::bill_status)), 0)::text as overdue_amount,
					count(*) filter (where ${effectiveStatus} = 'draft'::bill_status)::int as draft_count,
					count(*) filter (where ${effectiveStatus} = 'issued'::bill_status)::int as issued_count,
					count(*) filter (where ${effectiveStatus} = 'paid'::bill_status)::int as paid_count,
					count(*) filter (where ${effectiveStatus} = 'cancelled'::bill_status)::int as cancelled_count,
					count(*) filter (where ${effectiveStatus} = 'overdue'::bill_status)::int as overdue_count
				from ${bills}
				where ${whereSql}
			`)
		).rows

		return {
			totalBills: Number(row?.total_bills ?? 0),
			totalAmount: row?.total_amount ?? '0',
			paidAmount: row?.paid_amount ?? '0',
			overdueAmount: row?.overdue_amount ?? '0',
			billsByStatus: {
				draft: Number(row?.draft_count ?? 0),
				issued: Number(row?.issued_count ?? 0),
				paid: Number(row?.paid_count ?? 0),
				cancelled: Number(row?.cancelled_count ?? 0),
				overdue: Number(row?.overdue_count ?? 0),
			},
		}
	}

	private async createBillInternal(
		userId: string,
		data: CreateBillInput,
		externalRef?: {
			sourceType: string
			sourceId: string
			metadata: BillMetadata | null
		},
		writeDb: BillsDb = this.db
	): Promise<Bill> {
		const billId = generateUuidV7()
		const paymentToken = generatePaymentToken()
		const dueDate = typeof data.dueDate === 'string' ? new Date(data.dueDate) : data.dueDate

		const [bill] = await writeDb
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
				externalSourceType: externalRef?.sourceType ?? MANUAL_BILL_SOURCE,
				externalSourceId: externalRef?.sourceId ?? null,
				externalMetadata: data.externalMetadata ?? externalRef?.metadata ?? null,
				groupBillId: data.groupBillId ?? null,
			})
			.returning()

		await this.createStatusEvent(
			{
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
			},
			writeDb
		)
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

	private buildEffectiveBillStatusExpression(): SQL {
		return sql`case
			when ${bills.status} = 'issued'::bill_status and ${bills.dueDate} < now()
			then 'overdue'::bill_status
			else ${bills.status}
		end`
	}

	private buildBillFilterConditions(
		filters: BillFilters,
		statusExpression: SQL = sql`${bills.status}`
	): SQL[] {
		const conditions: SQL[] = []
		if (filters.status) {
			conditions.push(sql`${statusExpression} = ${filters.status}::bill_status`)
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
		const dueDateConditions: SQL[] = []
		if (filters.dueAfter) {
			dueDateConditions.push(gte(bills.dueDate, filters.dueAfter))
		}
		if (filters.dueBefore) {
			dueDateConditions.push(lte(bills.dueDate, filters.dueBefore))
		}
		if (dueDateConditions.length > 0) {
			const dueDateCondition = and(...dueDateConditions)
			const effectiveDueDateCondition = filters.includeOverdueBeyondDueAfter
				? or(dueDateCondition, sql`${statusExpression} = 'overdue'::bill_status`)
				: dueDateCondition

			if (effectiveDueDateCondition) {
				conditions.push(effectiveDueDateCondition)
			}
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

	private async createStatusEvent(
		input: {
			billId: string
			eventType: BillStatusEventType
			fromStatus: BillStatus | null
			toStatus: BillStatus | null
			actorUserId: string | null
			metadata?: BillMetadata | null
		},
		writeDb: BillsDb = this.db
	): Promise<void> {
		const fromStatusSql = input.fromStatus
			? sql`${input.fromStatus}::bill_status`
			: sql`null::bill_status`
		const toStatusSql = input.toStatus
			? sql`${input.toStatus}::bill_status`
			: sql`null::bill_status`
		const metadataSql = input.metadata
			? sql`${JSON.stringify(input.metadata)}::jsonb`
			: sql`null::jsonb`

		await writeDb.execute(sql`
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
					this.clearReadCache()
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

				this.clearReadCache()
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
			canRevertToDraft:
				bill.status !== 'draft' && bill.status !== 'paid' && !(bill.payments?.length > 0),
		}
	}
}
