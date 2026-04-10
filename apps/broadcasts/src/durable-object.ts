import { DurableObject } from 'cloudflare:workers'

import { and, desc, eq, inArray, or, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { createDb } from './db'
import { broadcastDeliveries, broadcasts, broadcastTargets, broadcastTemplates } from './db/schema'
import { convertUnixTimestamps } from './utils/timestamp-converter'

import type {
	Broadcast,
	BroadcastDelivery,
	BroadcastPage,
	Broadcasts,
	BroadcastStatus,
	BroadcastTarget,
	BroadcastTemplate,
	BroadcastWithDetails,
	CreateBroadcastRequest,
	CreateBroadcastTargetRequest,
	CreateBroadcastTemplateRequest,
	SendBroadcastResult,
	UpdateBroadcastTargetRequest,
	UpdateBroadcastTemplateRequest,
} from '@repo/broadcasts'
import type { Discord } from '@repo/discord'
import type { Env } from './context'

/**
 * Broadcasts Durable Object
 *
 * Manages broadcast targets, templates, and broadcast instances.
 * All data is stored in PostgreSQL via Drizzle ORM.
 */
export class BroadcastsDO extends DurableObject<Env> implements Broadcasts {
	private db: ReturnType<typeof createDb>

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
	}

	// =========================================================================
	// BROADCAST TARGETS
	// =========================================================================

	async listTargets(userId: string, sendPermissionIds?: string[]): Promise<BroadcastTarget[]> {
		if (sendPermissionIds && sendPermissionIds.length === 0) {
			return []
		}

		const targets = await this.db.query.broadcastTargets.findMany({
			where: sendPermissionIds
				? or(
						inArray(broadcastTargets.sendPermissionId, sendPermissionIds),
						inArray(broadcastTargets.managePermissionId, sendPermissionIds)
					)
				: undefined,
			orderBy: desc(broadcastTargets.createdAt),
		})

		return targets.map((t) => ({
			...t,
			config: t.config as Record<string, unknown>,
			createdAt: t.createdAt.toISOString(),
			updatedAt: t.updatedAt.toISOString(),
		}))
	}

	async getTarget(targetId: string, userId: string): Promise<BroadcastTarget | null> {
		const target = await this.db.query.broadcastTargets.findFirst({
			where: eq(broadcastTargets.id, targetId),
		})

		if (!target) return null

		return {
			...target,
			config: target.config as Record<string, unknown>,
			createdAt: target.createdAt.toISOString(),
			updatedAt: target.updatedAt.toISOString(),
		}
	}

	async createTarget(data: CreateBroadcastTargetRequest, userId: string): Promise<BroadcastTarget> {
		const sendPermissionId = (data as unknown as { sendPermissionId?: string }).sendPermissionId
		const managePermissionId = (data as unknown as { managePermissionId?: string })
			.managePermissionId
		if (!sendPermissionId || !managePermissionId) {
			throw new Error('sendPermissionId and managePermissionId are required')
		}

		const now = new Date()

		const [target] = await this.db
			.insert(broadcastTargets)
			.values({
				name: data.name,
				description: data.description || null,
				type: data.type,
				sendPermissionId,
				managePermissionId,
				config: data.config,
				createdBy: userId,
				createdAt: now,
				updatedAt: now,
			})
			.returning()

		return {
			...target,
			config: target.config as Record<string, unknown>,
			createdAt: target.createdAt.toISOString(),
			updatedAt: target.updatedAt.toISOString(),
		}
	}

	async updateTarget(
		targetId: string,
		data: UpdateBroadcastTargetRequest,
		userId: string
	): Promise<BroadcastTarget> {
		const existing = await this.getTarget(targetId, userId)
		if (!existing) {
			throw new Error('Target not found')
		}

		const [updated] = await this.db
			.update(broadcastTargets)
			.set({
				name: data.name ?? existing.name,
				description: data.description !== undefined ? data.description : existing.description,
				sendPermissionId: data.sendPermissionId ?? existing.sendPermissionId,
				managePermissionId: data.managePermissionId ?? existing.managePermissionId,
				config: data.config ? { ...existing.config, ...data.config } : existing.config,
				updatedAt: new Date(),
			})
			.where(eq(broadcastTargets.id, targetId))
			.returning()

		return {
			...updated,
			config: updated.config as Record<string, unknown>,
			createdAt: updated.createdAt.toISOString(),
			updatedAt: updated.updatedAt.toISOString(),
		}
	}

	async deleteTarget(targetId: string, userId: string): Promise<void> {
		await this.db.delete(broadcastTargets).where(eq(broadcastTargets.id, targetId))
	}

	// =========================================================================
	// BROADCAST TEMPLATES
	// =========================================================================

	async listTemplates(
		userId: string,
		filters?: { targetType?: string; targetId?: string }
	): Promise<BroadcastTemplate[]> {
		let whereConditions = []

		if (filters?.targetType) {
			whereConditions.push(eq(broadcastTemplates.targetType, filters.targetType))
		}

		if (filters?.targetId) {
			whereConditions.push(eq(broadcastTemplates.targetId, filters.targetId))
		}

		const templates = await this.db.query.broadcastTemplates.findMany({
			where: whereConditions.length > 0 ? and(...whereConditions) : undefined,
			orderBy: desc(broadcastTemplates.createdAt),
		})

		return templates.map((t) => ({
			id: t.id,
			name: t.name,
			description: t.description,
			targetType: t.targetType,
			targetId: t.targetId,
			fieldSchema: t.fieldSchema as any,
			messageTemplate: t.messageTemplate,
			createdBy: t.createdBy,
			createdAt: t.createdAt.toISOString(),
			updatedAt: t.updatedAt.toISOString(),
		}))
	}

	async getTemplate(templateId: string, userId: string): Promise<BroadcastTemplate | null> {
		const template = await this.db.query.broadcastTemplates.findFirst({
			where: eq(broadcastTemplates.id, templateId),
		})

		if (!template) return null

		return {
			id: template.id,
			name: template.name,
			description: template.description,
			targetType: template.targetType,
			targetId: template.targetId,
			fieldSchema: template.fieldSchema as any,
			messageTemplate: template.messageTemplate,
			createdBy: template.createdBy,
			createdAt: template.createdAt.toISOString(),
			updatedAt: template.updatedAt.toISOString(),
		}
	}

	async createTemplate(
		data: CreateBroadcastTemplateRequest,
		userId: string
	): Promise<BroadcastTemplate> {
		const target = await this.db.query.broadcastTargets.findFirst({
			where: eq(broadcastTargets.id, data.targetId),
		})
		if (!target) {
			throw new Error('Target not found')
		}
		if (target.type !== data.targetType) {
			throw new Error('Template targetType must match target type')
		}

		const now = new Date()

		const [template] = await this.db
			.insert(broadcastTemplates)
			.values({
				name: data.name,
				description: data.description || null,
				targetType: data.targetType,
				targetId: data.targetId,
				fieldSchema: data.fieldSchema,
				messageTemplate: data.messageTemplate,
				createdBy: userId,
				createdAt: now,
				updatedAt: now,
			})
			.returning()

		return {
			id: template.id,
			name: template.name,
			description: template.description,
			targetType: template.targetType,
			targetId: template.targetId,
			fieldSchema: template.fieldSchema as any,
			messageTemplate: template.messageTemplate,
			createdBy: template.createdBy,
			createdAt: template.createdAt.toISOString(),
			updatedAt: template.updatedAt.toISOString(),
		}
	}

	async updateTemplate(
		templateId: string,
		data: UpdateBroadcastTemplateRequest,
		userId: string
	): Promise<BroadcastTemplate> {
		const existing = await this.getTemplate(templateId, userId)
		if (!existing) {
			throw new Error('Template not found')
		}

		const [updated] = await this.db
			.update(broadcastTemplates)
			.set({
				name: data.name ?? existing.name,
				description: data.description !== undefined ? data.description : existing.description,
				fieldSchema: data.fieldSchema ?? existing.fieldSchema,
				messageTemplate: data.messageTemplate ?? existing.messageTemplate,
				updatedAt: new Date(),
			})
			.where(eq(broadcastTemplates.id, templateId))
			.returning()

		return {
			id: updated.id,
			name: updated.name,
			description: updated.description,
			targetType: updated.targetType,
			targetId: updated.targetId,
			fieldSchema: updated.fieldSchema as any,
			messageTemplate: updated.messageTemplate,
			createdBy: updated.createdBy,
			createdAt: updated.createdAt.toISOString(),
			updatedAt: updated.updatedAt.toISOString(),
		}
	}

	async deleteTemplate(templateId: string, userId: string): Promise<void> {
		await this.db.delete(broadcastTemplates).where(eq(broadcastTemplates.id, templateId))
	}

	// =========================================================================
	// BROADCASTS
	// =========================================================================

	async listBroadcasts(
		userId: string,
		filters?: {
			permissionId?: string
			permissionIds?: string[]
			status?: BroadcastStatus
			targetId?: string
			createdBy?: string
			limit?: number
			offset?: number
		}
	): Promise<BroadcastPage> {
		let whereConditions = []

		if (filters?.permissionId) {
			whereConditions.push(eq(broadcasts.permissionId, filters.permissionId))
		} else if (filters?.permissionIds) {
			if (filters.permissionIds.length === 0) {
				return { rows: [], rowCount: 0 }
			}
			whereConditions.push(inArray(broadcasts.permissionId, filters.permissionIds))
		}

		if (filters?.status) {
			whereConditions.push(eq(broadcasts.status, filters.status))
		}
		if (filters?.targetId) {
			whereConditions.push(eq(broadcasts.targetId, filters.targetId))
		}
		if (filters?.createdBy) {
			whereConditions.push(eq(broadcasts.createdBy, filters.createdBy))
		}

		const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined
		const limit = filters?.limit ?? 50
		const offset = filters?.offset ?? 0

		const [totalResult, broadcastList] = await Promise.all([
			this.db
				.select({ count: sql<number>`count(*)` })
				.from(broadcasts)
				.where(whereClause)
				.then((rows) => rows[0]),
			this.db.query.broadcasts.findMany({
				where: whereClause,
				orderBy: desc(broadcasts.createdAt),
				limit,
				offset,
			}),
		])

		return {
			rows: broadcastList.map((b) => ({
				...b,
				content: b.content as Record<string, unknown>,
				scheduledFor: b.scheduledFor ? b.scheduledFor.toISOString() : null,
				sentAt: b.sentAt ? b.sentAt.toISOString() : null,
				createdAt: b.createdAt.toISOString(),
				updatedAt: b.updatedAt.toISOString(),
			})),
			rowCount: Number(totalResult?.count ?? 0),
		}
	}

	async getBroadcast(broadcastId: string, userId: string): Promise<BroadcastWithDetails | null> {
		const broadcast = await this.db.query.broadcasts.findFirst({
			where: eq(broadcasts.id, broadcastId),
		})

		if (!broadcast) return null

		// Fetch related entities
		const template = broadcast.templateId
			? await this.db.query.broadcastTemplates.findFirst({
					where: eq(broadcastTemplates.id, broadcast.templateId),
				})
			: null

		const target = await this.db.query.broadcastTargets.findFirst({
			where: eq(broadcastTargets.id, broadcast.targetId),
		})

		const deliveries = await this.db.query.broadcastDeliveries.findMany({
			where: eq(broadcastDeliveries.broadcastId, broadcastId),
		})

		if (!target) {
			throw new Error('Target not found for broadcast')
		}

		return {
			...broadcast,
			content: broadcast.content as Record<string, unknown>,
			scheduledFor: broadcast.scheduledFor ? broadcast.scheduledFor.toISOString() : null,
			sentAt: broadcast.sentAt ? broadcast.sentAt.toISOString() : null,
			createdAt: broadcast.createdAt.toISOString(),
			updatedAt: broadcast.updatedAt.toISOString(),
			template: template
				? {
						id: template.id,
						name: template.name,
						description: template.description,
						targetType: template.targetType,
						targetId: template.targetId,
						fieldSchema: template.fieldSchema as any,
						messageTemplate: template.messageTemplate,
						createdBy: template.createdBy,
						createdAt: template.createdAt.toISOString(),
						updatedAt: template.updatedAt.toISOString(),
					}
				: null,
			target: {
				...target,
				config: target.config as Record<string, unknown>,
				createdAt: target.createdAt.toISOString(),
				updatedAt: target.updatedAt.toISOString(),
			},
			deliveries: deliveries.map((d) => ({
				...d,
				sentAt: d.sentAt ? d.sentAt.toISOString() : null,
				createdAt: d.createdAt.toISOString(),
			})),
		}
	}

	async createBroadcast(data: CreateBroadcastRequest, userId: string): Promise<Broadcast> {
		const now = new Date()

		const status: BroadcastStatus = data.scheduledFor ? 'scheduled' : 'draft'

		const [broadcast] = await this.db
			.insert(broadcasts)
			.values({
				templateId: data.templateId || null,
				targetId: data.targetId,
				title: data.title,
				content: data.content,
				status,
				scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : null,
				sentAt: null,
				errorMessage: null,
				permissionId: data.permissionId,
				createdBy: userId,
				createdByCharacterName: data.createdByCharacterName,
				createdAt: now,
				updatedAt: now,
			})
			.returning()

		return {
			...broadcast,
			content: broadcast.content as Record<string, unknown>,
			scheduledFor: broadcast.scheduledFor ? broadcast.scheduledFor.toISOString() : null,
			sentAt: null,
			createdAt: broadcast.createdAt.toISOString(),
			updatedAt: broadcast.updatedAt.toISOString(),
		}
	}

	async sendBroadcast(broadcastId: string, userId: string): Promise<SendBroadcastResult> {
		const broadcastDetails = await this.getBroadcast(broadcastId, userId)
		if (!broadcastDetails) {
			throw new Error('Broadcast not found')
		}

		if (broadcastDetails.status !== 'draft' && broadcastDetails.status !== 'scheduled') {
			throw new Error(`Cannot send broadcast with status: ${broadcastDetails.status}`)
		}

		// Update status to 'sending'
		await this.db
			.update(broadcasts)
			.set({
				status: 'sending',
				updatedAt: new Date(),
			})
			.where(eq(broadcasts.id, broadcastId))

		try {
			// Send based on target type
			if (broadcastDetails.target.type === 'discord_channel') {
				const config = broadcastDetails.target.config as {
					guildId: string
					channelId: string
				}

				// Render message from template if available
				let message: string
				if (broadcastDetails.template) {
					message = this.renderTemplate(
						broadcastDetails.template.messageTemplate,
						broadcastDetails.content
					)
				} else {
					// If no template, use content as-is (expect a 'message' field)
					message = (broadcastDetails.content.message as string) || broadcastDetails.title
				}

				// Convert any UNIX timestamps in the message to Discord format
				message = convertUnixTimestamps(message)

				// Add mention prefix if specified
				const mentionLevel = (broadcastDetails.content.mentionLevel as string) || 'none'
				if (mentionLevel === 'here') {
					message = '@here\n\n' + message
				} else if (mentionLevel === 'everyone') {
					message = '@everyone\n\n' + message
				}

				// Add footer with sender, target, and timestamp
				const sendTime = new Date()
				const unixTimestamp = Math.floor(sendTime.getTime() / 1000)
				const footer = `\n\n#### SENT BY ${broadcastDetails.createdByCharacterName} to ${broadcastDetails.target.name} @ <t:${unixTimestamp}:F> ####`
				message = message + footer

				// Get Discord DO stub and send message
				const discordStub = getStub<Discord>(this.env.DISCORD, 'default')
				const result = await discordStub.sendMessage(config.guildId, config.channelId, {
					content: message,
					allowEveryone: mentionLevel === 'everyone' || mentionLevel === 'here',
				})

				// Check if message failed to send
				if (!result.success) {
					throw new Error(result.error || 'Failed to send message to Discord')
				}

				const discordMessageId = result.messageId!

				// Create delivery record
				const now = sendTime
				const [delivery] = await this.db
					.insert(broadcastDeliveries)
					.values({
						broadcastId,
						targetId: broadcastDetails.target.id,
						status: 'sent',
						discordMessageId,
						errorMessage: null,
						sentAt: now,
						createdAt: now,
					})
					.returning()

				// Update broadcast status to 'sent'
				const [updatedBroadcast] = await this.db
					.update(broadcasts)
					.set({
						status: 'sent',
						sentAt: now,
						updatedAt: now,
					})
					.where(eq(broadcasts.id, broadcastId))
					.returning()

				return {
					success: true,
					broadcast: {
						...updatedBroadcast,
						content: updatedBroadcast.content as Record<string, unknown>,
						scheduledFor: updatedBroadcast.scheduledFor
							? updatedBroadcast.scheduledFor.toISOString()
							: null,
						sentAt: updatedBroadcast.sentAt ? updatedBroadcast.sentAt.toISOString() : null,
						createdAt: updatedBroadcast.createdAt.toISOString(),
						updatedAt: updatedBroadcast.updatedAt.toISOString(),
					},
					delivery: {
						...delivery,
						sentAt: delivery.sentAt ? delivery.sentAt.toISOString() : null,
						createdAt: delivery.createdAt.toISOString(),
					},
				}
			}

			throw new Error(`Unsupported target type: ${broadcastDetails.target.type}`)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error'

			// Create failed delivery record
			const now = new Date()
			const [delivery] = await this.db
				.insert(broadcastDeliveries)
				.values({
					broadcastId,
					targetId: broadcastDetails.target.id,
					status: 'failed',
					discordMessageId: null,
					errorMessage,
					sentAt: null,
					createdAt: now,
				})
				.returning()

			// Update broadcast status to 'failed'
			const [updatedBroadcast] = await this.db
				.update(broadcasts)
				.set({
					status: 'failed',
					errorMessage,
					updatedAt: now,
				})
				.where(eq(broadcasts.id, broadcastId))
				.returning()

			return {
				success: false,
				broadcast: {
					...updatedBroadcast,
					content: updatedBroadcast.content as Record<string, unknown>,
					scheduledFor: updatedBroadcast.scheduledFor
						? updatedBroadcast.scheduledFor.toISOString()
						: null,
					sentAt: updatedBroadcast.sentAt ? updatedBroadcast.sentAt.toISOString() : null,
					createdAt: updatedBroadcast.createdAt.toISOString(),
					updatedAt: updatedBroadcast.updatedAt.toISOString(),
				},
				delivery: {
					...delivery,
					sentAt: null,
					createdAt: delivery.createdAt.toISOString(),
				},
			}
		}
	}

	async deleteBroadcast(broadcastId: string, userId: string): Promise<void> {
		// Fetch deliveries and target config before deleting so we can clean up Discord
		const broadcast = await this.db.query.broadcasts.findFirst({
			where: eq(broadcasts.id, broadcastId),
		})

		if (broadcast && (broadcast.status === 'sent' || broadcast.status === 'rescinded')) {
			const [deliveries, target] = await Promise.all([
				this.db.query.broadcastDeliveries.findMany({
					where: and(
						eq(broadcastDeliveries.broadcastId, broadcastId),
						eq(broadcastDeliveries.status, 'sent')
					),
				}),
				this.db.query.broadcastTargets.findFirst({
					where: eq(broadcastTargets.id, broadcast.targetId),
				}),
			])

			if (target?.type === 'discord_channel') {
				const config = target.config as { channelId: string }
				const discordStub = getStub<Discord>(this.env.DISCORD, 'default')
				await Promise.allSettled(
					deliveries
						.filter((d) => d.discordMessageId)
						.map((d) => discordStub.deleteMessage(config.channelId, d.discordMessageId!))
				)
			}
		}

		// Delete deliveries first (or let cascade handle it), then broadcast
		await this.db
			.delete(broadcastDeliveries)
			.where(eq(broadcastDeliveries.broadcastId, broadcastId))
		await this.db.delete(broadcasts).where(eq(broadcasts.id, broadcastId))
	}

	async rescindBroadcast(broadcastId: string, userId: string, rescindMessage?: string): Promise<void> {
		const broadcast = await this.db.query.broadcasts.findFirst({
			where: eq(broadcasts.id, broadcastId),
		})

		if (!broadcast) throw new Error('Broadcast not found')
		if (broadcast.status !== 'sent') throw new Error('Only sent broadcasts can be rescinded')

		const [deliveries, target] = await Promise.all([
			this.db.query.broadcastDeliveries.findMany({
				where: and(
					eq(broadcastDeliveries.broadcastId, broadcastId),
					eq(broadcastDeliveries.status, 'sent')
				),
			}),
			this.db.query.broadcastTargets.findFirst({
				where: eq(broadcastTargets.id, broadcast.targetId),
			}),
		])

		if (target?.type === 'discord_channel') {
			const config = target.config as { channelId: string }
			const discordStub = getStub<Discord>(this.env.DISCORD, 'default')
			const broadcastDetails = await this.getBroadcast(broadcastId, userId)

			if (broadcastDetails) {
				// Render the original content (without footer)
				let baseMessage: string
				if (broadcastDetails.template) {
					baseMessage = this.renderTemplate(
						broadcastDetails.template.messageTemplate,
						broadcastDetails.content
					)
				} else {
					baseMessage = (broadcastDetails.content.message as string) || broadcastDetails.title
				}
				baseMessage = convertUnixTimestamps(baseMessage)

				const rescindTimestamp = Math.floor(Date.now() / 1000)

				await Promise.allSettled(
					deliveries
						.filter((d) => d.discordMessageId)
						.map((d) => {
							// Reconstruct the original sent footer using this delivery's sentAt
							const sentUnix = d.sentAt
								? Math.floor(new Date(d.sentAt).getTime() / 1000)
								: rescindTimestamp
							const sentFooter = `#### SENT BY ${broadcastDetails.createdByCharacterName} to ${broadcastDetails.target.name} @ <t:${sentUnix}:F> ####`

							// Wrap only the original content in strikethrough, leave footer as-is
							const strikethrough = baseMessage
								.split('\n')
								.map((line) => (line.trim() ? `~~${line}~~` : line))
								.join('\n')

							// Build: strikethrough content, original footer, optional reason, rescinded footer
							let rescindedContent = `${strikethrough}\n\n${sentFooter}`

							if (rescindMessage?.trim()) {
								rescindedContent += `\n\nRESCINDED: ${rescindMessage.trim()}`
							}

							rescindedContent += `\n\n#### RESCINDED @ <t:${rescindTimestamp}:F> ####`

							return discordStub.editMessage(
								config.channelId,
								d.discordMessageId!,
								rescindedContent
							)
						})
				)
			}
		}

		await this.db
			.update(broadcasts)
			.set({ status: 'rescinded', updatedAt: new Date() })
			.where(eq(broadcasts.id, broadcastId))
	}

	async getDeliveries(broadcastId: string, userId: string): Promise<BroadcastDelivery[]> {
		const deliveries = await this.db.query.broadcastDeliveries.findMany({
			where: eq(broadcastDeliveries.broadcastId, broadcastId),
		})

		return deliveries.map((d) => ({
			...d,
			sentAt: d.sentAt ? d.sentAt.toISOString() : null,
			createdAt: d.createdAt.toISOString(),
		}))
	}

	// =========================================================================
	// HELPERS
	// =========================================================================

	/**
	 * Simple template rendering - replaces {{fieldName}} with content values
	 */
	private renderTemplate(template: string, content: Record<string, unknown>): string {
		let result = template

		for (const [key, value] of Object.entries(content)) {
			const placeholder = `{{${key}}}`
			result = result.replace(new RegExp(placeholder, 'g'), String(value))
		}

		return result
	}
}
