import { and, eq } from '@repo/db-utils'

import { applicationMessageTemplates } from '../db/schema'

import type { ServiceContext } from './context'

/**
 * Message Template DTO
 */
export interface MessageTemplate {
	id: string
	status: 'draft' | 'active' | 'inactive' | 'deleted'
	templateName: string
	ownerCorporationId: string
	description: string | null
	messageTemplate: string
	createdAt: Date
	updatedAt: Date
}

/**
 * Template Service
 *
 * Handles all business logic for message templates.
 * Templates are corporation-scoped and only visible to HR staff with access.
 */
export class TemplateService {
	constructor(private ctx: ServiceContext) {}

	/**
	 * Create a new message template
	 */
	async createTemplate(
		corporationId: string,
		templateName: string,
		messageTemplate: string,
		description?: string,
		status: 'draft' | 'active' | 'inactive' = 'active'
	): Promise<MessageTemplate> {
		// Validate name is not empty
		if (!templateName || templateName.trim().length === 0) {
			throw new Error('Template name cannot be empty')
		}

		// Validate template content is not empty
		if (!messageTemplate || messageTemplate.trim().length === 0) {
			throw new Error('Template content cannot be empty')
		}

		// Create the template
		const [template] = await this.ctx.db
			.insert(applicationMessageTemplates)
			.values({
				ownerCorporationId: corporationId,
				templateName: templateName.trim(),
				messageTemplate: messageTemplate.trim(),
				description: description?.trim() || null,
				status,
			})
			.returning()

		if (!template) {
			throw new Error('Failed to create template')
		}

		return this.mapToMessageTemplate(template)
	}

	/**
	 * List templates for a corporation
	 */
	async listTemplates(
		corporationId: string,
		status?: 'draft' | 'active' | 'inactive' | 'deleted'
	): Promise<MessageTemplate[]> {
		const conditions = [eq(applicationMessageTemplates.ownerCorporationId, corporationId)]

		// Filter out deleted templates by default unless specifically requesting them
		if (status) {
			conditions.push(eq(applicationMessageTemplates.status, status))
		} else {
			// By default, exclude deleted templates
			conditions.push(
				and(
					eq(applicationMessageTemplates.ownerCorporationId, corporationId),
					// Use != operator by checking status is not 'deleted'
					eq(applicationMessageTemplates.status, 'active')
				) as any
			)
		}

		const templates = await this.ctx.db.query.applicationMessageTemplates.findMany({
			where: status
				? and(
						eq(applicationMessageTemplates.ownerCorporationId, corporationId),
						eq(applicationMessageTemplates.status, status)
					)
				: eq(applicationMessageTemplates.ownerCorporationId, corporationId),
		})

		// If no status filter, exclude deleted templates
		const filteredTemplates = status
			? templates
			: templates.filter((t) => t.status !== 'deleted')

		return filteredTemplates.map((t) => this.mapToMessageTemplate(t))
	}

	/**
	 * Get a single template by ID
	 */
	async getTemplate(templateId: string): Promise<MessageTemplate | null> {
		const template = await this.ctx.db.query.applicationMessageTemplates.findFirst({
			where: eq(applicationMessageTemplates.id, templateId),
		})

		if (!template) {
			return null
		}

		return this.mapToMessageTemplate(template)
	}

	/**
	 * Update a template
	 */
	async updateTemplate(
		templateId: string,
		updates: Partial<{
			templateName: string
			messageTemplate: string
			description: string | null
			status: 'draft' | 'active' | 'inactive' | 'deleted'
		}>
	): Promise<MessageTemplate> {
		// Get existing template
		const existing = await this.getTemplate(templateId)
		if (!existing) {
			throw new Error('Template not found')
		}

		// Validate name if being updated
		if (updates.templateName !== undefined && updates.templateName.trim().length === 0) {
			throw new Error('Template name cannot be empty')
		}

		// Validate content if being updated
		if (
			updates.messageTemplate !== undefined &&
			updates.messageTemplate.trim().length === 0
		) {
			throw new Error('Template content cannot be empty')
		}

		// Build update values
		const updateValues: Partial<typeof applicationMessageTemplates.$inferInsert> = {
			updatedAt: new Date(),
		}

		if (updates.templateName !== undefined) {
			updateValues.templateName = updates.templateName.trim()
		}
		if (updates.messageTemplate !== undefined) {
			updateValues.messageTemplate = updates.messageTemplate.trim()
		}
		if (updates.description !== undefined) {
			updateValues.description = updates.description?.trim() || null
		}
		if (updates.status !== undefined) {
			updateValues.status = updates.status
		}

		const [updated] = await this.ctx.db
			.update(applicationMessageTemplates)
			.set(updateValues)
			.where(eq(applicationMessageTemplates.id, templateId))
			.returning()

		if (!updated) {
			throw new Error('Failed to update template')
		}

		return this.mapToMessageTemplate(updated)
	}

	/**
	 * Delete a template (soft delete by setting status to 'deleted')
	 */
	async deleteTemplate(templateId: string): Promise<void> {
		const existing = await this.getTemplate(templateId)
		if (!existing) {
			throw new Error('Template not found')
		}

		await this.ctx.db
			.update(applicationMessageTemplates)
			.set({
				status: 'deleted',
				updatedAt: new Date(),
			})
			.where(eq(applicationMessageTemplates.id, templateId))
	}

	/**
	 * Map database record to MessageTemplate DTO
	 */
	private mapToMessageTemplate(
		template: typeof applicationMessageTemplates.$inferSelect
	): MessageTemplate {
		return {
			id: template.id,
			status: template.status as 'draft' | 'active' | 'inactive' | 'deleted',
			templateName: template.templateName,
			ownerCorporationId: template.ownerCorporationId,
			description: template.description,
			messageTemplate: template.messageTemplate,
			createdAt: template.createdAt,
			updatedAt: template.updatedAt,
		}
	}
}
