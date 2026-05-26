import { DurableObject } from 'cloudflare:workers'

import { and, asc, desc, eq, inArray, or, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { parseBroadcastSrpMode, renderBroadcastSrpSection } from '@repo/broadcasts'
import { logger } from '@repo/hono-helpers'

/** Parse a loose truthy value (boolean, number, "true"/"yes"/etc) into a boolean. */
function parseBoolFlag(value: unknown): boolean {
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase()
		return ['true', '1', 'yes', 'enabled', 'on'].includes(normalized)
	}
	return false
}

import { createDb } from './db'
import {
	broadcastDeliveries,
	broadcastSessionLinks,
	broadcasts,
	broadcastTargets,
	broadcastTemplateTargets,
	broadcastTemplates,
} from './db/schema'
import { generateSrpFriendlyToken } from './utils/srp-token'
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
	UpdateBroadcastRequest,
	UpdateBroadcastTargetRequest,
	UpdateBroadcastTemplateRequest,
	BroadcastSrpMode,
} from '@repo/broadcasts'
import type { Discord } from '@repo/discord'
import type { Env } from './context'

const DISCORD_MESSAGE_MAX_LENGTH = 2000

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
			orderBy: [asc(broadcastTargets.displayOrder), desc(broadcastTargets.createdAt)],
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
				displayOrder: data.displayOrder ?? 0,
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
				displayOrder: data.displayOrder ?? existing.displayOrder,
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

	private async getTemplateTargetIds(templateIds: string[]): Promise<Map<string, string[]>> {
		if (templateIds.length === 0) {
			return new Map()
		}

		const rows = await this.db.query.broadcastTemplateTargets.findMany({
			where: inArray(broadcastTemplateTargets.templateId, templateIds),
		})

		const idsByTemplateId = new Map<string, string[]>()
		for (const row of rows) {
			const existing = idsByTemplateId.get(row.templateId)
			if (existing) {
				existing.push(row.targetId)
			} else {
				idsByTemplateId.set(row.templateId, [row.targetId])
			}
		}

		return idsByTemplateId
	}

	async listTemplates(
		userId: string,
		filters?: { targetType?: string; targetId?: string }
	): Promise<BroadcastTemplate[]> {
		const whereConditions = []

		if (filters?.targetType) {
			whereConditions.push(eq(broadcastTemplates.targetType, filters.targetType))
		}
		const templates = await this.db.query.broadcastTemplates.findMany({
			where: whereConditions.length > 0 ? and(...whereConditions) : undefined,
			orderBy: [
				asc(broadcastTemplates.displayOrder),
				asc(broadcastTemplates.name),
				desc(broadcastTemplates.createdAt),
			],
		})
		const templateIds = templates.map((template) => template.id)
		const templateTargetIds = await this.getTemplateTargetIds(templateIds)

		return templates
			.filter((template) => {
				if (!filters?.targetId) return true
				const targetIds = templateTargetIds.get(template.id) ?? []
				return targetIds.includes(filters.targetId)
			})
			.map((t) => ({
			id: t.id,
			name: t.name,
			description: t.description,
			targetType: t.targetType,
			displayOrder: t.displayOrder,
			targetIds: templateTargetIds.get(t.id) ?? [],
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
		const templateTargetIds = await this.getTemplateTargetIds([templateId])

		return {
			id: template.id,
			name: template.name,
			description: template.description,
			targetType: template.targetType,
			displayOrder: template.displayOrder,
			targetIds: templateTargetIds.get(template.id) ?? [],
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
		const normalizedTargetIds = [...new Set(data.targetIds.filter(Boolean))]
		if (normalizedTargetIds.length === 0) {
			throw new Error('Template must include at least one target')
		}

		const targets = await this.db.query.broadcastTargets.findMany({
			where: inArray(broadcastTargets.id, normalizedTargetIds),
		})
		if (targets.length !== normalizedTargetIds.length) {
			throw new Error('One or more targets not found')
		}
		if (targets.some((target) => target.type !== data.targetType)) {
			throw new Error('Template targetType must match target type')
		}

		const now = new Date()

		const [template] = await this.db
			.insert(broadcastTemplates)
			.values({
				name: data.name,
				description: data.description || null,
				targetType: data.targetType,
				displayOrder: data.displayOrder ?? 0,
				fieldSchema: data.fieldSchema,
				messageTemplate: data.messageTemplate,
				createdBy: userId,
				createdAt: now,
				updatedAt: now,
			})
			.returning()

		await this.db.insert(broadcastTemplateTargets).values(
			normalizedTargetIds.map((targetId) => ({
				templateId: template.id,
				targetId,
				createdAt: now,
			}))
		)

		return {
			id: template.id,
			name: template.name,
			description: template.description,
			targetType: template.targetType,
			displayOrder: template.displayOrder,
			targetIds: normalizedTargetIds,
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

		const nextTargetIds = data.targetIds
			? [...new Set(data.targetIds.filter(Boolean))]
			: existing.targetIds
		if (nextTargetIds.length === 0) {
			throw new Error('Template must include at least one target')
		}

		const targets = await this.db.query.broadcastTargets.findMany({
			where: inArray(broadcastTargets.id, nextTargetIds),
		})
		if (targets.length !== nextTargetIds.length) {
			throw new Error('One or more targets not found')
		}
		if (targets.some((target) => target.type !== existing.targetType)) {
			throw new Error('Template targetType must match target type')
		}

		const [updated] = await this.db
			.update(broadcastTemplates)
			.set({
				name: data.name ?? existing.name,
				description: data.description !== undefined ? data.description : existing.description,
				displayOrder: data.displayOrder ?? existing.displayOrder,
				fieldSchema: data.fieldSchema ?? existing.fieldSchema,
				messageTemplate: data.messageTemplate ?? existing.messageTemplate,
				updatedAt: new Date(),
			})
			.where(eq(broadcastTemplates.id, templateId))
			.returning()

		await this.db
			.delete(broadcastTemplateTargets)
			.where(eq(broadcastTemplateTargets.templateId, templateId))
		await this.db.insert(broadcastTemplateTargets).values(
			nextTargetIds.map((targetId) => ({
				templateId,
				targetId,
				createdAt: new Date(),
			}))
		)

		return {
			id: updated.id,
			name: updated.name,
			description: updated.description,
			targetType: updated.targetType,
			displayOrder: updated.displayOrder,
			targetIds: nextTargetIds,
			fieldSchema: updated.fieldSchema as any,
			messageTemplate: updated.messageTemplate,
			createdBy: updated.createdBy,
			createdAt: updated.createdAt.toISOString(),
			updatedAt: updated.updatedAt.toISOString(),
		}
	}

	async deleteTemplate(templateId: string, userId: string): Promise<void> {
		const template = await this.db.query.broadcastTemplates.findFirst({
			where: eq(broadcastTemplates.id, templateId),
		})

		if (!template) {
			return
		}

		// Evacuate template-backed draft broadcasts to custom message drafts before delete.
		// This prevents drafts from depending on a template that no longer exists.
		const draftBroadcastsUsingTemplate = await this.db.query.broadcasts.findMany({
			where: and(eq(broadcasts.templateId, templateId), eq(broadcasts.status, 'draft')),
		})

		await Promise.all(
			draftBroadcastsUsingTemplate.map((broadcast) => {
				const existingContent = broadcast.content as Record<string, unknown>
				const renderedMessage = this.renderTemplateMessageWithDefaultText(
					template.messageTemplate,
					existingContent
				)
				return this.db
					.update(broadcasts)
					.set({
						templateId: null,
						content: {
							...existingContent,
							message: renderedMessage,
						},
						updatedAt: new Date(),
					})
					.where(eq(broadcasts.id, broadcast.id))
			})
		)

		await this.db.delete(broadcastTemplates).where(eq(broadcastTemplates.id, templateId))
	}

	// =========================================================================
	// BROADCASTS
	// =========================================================================

	private async getSessionLinksByBroadcastIds(
		broadcastIds: string[]
	): Promise<
		Map<
			string,
			{
				srpMode: BroadcastSrpMode | null
				srpToken: string | null
				doctrineId: string | null
				fleetSessionId: string | null
			}
		>
	> {
		if (broadcastIds.length === 0) return new Map()
		const links = await this.db.query.broadcastSessionLinks.findMany({
			where: inArray(broadcastSessionLinks.broadcastId, broadcastIds),
		})
		return new Map(
			links.map((link) => [
				link.broadcastId,
				{
					srpMode: (link.srpMode as BroadcastSrpMode | null) ?? null,
					srpToken: link.srpToken ?? null,
					doctrineId: link.doctrineId ?? null,
					fleetSessionId: link.fleetSessionId ?? null,
				},
			])
		)
	}

	private async upsertBroadcastSessionLink(args: {
		broadcastId: string
		srpMode?: BroadcastSrpMode | null
		srpToken?: string | null
		doctrineId?: string | null
		fleetSessionId?: string | null
	}): Promise<void> {
		const now = new Date()
		const normalizedSrpToken =
			typeof args.srpToken === 'string' && args.srpToken.trim().length > 0
				? args.srpToken.trim()
				: null
		const normalizedFleetSessionId =
			typeof args.fleetSessionId === 'string' && args.fleetSessionId.trim().length > 0
				? args.fleetSessionId.trim()
				: null
		const normalizedDoctrineId =
			typeof args.doctrineId === 'string' && args.doctrineId.trim().length > 0
				? args.doctrineId.trim()
				: null

		await this.db
			.insert(broadcastSessionLinks)
			.values({
				broadcastId: args.broadcastId,
				srpMode: args.srpMode ?? null,
				srpToken: normalizedSrpToken,
				doctrineId: normalizedDoctrineId,
				fleetSessionId: normalizedFleetSessionId,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: broadcastSessionLinks.broadcastId,
				set: {
					srpMode: args.srpMode ?? null,
					srpToken: normalizedSrpToken,
					doctrineId: normalizedDoctrineId,
					fleetSessionId: normalizedFleetSessionId,
					updatedAt: now,
				},
			})
	}

	private isUniqueViolation(error: unknown): boolean {
		if (typeof error !== 'object' || error === null) return false
		const code = (error as { code?: unknown }).code
		return typeof code === 'string' && code === '23505'
	}

	private async reserveSrpLink(args: {
		broadcastId: string
		content: Record<string, unknown>
	}): Promise<{
		content: Record<string, unknown>
		srpMode: BroadcastSrpMode | null
		srpToken: string | null
		doctrineId: string | null
	}> {
		const srpMode = this.resolveSrpModeIfPresent(args.content)
		const doctrineId = this.resolveDoctrineIdIfPresent(args.content)
		if (!srpMode) {
			await this.upsertBroadcastSessionLink({
				broadcastId: args.broadcastId,
				srpMode: null,
				srpToken: null,
				doctrineId,
				fleetSessionId: null,
			})
			return { content: args.content, srpMode: null, srpToken: null, doctrineId }
		}

		let nextContent = { ...args.content }
		if (srpMode === 'disabled' || srpMode === 'coalition') {
			if ('__srpToken' in nextContent) {
				delete nextContent.__srpToken
			}
			await this.upsertBroadcastSessionLink({
				broadcastId: args.broadcastId,
				srpMode,
				srpToken: null,
				doctrineId,
				fleetSessionId: null,
			})
			return { content: nextContent, srpMode, srpToken: null, doctrineId }
		}

		const maxAttempts = 10
		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			const existing = nextContent.__srpToken
			const token =
				typeof existing === 'string' && existing.trim().length > 0
					? existing.trim()
					: await this.generateUniqueSrpFriendlyToken()
			nextContent.__srpToken = token
			try {
				await this.upsertBroadcastSessionLink({
					broadcastId: args.broadcastId,
					srpMode,
					srpToken: token,
					doctrineId,
					fleetSessionId: null,
				})
				return { content: nextContent, srpMode, srpToken: token, doctrineId }
			} catch (error) {
				if (!this.isUniqueViolation(error)) throw error
				// Rare race: another broadcast reserved this token between check and upsert.
				// Force a new token and retry.
				delete nextContent.__srpToken
			}
		}

		throw new Error('Unable to reserve a unique SRP token.')
	}

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
		const sessionLinksByBroadcastId = await this.getSessionLinksByBroadcastIds(
			broadcastList.map((broadcast) => broadcast.id)
		)

		return {
			rows: broadcastList.map((b) => ({
				...b,
				content: b.content as Record<string, unknown>,
				srpMode: sessionLinksByBroadcastId.get(b.id)?.srpMode ?? null,
				srpToken: sessionLinksByBroadcastId.get(b.id)?.srpToken ?? null,
				doctrineId: sessionLinksByBroadcastId.get(b.id)?.doctrineId ?? null,
				fleetSessionId: sessionLinksByBroadcastId.get(b.id)?.fleetSessionId ?? null,
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
		const link = await this.db.query.broadcastSessionLinks.findFirst({
			where: eq(broadcastSessionLinks.broadcastId, broadcastId),
		})

		if (!target) {
			throw new Error('Target not found for broadcast')
		}

		return {
			...broadcast,
			content: broadcast.content as Record<string, unknown>,
			srpMode: (link?.srpMode as BroadcastSrpMode | null) ?? null,
			srpToken: link?.srpToken ?? null,
			doctrineId: link?.doctrineId ?? null,
			fleetSessionId: link?.fleetSessionId ?? null,
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
						displayOrder: template.displayOrder,
						targetIds: (await this.getTemplateTargetIds([template.id])).get(template.id) ?? [],
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

	async getBroadcastBySrpToken(
		srpToken: string,
		userId: string
	): Promise<BroadcastWithDetails | null> {
		const normalized = srpToken.trim()
		if (!normalized) return null
		const link = await this.db.query.broadcastSessionLinks.findFirst({
			where: eq(broadcastSessionLinks.srpToken, normalized),
		})
		if (!link) return null
		if (link.srpMode !== 'blanket' && link.srpMode !== 'military') return null
		return this.getBroadcast(link.broadcastId, userId)
	}

	async getBroadcastByFleetSessionId(
		fleetSessionId: string,
		userId: string
	): Promise<BroadcastWithDetails | null> {
		const normalized = fleetSessionId.trim()
		if (!normalized) return null
		const link = await this.db.query.broadcastSessionLinks.findFirst({
			where: eq(broadcastSessionLinks.fleetSessionId, normalized),
		})
		if (!link) return null
		return this.getBroadcast(link.broadcastId, userId)
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
			srpMode: null,
			srpToken: null,
			doctrineId: null,
			fleetSessionId: null,
			scheduledFor: broadcast.scheduledFor ? broadcast.scheduledFor.toISOString() : null,
			sentAt: null,
			createdAt: broadcast.createdAt.toISOString(),
			updatedAt: broadcast.updatedAt.toISOString(),
		}
	}

	async sendBroadcast(
		broadcastId: string,
		userId: string,
		options: { canStartTracking?: boolean } = {}
	): Promise<SendBroadcastResult> {
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
			let renderedContent = broadcastDetails.content
			if (broadcastDetails.template) {
				const prepared = await this.prepareTemplateContentForSend(
					broadcastDetails.template.messageTemplate,
					broadcastDetails.content
				)
				if (prepared.changed) {
					const [updatedContent] = await this.db
						.update(broadcasts)
						.set({
							content: prepared.content,
							updatedAt: new Date(),
						})
						.where(eq(broadcasts.id, broadcastId))
						.returning()
					renderedContent = updatedContent.content as Record<string, unknown>
				} else {
					renderedContent = prepared.content
				}
			}

				const reservedLink = await this.reserveSrpLink({
					broadcastId,
					content: renderedContent,
				})
				if (
					JSON.stringify(reservedLink.content) !== JSON.stringify(renderedContent)
				) {
					const [reservedContentUpdate] = await this.db
						.update(broadcasts)
						.set({
							content: reservedLink.content,
							updatedAt: new Date(),
						})
						.where(eq(broadcasts.id, broadcastId))
						.returning()
					renderedContent = reservedContentUpdate.content as Record<string, unknown>
				}

				// Send based on target type
				if (broadcastDetails.target.type === 'discord_channel') {
				const config = broadcastDetails.target.config as {
					guildId: string
					channelId: string
				}

				// Render message from template if available
				let message: string
				if (broadcastDetails.template) {
					message = this.renderTemplateMessageWithDefaultText(
						broadcastDetails.template.messageTemplate,
						renderedContent
					)
				} else {
					// If no template, use content as-is (expect a 'message' field)
					message = (renderedContent.message as string) || broadcastDetails.title
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

				if (this.isFrogsirenEnabled(renderedContent.__frogsirenEnabled)) {
					message = this.wrapWithFrogsirenBanner(message)
				}

				// Add footer with sender, target, and timestamp
				const sendTime = new Date()
				const unixTimestamp = Math.floor(sendTime.getTime() / 1000)
				const footer = `\n\n#### SENT BY ${broadcastDetails.createdByCharacterName} to ${broadcastDetails.target.name} @ <t:${unixTimestamp}:F> ####`
				message = message + footer
				this.ensureDiscordContentLimit(message)

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

				// Side effect: start fleet tracking if the template requested it.
				// Runs only after Discord has confirmed the message went out, so a
				// Discord failure never leaves an orphan tracking session.
				const trackingOutcome = await this.maybeStartFleetTracking({
					broadcastId,
					broadcastTitle: broadcastDetails.title,
					content: renderedContent,
					userId,
					canStartTracking: options.canStartTracking ?? false,
				})
				const srpMode = reservedLink.srpMode
				const srpToken = reservedLink.srpToken
				const doctrineId = reservedLink.doctrineId
				await this.upsertBroadcastSessionLink({
					broadcastId,
					srpMode,
					srpToken,
					doctrineId,
					fleetSessionId: trackingOutcome.sessionId,
				})

				return {
					success: true,
					broadcast: {
						...updatedBroadcast,
						content: updatedBroadcast.content as Record<string, unknown>,
						srpMode,
						srpToken,
						doctrineId,
						fleetSessionId: trackingOutcome.sessionId,
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
					trackingSessionId: trackingOutcome.sessionId,
					trackingError: trackingOutcome.error,
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
					srpMode: this.resolveSrpModeIfPresent(
						(updatedBroadcast.content ?? {}) as Record<string, unknown>
					),
					srpToken: this.resolveSrpTokenForMode(
						(updatedBroadcast.content ?? {}) as Record<string, unknown>,
						this.resolveSrpModeIfPresent((updatedBroadcast.content ?? {}) as Record<string, unknown>)
					),
					doctrineId: this.resolveDoctrineIdIfPresent(
						(updatedBroadcast.content ?? {}) as Record<string, unknown>
					),
					fleetSessionId: null,
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

	async updateBroadcast(
		broadcastId: string,
		data: UpdateBroadcastRequest,
		userId: string
	): Promise<Broadcast> {
		const existing = await this.db.query.broadcasts.findFirst({
			where: eq(broadcasts.id, broadcastId),
		})

		if (!existing) {
			throw new Error('Broadcast not found')
		}

		if (existing.status !== 'draft') {
			throw new Error('Only draft broadcasts can be edited')
		}

		const nextScheduledFor =
			data.scheduledFor !== undefined
				? data.scheduledFor
					? new Date(data.scheduledFor)
					: null
				: existing.scheduledFor
		const nextStatus: BroadcastStatus = nextScheduledFor ? 'scheduled' : 'draft'

		const [updated] = await this.db
			.update(broadcasts)
			.set({
				content: data.content ?? existing.content,
				scheduledFor: nextScheduledFor,
				status: nextStatus,
				errorMessage: null,
				updatedAt: new Date(),
			})
			.where(eq(broadcasts.id, broadcastId))
			.returning()

		if (!updated) {
			throw new Error('Failed to update broadcast')
		}

		return {
			...updated,
			content: updated.content as Record<string, unknown>,
			scheduledFor: updated.scheduledFor ? updated.scheduledFor.toISOString() : null,
			sentAt: updated.sentAt ? updated.sentAt.toISOString() : null,
			createdAt: updated.createdAt.toISOString(),
			updatedAt: updated.updatedAt.toISOString(),
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
					baseMessage = this.renderTemplateMessageWithDefaultText(
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
		return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawFieldName) => {
			const token = String(rawFieldName ?? '').trim()
			const wrappedToken =
				token.startsWith('<') && token.endsWith('>') ? token.slice(1, -1).trim() : token
			let fieldName = wrappedToken
			if (wrappedToken.startsWith('select:')) {
				const selectBody = wrappedToken.slice('select:'.length)
				const separator = selectBody.indexOf(':')
				if (separator > 0) {
					const labelName = selectBody.slice(0, separator).trim()
					fieldName = `select:${labelName}`
				}
			}
			if (fieldName === 'srp') {
				const mode = parseBroadcastSrpMode(content.srp)
				const token = this.resolveSrpToken(content)
				return renderBroadcastSrpSection(mode, token)
			}
			const value = content[fieldName]
			return value === undefined || value === null ? '' : String(value)
		})
	}

	private async prepareTemplateContentForSend(
		template: string,
		content: Record<string, unknown>
	): Promise<{ content: Record<string, unknown>; changed: boolean }> {
		if (!/\{\{\s*srp\s*\}\}/.test(template)) {
			return { content, changed: false }
		}

		const nextContent = { ...content }
		let changed = false
		const mode = parseBroadcastSrpMode(nextContent.srp)
		if (mode === 'disabled' || mode === 'coalition') {
			if ('__srpToken' in nextContent) {
				delete nextContent.__srpToken
				changed = true
			}
			return { content: nextContent, changed }
		}

		const existingToken = nextContent.__srpToken
		if (typeof existingToken === 'string' && existingToken.trim().length > 0) {
			if (!(await this.isSrpTokenAvailable(existingToken.trim()))) {
				nextContent.__srpToken = await this.generateUniqueSrpFriendlyToken()
				return { content: nextContent, changed: true }
			}
			return { content: nextContent, changed }
		}

		nextContent.__srpToken = await this.generateUniqueSrpFriendlyToken()
		return { content: nextContent, changed: true }
	}

	private isFrogsirenEnabled(value: unknown): boolean {
		if (typeof value === 'boolean') return value
		if (typeof value === 'number') return value !== 0
		if (typeof value === 'string') {
			const normalized = value.trim().toLowerCase()
			return ['true', '1', 'yes', 'enabled', 'on'].includes(normalized)
		}
		return false
	}

	/**
	 * If the broadcast content has the system_fleet_tracking flag set, try to
	 * spin up a fleet tracking session on FleetsDO. Returns the resulting
	 * sessionId (or a user-facing error string). Never throws; broadcast
	 * delivery already succeeded by the time we get here.
	 */
	private async maybeStartFleetTracking(args: {
		broadcastId: string
		broadcastTitle: string
		content: Record<string, unknown>
		userId: string
		canStartTracking: boolean
	}): Promise<{ sessionId: string | null; error: string | null }> {
		if (!parseBoolFlag(args.content.__fleetTrackingEnabled)) {
			return { sessionId: null, error: null }
		}

		if (!args.canStartTracking) {
			const error = 'You do not have permission to start fleet tracking.'
			logger.warn('[Broadcasts] Fleet tracking requested but user lacks permission', {
				broadcastId: args.broadcastId,
				userId: args.userId,
			})
			return { sessionId: null, error }
		}

		const characterId = args.content.__fleetTrackingCharacterId
		if (typeof characterId !== 'string' || !characterId.trim()) {
			return {
				sessionId: null,
				error: 'No character selected for fleet tracking.',
			}
		}

		try {
			const fleetsStub = getStub(this.env.FLEETS, 'default') as {
				startTrackingSession: (args: {
					characterId: string
					startedByUserId: string
					name: string
				}) => Promise<{ sessionId: string }>
			}
			const result = await fleetsStub.startTrackingSession({
				characterId: characterId.trim(),
				startedByUserId: args.userId,
				name: args.broadcastTitle,
			})
			return { sessionId: result.sessionId, error: null }
		} catch (error) {
			const trackingErrorCode =
				typeof error === 'object' &&
				error !== null &&
				'code' in error &&
				typeof (error as { code?: unknown }).code === 'string'
					? (error as { code: string }).code
					: null
			const errorMessage =
				trackingErrorCode
					? this.formatTrackingStartError(trackingErrorCode)
					: error instanceof Error
						? error.message
						: 'Failed to start fleet tracking.'
			logger.warn('[Broadcasts] Failed to start fleet tracking after broadcast send', {
				broadcastId: args.broadcastId,
				characterId,
				error: error instanceof Error ? error.message : String(error),
			})
			return { sessionId: null, error: errorMessage }
		}
	}

	private formatTrackingStartError(code: string): string {
		switch (code) {
			case 'not_in_fleet':
				return 'Selected character is not currently in a fleet.'
			case 'not_fleet_boss':
				return 'Selected character is not the fleet boss.'
			case 'character_session_active':
				return 'A tracking session is already running for this character.'
			case 'fleet_session_active':
				return 'A tracking session is already running for this fleet.'
			case 'esi_unavailable':
				return 'EVE ESI is unreachable; try starting tracking manually.'
			default:
				return `Failed to start fleet tracking (${code}).`
		}
	}

	private resolveSrpToken(content: Record<string, unknown>): string {
		const existing = content.__srpToken
		if (typeof existing === 'string' && existing.trim().length > 0) {
			return existing.trim()
		}
		return this.generateSrpFriendlyToken()
	}

	private generateSrpFriendlyToken(): string {
		return generateSrpFriendlyToken()
	}

	private resolveSrpModeIfPresent(content: Record<string, unknown>): BroadcastSrpMode | null {
		if (!Object.prototype.hasOwnProperty.call(content, 'srp')) return null
		return parseBroadcastSrpMode(content.srp)
	}

	private resolveDoctrineIdIfPresent(content: Record<string, unknown>): string | null {
		const raw = content.__doctrineId
		if (typeof raw !== 'string') return null
		const trimmed = raw.trim()
		// Persist only explicit doctrine IDs (not custom doctrine text).
		if (!trimmed) return null
		return trimmed
	}

	private resolveSrpTokenForMode(
		content: Record<string, unknown>,
		mode: BroadcastSrpMode | null
	): string | null {
		if (!mode || mode === 'disabled' || mode === 'coalition') return null
		const token = content.__srpToken
		return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null
	}

	private async isSrpTokenAvailable(token: string): Promise<boolean> {
		const existing = await this.db.query.broadcastSessionLinks.findFirst({
			where: eq(broadcastSessionLinks.srpToken, token),
		})
		return !existing
	}

	private async generateUniqueSrpFriendlyToken(): Promise<string> {
		const maxAttempts = 10
		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			const candidate = this.generateSrpFriendlyToken()
			if (await this.isSrpTokenAvailable(candidate)) {
				return candidate
			}
		}
		throw new Error('Unable to generate a unique SRP token.')
	}

	private renderTemplateMessageWithDefaultText(
		template: string,
		content: Record<string, unknown>
	): string {
		const renderedTemplate = this.renderTemplate(template, content)
		const prefixText = String(content.__prefixText ?? '').trim()
		const defaultText = String(content.__defaultText ?? '').trim()
		return [prefixText, renderedTemplate, defaultText].filter(Boolean).join('\n\n')
	}

	private wrapWithFrogsirenBanner(message: string): string {
		const frogsirenBanner = Array.from(
			{ length: 16 },
			() => '<:fs:1496199804470952080>'
		).join(' ')
		return `${frogsirenBanner}\n\n${message}\n\n${frogsirenBanner}`
	}

	private ensureDiscordContentLimit(message: string): void {
		if (message.length <= DISCORD_MESSAGE_MAX_LENGTH) return

		throw new Error(
			`Rendered broadcast message is ${message.length} characters. Discord maximum content length is ${DISCORD_MESSAGE_MAX_LENGTH}.`
		)
	}
}
