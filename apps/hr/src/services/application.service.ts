import { and, desc, eq, inArray, or, sql } from '@repo/db-utils'

import {
	applications,
	applicationActivityLog,
	applicationRecommendations,
} from '../db/schema'

import type { Application, ApplicationDetail, ApplicationFilters } from '@repo/hr'
import type { DbClient } from '@repo/db-utils'
import type * as schema from '../db/schema'

/**
 * Application Service
 *
 * Handles all business logic for corporation membership applications.
 */
export class ApplicationService {
	constructor(private db: DbClient<typeof schema>) {}

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
		const [application] = await this.db
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
		await this.logActivity(
			application.id,
			userId,
			characterId,
			'submitted',
			null,
			'pending'
		)

		return this.mapToApplication(application)
	}

	/**
	 * List applications with optional filters and authorization
	 */
	async listApplications(
		filters: ApplicationFilters,
		userId: string,
		isAdmin: boolean,
		userHrCorporations: string[] = []
	): Promise<Application[]> {
		const conditions: ReturnType<typeof and>[] = []

		// Apply filters
		if (filters.corporationId) {
			conditions.push(eq(applications.corporationId, filters.corporationId))
		}

		if (filters.userId) {
			conditions.push(eq(applications.userId, filters.userId))
		}

		if (filters.status) {
			conditions.push(eq(applications.status, filters.status))
		}

		// Authorization filter (if not admin)
		if (!isAdmin) {
			// User can see: their own applications OR applications for corps they have HR access to
			const authConditions = [eq(applications.userId, userId)]

			if (userHrCorporations.length > 0) {
				authConditions.push(inArray(applications.corporationId, userHrCorporations))
			}

			conditions.push(or(...authConditions))
		}

		// Build query
		const query = this.db.query.applications.findMany({
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
		includeActivityLog = false
	): Promise<ApplicationDetail> {
		// Get the application
		const application = await this.db.query.applications.findFirst({
			where: eq(applications.id, applicationId),
		})

		if (!application) {
			throw new Error('Application not found')
		}

		// Check authorization
		const isOwner = application.userId === userId
		const hasHrAccess = userHrCorporations.includes(application.corporationId)

		if (!isOwner && !hasHrAccess && !isAdmin) {
			throw new Error('You do not have permission to view this application')
		}

		// Get recommendations
		const recommendations = await this.db.query.applicationRecommendations.findMany({
			where: eq(applicationRecommendations.applicationId, applicationId),
			orderBy: [desc(applicationRecommendations.createdAt)],
		})

		// Get activity log if requested (HR only)
		let activityLog: typeof applicationActivityLog.$inferSelect[] | undefined

		if (includeActivityLog && (hasHrAccess || isAdmin)) {
			activityLog = await this.db.query.applicationActivityLog.findMany({
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
		status: string,
		userId: string,
		characterId: string,
		reviewNotes?: string
	): Promise<void> {
		// Get current application
		const application = await this.db.query.applications.findFirst({
			where: eq(applications.id, applicationId),
		})

		if (!application) {
			throw new Error('Application not found')
		}

		const previousStatus = application.status

		// Update the application
		await this.db
			.update(applications)
			.set({
				status,
				reviewedBy: userId,
				reviewedAt: new Date(),
				reviewNotes,
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
		const application = await this.db.query.applications.findFirst({
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
		await this.db
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
		await this.db.delete(applications).where(eq(applications.id, applicationId))
	}

	/**
	 * Check if user has a pending application for a corporation
	 */
	async hasPendingApplication(userId: string, corporationId: string): Promise<boolean> {
		const existing = await this.db.query.applications.findFirst({
			where: and(
				eq(applications.userId, userId),
				eq(applications.corporationId, corporationId),
				inArray(applications.status, ['pending', 'under_review'])
			),
		})

		return !!existing
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
		await this.db.insert(applicationActivityLog).values({
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
	private mapToApplication(
		app: typeof applications.$inferSelect
	): Application {
		return {
			id: app.id,
			corporationId: app.corporationId,
			userId: app.userId,
			characterId: app.characterId,
			characterName: app.characterName,
			applicationText: app.applicationText,
			status: app.status as Application['status'],
			reviewedBy: app.reviewedBy,
			reviewedAt: app.reviewedAt,
			reviewNotes: app.reviewNotes,
			createdAt: app.createdAt,
			updatedAt: app.updatedAt,
		}
	}
}
