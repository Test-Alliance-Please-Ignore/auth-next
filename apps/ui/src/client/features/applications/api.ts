/**
 * Applications Feature API Client
 *
 * Provides typed API methods and interfaces for the HR job application system
 * including applications, recommendations, and activity logging.
 */

import { apiClient } from '../../lib/api'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Application status types
 */
export type ApplicationStatus = 'pending' | 'under_review' | 'accepted' | 'rejected' | 'withdrawn'

/**
 * Recommendation sentiment types
 */
export type RecommendationSentiment = 'positive' | 'neutral' | 'negative'

/**
 * Represents a job application to a corporation
 */
export interface Application {
	id: string
	corporationId: string
	corporationName?: string
	userId: string
	characterId: string
	characterName: string
	applicationText: string
	status: ApplicationStatus
	reviewedBy?: string
	reviewedByCharacterName?: string
	reviewedAt?: string
	reviewNotes?: string
	createdAt: string
	updatedAt: string
	recommendationCount?: number
}

/**
 * Represents a recommendation for an application
 */
export interface Recommendation {
	id: string
	applicationId: string
	userId: string
	characterId: string
	characterName: string
	recommendationText: string
	sentiment: RecommendationSentiment
	isPublic: boolean
	createdAt: string
	updatedAt: string
}

/**
 * Represents an activity log entry for an application
 */
export interface ApplicationActivityLogEntry {
	id: string
	applicationId: string
	userId?: string
	characterId?: string
	characterName?: string
	action: string
	previousValue?: string
	newValue?: string
	metadata?: Record<string, unknown>
	timestamp: string
}

/**
 * HR Note types for categorization
 */
export type HRNoteType = 'general' | 'warning' | 'positive' | 'incident' | 'background_check'

/**
 * HR Note priority levels
 */
export type HRNotePriority = 'low' | 'normal' | 'high' | 'critical'

/**
 * Represents an HR note about a user (ADMIN ONLY)
 */
export interface HRNote {
	id: string
	subjectUserId: string
	subjectCharacterId?: string
	subjectCharacterName?: string
	authorId: string
	authorCharacterId: string
	authorCharacterName: string
	noteText: string
	noteType: HRNoteType
	priority: HRNotePriority
	metadata?: Record<string, unknown>
	createdAt: string
	updatedAt: string
}

/**
 * Query parameters for listing applications
 */
export interface ApplicationsParams {
	corporationId?: string
	userId?: string
	status?: ApplicationStatus
	limit?: number
	offset?: number
}

/**
 * Request body for submitting an application
 */
export interface SubmitApplicationRequest {
	corporationId: string
	characterId: string
	applicationText: string
}

/**
 * Request body for updating application status
 */
export interface UpdateApplicationStatusRequest {
	status: ApplicationStatus
	reviewNotes?: string
}

/**
 * Request body for adding a recommendation
 */
export interface AddRecommendationRequest {
	characterId: string
	recommendationText: string
	sentiment: RecommendationSentiment
	isPublic?: boolean
}

/**
 * Request body for updating a recommendation
 */
export interface UpdateRecommendationRequest {
	characterId?: string
	recommendationText?: string
	sentiment?: RecommendationSentiment
	isPublic?: boolean
}

/**
 * Query parameters for listing HR notes
 */
export interface HRNotesParams {
	subjectUserId?: string
	noteType?: HRNoteType
	priority?: HRNotePriority
	limit?: number
	offset?: number
}

/**
 * Request body for adding an HR note
 */
export interface AddHRNoteRequest {
	subjectUserId: string
	subjectCharacterId?: string
	noteText: string
	noteType: HRNoteType
	priority?: HRNotePriority
	metadata?: Record<string, unknown>
}

/**
 * Request body for updating an HR note
 */
export interface UpdateHRNoteRequest {
	noteText?: string
	noteType?: HRNoteType
	priority?: HRNotePriority
	metadata?: Record<string, unknown>
}

// ============================================================================
// API Client Methods
// ============================================================================

/**
 * Applications API methods
 */
export const applicationsApi = {
	// ==================== Applications ====================

	/**
	 * Get list of applications with optional filters
	 */
	async getApplications(params?: ApplicationsParams): Promise<Application[]> {
		const searchParams = new URLSearchParams()
		if (params?.corporationId) searchParams.set('corporationId', params.corporationId)
		if (params?.userId) searchParams.set('userId', params.userId)
		if (params?.status) searchParams.set('status', params.status)
		if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString())
		if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString())

		const query = searchParams.toString()
		return apiClient.get(`/hr/applications${query ? `?${query}` : ''}`)
	},

	/**
	 * Get a single application by ID
	 */
	async getApplication(applicationId: string): Promise<Application> {
		return apiClient.get(`/hr/applications/${applicationId}`)
	},

	/**
	 * Submit a new application to a corporation
	 */
	async submitApplication(data: SubmitApplicationRequest): Promise<Application> {
		return apiClient.post('/hr/applications', data)
	},

	/**
	 * Update application status (for reviewers)
	 */
	async updateApplicationStatus(
		applicationId: string,
		data: UpdateApplicationStatusRequest
	): Promise<{ success: boolean }> {
		return apiClient.patch(`/hr/applications/${applicationId}`, data)
	},

	/**
	 * Withdraw an application (for applicants)
	 */
	async withdrawApplication(applicationId: string): Promise<{ success: boolean }> {
		return apiClient.post(`/hr/applications/${applicationId}/withdraw`)
	},

	/**
	 * Delete an application (admin only)
	 */
	async deleteApplication(applicationId: string): Promise<{ success: boolean }> {
		return apiClient.delete(`/hr/applications/${applicationId}`)
	},

	// ==================== Recommendations ====================

	/**
	 * Get recommendations for an application
	 * Note: This is embedded in the application detail response
	 */
	async getRecommendations(applicationId: string): Promise<Recommendation[]> {
		// The backend embeds recommendations in the application detail
		// This is a convenience method that extracts them
		const application = await this.getApplication(applicationId)
		return (application as any).recommendations || []
	},

	/**
	 * Add a recommendation to an application
	 */
	async addRecommendation(
		applicationId: string,
		data: AddRecommendationRequest
	): Promise<Recommendation> {
		return apiClient.post(`/hr/applications/${applicationId}/recommendations`, data)
	},

	/**
	 * Update a recommendation
	 */
	async updateRecommendation(
		applicationId: string,
		recommendationId: string,
		data: UpdateRecommendationRequest
	): Promise<{ success: boolean }> {
		return apiClient.patch(
			`/hr/applications/${applicationId}/recommendations/${recommendationId}`,
			data
		)
	},

	/**
	 * Delete a recommendation
	 */
	async deleteRecommendation(
		applicationId: string,
		recommendationId: string
	): Promise<{ success: boolean }> {
		return apiClient.delete(`/hr/applications/${applicationId}/recommendations/${recommendationId}`)
	},

	// ==================== Activity Log ====================

	/**
	 * Get activity log for an application
	 * Note: This is embedded in the application detail response
	 */
	async getApplicationActivity(applicationId: string): Promise<ApplicationActivityLogEntry[]> {
		// The backend embeds activity in the application detail
		// This is a convenience method that extracts it
		const application = await this.getApplication(applicationId)
		return (application as any).activity || []
	},

	// ==================== HR Notes (ADMIN ONLY) ====================

	/**
	 * Get HR notes with optional filters (ADMIN ONLY)
	 */
	async getHRNotes(params?: HRNotesParams): Promise<HRNote[]> {
		const searchParams = new URLSearchParams()
		if (params?.subjectUserId) searchParams.set('subjectUserId', params.subjectUserId)
		if (params?.noteType) searchParams.set('noteType', params.noteType)
		if (params?.priority) searchParams.set('priority', params.priority)
		if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString())
		if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString())

		const query = searchParams.toString()
		return apiClient.get(`/hr/notes${query ? `?${query}` : ''}`)
	},

	/**
	 * Get a single HR note by ID (ADMIN ONLY)
	 */
	async getHRNote(noteId: string): Promise<HRNote> {
		return apiClient.get(`/hr/notes/${noteId}`)
	},

	/**
	 * Add a new HR note (ADMIN ONLY)
	 */
	async addHRNote(data: AddHRNoteRequest): Promise<HRNote> {
		return apiClient.post('/hr/notes', data)
	},

	/**
	 * Update an HR note (ADMIN ONLY)
	 */
	async updateHRNote(noteId: string, data: UpdateHRNoteRequest): Promise<HRNote> {
		return apiClient.patch(`/hr/notes/${noteId}`, data)
	},

	/**
	 * Delete an HR note (ADMIN ONLY)
	 */
	async deleteHRNote(noteId: string): Promise<{ success: boolean }> {
		return apiClient.delete(`/hr/notes/${noteId}`)
	},
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get display name for application status
 */
export function getStatusDisplayName(status: ApplicationStatus): string {
	const names: Record<ApplicationStatus, string> = {
		pending: 'Pending',
		under_review: 'Under Review',
		accepted: 'Accepted',
		rejected: 'Rejected',
		withdrawn: 'Withdrawn',
	}
	return names[status]
}

/**
 * Get display name for recommendation sentiment
 */
export function getSentimentDisplayName(sentiment: RecommendationSentiment): string {
	const names: Record<RecommendationSentiment, string> = {
		positive: 'Positive',
		neutral: 'Neutral',
		negative: 'Negative',
	}
	return names[sentiment]
}

/**
 * Check if an application can be withdrawn by the applicant
 */
export function canWithdrawApplication(application: Application): boolean {
	return ['pending', 'under_review'].includes(application.status)
}

/**
 * Check if an application can be reviewed
 */
export function canReviewApplication(application: Application): boolean {
	return ['pending', 'under_review'].includes(application.status)
}
