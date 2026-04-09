import { and, eq } from '@repo/db-utils'

import { applicationActivityLog, applicationRecommendations, applications } from '../db/schema'

import type { Recommendation, RecommendationSentiment } from '@repo/hr'
import type { ServiceContext } from './context'

/**
 * Recommendation Service
 *
 * Handles all business logic for application recommendations.
 */
export class RecommendationService {
	constructor(private ctx: ServiceContext) { }

	/**
	 * Add a recommendation for an application
	 */
	async addRecommendation(
		applicationId: string,
		userId: string,
		characterId: string,
		characterName: string,
		recommendationText: string,
		sentiment: RecommendationSentiment,
		isPublic: boolean
	): Promise<Recommendation> {
		// Get the application to validate
		const application = await this.ctx.db.query.applications.findFirst({
			where: eq(applications.id, applicationId),
		})

		if (!application) {
			throw new Error('Application not found')
		}

		// Check that user is not recommending their own application
		if (application.userId === userId) {
			throw new Error('You cannot recommend your own application')
		}

		// Check that application is pending or under review
		if (!['pending', 'under_review'].includes(application.status)) {
			throw new Error('Can only recommend applications that are pending or under review')
		}

		// Check for existing recommendation (unique constraint will also catch this)
		const existing = await this.ctx.db.query.applicationRecommendations.findFirst({
			where: and(
				eq(applicationRecommendations.applicationId, applicationId),
				eq(applicationRecommendations.userId, userId)
			),
		})

		if (existing) {
			throw new Error('You have already recommended this application')
		}

		// Create the recommendation
		const [recommendation] = await this.ctx.db
			.insert(applicationRecommendations)
			.values({
				applicationId,
				userId,
				characterId,
				characterName,
				recommendationText,
				sentiment,
				isPublic,
			})
			.returning()

		if (!recommendation) {
			throw new Error('Failed to create recommendation')
		}

		// Log the activity
		await this.ctx.db.insert(applicationActivityLog).values({
			applicationId,
			userId,
			characterId,
			action: 'recommendation_added',
			previousValue: null,
			newValue: sentiment,
			metadata: { recommendationId: recommendation.id },
		})

		return this.mapToRecommendation(recommendation)
	}

	/**
	 * Update a recommendation
	 */
	async updateRecommendation(
		recommendationId: string,
		userId: string,
		characterId: string,
		recommendationText: string,
		sentiment: RecommendationSentiment,
		isPublic: boolean,
		isAdmin: boolean
	): Promise<void> {
		// Get the recommendation
		const recommendation = await this.ctx.db.query.applicationRecommendations.findFirst({
			where: eq(applicationRecommendations.id, recommendationId),
		})

		if (!recommendation) {
			throw new Error('Recommendation not found')
		}

		// Check authorization (author or admin)
		if (recommendation.userId !== userId && !isAdmin) {
			throw new Error('You can only update your own recommendations')
		}

		const previousSentiment = recommendation.sentiment

		// Update the recommendation
		await this.ctx.db
			.update(applicationRecommendations)
			.set({
				recommendationText,
				sentiment,
				isPublic,
				updatedAt: new Date(),
			})
			.where(eq(applicationRecommendations.id, recommendationId))

		// Log the activity
		await this.ctx.db.insert(applicationActivityLog).values({
			applicationId: recommendation.applicationId,
			userId,
			characterId,
			action: 'recommendation_updated',
			previousValue: previousSentiment,
			newValue: sentiment,
			metadata: { recommendationId },
		})
	}

	/**
	 * Delete a recommendation
	 */
	async deleteRecommendation(
		recommendationId: string,
		userId: string,
		characterId: string,
		isAdmin: boolean
	): Promise<void> {
		// Get the recommendation
		const recommendation = await this.ctx.db.query.applicationRecommendations.findFirst({
			where: eq(applicationRecommendations.id, recommendationId),
		})

		if (!recommendation) {
			throw new Error('Recommendation not found')
		}

		// Check authorization (author or admin)
		if (recommendation.userId !== userId && !isAdmin) {
			throw new Error('You can only delete your own recommendations')
		}

		// Log the activity before deleting
		await this.ctx.db.insert(applicationActivityLog).values({
			applicationId: recommendation.applicationId,
			userId,
			characterId,
			action: 'recommendation_deleted',
			previousValue: recommendation.sentiment,
			newValue: null,
			metadata: { recommendationId },
		})

		// Delete the recommendation
		await this.ctx.db
			.delete(applicationRecommendations)
			.where(eq(applicationRecommendations.id, recommendationId))
	}

	/**
	 * Map database record to Recommendation DTO
	 */
	private mapToRecommendation(rec: typeof applicationRecommendations.$inferSelect): Recommendation {
		return {
			id: rec.id,
			applicationId: rec.applicationId,
			userId: rec.userId,
			characterId: rec.characterId,
			characterName: rec.characterName,
			recommendationText: rec.recommendationText,
			sentiment: rec.sentiment as RecommendationSentiment,
			isPublic: rec.isPublic,
			createdAt: rec.createdAt,
			updatedAt: rec.updatedAt,
		}
	}
}
