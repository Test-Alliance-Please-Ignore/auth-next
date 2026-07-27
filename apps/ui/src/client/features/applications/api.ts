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
export type ApplicationStatus =
	| 'pending'
	| 'under_review'
	| 'accepted'
	| 'completed'
	| 'rejected'
	| 'withdrawn'

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
	discordUsername?: string | null
	applicationText: string
	status: ApplicationStatus
	reviewedBy?: string
	reviewedByCharacterName?: string
	reviewedAt?: string
	reviewNotes?: string
	createdAt: string
	updatedAt: string
	lastStaffInteractionAt?: string | null
	recommendationCount?: number
	altCharacterIds?: string[]
	isFirstApplication?: boolean
}

export interface ApplicationStaffNote {
	id: string
	applicationId: string
	authorId: string
	authorCharacterId: string | null
	authorCharacterName: string | null
	noteText: string
	createdAt: string
	updatedAt: string
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
 * Represents a message between HR and applicant
 */
export interface ApplicationMessage {
	id: string
	applicationId: string
	senderId: string
	senderCharacterId: string | null
	senderCharacterName: string | null
	recipientId: string
	message: string
	createdAt: string
}

/**
 * Request body for sending a message
 */
export interface SendMessageRequest {
	recipientId?: string
	message: string
}

export interface UpsertApplicationStaffNoteRequest {
	noteText: string
}

/**
 * Message template status types
 */
export type MessageTemplateStatus = 'draft' | 'active' | 'inactive' | 'deleted'

/**
 * Represents a message template for HR communications
 */
export interface MessageTemplate {
	id: string
	status: MessageTemplateStatus
	templateName: string
	ownerCorporationId: string
	description: string | null
	messageTemplate: string
	createdAt: string
	updatedAt: string
}

/**
 * Request body for creating a message template
 */
export interface CreateTemplateRequest {
	templateName: string
	messageTemplate: string
	description?: string
	status?: 'draft' | 'active' | 'inactive'
}

/**
 * Request body for updating a message template
 */
export interface UpdateTemplateRequest {
	templateName?: string
	messageTemplate?: string
	description?: string | null
	status?: MessageTemplateStatus
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
	authorIsAdmin?: boolean
	source?: 'admin' | 'hr'
	createdAt: string
	updatedAt: string
}

/**
 * Query parameters for listing applications
 */
export interface ApplicationsParams {
	corporationId?: string
	userId?: string
	characterId?: string
	status?: ApplicationStatus
	search?: string
	limit?: number
	offset?: number
}

export interface ApplicationsListResult {
	items: Application[]
	total: number
	limit: number
	offset: number
	counts: {
		pending: number
		under_review: number
		accepted: number
		completed: number
		rejected: number
		withdrawn: number
	}
}

/**
 * Request body for submitting an application
 */
export interface SubmitApplicationRequest {
	corporationId: string
	characterId: string
	applicationText: string
	altCharacterIds?: string[]
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

/**
 * Lightweight application info for the recommendations discovery page
 */
export interface RecommendableApplication {
	id: string
	corporationId: string
	characterId: string
	characterName: string
	status: ApplicationStatus
	createdAt: string
	recommendationCount: number
	userHasRecommended: boolean
	userRecommendation: {
		id: string
		characterId: string
		sentiment: RecommendationSentiment
		recommendationText: string
		isPublic: boolean
	} | null
}

/**
 * Limited application detail for corp members writing recommendations
 */
export interface RecommenderApplicationDetail {
	id: string
	corporationId: string
	characterId: string
	characterName: string
	applicationText: string
	status: ApplicationStatus
	createdAt: string
	recommendations: Recommendation[]
	recommendationCount: number
	userRecommendation: Recommendation | null
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
		if (params?.characterId) searchParams.set('characterId', params.characterId)
		if (params?.status) searchParams.set('status', params.status)
		if (params?.search) searchParams.set('search', params.search)
		if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString())
		if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString())

		const query = searchParams.toString()
		return apiClient.get(`/hr/applications${query ? `?${query}` : ''}`)
	},

	async getApplicationsPaged(params?: ApplicationsParams): Promise<ApplicationsListResult> {
		const searchParams = new URLSearchParams()
		if (params?.corporationId) searchParams.set('corporationId', params.corporationId)
		if (params?.userId) searchParams.set('userId', params.userId)
		if (params?.characterId) searchParams.set('characterId', params.characterId)
		if (params?.status) searchParams.set('status', params.status)
		if (params?.search) searchParams.set('search', params.search)
		if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString())
		if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString())

		const query = searchParams.toString()
		return apiClient.get(`/hr/applications/paged${query ? `?${query}` : ''}`)
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

	/**
	 * Add an alt character to a pending application
	 */
	async addApplicationAlts(
		applicationId: string,
		altCharacterIds: string[]
	): Promise<{ success: boolean }> {
		return apiClient.post(`/hr/applications/${applicationId}/alts`, { altCharacterIds })
	},

	/**
	 * Remove an alt character from a pending application
	 */
	async removeApplicationAlt(
		applicationId: string,
		altCharacterId: string
	): Promise<{ success: boolean }> {
		return apiClient.delete(`/hr/applications/${applicationId}/alts/${altCharacterId}`)
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
		return (application as any).activityLog || []
	},

	// ==================== Messages ====================

	/**
	 * Get all messages for an application
	 */
	async getMessages(applicationId: string): Promise<ApplicationMessage[]> {
		return apiClient.get(`/hr/applications/${applicationId}/messages`)
	},

	/**
	 * Send a message for an application
	 */
	async sendMessage(
		applicationId: string,
		data: SendMessageRequest
	): Promise<ApplicationMessage> {
		return apiClient.post(`/hr/applications/${applicationId}/messages`, data)
	},

	/**
	 * Get message count for an application (for badge display)
	 */
	async getMessageCount(applicationId: string): Promise<number> {
		const result = await apiClient.get<{ count: number }>(
			`/hr/applications/${applicationId}/messages/count`
		)
		return result.count
	},

	// ==================== Application Staff Notes ====================

	async getApplicationStaffNotes(applicationId: string): Promise<ApplicationStaffNote[]> {
		return apiClient.get(`/hr/applications/${applicationId}/staff-notes`)
	},

	async addApplicationStaffNote(
		applicationId: string,
		data: UpsertApplicationStaffNoteRequest
	): Promise<ApplicationStaffNote> {
		return apiClient.post(`/hr/applications/${applicationId}/staff-notes`, data)
	},

	async updateApplicationStaffNote(
		applicationId: string,
		noteId: string,
		data: UpsertApplicationStaffNoteRequest
	): Promise<ApplicationStaffNote> {
		return apiClient.patch(`/hr/applications/${applicationId}/staff-notes/${noteId}`, data)
	},

	async deleteApplicationStaffNote(
		applicationId: string,
		noteId: string
	): Promise<{ success: boolean }> {
		return apiClient.delete(`/hr/applications/${applicationId}/staff-notes/${noteId}`)
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

	// ==================== Message Templates ====================

	/**
	 * Get templates for a corporation
	 */
	async getTemplates(
		corporationId: string,
		status?: MessageTemplateStatus
	): Promise<MessageTemplate[]> {
		const searchParams = new URLSearchParams()
		if (status) searchParams.set('status', status)

		const query = searchParams.toString()
		return apiClient.get(`/hr/${corporationId}/templates${query ? `?${query}` : ''}`)
	},

	/**
	 * Get a single template by ID
	 */
	async getTemplate(templateId: string): Promise<MessageTemplate> {
		return apiClient.get(`/hr/templates/${templateId}`)
	},

	/**
	 * Create a new message template
	 */
	async createTemplate(
		corporationId: string,
		data: CreateTemplateRequest
	): Promise<MessageTemplate> {
		return apiClient.post(`/hr/${corporationId}/templates`, data)
	},

	/**
	 * Update a message template
	 */
	async updateTemplate(
		templateId: string,
		data: UpdateTemplateRequest
	): Promise<MessageTemplate> {
		return apiClient.patch(`/hr/templates/${templateId}`, data)
	},

	/**
	 * Delete a message template (soft delete)
	 */
	async deleteTemplate(templateId: string): Promise<{ success: boolean }> {
		return apiClient.delete(`/hr/templates/${templateId}`)
	},

	// ==================== Recommendations Discovery (Corp Members) ====================

	/**
	 * Get pending applications for the user's corporations (for recommending)
	 */
	async getPendingRecommendations(): Promise<RecommendableApplication[]> {
		return apiClient.get('/hr/recommendations/pending')
	},

	/**
	 * Get application detail for recommendation (limited info for corp members)
	 */
	async getApplicationForRecommender(applicationId: string): Promise<RecommenderApplicationDetail> {
		return apiClient.get(`/hr/recommendations/applications/${applicationId}`)
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
		completed: 'Completed',
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

// ============================================================================
// Fulcrum (Character Reports) Types & API
// ============================================================================

/**
 * Request source for character reports
 */
export type ReportRequestSource = 'hr'

/**
 * Report metadata returned by the Fulcrum system
 */
export interface CharacterReportMetadata {
	id: string
	characterId: string
	characterName?: string
	status: string
	requestorUserId: string
	requestorCorporationId: string
	requestSource: ReportRequestSource
	applicationId?: string
	retentionDays: number
	workflowInstanceId?: string
	createdAt: string
	updatedAt: string
	expiresAt?: string
	viewedAt?: string
	errorMessage?: string
}

/**
 * A character with their associated Fulcrum reports and identity fields.
 * Legacy list endpoint payload retained for compatibility in older callers.
 */
export interface FulcrumCharacterData {
	characterId: string
	characterName: string
	corporationId?: string | null
	corporationName?: string | null
	allianceId?: string | null
	allianceName?: string | null
	hasValidToken?: boolean | null
	role?: 'CEO' | 'Director' | 'Member' | null
	activityStatus?: 'active' | 'inactive' | 'unknown' | null
	reports: CharacterReportMetadata[]
}

/**
 * A character's Fulcrum report metadata without identity fields.
 * This is the preferred payload for report-only consumers.
 */
export interface FulcrumCharacterReportData {
	characterId: string
	role?: 'CEO' | 'Director' | 'Member' | null
	activityStatus?: 'active' | 'inactive' | 'unknown' | null
	reports: CharacterReportMetadata[]
}

/**
 * Valid section names for character reports
 */
export type ReportSectionName =
	| 'public-info'
	| 'assets'
	| 'fitted-ships'
	| 'orders'
	| 'wallet-transactions'
	| 'wallet-journal'
	| 'mails'
	| 'contacts'
	| 'corp-history'
	| 'skills'
	| 'contracts'
	| 'notifications'
	| 'clones'
	| 'alerts'

/**
 * Storage metadata for a single report section.
 * chunks === 0 means flat file; chunks > 0 means chunked files.
 */
export interface ReportSectionMeta {
	chunks: number
	totalCount: number
	truncated?: boolean
}

/**
 * Report manifest listing available sections with their storage metadata.
 * Only successfully persisted sections appear as keys.
 */
export interface ReportManifest {
	reportId: string
	characterId: string
	sections: Partial<Record<ReportSectionName, ReportSectionMeta>>
	createdAt: string
}

/**
 * Fulcrum API methods (character-scoped)
 */
export const fulcrumApi = {
	/**
	 * Get all linked characters for a user with their Fulcrum reports and identity fields.
	 * Legacy endpoint, retained for compatibility.
	 */
	async getUserCharactersWithReports(
		userId: string,
		corporationId: string,
	): Promise<FulcrumCharacterData[]> {
		return apiClient.get(
			`/fulcrum/users/${userId}/characters?corporationId=${encodeURIComponent(corporationId)}`,
		)
	},

	/**
	 * Get all linked characters for a user with Fulcrum report metadata only.
	 */
	async getUserCharacterReports(userId: string): Promise<FulcrumCharacterReportData[]> {
		return apiClient.get(`/fulcrum/users/${userId}/reports`)
	},

	/**
	 * List reports for a character
	 */
	async getCharacterReports(characterId: string): Promise<CharacterReportMetadata[]> {
		return apiClient.get(`/fulcrum/characters/${characterId}/reports`)
	},

	/**
	 * Request a new Fulcrum report for a character.
	 * `applicationId` is metadata only for report-link / back-navigation context.
	 * It is not used for authorization or corp scoping.
	 */
	async requestReport(
		characterId: string,
		requestSource: ReportRequestSource,
		applicationId?: string,
		sendDm = true,
	): Promise<{ reportId: string; status: string }> {
		return apiClient.post(`/fulcrum/characters/${characterId}/reports`, {
			requestSource,
			applicationId,
			sendDm,
		})
	},

	/**
	 * Request a new batch of Fulcrum reports for multiple characters.
	 * `applicationId` is metadata only for report-link / back-navigation context.
	 * It is not used for authorization or corp scoping.
	 */
	async requestBulkReports(
		characterIds: string[],
		requestSource: ReportRequestSource,
		applicationId?: string,
		sendDm = true,
	): Promise<{ batchId: string; status: string }> {
		return apiClient.post('/fulcrum/reports/batch', {
			characterIds,
			requestSource,
			applicationId,
			sendDm,
		})
	},

	/**
	 * Get report section manifest (list of available sections)
	 */
	async getReportSections(reportId: string): Promise<ReportManifest> {
		return apiClient.get(`/fulcrum/reports/${reportId}/sections`)
	},

	/**
	 * Get processed data for a specific report section
	 */
	async getReportSectionData<T = unknown>(
		reportId: string,
		section: ReportSectionName,
		page?: number,
		pageSize?: number,
	): Promise<T> {
		const params = new URLSearchParams()
		if (page !== undefined) params.set('page', String(page))
		if (pageSize !== undefined) params.set('pageSize', String(pageSize))
		const query = params.toString() ? `?${params.toString()}` : ''
		return apiClient.get(`/fulcrum/reports/${reportId}/sections/${section}${query}`)
	},

	/**
	 * Fetch a single mail's content on-demand from ESI
	 */
	async fetchMailContent(
		reportId: string,
		mailId: string,
	): Promise<{ body: string }> {
		return apiClient.get(`/fulcrum/reports/${reportId}/mails/${mailId}/content`)
	},
}
