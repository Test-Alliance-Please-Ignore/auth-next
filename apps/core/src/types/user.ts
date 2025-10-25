/**
 * User-related types and interfaces
 */

/**
 * Activity log action types
 */
export type ActivityAction =
	| 'login'
	| 'logout'
	| 'character_linked'
	| 'character_unlinked'
	| 'character_primary_changed'
	| 'preferences_updated'
	| 'session_created'
	| 'session_expired'
	| 'role_granted'
	| 'role_revoked'
	| 'admin_user_deleted'
	| 'admin_character_deleted'
	| 'admin_character_transferred'
	| 'admin_user_viewed'
	| 'admin_character_viewed'

/**
 * User character DTO
 */
export interface UserCharacterDTO {
	id: string
	characterOwnerHash: string
	characterId: string
	characterName: string
	is_primary: boolean
	hasValidToken: boolean
	linkedAt: Date
}

/**
 * User session DTO
 */
export interface UserSessionDTO {
	id: string
	sessionToken: string
	expiresAt: Date
	metadata?: {
		ip?: string
		userAgent?: string
		characterId?: string
	}
	lastActivityAt: Date
	createdAt: Date
}

/**
 * User preferences DTO
 */
export interface UserPreferencesDTO {
	theme?: 'light' | 'dark' | 'auto'
	notifications?: {
		email?: boolean
		push?: boolean
	}
	[key: string]: unknown
}

/**
 * User profile DTO (full user data)
 */
export interface UserProfileDTO {
	id: string
	mainCharacterId: string
	discordUserId: string | null
	characters: UserCharacterDTO[]
	is_admin: boolean
	preferences: UserPreferencesDTO
	createdAt: Date
	updatedAt: Date
}

/**
 * Activity log entry DTO
 */
export interface ActivityLogEntryDTO {
	id: string
	userId: string | null
	action: ActivityAction
	metadata?: {
		ip?: string
		userAgent?: string
		characterId?: string
		success?: boolean
		error?: string
		[key: string]: unknown
	}
	timestamp: Date
}

/**
 * Request metadata for logging
 */
export interface RequestMetadata {
	ip?: string
	userAgent?: string
}

/**
 * Session creation options
 */
export interface CreateSessionOptions {
	userId: string
	characterId: string
	metadata?: RequestMetadata
	/** Session duration in seconds (default: 30 days) */
	durationSeconds?: number
}

/**
 * User creation options
 */
export interface CreateUserOptions {
	characterOwnerHash: string
	characterId: string
	characterName: string
}

/**
 * Character linking options
 */
export interface LinkCharacterOptions {
	userId: string
	characterOwnerHash: string
	characterId: string
	characterName: string
}
