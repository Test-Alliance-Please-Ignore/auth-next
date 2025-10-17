/**
 * SessionStore Durable Object Interface
 *
 * This package provides TypeScript interfaces for the SessionStore Durable Object
 * which manages user sessions, social accounts, and various account linkings.
 *
 * The actual implementation lives in apps/social-auth/src/session-store.ts
 */

// ========== Types ==========

export interface SocialUser {
	socialUserId: string
	provider: string
	providerUserId: string
	email: string
	name: string
	isAdmin: boolean
	createdAt: number
	updatedAt: number
}

export interface SessionInfo {
	sessionId: string
	socialUserId: string
	provider: string
	providerUserId: string
	email: string
	name: string
	accessToken: string
	expiresAt: number
	createdAt?: number
	updatedAt?: number
}

export interface SessionListResult {
	total: number
	limit: number
	offset: number
	results: Array<{
		sessionId: string
		socialUserId: string
		provider: string
		providerUserId: string
		email: string
		name: string
		expiresAt: number
		createdAt: number
		updatedAt: number
	}>
}

export interface SessionStats {
	totalCount: number
	expiredCount: number
	activeCount: number
}

export interface AccountLink {
	linkId: string
	socialUserId: string
	legacySystem: string
	legacyUserId: string
	legacyUsername: string
	superuser: boolean
	staff: boolean
	active: boolean
	primaryCharacter: string
	primaryCharacterId: string
	groups: string[]
	linkedAt: number
	updatedAt: number
}

export interface CharacterLink {
	linkId: string
	socialUserId: string
	characterId: number
	characterName: string
	isPrimary: boolean
	linkedAt: number
	updatedAt: number
}

export interface ProviderLink {
	linkId: string
	socialUserId: string
	provider: string
	providerUserId: string
	providerUsername: string
	linkedAt: number
	updatedAt: number
}

// ========== Durable Object Interface ==========

/**
 * SessionStore Durable Object Interface
 *
 * Manages user sessions, social accounts, and various account linkings including:
 * - Social OAuth sessions (Google, Discord, etc.)
 * - Legacy account links
 * - EVE character links
 * - Secondary provider links
 *
 * Note: This interface is used for type-safe cross-worker communication.
 * The actual implementation is in apps/social-auth/src/session-store.ts
 */
export interface SessionStore {
	/**
	 * Get or create a social user by provider credentials
	 */
	getOrCreateSocialUser(
		provider: string,
		providerUserId: string,
		email: string,
		name: string
	): Promise<SocialUser>

	/**
	 * Get a social user by their ID
	 * @returns Social user or null if not found
	 */
	getSocialUser(socialUserId: string): Promise<SocialUser | null>

	/**
	 * Create a new session for a social user
	 */
	createSession(
		provider: string,
		providerUserId: string,
		email: string,
		name: string,
		accessToken: string,
		refreshToken: string,
		expiresIn: number
	): Promise<SessionInfo>

	/**
	 * Get a session by ID, automatically refreshing OAuth token if needed
	 * @throws {Error} If session not found or expired
	 */
	getSession(sessionId: string): Promise<SessionInfo>

	/**
	 * Manually refresh a session's OAuth token
	 * @throws {Error} If session not found or refresh fails
	 */
	refreshSession(sessionId: string): Promise<SessionInfo>

	/**
	 * Delete a session
	 * @throws {Error} If session not found
	 */
	deleteSession(sessionId: string): Promise<void>

	/**
	 * List all sessions with pagination
	 */
	listSessions(limit?: number, offset?: number): Promise<SessionListResult>

	/**
	 * Get session statistics
	 */
	getStats(): Promise<SessionStats>

	/**
	 * Create OIDC state for CSRF protection
	 * @returns State token
	 */
	createOIDCState(sessionId: string): Promise<string>

	/**
	 * Validate and consume OIDC state
	 * @returns Session ID associated with the state
	 * @throws {Error} If state is invalid or expired
	 */
	validateOIDCState(state: string): Promise<string>

	/**
	 * Create a link between a social user and a legacy account
	 * @throws {Error} If legacy account already claimed or social user already has a link
	 */
	createAccountLink(
		socialUserId: string,
		legacySystem: string,
		legacyUserId: string,
		legacyUsername: string,
		superuser: boolean,
		staff: boolean,
		active: boolean,
		primaryCharacter: string,
		primaryCharacterId: string,
		groups: string[]
	): Promise<AccountLink>

	/**
	 * Get all account links for a social user
	 */
	getAccountLinksBySocialUser(socialUserId: string): Promise<AccountLink[]>

	/**
	 * Get account link by legacy account ID
	 * @returns Account link or null if not found
	 */
	getAccountLinkByLegacyId(legacySystem: string, legacyUserId: string): Promise<AccountLink | null>

	/**
	 * Delete an account link
	 * @throws {Error} If link not found
	 */
	deleteAccountLink(linkId: string): Promise<void>

	/**
	 * Create a link between a social user and an EVE character
	 * @throws {Error} If character already linked to another social user
	 */
	createCharacterLink(
		socialUserId: string,
		characterId: number,
		characterName: string
	): Promise<CharacterLink>

	/**
	 * Get all character links for a social user
	 */
	getCharacterLinksBySocialUser(socialUserId: string): Promise<CharacterLink[]>

	/**
	 * Get character link by character ID
	 * @returns Character link or null if not found
	 */
	getCharacterLinkByCharacterId(characterId: number): Promise<CharacterLink | null>

	/**
	 * Set a character as the primary character for a social user
	 * @throws {Error} If character not found or doesn't belong to user
	 */
	setPrimaryCharacter(socialUserId: string, characterId: number): Promise<void>

	/**
	 * Delete a character link
	 * @throws {Error} If link not found
	 */
	deleteCharacterLink(characterId: number): Promise<void>

	/**
	 * Search for characters by name
	 */
	searchCharactersByName(query: string): Promise<Array<{
		socialUserId: string
		characterId: number
		characterName: string
	}>>

	/**
	 * Create a link between a social user and a secondary OAuth provider
	 * @throws {Error} If provider account already linked or user already has this provider
	 */
	createProviderLink(
		socialUserId: string,
		provider: string,
		providerUserId: string,
		providerUsername: string
	): Promise<ProviderLink>

	/**
	 * Get all provider links for a social user
	 */
	getProviderLinksBySocialUser(socialUserId: string): Promise<ProviderLink[]>

	/**
	 * Get provider link by provider credentials
	 * @returns Provider link or null if not found
	 */
	getProviderLinkByProvider(provider: string, providerUserId: string): Promise<ProviderLink | null>

	/**
	 * Delete a provider link
	 * @throws {Error} If link not found
	 */
	deleteProviderLink(linkId: string): Promise<void>
}
