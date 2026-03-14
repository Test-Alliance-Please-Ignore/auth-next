import { and, eq, gte, inArray, lte, or, sql } from '@repo/db-utils'

import { billPayments, bills, billStatusEvents } from '../db/schema'
import { calculateLateFee } from '../utils/late-fees'
import { generatePaymentToken } from '../utils/token'
import { generateUuidV7 } from '../utils/uuid'

import type {
	Bill,
	BillExternalRef,
	BillFilters,
	BillIntegrationView,
	BillMetadata,
	BillStatistics,
	BillStatus,
	BillStatusEvent,
	BillStatusEventType,
	BillWithDetails,
	CreateBillInput,
	EntityType,
	RegenerateTokenResponse,
	UpdateBillInput,
} from '@repo/bills'
import type { BillsDb } from '../db'

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
		const conditions = [
			// User must be issuer or payer
			or(eq(bills.issuerId, userId), eq(bills.payerId, userId)),
		]

		// Apply filters
		if (filters.status) {
			conditions.push(eq(bills.status, filters.status))
		}
		if (filters.payerId) {
			conditions.push(eq(bills.payerId, filters.payerId))
		}
		if (filters.issuerId) {
			conditions.push(eq(bills.issuerId, filters.issuerId))
		}
		if (filters.payerType) {
			conditions.push(eq(bills.payerType, filters.payerType))
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

		const results = await this.db.query.bills.findMany({
			where: and(...conditions),
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

	/**
	 * Update a bill (draft only, issuer only)
	 */
	async updateBill(userId: string, billId: string, data: UpdateBillInput): Promise<Bill> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) {
			throw new Error('Bill not found')
		}

		if (bill.issuerId !== userId) {
			throw new Error('Only the issuer can update the bill')
		}

		if (bill.status !== 'draft') {
			throw new Error('Only draft bills can be updated')
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
	async issueBill(userId: string, billId: string): Promise<Bill> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) {
			throw new Error('Bill not found')
		}

		if (bill.issuerId !== userId) {
			throw new Error('Only the issuer can issue the bill')
		}

		if (bill.status !== 'draft') {
			throw new Error('Only draft bills can be issued')
		}

		const [updated] = await this.db
			.update(bills)
			.set({
				status: 'issued',
				updatedAt: new Date(),
			})
			.where(eq(bills.id, billId))
			.returning()

		await this.createStatusEvent({
			billId: updated.id,
			eventType: 'issued',
			fromStatus: bill.status,
			toStatus: updated.status,
			actorUserId: userId,
		})

		return this.toBillResponse(updated)
	}

	/**
	 * Cancel a bill (issuer only)
	 */
	async cancelBill(userId: string, billId: string): Promise<Bill> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) {
			throw new Error('Bill not found')
		}

		if (bill.issuerId !== userId) {
			throw new Error('Only the issuer can cancel the bill')
		}

		if (bill.status === 'paid') {
			throw new Error('Cannot cancel a paid bill')
		}

		if (bill.status === 'cancelled') {
			throw new Error('Bill is already cancelled')
		}

		const [updated] = await this.db
			.update(bills)
			.set({
				status: 'cancelled',
				updatedAt: new Date(),
			})
			.where(eq(bills.id, billId))
			.returning()

		await this.createStatusEvent({
			billId: updated.id,
			eventType: 'cancelled',
			fromStatus: bill.status,
			toStatus: updated.status,
			actorUserId: userId,
		})

		return this.toBillResponse(updated)
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
	 * Regenerate payment token for a bill (issuer only)
	 */
	async regeneratePaymentToken(userId: string, billId: string): Promise<RegenerateTokenResponse> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) {
			throw new Error('Bill not found')
		}

		if (bill.issuerId !== userId) {
			throw new Error('Only the issuer can regenerate the payment token')
		}

		if (bill.status === 'paid' || bill.status === 'cancelled') {
			throw new Error('Cannot regenerate token for paid or cancelled bills')
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
			actorUserId: userId,
		})

		return {
			token: newToken,
			billId,
		}
	}

	/**
	 * Delete a bill (draft only, issuer only)
	 */
	async deleteBill(userId: string, billId: string): Promise<void> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})

		if (!bill) {
			throw new Error('Bill not found')
		}

		if (bill.issuerId !== userId) {
			throw new Error('Only the issuer can delete the bill')
		}

		if (bill.status !== 'draft') {
			throw new Error('Only draft bills can be deleted')
		}

		await this.db.delete(bills).where(eq(bills.id, billId))
	}

	async checkBillBalancePaid(billId: string): Promise<boolean> {
		const bill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
			with: {
				payments: true,
			},
		})

		if (!bill) {
			throw new Error('Bill not found')
		}
		const totalAmount = BigInt(bill.amount) + BigInt(bill.lateFee)
		const paidAmount = bill.payments.reduce(
			(acc, payment) => acc + BigInt(payment.amount),
			BigInt(0)
		)
		return paidAmount >= totalAmount ? true : false
	}

	async markBillAsPaid(billId: string): Promise<void> {
		const existingBill = await this.db.query.bills.findFirst({
			where: eq(bills.id, billId),
		})
		if (!existingBill) {
			throw new Error('Bill not found')
		}
		if (existingBill.status === 'paid') {
			return
		}

		await this.db
			.update(bills)
			.set({
				status: 'paid',
				paidAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(bills.id, billId))

		await this.createStatusEvent({
			billId,
			eventType: 'paid',
			fromStatus: existingBill.status,
			toStatus: 'paid',
			actorUserId: null,
		})
	}
	/**
	 * Get bill statistics for a user
	 */
	async getBillStatistics(userId: string, filters: BillFilters = {}): Promise<BillStatistics> {
		const conditions = [or(eq(bills.issuerId, userId), eq(bills.payerId, userId))]

		// Apply filters
		if (filters.status) {
			conditions.push(eq(bills.status, filters.status))
		}
		if (filters.payerId) {
			conditions.push(eq(bills.payerId, filters.payerId))
		}
		if (filters.issuerId) {
			conditions.push(eq(bills.issuerId, filters.issuerId))
		}

		const userBills = await this.db.query.bills.findMany({
			where: and(...conditions),
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
				externalMetadata: externalRef?.metadata ?? null,
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

	private async createStatusEvent(input: {
		billId: string
		eventType: BillStatusEventType
		fromStatus: BillStatus | null
		toStatus: BillStatus | null
		actorUserId: string | null
		metadata?: BillMetadata | null
	}): Promise<void> {
		await this.db.insert(billStatusEvents).values({
			id: generateUuidV7(),
			billId: input.billId,
			eventType: input.eventType,
			fromStatus: input.fromStatus,
			toStatus: input.toStatus,
			actorUserId: input.actorUserId,
			metadata: input.metadata ?? null,
		})
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

			const [updated] = await this.db
				.update(bills)
				.set({
					status: 'overdue',
					lateFee,
					updatedAt: now,
				})
				.where(and(eq(bills.id, bill.id), eq(bills.status, 'issued')))
				.returning()

			if (updated) {
				await this.createStatusEvent({
					billId: updated.id,
					eventType: 'overdue',
					fromStatus: 'issued',
					toStatus: 'overdue',
					actorUserId: null,
					metadata: {
						dueDate: bill.dueDate.toISOString(),
					},
				})
				return updated
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
