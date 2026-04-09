import { and, desc, eq, inArray, or, sql } from '@repo/db-utils'
import { isApplicationStatus } from '@repo/hr'

import { applicationActivityLog, applicationRecommendations, applications } from '../db/schema'

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
		applicationText: string
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

		// Log the submission
		await this.logActivity(application.id, userId, characterId, 'submitted', null, 'pending')

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
		userHrCorporations: string[] = [],
		userHrAdminCorporations: string[] = []
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

			if (userHrCorporations.length > 0) {
				// Non-admin HR corps (viewer/reviewer) can only see pending/under_review
				const nonAdminHrCorps = userHrCorporations.filter(
					(corpId) => !userHrAdminCorporations.includes(corpId)
				)

				const corpConditions = []

				// HR admin corps: see all statuses
				if (userHrAdminCorporations.length > 0) {
					corpConditions.push(
						inArray(applications.corporationId, userHrAdminCorporations)
					)
				}

				// Non-admin HR corps: only pending/under_review
				if (nonAdminHrCorps.length > 0) {
					const nonAdminCondition = and(
						inArray(applications.corporationId, nonAdminHrCorps),
						inArray(applications.status, ['pending', 'under_review'])
					)
					if (nonAdminCondition) {
						corpConditions.push(nonAdminCondition)
					}
				}

				if (corpConditions.length > 0) {
					authConditions.push(...corpConditions)
				}
			}

			conditions.push(or(...authConditions))
		}

		// Build query
		const query = this.ctx.db.query.applications.findMany({
			where: conditions.length > 0 ? and(...conditions) : undefined,
			orderBy: [desc(applications.createdAt)],
			limit: filters.limit || 50,
			offset: filters.offset || 0,
		})

		const results = await query

		return results.map((app) => this.mapToApplication(app))
	}

	/**
	 * Get a single application with recommendations
	 */
	async getApplication(
		applicationId: string,
		userId: string,
		isAdmin: boolean,
		userHrCorporations: string[] = [],
		includeActivityLog = false,
		userHrAdminCorporations: string[] = []
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
		const hasHrAccess = userHrCorporations.includes(application.corporationId)
		const isHrAdmin = userHrAdminCorporations.includes(application.corporationId)

		if (!isOwner && !hasHrAccess && !isAdmin) {
			throw new Error('You do not have permission to view this application')
		}

		// Non-admin HR (viewer/reviewer) can only see pending/under_review applications
		const activeStatuses = ['pending', 'under_review']
		if (hasHrAccess && !isHrAdmin && !isAdmin && !isOwner) {
			if (!activeStatuses.includes(application.status)) {
				throw new Error('You do not have permission to view this application')
			}
		}

		// Get recommendations
		const recommendations = await this.ctx.db.query.applicationRecommendations.findMany({
			where: eq(applicationRecommendations.applicationId, applicationId),
			orderBy: [desc(applicationRecommendations.createdAt)],
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

		// Only set reviewer info on final decisions
		const isFinalDecision = status === 'accepted' || status === 'rejected'

		// Update the application
		await this.ctx.db
			.update(applications)
			.set({
				status: status as ApplicationStatus,
				...(isFinalDecision
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
		characterId: string
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
			'withdrawn',
			previousStatus,
			'withdrawn'
		)
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
		action: string,
		previousValue: string | null,
		newValue: string | null,
		metadata?: Record<string, unknown>
	): Promise<void> {
		await this.ctx.db.insert(applicationActivityLog).values({
			applicationId,
			userId,
			characterId,
			action,
			previousValue,
			newValue,
			metadata,
		})
	}

	/**
	 * Map database record to Application DTO
	 */
	private mapToApplication(app: typeof applications.$inferSelect): Application {
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
		}
	}
}
