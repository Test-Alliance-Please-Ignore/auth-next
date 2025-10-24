/**
 * Admin RPC Interface Types
 * Shared between admin worker and core worker for type-safe RPC calls
 */

/**
 * Admin audit log action types
 */
export type AdminAction =
	| 'admin_user_deleted'
	| 'admin_character_deleted'
	| 'admin_character_transferred'
	| 'admin_user_viewed'
	| 'admin_character_viewed'

/**
 * Result types for admin operations
 */
export interface DeleteUserResult {
	success: boolean
	deletedUserId: string
	deletedCharacterIds: string[]
	tokensRevoked: number
}

export interface TransferCharacterResult {
	success: boolean
	characterId: string
	oldUserId: string
	newUserId: string
	tokensRevoked: boolean
}

export interface DeleteCharacterResult {
	success: boolean
	characterId: string
	userId: string
	tokensRevoked: boolean
}

/**
 * User summary for search results
 */
export interface UserSummary {
	id: string
	mainCharacterId: string
	mainCharacterName: string | null
	characterCount: number
	is_admin: boolean
	createdAt: Date
	updatedAt: Date
}

/**
 * Search users parameters
 */
export interface SearchUsersParams {
	search?: string
	limit?: number
	offset?: number
}

/**
 * Search users result
 */
export interface SearchUsersResult {
	users: UserSummary[]
	total: number
	limit: number
	offset: number
}

/**
 * Character summary for user details
 */
export interface CharacterSummary {
	characterId: string
	characterName: string
	characterOwnerHash: string
	is_primary: boolean
	linkedAt: Date
	hasValidToken: boolean
}

/**
 * User details with all characters
 */
export interface UserDetails {
	id: string
	mainCharacterId: string
	is_admin: boolean
	discordUserId: string | null
	characters: CharacterSummary[]
	createdAt: Date
	updatedAt: Date
}

/**
 * Character ownership info
 */
export interface CharacterOwnerInfo {
	userId: string
	isPrimary: boolean
	linkedAt: Date
}

/**
 * Character public info
 */
export interface CharacterPublicInfo {
	corporationId?: string
	corporationName?: string
	allianceId?: string
	allianceName?: string
	securityStatus?: number
	birthday?: Date
	[key: string]: unknown
}

/**
 * Character details with ownership
 */
export interface CharacterDetails {
	characterId: string
	characterName: string
	owner: CharacterOwnerInfo | null
	publicInfo: CharacterPublicInfo
	hasValidToken: boolean
	lastUpdated: Date | null
}

/**
 * Admin audit log entry
 */
export interface AdminAuditLogEntry {
	id: string
	adminUserId: string
	action: AdminAction
	targetUserId: string | null
	targetCharacterId: string | null
	metadata: Record<string, unknown> | null
	timestamp: Date
	ip: string | null
	userAgent: string | null
}

/**
 * Activity log filters
 */
export interface ActivityLogFilters {
	limit?: number
	offset?: number
	action?: AdminAction
	adminUserId?: string
}

/**
 * Activity log result
 */
export interface ActivityLogResult {
	logs: AdminAuditLogEntry[]
	total: number
	limit: number
	offset: number
}

/**
 * Core Worker RPC Interface
 * This interface defines all RPC methods exposed by the core worker
 * These methods provide direct access to user/character data without audit logging
 */
export interface CoreWorker {
	/**
	 * Search users with pagination
	 */
	searchUsers(params: SearchUsersParams): Promise<SearchUsersResult>

	/**
	 * Get detailed user information
	 */
	getUserDetails(userId: string): Promise<UserDetails | null>

	/**
	 * Delete a user and all associated data
	 */
	deleteUser(userId: string): Promise<DeleteUserResult>

	/**
	 * Transfer character ownership from one user to another
	 */
	transferCharacterOwnership(characterId: string, newUserId: string): Promise<TransferCharacterResult>

	/**
	 * Delete/unlink a character from its owner
	 */
	deleteCharacter(characterId: string): Promise<DeleteCharacterResult>

	/**
	 * Get character ownership information
	 */
	getCharacterOwnership(characterId: string): Promise<CharacterOwnerInfo | null>
}

/**
 * Admin Worker RPC Interface
 * This interface defines all RPC methods exposed by the admin worker
 */
export interface AdminWorker {
	/**
	 * Delete a user and all associated data
	 */
	deleteUser(userId: string, adminUserId: string): Promise<DeleteUserResult>

	/**
	 * Transfer character ownership from one user to another
	 */
	transferCharacterOwnership(
		characterId: string,
		newUserId: string,
		adminUserId: string
	): Promise<TransferCharacterResult>

	/**
	 * Delete/unlink a character from its owner
	 */
	deleteCharacter(characterId: string, adminUserId: string): Promise<DeleteCharacterResult>

	/**
	 * Search users with pagination
	 */
	searchUsers(params: SearchUsersParams, adminUserId: string): Promise<SearchUsersResult>

	/**
	 * Get detailed user information
	 */
	getUserDetails(userId: string, adminUserId: string): Promise<UserDetails | null>

	/**
	 * Get detailed character information with ownership
	 */
	getCharacterDetails(characterId: string, adminUserId: string): Promise<CharacterDetails | null>

	/**
	 * Get admin activity log with filters
	 */
	getActivityLog(filters: ActivityLogFilters, adminUserId: string): Promise<ActivityLogResult>
}
