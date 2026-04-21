import { and, desc, eq, inArray, or, sql } from '@repo/db-utils'
import { isActiveApplicationStatus, isApplicationStatus } from '@repo/hr'

import { applicationActivityLog, applicationAlts, applicationRecommendations, applications } from '../db/schema'

import type {
	Application,
	ApplicationDetail,
	ApplicationFilters,
	ApplicationStatus,
	RecommendableApplication,
	RecommendationSentiment,
	RecommenderApplicationDetail,
} from '@repo/hr'
import type { ServiceContext } from './context'

/**
 * Application Service
 *
 * Handles all business logic for corporation membership applications.
 */
export class ApplicationService {
	constructor(private ctx: ServiceContext) { }

	/**
	 * Get raw application record by ID
	 */
	async getApplicationById(
		applicationId: string
	): Promise<typeof applications.$inferSelect | null> {
		const application = await this.ctx.db.query.applications.findFirst({
			where: eq(applications.id, applicationId),
		})

		return application ?? null
	}

	/**
	 * Submit a new application to a corporation
	 */
	async submitApplication(
		userId: string,
		characterId: string,
		characterName: string,
		corporationId: string,
		applicationText: string,
		altCharacterIds: string[] = []
	): Promise<Application> {
		// Create the application
		const [application] = await this.ctx.db
			.insert(applications)
			.values({
				userId,
				characterId,
				characterName,
				corporationId,
				applicationText,
				status: 'pending',
			})
			.returning()

		if (!application) {
			throw new Error('Failed to create application')
		}

		// Insert alt characters if provided
		if (altCharacterIds.length > 0) {
			await this.ctx.db.insert(applicationAlts).values(
				altCharacterIds.map((altCharId) => ({
					applicationId: application.id,
					characterId: altCharId,
				}))
			)
		}

		// Log the submission
		await this.logActivity(application.id, userId, characterId, characterName, 'submitted', null, 'pending')

		console.log('[HR] application submitted', {
			applicationId: application.id,
			userId,
			characterId,
			corporationId,
		})

		return this.mapToApplication(application)
	}

	/**
	 * List applications with optional filters and authorization
	 */
	async listApplications(
		filters: ApplicationFilters,
		userId: string,
		isAdmin: boolean,
		isAuditor: boolean,
		userHrCorporations: string[] = [],
		userHrReviewerCorporations: string[] = []
	): Promise<Application[]> {
		const conditions: ReturnType<typeof and>[] = []

		// Apply filters
		if (filters.corporationId) {
			conditions.push(eq(applications.corporationId, filters.corporationId))
		}

		if (filters.userId) {
			conditions.push(eq(applications.userId, filters.userId))
		}

		if (filters.characterId) {
			conditions.push(eq(applications.characterId, filters.characterId))
		}

		if (filters.status) {
			conditions.push(eq(applications.status, filters.status))
		}

		// Authorization filter (if not admin)
		if (!isAdmin) {
			// User can see: their own applications OR applications for corps they have HR access to
			const authConditions = [eq(applications.userId, userId)]

			if (isAuditor) {
				// Auditors are global viewer-equivalent: read-only active queue visibility
				const auditorCondition = inArray(applications.status, ['pending', 'under_review'])
				authConditions.push(auditorCondition)
			} else if (userHrCorporations.length > 0) {
				// Viewer-only corps can only see pending/under_review
				const viewerOnlyCorps = userHrCorporations.filter(
					(corpId) => !userHrReviewerCorporations.includes(corpId)
				)

				const corpConditions = []

				// HR reviewer+ corps: see all statuses
				if (userHrReviewerCorporations.length > 0) {
					corpConditions.push(
						inArray(applications.corporationId, userHrReviewerCorporations)
					)
				}

				// Viewer-only corps: only pending/under_review
				if (viewerOnlyCorps.length > 0) {
					const viewerCondition = and(
						inArray(applications.corporationId, viewerOnlyCorps),
						inArray(applications.status, ['pending', 'under_review'])
					)
					if (viewerCondition) {
						corpConditions.push(viewerCondition)
					}
				}

				if (corpConditions.length > 0) {
					authConditions.push(...corpConditions)
				}
			}

			conditions.push(or(...authConditions))
		}

		// Build query
		const results = await this.ctx.db.query.applications.findMany({
			where: conditions.length > 0 ? and(...conditions) : undefined,
			orderBy: [desc(applications.createdAt)],
			limit: filters.limit || 50,
			offset: filters.offset || 0,
			with: { alts: true },
		})

		return results.map((app) => this.mapToApplication(app, app.alts.map((a) => a.characterId)))
	}

	/**
	 * Get a single application with recommendations
	 */
	async getApplication(
		applicationId: string,
		userId: string,
		isAdmin: boolean,
		isAuditor: boolean,
		userHrCorporations: string[] = [],
		includeActivityLog = false,
		userHrReviewerCorporations: string[] = []
	): Promise<ApplicationDetail> {
		// Get the application
		const application = await this.ctx.db.query.applications.findFirst({
			where: eq(applications.id, applicationId),
		})

		if (!application) {
			throw new Error('Application not found')
		}

		// Check authorization
		const isOwner = application.userId === userId
		const hasHrAccess = isAuditor || userHrCorporations.includes(application.corporationId)
		const isReviewerOrAbove = userHrReviewerCorporations.includes(application.corporationId)

		if (!isOwner && !hasHrAccess && !isAdmin) {
			throw new Error('You do not have permission to view this application')
		}

		// Viewer-only HR can only see pending/under_review applications
		const activeStatuses = ['pending', 'under_review']
		if (hasHrAccess && !isReviewerOrAbove && !isAdmin && !isOwner) {
			if (!activeStatuses.includes(application.status)) {
				throw new Error('You do not have permission to view this application')
			}
		}

		// Get recommendations
		const recommendations = await this.ctx.db.query.applicationRecommendations.findMany({
			where: eq(applicationRecommendations.applicationId, applicationId),
			orderBy: [desc(applicationRecommendations.createdAt)],
		})

		// Get alt characters
		const alts = await this.ctx.db.query.applicationAlts.findMany({
			where: eq(applicationAlts.applicationId, applicationId),
		})

		// Get activity log if requested (HR, admin, or application owner)
		let activityLog: (typeof applicationActivityLog.$inferSelect)[] | undefined

		if (includeActivityLog && (hasHrAccess || isAdmin || isOwner)) {
			activityLog = await this.ctx.db.query.applicationActivityLog.findMany({
				where: eq(applicationActivityLog.applicationId, applicationId),
				orderBy: [desc(applicationActivityLog.timestamp)],
			})
		}

		return {
			...this.mapToApplication(application),
			altCharacterIds: alts.map((alt) => alt.characterId),
			recommendations: recommendations.map((rec) => ({
				id: rec.id,
				applicationId: rec.applicationId,
				userId: rec.userId,
				characterId: rec.characterId,
				characterName: rec.characterName,
				recommendationText: rec.recommendationText,
				sentiment: rec.sentiment as 'positive' | 'neutral' | 'negative',
				isPublic: rec.isPublic,
				createdAt: rec.createdAt,
				updatedAt: rec.updatedAt,
			})),
			recommendationCount: recommendations.length,
			activityLog: activityLog?.map((log) => ({
				id: log.id,
				applicationId: log.applicationId,
				userId: log.userId,
				characterId: log.characterId,
				characterName: log.characterName ?? undefined,
				action: log.action,
				previousValue: log.previousValue,
				newValue: log.newValue,
				metadata: log.metadata,
				timestamp: log.timestamp,
			})),
		}
	}

	/**
	 * Update application status (flexible - any status -> any status)
	 */
	async updateApplicationStatus(
		applicationId: string,
		status: ApplicationStatus,
		userId: string,
		characterId: string,
		characterName: string,
		reviewNotes?: string
	): Promise<void> {
		if (!isApplicationStatus(status)) {
			throw new Error(`Invalid application status: ${status}`)
		}

		// Get current application
		const application = await this.getApplicationById(applicationId)

		if (!application) {
			throw new Error('Application not found')
		}

		const previousStatus = application.status

		// Set reviewer info for any status change that involves review
		const isReviewAction = status === 'accepted' || status === 'rejected' || status === 'under_review'

		// Update the application
		await this.ctx.db
			.update(applications)
			.set({
				status: status as ApplicationStatus,
				lastStaffInteractionAt: new Date(),
				...(isReviewAction
					? {
						reviewedBy: userId,
						reviewedAt: new Date(),
						reviewNotes,
					}
					: {}),
				updatedAt: new Date(),
			})
			.where(eq(applications.id, applicationId))

		// Log the status change
		await this.logActivity(
			applicationId,
			userId,
			characterId,
			characterName,
			'status_changed',
			previousStatus,
			status,
			{ reviewNotes }
		)

		console.log('[HR] application status updated', {
			applicationId,
			from: previousStatus,
			to: status,
			updatedBy: userId,
		})
	}

	/**
	 * Withdraw an application (applicant only)
	 */
	async withdrawApplication(
		applicationId: string,
		userId: string,
		characterId: string,
		characterName: string
	): Promise<void> {
		// Get current application
		const application = await this.ctx.db.query.applications.findFirst({
			where: eq(applications.id, applicationId),
		})

		if (!application) {
			throw new Error('Application not found')
		}

		// Check ownership
		if (application.userId !== userId) {
			throw new Error('You can only withdraw your own applications')
		}

		const previousStatus = application.status

		// Update to withdrawn
		await this.ctx.db
			.update(applications)
			.set({
				status: 'withdrawn',
				updatedAt: new Date(),
			})
			.where(eq(applications.id, applicationId))

		// Log the withdrawal
		await this.logActivity(
			applicationId,
			userId,
			characterId,
			characterName,
			'withdrawn',
			previousStatus,
			'withdrawn'
		)
	}

	/**
	 * Add one or more alt characters to a pending application
	 */
	async addApplicationAlts(
		applicationId: string,
		userId: string,
		characterId: string,
		characterName: string,
		alts: Array<{ characterId: string; characterName?: string }>
	): Promise<void> {
		if (alts.length === 0) return

		const application = await this.getApplicationById(applicationId)
		if (!application) throw new Error('Application not found')
		if (application.userId !== userId) throw new Error('You can only modify your own applications')
		if (!isActiveApplicationStatus(application.status)) throw new Error('You can only modify alts on active applications')

		// Filter out already-existing alts
		const altIds = alts.map((a) => a.characterId)
		const existing = await this.ctx.db.query.applicationAlts.findMany({
			where: and(
				eq(applicationAlts.applicationId, applicationId),
				inArray(applicationAlts.characterId, altIds)
			),
		})
		const existingIds = new Set(existing.map((e) => e.characterId))
		const newAlts = alts.filter((a) => !existingIds.has(a.characterId))
		if (newAlts.length === 0) return

		await this.ctx.db.insert(applicationAlts).values(
			newAlts.map((a) => ({ applicationId, characterId: a.characterId }))
		)

		for (const alt of newAlts) {
			await this.logActivity(applicationId, userId, characterId, characterName, 'alt_added', null, alt.characterId, { altCharacterName: alt.characterName })
		}
	}

	/**
	 * Remove an alt character from a pending application
	 */
	async removeApplicationAlt(
		applicationId: string,
		userId: string,
		characterId: string,
		characterName: string,
		altCharacterId: string,
		altCharacterName?: string
	): Promise<void> {
		const application = await this.getApplicationById(applicationId)
		if (!application) throw new Error('Application not found')
		if (application.userId !== userId) throw new Error('You can only modify your own applications')
		if (!isActiveApplicationStatus(application.status)) throw new Error('You can only modify alts on active applications')

		await this.ctx.db
			.delete(applicationAlts)
			.where(
				and(
					eq(applicationAlts.applicationId, applicationId),
					eq(applicationAlts.characterId, altCharacterId)
				)
			)

		await this.logActivity(applicationId, userId, characterId, characterName, 'alt_removed', altCharacterId, null, { altCharacterName })
	}

	/**
	 * Delete an application permanently (admin only)
	 */
	async deleteApplication(applicationId: string): Promise<void> {
		// Recommendations and activity log will cascade delete via foreign keys
		await this.ctx.db.delete(applications).where(eq(applications.id, applicationId))
	}

	/**
	 * Check if user has a pending application for a corporation
	 */
	async hasPendingApplication(userId: string, corporationId: string): Promise<boolean> {
		const existing = await this.ctx.db.query.applications.findFirst({
			where: and(
				eq(applications.userId, userId),
				eq(applications.corporationId, corporationId),
				inArray(applications.status, ['pending', 'under_review'])
			),
		})

		return !!existing
	}

	/**
	 * Count open applications for a user across all corporations
	 */
	async countOpenApplications(userId: string): Promise<number> {
		const result = await this.ctx.db
			.select({ count: sql<number>`cast(count(*) as integer)` })
			.from(applications)
			.where(
				and(
					eq(applications.userId, userId),
					inArray(applications.status, ['pending', 'under_review'])
				)
			)

		return result[0]?.count ?? 0
	}

	/**
	 * List pending/under_review applications for given corporations.
	 * Returns lightweight info for the recommendations discovery page.
	 */
	async listCorpApplicationsForRecommendation(
		corporationIds: string[],
		userId: string
	): Promise<RecommendableApplication[]> {
		if (corporationIds.length === 0) return []

		// Get applications that are pending or under_review for the user's corporations
		const results = await this.ctx.db.query.applications.findMany({
			where: and(
				inArray(applications.corporationId, corporationIds),
				inArray(applications.status, ['pending', 'under_review']),
				// Exclude user's own applications
				sql`${applications.userId} != ${userId}`
			),
			orderBy: [desc(applications.createdAt)],
		})

		// Get recommendation counts and user's own recommendations in one query
		const appIds = results.map((a) => a.id)
		if (appIds.length === 0) return []

		const recCounts = await this.ctx.db
			.select({
				applicationId: applicationRecommendations.applicationId,
				count: sql<number>`cast(count(*) as integer)`,
				userRecommended: sql<number>`cast(sum(case when ${applicationRecommendations.userId} = ${userId} then 1 else 0 end) as integer)`,
			})
			.from(applicationRecommendations)
			.where(inArray(applicationRecommendations.applicationId, appIds))
			.groupBy(applicationRecommendations.applicationId)

		const recMap = new Map(recCounts.map((r) => [r.applicationId, r]))

		// Fetch the user's own recommendations for these applications
		const userRecs = await this.ctx.db.query.applicationRecommendations.findMany({
			where: and(
				inArray(applicationRecommendations.applicationId, appIds),
				eq(applicationRecommendations.userId, userId)
			),
		})
		const userRecMap = new Map(userRecs.map((r) => [r.applicationId, r]))

		return results.map((app) => {
			const rec = recMap.get(app.id)
			const userRec = userRecMap.get(app.id)
			return {
				id: app.id,
				corporationId: app.corporationId,
				characterId: app.characterId,
				characterName: app.characterName,
				status: app.status as ApplicationStatus,
				createdAt: app.createdAt,
				recommendationCount: rec?.count ?? 0,
				userHasRecommended: (rec?.userRecommended ?? 0) > 0,
				userRecommendation: userRec
					? {
						id: userRec.id,
						characterId: userRec.characterId,
						sentiment: userRec.sentiment as RecommendationSentiment,
						recommendationText: userRec.recommendationText,
						isPublic: userRec.isPublic,
					}
					: null,
			}
		})
	}

	/**
	 * Get an application for a corp member to view and recommend.
	 * Returns limited info (no HR-internal data).
	 */
	async getApplicationForRecommender(
		applicationId: string,
		userId: string,
		userCorporationIds: string[]
	): Promise<RecommenderApplicationDetail> {
		const application = await this.ctx.db.query.applications.findFirst({
			where: eq(applications.id, applicationId),
		})

		if (!application) {
			throw new Error('Application not found')
		}

		// Verify the user is in the same corporation
		if (!userCorporationIds.includes(application.corporationId)) {
			throw new Error('You do not have permission to view this application')
		}

		// Cannot recommend own application
		if (application.userId === userId) {
			throw new Error('You cannot view your own application for recommendation')
		}

		// Must be pending or under_review
		if (!['pending', 'under_review'].includes(application.status)) {
			throw new Error('This application is no longer accepting recommendations')
		}

		// Get recommendations
		const recommendations = await this.ctx.db.query.applicationRecommendations.findMany({
			where: eq(applicationRecommendations.applicationId, applicationId),
			orderBy: [desc(applicationRecommendations.createdAt)],
		})

		const mappedRecs = recommendations.map((rec) => ({
			id: rec.id,
			applicationId: rec.applicationId,
			userId: rec.userId,
			characterId: rec.characterId,
			characterName: rec.characterName,
			recommendationText: rec.recommendationText,
			sentiment: rec.sentiment as 'positive' | 'neutral' | 'negative',
			isPublic: rec.isPublic,
			createdAt: rec.createdAt,
			updatedAt: rec.updatedAt,
		}))

		// Corp members only see their own recommendation
		const userRecommendation = mappedRecs.find((r) => r.userId === userId) ?? null

		return {
			id: application.id,
			corporationId: application.corporationId,
			characterId: application.characterId,
			characterName: application.characterName,
			applicationText: application.applicationText,
			status: application.status as ApplicationStatus,
			createdAt: application.createdAt,
			recommendations: [userRecommendation].filter(Boolean) as typeof mappedRecs,
			recommendationCount: mappedRecs.length,
			userRecommendation,
		}
	}

	/**
	 * Log activity for an application
	 */
	private async logActivity(
		applicationId: string,
		userId: string,
		characterId: string,
		characterName: string,
		action: string,
		previousValue: string | null,
		newValue: string | null,
		metadata?: Record<string, unknown>
	): Promise<void> {
		await this.ctx.db.insert(applicationActivityLog).values({
			applicationId,
			userId,
			characterId,
			characterName,
			action,
			previousValue,
			newValue,
			metadata,
		})
	}

	/**
	 * Map database record to Application DTO
	 */
	private mapToApplication(app: typeof applications.$inferSelect, altCharacterIds?: string[]): Application {
		return {
			id: app.id,
			corporationId: app.corporationId,
			userId: app.userId,
			characterId: app.characterId,
			characterName: app.characterName,
			applicationText: app.applicationText,
			status: app.status as Application['status'],
			reviewedBy: app.reviewedBy,
			reviewedByCharacterName: null,
			reviewedAt: app.reviewedAt,
			reviewNotes: app.reviewNotes,
			createdAt: app.createdAt,
			updatedAt: app.updatedAt,
			lastStaffInteractionAt: app.lastStaffInteractionAt,
			altCharacterIds,
		}
	}
}
