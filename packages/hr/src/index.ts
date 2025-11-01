/**
 * @repo/hr
 *
 * Shared types and interfaces for the Hr Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * Application status values
 */
export type ApplicationStatus = 'pending' | 'under_review' | 'accepted' | 'rejected' | 'withdrawn'

/**
 * Recommendation sentiment values
 */
export type RecommendationSentiment = 'positive' | 'neutral' | 'negative'

/**
 * HR note types
 */
export type HrNoteType = 'general' | 'warning' | 'positive' | 'incident' | 'background_check'

/**
 * HR note priorities
 */
export type HrNotePriority = 'low' | 'normal' | 'high' | 'critical'

/**
 * HR role types
 */
export type HrRoleType = 'hr_admin' | 'hr_reviewer' | 'hr_viewer'

/**
 * Application data transfer object
 */
export interface Application {
	id: string
	corporationId: string
	userId: string
	characterId: string
	characterName: string
	applicationText: string
	status: ApplicationStatus
	reviewedBy: string | null
	reviewedAt: Date | null
	reviewNotes: string | null
	createdAt: Date
	updatedAt: Date
}

/**
 * Application detail with related data
 */
export interface ApplicationDetail extends Application {
	recommendations: Recommendation[]
	recommendationCount: number
	activityLog?: ActivityLogEntry[]
}

/**
 * Recommendation data transfer object
 */
export interface Recommendation {
	id: string
	applicationId: string
	userId: string
	characterId: string
	characterName: string
	recommendationText: string
	sentiment: RecommendationSentiment
	createdAt: Date
	updatedAt: Date
}

/**
 * Activity log entry data transfer object
 */
export interface ActivityLogEntry {
	id: string
	applicationId: string
	userId: string
	characterId: string
	action: string
	previousValue: string | null
	newValue: string | null
	metadata: Record<string, unknown> | null
	timestamp: Date
}

/**
 * HR note data transfer object
 */
export interface HrNote {
	id: string
	subjectUserId: string
	subjectCharacterId: string | null
	authorId: string
	authorCharacterId: string | null
	authorCharacterName: string | null
	noteText: string
	noteType: HrNoteType
	priority: HrNotePriority
	metadata: Record<string, unknown> | null
	createdAt: Date
	updatedAt: Date
}

/**
 * HR role data transfer object
 */
export interface HrRole {
	id: string
	corporationId: string
	userId: string
	characterId: string
	characterName: string
	role: HrRoleType
	grantedBy: string
	grantedAt: Date
	expiresAt: Date | null
	isActive: boolean
	createdAt: Date
	updatedAt: Date
}

/**
 * Filters for listing applications
 */
export interface ApplicationFilters {
	corporationId?: string
	userId?: string
	status?: ApplicationStatus
	limit?: number
	offset?: number
}

/**
 * Filters for listing HR notes
 */
export interface NoteFilters {
	subjectUserId?: string
	noteType?: HrNoteType
	priority?: HrNotePriority
	limit?: number
	offset?: number
}

/**
 * Filters for listing HR roles
 */
export interface RoleFilters {
	corporationId?: string
	userId?: string
	isActive?: boolean
	limit?: number
	offset?: number
}

/**
 * Public RPC interface for Hr Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Hr } from '@repo/hr'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Hr>(env.HR, 'default')
 * const application = await stub.submitApplication(userId, characterId, corporationId, applicationText)
 * ```
 */
export interface Hr extends DurableObject {
	// ==================== Application Methods ====================

	/**
	 * Submit a new application to a corporation
	 * @param userId - ID of the user submitting the application
	 * @param characterId - Character ID applying (must be owned by user)
	 * @param corporationId - Corporation ID to apply to
	 * @param applicationText - Application text from the user
	 * @param characterName - Character name (cached for display)
	 * @returns The created application
	 */
	submitApplication(
		userId: string,
		characterId: string,
		corporationId: string,
		applicationText: string,
		characterName: string
	): Promise<Application>

	/**
	 * List applications with optional filters
	 * @param filters - Filter criteria for applications
	 * @param userId - ID of the requesting user
	 * @param isAdmin - Whether the requesting user is a site admin
	 * @returns Array of applications (filtered by authorization)
	 */
	listApplications(
		filters: ApplicationFilters,
		userId: string,
		isAdmin: boolean
	): Promise<Application[]>

	/**
	 * Get a single application with recommendations
	 * @param applicationId - Application ID to retrieve
	 * @param userId - ID of the requesting user
	 * @param isAdmin - Whether the requesting user is a site admin
	 * @returns Application detail with recommendations
	 */
	getApplication(
		applicationId: string,
		userId: string,
		isAdmin: boolean
	): Promise<ApplicationDetail>

	/**
	 * Update application status (flexible - no state machine validation)
	 * @param applicationId - Application ID to update
	 * @param status - New status
	 * @param userId - ID of the user making the update
	 * @param characterId - Character ID of user making update
	 * @param reviewNotes - Optional review notes (for HR)
	 */
	updateApplicationStatus(
		applicationId: string,
		status: ApplicationStatus,
		userId: string,
		characterId: string,
		reviewNotes?: string
	): Promise<void>

	/**
	 * Withdraw an application (applicant only)
	 * @param applicationId - Application ID to withdraw
	 * @param userId - ID of the user withdrawing (must be applicant)
	 * @param characterId - Character ID of user withdrawing
	 */
	withdrawApplication(applicationId: string, userId: string, characterId: string): Promise<void>

	/**
	 * Permanently delete an application (admin only)
	 * @param applicationId - Application ID to delete
	 */
	deleteApplication(applicationId: string): Promise<void>

	// ==================== Recommendation Methods ====================

	/**
	 * Add a recommendation for an application
	 * @param applicationId - Application to recommend for
	 * @param userId - ID of the user adding recommendation
	 * @param characterId - Character ID adding recommendation
	 * @param characterName - Character name (cached for display)
	 * @param recommendationText - Recommendation text
	 * @param sentiment - Sentiment (positive, neutral, negative)
	 * @returns The created recommendation
	 */
	addRecommendation(
		applicationId: string,
		userId: string,
		characterId: string,
		characterName: string,
		recommendationText: string,
		sentiment: RecommendationSentiment
	): Promise<Recommendation>

	/**
	 * Update a recommendation
	 * @param recommendationId - Recommendation ID to update
	 * @param userId - ID of the user updating (must be author or admin)
	 * @param characterId - Character ID of user updating
	 * @param recommendationText - Updated recommendation text
	 * @param sentiment - Updated sentiment
	 * @param isAdmin - Whether the user is an admin
	 */
	updateRecommendation(
		recommendationId: string,
		userId: string,
		characterId: string,
		recommendationText: string,
		sentiment: RecommendationSentiment,
		isAdmin: boolean
	): Promise<void>

	/**
	 * Delete a recommendation
	 * @param recommendationId - Recommendation ID to delete
	 * @param userId - ID of the user deleting (must be author or admin)
	 * @param characterId - Character ID of user deleting
	 * @param isAdmin - Whether the requesting user is a site admin
	 */
	deleteRecommendation(
		recommendationId: string,
		userId: string,
		characterId: string,
		isAdmin: boolean
	): Promise<void>

	// ==================== HR Notes Methods (Admin Only) ====================

	/**
	 * Create an HR note about a user (admin only)
	 * @param subjectUserId - User the note is about
	 * @param subjectCharacterId - Optional character the note is about
	 * @param authorId - Admin creating the note
	 * @param authorCharacterId - Character ID of admin creating note
	 * @param authorCharacterName - Character name of admin creating note
	 * @param noteText - Note content
	 * @param noteType - Type of note
	 * @param priority - Priority level
	 * @param metadata - Optional additional metadata
	 * @returns The created note
	 */
	createNote(
		subjectUserId: string,
		subjectCharacterId: string | null,
		authorId: string,
		authorCharacterId: string | null,
		authorCharacterName: string | null,
		noteText: string,
		noteType: HrNoteType,
		priority: HrNotePriority,
		metadata?: Record<string, unknown>
	): Promise<HrNote>

	/**
	 * List HR notes with optional filters (admin only)
	 * @param filters - Filter criteria for notes
	 * @returns Array of HR notes
	 */
	listNotes(filters: NoteFilters): Promise<HrNote[]>

	/**
	 * Get all HR notes for a specific user (admin only)
	 * @param subjectUserId - User to get notes for
	 * @returns Array of HR notes for the user
	 */
	getUserNotes(subjectUserId: string): Promise<HrNote[]>

	/**
	 * Update an HR note (admin only)
	 * @param noteId - Note ID to update
	 * @param updates - Partial updates to apply
	 */
	updateNote(noteId: string, updates: Partial<HrNote>): Promise<void>

	/**
	 * Delete an HR note (admin only)
	 * @param noteId - Note ID to delete
	 */
	deleteNote(noteId: string): Promise<void>

	// ==================== HR Roles Methods ====================

	/**
	 * Grant an HR role to a user for a corporation
	 * Validates that the character is a member of the corporation via EVE Corporation Data DO
	 * @param corporationId - Corporation to grant role for
	 * @param userId - User to grant role to
	 * @param characterId - Character in the corporation
	 * @param characterName - Character name (cached for display)
	 * @param role - Role to grant (hr_admin, hr_reviewer, hr_viewer)
	 * @param grantedBy - ID of the user granting the role
	 * @param expiresAt - Optional expiration date for the role
	 * @returns The created role
	 */
	grantRole(
		corporationId: string,
		userId: string,
		characterId: string,
		characterName: string,
		role: HrRoleType,
		grantedBy: string,
		expiresAt?: Date
	): Promise<HrRole>

	/**
	 * Revoke an HR role
	 * @param roleId - Role ID to revoke
	 */
	revokeRole(roleId: string): Promise<void>

	/**
	 * Get a single HR role by ID
	 * @param roleId - Role ID to retrieve
	 * @returns The HR role or null if not found
	 */
	getRole(roleId: string): Promise<HrRole | null>

	/**
	 * Get HR roles for a user
	 * @param userId - User to get roles for
	 * @param corporationId - Optional: filter by corporation
	 * @returns Array of HR roles
	 */
	getUserRoles(userId: string, corporationId?: string): Promise<HrRole[]>

	/**
	 * Get all HR roles for a corporation
	 * @param corporationId - Corporation ID to get roles for
	 * @param activeOnly - Whether to only return active roles (default: true)
	 * @returns Array of HR roles for the corporation
	 */
	getCorporationRoles(corporationId: string, activeOnly?: boolean): Promise<HrRole[]>

	/**
	 * Check if a user has permission for a corporation
	 * @param userId - User to check
	 * @param corporationId - Corporation to check for
	 * @param requiredRole - Minimum required role (hr_viewer, hr_reviewer, hr_admin)
	 * @returns Whether the user has the required permission
	 */
	checkPermission(userId: string, corporationId: string, requiredRole: HrRoleType): Promise<boolean>
}
