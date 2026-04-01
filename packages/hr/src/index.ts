/**
 * @repo/hr
 *
 * Shared types and interfaces for the Hr Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import type { DurableObject } from 'cloudflare:workers'

/**
 * Application status values
 */
export const APPLICATION_STATUSES = [
	'pending',
	'under_review',
	'accepted',
	'rejected',
	'withdrawn',
] as const

/**
 * Application status type
 */
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

/**
 * Runtime guard for application statuses
 */
export function isApplicationStatus(value: string): value is ApplicationStatus {
	return APPLICATION_STATUSES.includes(value as ApplicationStatus)
}

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
 * Message template status values
 */
export type MessageTemplateStatus = 'draft' | 'active' | 'inactive' | 'deleted'

/**
 * Blacklist target types
 */
export type BlacklistTargetType = 'user' | 'character'

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
	reviewedByCharacterName: string | null
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
 * Application message data transfer object
 */
export interface ApplicationMessage {
	id: string
	applicationId: string
	senderId: string
	senderCharacterId: string | null
	senderCharacterName: string | null
	recipientId: string
	message: string
	createdAt: Date
}

/**
 * Message template data transfer object
 */
export interface MessageTemplate {
	id: string
	status: MessageTemplateStatus
	templateName: string
	ownerCorporationId: string
	description: string | null
	messageTemplate: string
	createdAt: Date
	updatedAt: Date
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
 * Blacklist entry data transfer object
 */
export interface BlacklistEntry {
	id: string
	targetType: BlacklistTargetType
	userId: string | null
	characterId: string | null
	reason: string
	blacklistedBy: string
	triggeredBy: string | null
	isAutoBlacklist: boolean
	metadata: Record<string, unknown> | null
	createdAt: Date
}

/**
 * Parameters for creating a user blacklist
 */
export interface CreateUserBlacklistParams {
	userId: string
	reason: string
	blacklistedBy: string
	triggeredBy?: string
	isAutoBlacklist?: boolean
	metadata?: Record<string, unknown>
}

/**
 * Parameters for creating a character blacklist
 */
export interface CreateCharacterBlacklistParams {
	characterId: string
	reason: string
	blacklistedBy: string
	metadata?: Record<string, unknown>
}

/**
 * Filters for listing blacklists
 */
export interface BlacklistFilters {
	targetType?: BlacklistTargetType
	isAutoBlacklist?: boolean
	userId?: string
	characterId?: string
	limit?: number
	offset?: number
}

/**
 * Paginated blacklist results
 */
export interface BlacklistResults {
	entries: BlacklistEntry[]
	total: number
	limit: number
	offset: number
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
	 * Update application status
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
		characterName: string,
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

	// ==================== Message Methods ====================

	/**
	 * Send a message from HR reviewer to applicant or vice versa
	 * Messages can only be sent for applications in "open" status (pending or under_review)
	 * @param applicationId - Application ID to send message for
	 * @param senderId - ID of the user sending the message
	 * @param recipientId - ID of the user receiving the message
	 * @param message - Message text content
	 * @param characterId - Character ID of the sender
	 * @param isAdmin - Whether the requesting user is a site admin
	 * @returns The created message
	 */
	sendMessage(
		applicationId: string,
		senderId: string,
		recipientId: string | null,
		message: string,
		characterId: string,
		characterName: string,
		isAdmin: boolean
	): Promise<ApplicationMessage>

	/**
	 * List all messages for an application
	 * @param applicationId - Application ID to get messages for
	 * @param userId - ID of the requesting user
	 * @param isAdmin - Whether the requesting user is a site admin
	 * @returns Array of messages ordered by creation time
	 */
	listMessages(
		applicationId: string,
		userId: string,
		isAdmin: boolean
	): Promise<ApplicationMessage[]>

	/**
	 * Get count of messages for an application (for UI badges)
	 * @param applicationId - Application ID to get message count for
	 * @param userId - ID of the requesting user
	 * @param isAdmin - Whether the requesting user is a site admin
	 * @returns Number of messages for the application
	 */
	getMessageCount(applicationId: string, userId: string, isAdmin: boolean): Promise<number>

	// ==================== Message Template Methods ====================

	/**
	 * Create a new message template for a corporation
	 * @param corporationId - Corporation ID that owns the template
	 * @param templateName - Name for the template
	 * @param messageTemplate - Template message content
	 * @param description - Optional description of the template
	 * @param status - Template status (default: 'active')
	 * @returns The created template
	 */
	createTemplate(
		corporationId: string,
		templateName: string,
		messageTemplate: string,
		description?: string,
		status?: 'draft' | 'active' | 'inactive'
	): Promise<MessageTemplate>

	/**
	 * List templates for a corporation
	 * @param corporationId - Corporation ID to list templates for
	 * @param status - Optional: filter by status (excludes deleted by default)
	 * @returns Array of templates
	 */
	listTemplates(corporationId: string, status?: MessageTemplateStatus): Promise<MessageTemplate[]>

	/**
	 * Get a single template by ID
	 * @param templateId - Template ID to retrieve
	 * @returns The template or null if not found
	 */
	getTemplate(templateId: string): Promise<MessageTemplate | null>

	/**
	 * Update a template
	 * @param templateId - Template ID to update
	 * @param updates - Partial updates to apply
	 * @returns The updated template
	 */
	updateTemplate(
		templateId: string,
		updates: Partial<{
			templateName: string
			messageTemplate: string
			description: string | null
			status: MessageTemplateStatus
		}>
	): Promise<MessageTemplate>

	/**
	 * Delete a template (soft delete by setting status to 'deleted')
	 * @param templateId - Template ID to delete
	 */
	deleteTemplate(templateId: string): Promise<void>

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
	 * Get corporation IDs where a user has any HR role
	 * @param userId - User to check
	 * @returns Array of corporation IDs
	 */
	getUserHrCorporations(userId: string): Promise<string[]>

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

	// ==================== Blacklist Methods ====================

	/**
	 * Check if a user is blacklisted
	 * Fast lookup - used on every auth request
	 * @param userId - User ID to check
	 * @returns Whether the user is blacklisted
	 */
	isUserBlacklisted(userId: string): Promise<boolean>

	/**
	 * Check if a character is blacklisted
	 * Fast lookup - used on login and character linking
	 * @param characterId - Character ID to check
	 * @returns Whether the character is blacklisted
	 */
	isCharacterBlacklisted(characterId: string): Promise<boolean>

	/**
	 * Bulk check if multiple characters are blacklisted
	 * Optimized for checking many characters at once (e.g., displaying member lists)
	 * @param characterIds - Array of character IDs to check
	 * @returns Object mapping character ID to blacklist status
	 */
	checkCharactersBlacklisted(characterIds: string[]): Promise<Record<string, boolean>>

	/**
	 * Create a user blacklist entry
	 * Used for both manual blacklists and auto-blacklists triggered by characters
	 * @param params - Parameters for creating the user blacklist
	 * @returns The created blacklist entry
	 */
	createUserBlacklist(params: CreateUserBlacklistParams): Promise<BlacklistEntry>

	/**
	 * Create a character blacklist entry
	 * The Core worker will handle finding users with this character and auto-blacklisting them
	 * @param params - Parameters for creating the character blacklist
	 * @returns The created blacklist entry
	 */
	createCharacterBlacklist(params: CreateCharacterBlacklistParams): Promise<BlacklistEntry>

	/**
	 * Remove a blacklist entry
	 * IMPORTANT: Removing a character blacklist does NOT remove user blacklists it triggered
	 * @param id - Blacklist entry ID to remove
	 */
	removeBlacklistEntry(id: string): Promise<void>

	/**
	 * Get all blacklist entries for a user (including auto-blacklists)
	 * @param userId - User ID to get blacklists for
	 * @returns Array of blacklist entries for the user
	 */
	getBlacklistsForUser(userId: string): Promise<BlacklistEntry[]>

	/**
	 * Get all blacklist entries for a character
	 * @param characterId - Character ID to get blacklists for
	 * @returns Array of blacklist entries for the character
	 */
	getBlacklistsForCharacter(characterId: string): Promise<BlacklistEntry[]>

	/**
	 * Get a specific blacklist entry by ID
	 * @param id - Blacklist entry ID to retrieve
	 * @returns The blacklist entry or null if not found
	 */
	getBlacklistEntry(id: string): Promise<BlacklistEntry | null>

	/**
	 * Get user blacklists triggered by a character blacklist
	 * Used to show "N users auto-blacklisted from this character"
	 * @param characterBlacklistId - Character blacklist entry ID
	 * @returns Array of user blacklist entries triggered by this character
	 */
	getTriggeredBlacklists(characterBlacklistId: string): Promise<BlacklistEntry[]>

	/**
	 * Find ALL blacklist entries triggered by a specific entry (for cascading removal)
	 * @param blacklistId - Blacklist entry ID
	 * @returns Array of blacklist entries (both user and character) triggered by this entry
	 */
	findTriggeredEntries(blacklistId: string): Promise<BlacklistEntry[]>

	/**
	 * List all blacklist entries with filters and pagination
	 * @param filters - Filter criteria and pagination options
	 * @returns Paginated blacklist results
	 */
	getAllBlacklists(filters: BlacklistFilters): Promise<BlacklistResults>
}

/**
 * Service URN for the HR Durable Object
 */
export const SERVICE_HR = 'urn:service:hr'

/**
 * HR viewer role URN
 */
export const ROLE_HR_VIEWER = `${SERVICE_HR}:role:hr-viewer`

/**
 * HR reviewer role URN
 */
export const ROLE_HR_REVIEWER = `${SERVICE_HR}:role:hr-reviewer`

/**
 * HR admin role URN
 */
export const ROLE_HR_ADMIN = `${SERVICE_HR}:role:hr-admin`

/**
 * HR corporation CEO role URN
 */
export const ROLE_HR_CORP_CEO = `${SERVICE_HR}:role:hr-corp-ceo`

/**
 * All HR roles
 */
export const HR_ROLES = [ROLE_HR_VIEWER, ROLE_HR_REVIEWER, ROLE_HR_ADMIN, ROLE_HR_CORP_CEO] as const

/**
 * HR role URN type
 */
export type HrRoleUrn = (typeof HR_ROLES)[number]

/**
 * Get a HR stub
 * @param env - Environment
 * @returns HR stub
 */
export const getHrStub = (env: { HR: DurableObjectNamespace }): Hr => {
	if (!env.HR) {
		throw new Error('HR namespace is not defined')
	}
	const id = env.HR.newUniqueId()
	return env.HR.get(id) as unknown as Hr
}
