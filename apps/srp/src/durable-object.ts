import { DurableObject } from 'cloudflare:workers'

import { and, desc, eq, gte, inArray, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import type { EveCharacterData } from '@repo/eve-character-data'
import {
	generateKillmailUrl,
	generatePaymentToken,
	type LossWithSRPStatus,
	type SRPCommentResponse,
	type SRPConfigResponse,
	type SRPRequestResponse,
	type SRPStatsResponse,
	type Srp,
} from '@repo/srp'

import { createDb } from './db'
import { srpComments, srpConfig, srpRequestHistory, srpRequests } from './db/schema'

import type { Env } from './context'

/**
 * SRP Durable Object
 *
 * Manages the Ship Replacement Program database and business logic.
 * Uses PostgreSQL for persistent storage.
 */
export class SrpDO extends DurableObject<Env> implements Srp {
	private db: ReturnType<typeof createDb>

	constructor(state: DurableObjectState, env: Env) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
	}

	/**
	 * Create a new SRP request
	 */
	async createRequest(
		userId: string,
		characterId: string,
		killmailId: string,
		killmailHash: string,
		requestedAmount?: string
	): Promise<SRPRequestResponse> {
		// Check if request already exists for this killmail
		const existing = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.killmailId, killmailId),
		})

		if (existing) {
			throw new Error('SRP request already exists for this killmail')
		}

		// Fetch killmail details from eve-character-data using instance pattern
		using charStub = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, characterId)
		const charInstance = await charStub.getInstance(characterId)
		const killmailData = await charInstance.fetchKillmailDetails(killmailId, killmailHash)

		if (!killmailData || !killmailData.isLoss) {
			throw new Error('Killmail not found or is not a loss')
		}

		// Get character info
		const characterInfo = await charInstance.getCharacterInfo()
		if (!characterInfo) {
			throw new Error('Character not found')
		}

		// TODO: Fetch ship type name from static data
		const shipTypeName = `Ship ${killmailData.shipTypeId}`

		// Generate payment token
		const paymentToken = generatePaymentToken()

		// Create the request
		const result = await this.db
			.insert(srpRequests)
			.values({
				userId,
				characterId,
				characterName: characterInfo.name,
				corporationId: characterInfo.corporationId,
				corporationName: characterInfo.corporationName || 'Unknown',
				killmailId,
				killmailHash,
				shipTypeId: killmailData.shipTypeId!,
				shipTypeName,
				shipValue: killmailData.totalValue!,
				requestedAmount: requestedAmount || null,
				paymentToken,
				lossDate: killmailData.killmailTime,
				killmailData: killmailData.killmailData as any,
			})
			.returning()

		const request = result[0]

		// Log history
		await this.logHistory(request.id, userId, characterInfo.name, 'request_created', {
			previousRequestStatus: null,
			newRequestStatus: 'pending',
		})

		return this.formatRequest(request)
	}

	/**
	 * Get a single SRP request
	 */
	async getRequest(requestId: string, userId: string): Promise<SRPRequestResponse | null> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
			with: {
				comments: {
					orderBy: desc(srpComments.createdAt),
				},
				history: {
					orderBy: desc(srpRequestHistory.timestamp),
					limit: 50,
				},
			},
		})

		if (!request) return null

		// Check if user has access (owner, reviewer, or admin handled by core worker)
		if (request.userId !== userId) {
			// Only return public comments if not the owner
			request.comments = request.comments?.filter((c) => c.visibility === 'public')
		}

		return this.formatRequest(request)
	}

	/**
	 * Get all requests for a user
	 */
	async getUserRequests(
		userId: string,
		limit = 50,
		offset = 0
	): Promise<SRPRequestResponse[]> {
		const requests = await this.db.query.srpRequests.findMany({
			where: eq(srpRequests.userId, userId),
			orderBy: desc(srpRequests.createdAt),
			limit,
			offset,
		})

		return requests.map((r) => this.formatRequest(r))
	}

	/**
	 * Get recent losses for multiple characters with SRP status
	 */
	async getRecentLosses(
		characterIds: string[],
		userId: string,
		daysBack = 30,
		excludeNonSrpEligible = true
	): Promise<LossWithSRPStatus[]> {
		// Fetch losses from eve-character-data for each character
		const allLosses: Array<
			Omit<LossWithSRPStatus, 'hasSRPRequest' | 'srpRequestId' | 'srpRequestStatus'>
		> = []

		for (const characterId of characterIds) {
			using charStub = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, characterId)
			const charInstance = await charStub.getInstance(characterId)
			const losses = await charInstance.getRecentLosses(daysBack, excludeNonSrpEligible)

			// Convert losses to the format we need (with string timestamps)
			// Note: Date objects are serialized to ISO strings over RPC
			allLosses.push(
				...losses.map((loss) => ({
					...loss,
					killmailTime:
						typeof loss.killmailTime === 'string'
							? loss.killmailTime
							: loss.killmailTime.toISOString(),
				}))
			)
		}

		// Get existing SRP requests for these losses
		const killmailIds = allLosses.map((l) => l.killmailId)

		if (killmailIds.length === 0) {
			return []
		}

		const existingRequests = await this.db.query.srpRequests.findMany({
			where: and(eq(srpRequests.userId, userId), inArray(srpRequests.killmailId, killmailIds)),
		})

		const requestMap = new Map(
			existingRequests.map((r) => [r.killmailId, { id: r.id, status: r.requestStatus }])
		)

		// Annotate losses with SRP status and sort by time descending
		return allLosses
			.map((loss) => {
				const request = requestMap.get(loss.killmailId)
				return {
					...loss,
					hasSRPRequest: !!request,
					srpRequestId: request?.id,
					srpRequestStatus: request?.status,
				}
			})
			.sort((a, b) => new Date(b.killmailTime).getTime() - new Date(a.killmailTime).getTime())
	}

	/**
	 * Get pending requests for review
	 */
	async getPendingRequests(
		corporationId: string,
		limit = 50,
		offset = 0
	): Promise<SRPRequestResponse[]> {
		const requests = await this.db.query.srpRequests.findMany({
			where: and(
				eq(srpRequests.corporationId, corporationId),
				eq(srpRequests.requestStatus, 'pending')
			),
			orderBy: desc(srpRequests.createdAt),
			limit,
			offset,
		})

		return requests.map((r) => this.formatRequest(r))
	}

	/**
	 * Approve an SRP request
	 */
	async approveRequest(
		requestId: string,
		reviewerUserId: string,
		approvedAmount: string,
		reviewNotes?: string
	): Promise<SRPRequestResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')

		// Get reviewer character name (using their main character)
		// TODO: Get actual reviewer character name from user data

		const updated = await this.db
			.update(srpRequests)
			.set({
				requestStatus: 'approved',
				paymentStatus: 'pending',
				approvedAmount,
				reviewerId: reviewerUserId,
				reviewerCharacterName: 'Reviewer', // TODO: Get actual name
				reviewedAt: new Date(),
				reviewNotes,
				updatedAt: new Date(),
			})
			.where(eq(srpRequests.id, requestId))
			.returning()

		await this.logHistory(requestId, reviewerUserId, 'Reviewer', 'request_approved', {
			previousRequestStatus: request.requestStatus,
			newRequestStatus: 'approved',
			previousPaymentStatus: request.paymentStatus,
			newPaymentStatus: 'pending',
			newApprovedAmount: approvedAmount,
		})

		return this.formatRequest(updated[0])
	}

	/**
	 * Partially approve an SRP request
	 */
	async partiallyApproveRequest(
		requestId: string,
		reviewerUserId: string,
		approvedAmount: string,
		rejectionReason: string,
		reviewNotes?: string
	): Promise<SRPRequestResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')

		const updated = await this.db
			.update(srpRequests)
			.set({
				requestStatus: 'partially_approved',
				paymentStatus: 'pending',
				approvedAmount,
				reviewerId: reviewerUserId,
				reviewerCharacterName: 'Reviewer', // TODO: Get actual name
				reviewedAt: new Date(),
				reviewNotes: reviewNotes ? `${rejectionReason}\n\n${reviewNotes}` : rejectionReason,
				updatedAt: new Date(),
			})
			.where(eq(srpRequests.id, requestId))
			.returning()

		await this.logHistory(requestId, reviewerUserId, 'Reviewer', 'request_partially_approved', {
			previousRequestStatus: request.requestStatus,
			newRequestStatus: 'partially_approved',
			previousPaymentStatus: request.paymentStatus,
			newPaymentStatus: 'pending',
			newApprovedAmount: approvedAmount,
			metadata: { rejectionReason },
		})

		return this.formatRequest(updated[0])
	}

	/**
	 * Reject an SRP request
	 */
	async rejectRequest(
		requestId: string,
		reviewerUserId: string,
		rejectionReason: string,
		reviewNotes?: string
	): Promise<SRPRequestResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')

		const updated = await this.db
			.update(srpRequests)
			.set({
				requestStatus: 'rejected',
				reviewerId: reviewerUserId,
				reviewerCharacterName: 'Reviewer', // TODO: Get actual name
				reviewedAt: new Date(),
				reviewNotes: reviewNotes ? `${rejectionReason}\n\n${reviewNotes}` : rejectionReason,
				updatedAt: new Date(),
			})
			.where(eq(srpRequests.id, requestId))
			.returning()

		await this.logHistory(requestId, reviewerUserId, 'Reviewer', 'request_rejected', {
			previousRequestStatus: request.requestStatus,
			newRequestStatus: 'rejected',
			metadata: { rejectionReason },
		})

		return this.formatRequest(updated[0])
	}

	/**
	 * Get comments for a request
	 */
	async getComments(
		requestId: string,
		userId: string,
		includeInternal: boolean
	): Promise<SRPCommentResponse[]> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')

		const comments = await this.db.query.srpComments.findMany({
			where: and(
				eq(srpComments.requestId, requestId),
				includeInternal ? undefined : eq(srpComments.visibility, 'public')
			),
			orderBy: desc(srpComments.createdAt),
		})

		return comments.map((c) => ({
			id: c.id,
			requestId: c.requestId,
			authorUserId: c.authorUserId,
			authorCharacterName: c.authorCharacterName,
			content: c.content,
			visibility: c.visibility,
			isEdited: c.isEdited,
			editedAt: c.editedAt?.toISOString(),
			createdAt: c.createdAt.toISOString(),
		}))
	}

	/**
	 * Add a comment to a request
	 */
	async addComment(
		requestId: string,
		userId: string,
		content: string,
		visibility: 'public' | 'internal' = 'public'
	): Promise<SRPCommentResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')

		// TODO: Get character name from user
		const characterName = 'User'

		const result = await this.db
			.insert(srpComments)
			.values({
				requestId,
				authorUserId: userId,
				authorCharacterName: characterName,
				content,
				visibility,
			})
			.returning()

		const comment = result[0]

		return {
			id: comment.id,
			requestId: comment.requestId,
			authorUserId: comment.authorUserId,
			authorCharacterName: comment.authorCharacterName,
			content: comment.content,
			visibility: comment.visibility,
			isEdited: comment.isEdited,
			editedAt: comment.editedAt?.toISOString(),
			createdAt: comment.createdAt.toISOString(),
		}
	}

	/**
	 * Edit a comment
	 */
	async editComment(commentId: string, userId: string, content: string): Promise<SRPCommentResponse> {
		const comment = await this.db.query.srpComments.findFirst({
			where: eq(srpComments.id, commentId),
		})

		if (!comment) throw new Error('Comment not found')
		if (comment.authorUserId !== userId) throw new Error('Not authorized to edit this comment')

		const updated = await this.db
			.update(srpComments)
			.set({
				content,
				isEdited: true,
				editedAt: new Date(),
				originalContent: comment.originalContent || comment.content,
			})
			.where(eq(srpComments.id, commentId))
			.returning()

		const result = updated[0]

		return {
			id: result.id,
			requestId: result.requestId,
			authorUserId: result.authorUserId,
			authorCharacterName: result.authorCharacterName,
			content: result.content,
			visibility: result.visibility,
			isEdited: result.isEdited,
			editedAt: result.editedAt?.toISOString(),
			createdAt: result.createdAt.toISOString(),
		}
	}

	/**
	 * Delete a comment
	 */
	async deleteComment(commentId: string, userId: string): Promise<void> {
		const comment = await this.db.query.srpComments.findFirst({
			where: eq(srpComments.id, commentId),
		})

		if (!comment) throw new Error('Comment not found')
		if (comment.authorUserId !== userId) throw new Error('Not authorized to delete this comment')

		await this.db.delete(srpComments).where(eq(srpComments.id, commentId))
	}

	/**
	 * Get pending payments
	 */
	async getPendingPayments(
		corporationId?: string,
		limit = 50,
		offset = 0
	): Promise<SRPRequestResponse[]> {
		const requests = await this.db.query.srpRequests.findMany({
			where: and(
				corporationId ? eq(srpRequests.corporationId, corporationId) : undefined,
				eq(srpRequests.paymentStatus, 'pending')
			),
			orderBy: desc(srpRequests.reviewedAt),
			limit,
			offset,
		})

		return requests.map((r) => this.formatRequest(r))
	}

	/**
	 * Mark a request as paid
	 */
	async markPaid(
		requestId: string,
		payerUserId: string,
		paidAmount: string,
		paymentToken: string
	): Promise<SRPRequestResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')
		if (request.paymentToken !== paymentToken) throw new Error('Invalid payment token')

		// TODO: Get payer character name
		const payerName = 'Payer'

		const updated = await this.db
			.update(srpRequests)
			.set({
				paymentStatus: 'paid_in_full',
				paymentDate: new Date(),
				paymentCharacterName: payerName,
				updatedAt: new Date(),
			})
			.where(eq(srpRequests.id, requestId))
			.returning()

		await this.logHistory(requestId, payerUserId, payerName, 'payment_completed', {
			previousPaymentStatus: request.paymentStatus,
			newPaymentStatus: 'paid_in_full',
			metadata: { paidAmount },
		})

		return this.formatRequest(updated[0])
	}

	/**
	 * Mark a request as partially paid
	 */
	async markPartiallyPaid(
		requestId: string,
		payerUserId: string,
		paidAmount: string,
		paymentToken: string,
		notes?: string
	): Promise<SRPRequestResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')
		if (request.paymentToken !== paymentToken) throw new Error('Invalid payment token')

		// TODO: Get payer character name
		const payerName = 'Payer'

		const updated = await this.db
			.update(srpRequests)
			.set({
				paymentStatus: 'partial_payment',
				paymentDate: new Date(),
				paymentCharacterName: payerName,
				updatedAt: new Date(),
			})
			.where(eq(srpRequests.id, requestId))
			.returning()

		await this.logHistory(requestId, payerUserId, payerName, 'partial_payment_completed', {
			previousPaymentStatus: request.paymentStatus,
			newPaymentStatus: 'partial_payment',
			metadata: { paidAmount, notes },
		})

		return this.formatRequest(updated[0])
	}

	/**
	 * Get SRP configuration
	 */
	async getConfig(): Promise<SRPConfigResponse | null> {
		const config = await this.db.query.srpConfig.findFirst({
			where: eq(srpConfig.isActive, true),
			orderBy: desc(srpConfig.effectiveFrom),
		})

		if (!config) return null

		return {
			id: config.id,
			isActive: config.isActive,
			defaultCoverageRate: config.defaultCoverageRate,
			maxPayoutAmount: config.maxPayoutAmount || undefined,
			minShipValue: config.minShipValue,
			autoApprovalEnabled: config.autoApprovalEnabled,
			autoApprovalThreshold: config.autoApprovalThreshold || undefined,
			eligibleCorporationIds: config.eligibleCorporationIds || undefined,
			rejectionReasons: (config.rejectionReasons as string[]) || [],
			metadata: (config.metadata as Record<string, unknown>) || undefined,
			createdBy: config.createdBy,
			effectiveFrom: config.effectiveFrom.toISOString(),
			effectiveTo: config.effectiveTo?.toISOString(),
			createdAt: config.createdAt.toISOString(),
		}
	}

	/**
	 * Update SRP configuration
	 */
	async updateConfig(
		userId: string,
		updates: import('@repo/srp').UpdateSRPConfig
	): Promise<SRPConfigResponse> {
		// Get current config
		const current = await this.getConfig()

		if (current) {
			// Deactivate current config
			await this.db
				.update(srpConfig)
				.set({ isActive: false, effectiveTo: new Date() })
				.where(eq(srpConfig.id, current.id))
		}

		// Create new config
		const result = await this.db
			.insert(srpConfig)
			.values({
				isActive: true,
				defaultCoverageRate: updates.defaultCoverageRate || current?.defaultCoverageRate || '1.0',
				maxPayoutAmount: updates.maxPayoutAmount || current?.maxPayoutAmount || null,
				minShipValue: updates.minShipValue || current?.minShipValue || '0',
				autoApprovalEnabled: updates.autoApprovalEnabled ?? current?.autoApprovalEnabled ?? false,
				autoApprovalThreshold: updates.autoApprovalThreshold || current?.autoApprovalThreshold || null,
				eligibleCorporationIds: updates.eligibleCorporationIds || current?.eligibleCorporationIds || null,
				rejectionReasons: updates.rejectionReasons || current?.rejectionReasons || [],
				metadata: updates.metadata || current?.metadata || {},
				createdBy: userId,
				effectiveFrom: new Date(),
			})
			.returning()

		return this.getConfig() as Promise<SRPConfigResponse>
	}

	/**
	 * Get SRP statistics
	 */
	async getStats(startDate?: string, endDate?: string, corporationId?: string): Promise<SRPStatsResponse> {
		// TODO: Implement comprehensive statistics
		// This is a placeholder implementation
		return {
			totalRequests: 0,
			totalRequestsByStatus: {
				pending: 0,
				in_review: 0,
				approved: 0,
				partially_approved: 0,
				rejected: 0,
			},
			totalRequestsByPaymentStatus: {
				'n/a': 0,
				pending: 0,
				paid_in_full: 0,
				partial_payment: 0,
			},
			totalIskRequested: '0',
			totalIskApproved: '0',
			totalIskPaid: '0',
			averageApprovalTime: 0,
			topShipTypes: [],
			requestsByCorporation: [],
		}
	}

	/**
	 * Helper: Format request for response
	 */
	private formatRequest(request: any): SRPRequestResponse {
		return {
			id: request.id,
			userId: request.userId,
			characterId: request.characterId,
			characterName: request.characterName,
			corporationId: request.corporationId,
			corporationName: request.corporationName,
			killmailId: request.killmailId,
			killmailHash: request.killmailHash,
			killmailUrl: generateKillmailUrl(request.killmailId),
			lossDate: request.lossDate.toISOString(),
			shipTypeId: request.shipTypeId,
			shipTypeName: request.shipTypeName,
			shipValue: request.shipValue,
			requestedAmount: request.requestedAmount,
			requestStatus: request.requestStatus,
			approvedAmount: request.approvedAmount,
			reviewerId: request.reviewerId,
			reviewerCharacterName: request.reviewerCharacterName,
			reviewedAt: request.reviewedAt?.toISOString(),
			reviewNotes: request.reviewNotes,
			paymentStatus: request.paymentStatus,
			paymentToken: request.paymentToken,
			paymentDate: request.paymentDate?.toISOString(),
			paymentCharacterName: request.paymentCharacterName,
			createdAt: request.createdAt.toISOString(),
			updatedAt: request.updatedAt.toISOString(),
			comments: request.comments?.map((c: any) => ({
				id: c.id,
				requestId: c.requestId,
				authorUserId: c.authorUserId,
				authorCharacterName: c.authorCharacterName,
				content: c.content,
				visibility: c.visibility,
				isEdited: c.isEdited,
				editedAt: c.editedAt?.toISOString(),
				createdAt: c.createdAt.toISOString(),
			})),
			history: request.history?.map((h: any) => ({
				id: h.id,
				requestId: h.requestId,
				actorUserId: h.actorUserId,
				actorCharacterName: h.actorCharacterName,
				action: h.action,
				previousRequestStatus: h.previousRequestStatus,
				newRequestStatus: h.newRequestStatus,
				previousPaymentStatus: h.previousPaymentStatus,
				newPaymentStatus: h.newPaymentStatus,
				previousApprovedAmount: h.previousApprovedAmount,
				newApprovedAmount: h.newApprovedAmount,
				metadata: h.metadata as Record<string, unknown>,
				timestamp: h.timestamp.toISOString(),
			})),
		}
	}

	/**
	 * Helper: Log history entry
	 */
	private async logHistory(
		requestId: string,
		actorUserId: string,
		actorCharacterName: string,
		action: string,
		details: {
			previousRequestStatus?: any
			newRequestStatus?: any
			previousPaymentStatus?: any
			newPaymentStatus?: any
			previousApprovedAmount?: string
			newApprovedAmount?: string
			metadata?: Record<string, unknown>
		}
	): Promise<void> {
		await this.db.insert(srpRequestHistory).values({
			requestId,
			actorUserId,
			actorCharacterName,
			action,
			previousRequestStatus: details.previousRequestStatus || null,
			newRequestStatus: details.newRequestStatus || null,
			previousPaymentStatus: details.previousPaymentStatus || null,
			newPaymentStatus: details.newPaymentStatus || null,
			previousApprovedAmount: details.previousApprovedAmount || null,
			newApprovedAmount: details.newApprovedAmount || null,
			metadata: details.metadata || {},
		})
	}
}
