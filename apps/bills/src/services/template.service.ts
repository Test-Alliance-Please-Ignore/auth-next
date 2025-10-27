import { and, eq, sql } from '@repo/db-utils'

import type {
	Bill,
	BillTemplate,
	BillTemplateWithDetails,
	CloneBillAsTemplateInput,
	CloneTemplateInput,
	CreateBillFromTemplateInput,
	CreateTemplateInput,
	UpdateTemplateInput,
} from '@repo/bills'
import type { BillsDb } from '../db'
import { billSchedules, bills, billTemplates } from '../db/schema'
import { generatePaymentToken } from '../utils/token'
import { generateUuidV7 } from '../utils/uuid'

/**
 * Template Service
 *
 * Handles bill template operations including:
 * - Template CRUD operations
 * - Template cloning (from other templates or from bills)
 * - Bill creation from templates with parameter substitution
 */
export class TemplateService {
	constructor(private db: BillsDb) {}

	/**
	 * Create a new template
	 */
	async createTemplate(userId: string, data: CreateTemplateInput): Promise<BillTemplate> {
		const templateId = generateUuidV7()

		const [template] = await this.db
			.insert(billTemplates)
			.values({
				id: templateId,
				ownerId: userId,
				name: data.name,
				description: data.description || null,
				amountTemplate: data.amountTemplate || '{amount}',
				titleTemplate: data.titleTemplate,
				descriptionTemplate: data.descriptionTemplate || null,
				lateFeeType: data.lateFeeType || 'none',
				lateFeeAmount: data.lateFeeAmount || '0',
				lateFeeCompounding: data.lateFeeCompounding || 'none',
				daysUntilDue: data.daysUntilDue || 30,
			})
			.returning()

		return this.toTemplateResponse(template)
	}

	/**
	 * Get a specific template
	 */
	async getTemplate(userId: string, templateId: string): Promise<BillTemplateWithDetails | null> {
		const template = await this.db.query.billTemplates.findFirst({
			where: eq(billTemplates.id, templateId),
		})

		if (!template) {
			return null
		}

		// Authorization: User must be owner
		if (template.ownerId !== userId) {
			throw new Error('Not authorized to view this template')
		}

		// Get active schedule count
		const scheduleCountResult = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(billSchedules)
			.where(and(eq(billSchedules.templateId, templateId), eq(billSchedules.isActive, true)))

		const activeScheduleCount = scheduleCountResult[0]?.count || 0

		return {
			...this.toTemplateResponse(template),
			activeScheduleCount,
		}
	}

	/**
	 * List templates owned by user
	 */
	async listTemplates(userId: string): Promise<BillTemplateWithDetails[]> {
		const templates = await this.db.query.billTemplates.findMany({
			where: eq(billTemplates.ownerId, userId),
			orderBy: (billTemplates, { desc }) => [desc(billTemplates.createdAt)],
		})

		// Get active schedule counts for all templates
		const templateIds = templates.map((t) => t.id)

		if (templateIds.length === 0) {
			return []
		}

		const scheduleCountsResult = await this.db
			.select({
				templateId: billSchedules.templateId,
				count: sql<number>`count(*)::int`,
			})
			.from(billSchedules)
			.where(and(sql`${billSchedules.templateId} = ANY(${templateIds})`, eq(billSchedules.isActive, true)))
			.groupBy(billSchedules.templateId)

		const countMap = new Map<string, number>()
		for (const row of scheduleCountsResult) {
			if (row.templateId) {
				countMap.set(row.templateId, row.count)
			}
		}

		return templates.map((template) => ({
			...this.toTemplateResponse(template),
			activeScheduleCount: countMap.get(template.id) || 0,
		}))
	}

	/**
	 * Update a template (owner only)
	 */
	async updateTemplate(userId: string, templateId: string, data: UpdateTemplateInput): Promise<BillTemplate> {
		const template = await this.db.query.billTemplates.findFirst({
			where: eq(billTemplates.id, templateId),
		})

		if (!template) {
			throw new Error('Template not found')
		}

		if (template.ownerId !== userId) {
			throw new Error('Only the owner can update the template')
		}

		const [updated] = await this.db
			.update(billTemplates)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(eq(billTemplates.id, templateId))
			.returning()

		return this.toTemplateResponse(updated)
	}

	/**
	 * Delete a template (owner only, no active schedules)
	 */
	async deleteTemplate(userId: string, templateId: string): Promise<void> {
		const template = await this.db.query.billTemplates.findFirst({
			where: eq(billTemplates.id, templateId),
		})

		if (!template) {
			throw new Error('Template not found')
		}

		if (template.ownerId !== userId) {
			throw new Error('Only the owner can delete the template')
		}

		// Check for active schedules
		const activeSchedules = await this.db.query.billSchedules.findMany({
			where: and(eq(billSchedules.templateId, templateId), eq(billSchedules.isActive, true)),
		})

		if (activeSchedules.length > 0) {
			throw new Error('Cannot delete template with active schedules. Pause or delete schedules first.')
		}

		await this.db.delete(billTemplates).where(eq(billTemplates.id, templateId))
	}

	/**
	 * Clone an existing template
	 */
	async cloneTemplate(userId: string, data: CloneTemplateInput): Promise<BillTemplate> {
		const sourceTemplate = await this.db.query.billTemplates.findFirst({
			where: eq(billTemplates.id, data.sourceTemplateId),
		})

		if (!sourceTemplate) {
			throw new Error('Source template not found')
		}

		if (sourceTemplate.ownerId !== userId) {
			throw new Error('Not authorized to clone this template')
		}

		const newTemplateId = generateUuidV7()

		const [clonedTemplate] = await this.db
			.insert(billTemplates)
			.values({
				id: newTemplateId,
				ownerId: userId,
				name: data.name,
				description: data.description || sourceTemplate.description,
				amountTemplate: sourceTemplate.amountTemplate,
				titleTemplate: sourceTemplate.titleTemplate,
				descriptionTemplate: sourceTemplate.descriptionTemplate,
				lateFeeType: sourceTemplate.lateFeeType,
				lateFeeAmount: sourceTemplate.lateFeeAmount,
				lateFeeCompounding: sourceTemplate.lateFeeCompounding,
				daysUntilDue: sourceTemplate.daysUntilDue,
			})
			.returning()

		return this.toTemplateResponse(clonedTemplate)
	}

	/**
	 * Clone a bill as a template
	 */
	async cloneBillAsTemplate(userId: string, data: CloneBillAsTemplateInput): Promise<BillTemplate> {
		const sourceBill = await this.db.query.bills.findFirst({
			where: eq(bills.id, data.sourceBillId),
		})

		if (!sourceBill) {
			throw new Error('Source bill not found')
		}

		if (sourceBill.issuerId !== userId) {
			throw new Error('Not authorized to clone this bill')
		}

		const newTemplateId = generateUuidV7()

		const [template] = await this.db
			.insert(billTemplates)
			.values({
				id: newTemplateId,
				ownerId: userId,
				name: data.name,
				description: data.description || sourceBill.description,
				amountTemplate: '{amount}',
				titleTemplate: sourceBill.title,
				descriptionTemplate: sourceBill.description,
				lateFeeType: sourceBill.lateFeeType,
				lateFeeAmount: sourceBill.lateFeeAmount,
				lateFeeCompounding: sourceBill.lateFeeCompounding,
				daysUntilDue: 30, // Default to 30 days
			})
			.returning()

		return this.toTemplateResponse(template)
	}

	/**
	 * Create a bill from a template
	 */
	async createBillFromTemplate(userId: string, data: CreateBillFromTemplateInput): Promise<Bill> {
		const template = await this.db.query.billTemplates.findFirst({
			where: eq(billTemplates.id, data.templateId),
		})

		if (!template) {
			throw new Error('Template not found')
		}

		if (template.ownerId !== userId) {
			throw new Error('Not authorized to use this template')
		}

		// Apply template parameters
		const params = data.templateParams || {}
		params.amount = data.amount

		const title = this.applyTemplateParams(template.titleTemplate, params)
		const description = template.descriptionTemplate
			? this.applyTemplateParams(template.descriptionTemplate, params)
			: null

		// Calculate due date
		const dueDate = new Date()
		dueDate.setDate(dueDate.getDate() + template.daysUntilDue)

		const billId = generateUuidV7()
		const paymentToken = generatePaymentToken()

		const [bill] = await this.db
			.insert(bills)
			.values({
				id: billId,
				issuerId: userId,
				payerId: data.payerId,
				payerType: data.payerType,
				templateId: template.id,
				title,
				description,
				amount: data.amount,
				lateFee: '0',
				lateFeeType: template.lateFeeType,
				lateFeeAmount: template.lateFeeAmount,
				lateFeeCompounding: template.lateFeeCompounding,
				dueDate,
				status: 'draft',
				paymentToken,
			})
			.returning()

		return {
			id: bill.id,
			issuerId: bill.issuerId,
			payerId: bill.payerId,
			payerType: bill.payerType,
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
			createdAt: bill.createdAt,
			updatedAt: bill.updatedAt,
		}
	}

	/**
	 * Apply template parameters to a template string
	 */
	private applyTemplateParams(template: string, params: Record<string, string>): string {
		let result = template

		for (const [key, value] of Object.entries(params)) {
			const placeholder = `{${key}}`
			result = result.replace(new RegExp(placeholder, 'g'), value)
		}

		return result
	}

	/**
	 * Convert database record to BillTemplate response
	 */
	private toTemplateResponse(template: any): BillTemplate {
		return {
			id: template.id,
			ownerId: template.ownerId,
			name: template.name,
			description: template.description,
			amountTemplate: template.amountTemplate,
			titleTemplate: template.titleTemplate,
			descriptionTemplate: template.descriptionTemplate,
			lateFeeType: template.lateFeeType,
			lateFeeAmount: template.lateFeeAmount,
			lateFeeCompounding: template.lateFeeCompounding,
			daysUntilDue: template.daysUntilDue,
			createdAt: template.createdAt,
			updatedAt: template.updatedAt,
		}
	}
}
