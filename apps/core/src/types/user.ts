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

/**
 * User character DTO
 */
export interface UserCharacterDTO {
	id: string
	characterOwnerHash: string
	characterId: number
	characterName: string
	is_primary: boolean
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
		characterOwnerHash?: string
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
	mainCharacterOwnerHash: string
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
		characterOwnerHash?: string
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
	characterOwnerHash: string
	metadata?: RequestMetadata
	/** Session duration in seconds (default: 30 days) */
	durationSeconds?: number
}

/**
 * User creation options
 */
export interface CreateUserOptions {
	characterOwnerHash: string
	characterId: number
	characterName: string
}

/**
 * Character linking options
 */
export interface LinkCharacterOptions {
	userId: string
	characterOwnerHash: string
	characterId: number
	characterName: string
}
