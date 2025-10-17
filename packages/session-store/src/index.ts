/**
 * SessionStore Durable Object Interface
 *
 * This package provides TypeScript interfaces for the SessionStore Durable Object
 * which manages EVE SSO sessions, root user accounts, and various account linkings.
 *
 * The actual implementation lives in apps/core/src/session-store.ts
 */

// ========== Types ==========

export interface RootUser {
	rootUserId: string
	provider: string
	providerUserId: string
	email: string
	name: string
	ownerHash: string | null
	isAdmin: boolean
	createdAt: number
	updatedAt: number
}

export interface SessionInfo {
	sessionId: string
	rootUserId: string
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
		rootUserId: string
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
	rootUserId: string
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
	rootUserId: string
	characterId: number
	characterName: string
	isPrimary: boolean
	linkedAt: number
	updatedAt: number
}

export interface ProviderLink {
	linkId: string
	rootUserId: string
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
 * Manages EVE SSO sessions, root user accounts, and various account linkings including:
 * - EVE SSO OAuth sessions
 * - Legacy account links
 * - EVE character links
 * - Secondary provider links
 *
 * Note: This interface is used for type-safe cross-worker communication.
 * The actual implementation is in apps/core/src/session-store.ts
 */
export interface SessionStore {
	/**
	 * Get or create a root user by provider credentials
	 */
	getOrCreateRootUser(
		provider: string,
		providerUserId: string,
		email: string,
		name: string,
		ownerHash?: string | null
	): Promise<RootUser>

	/**
	 * Get a root user by their ID
	 * @returns Root user or null if not found
	 */
	getRootUser(rootUserId: string): Promise<RootUser | null>

	/**
	 * Get a root user by provider credentials
	 * @returns Root user or null if not found
	 */
	getRootUserByProvider(provider: string, providerUserId: string): Promise<RootUser | null>

	/**
	 * Create a new session for a root user
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
	 * Create a link between a root user and a legacy account
	 * @throws {Error} If legacy account already claimed or root user already has a link
	 */
	createAccountLink(
		rootUserId: string,
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
	 * Get all account links for a root user
	 */
	getAccountLinksByRootUser(rootUserId: string): Promise<AccountLink[]>

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
	 * Create a link between a root user and an EVE character
	 * @throws {Error} If character already linked to another root user
	 */
	createCharacterLink(
		rootUserId: string,
		characterId: number,
		characterName: string
	): Promise<CharacterLink>

	/**
	 * Get all character links for a root user
	 */
	getCharacterLinksByRootUser(rootUserId: string): Promise<CharacterLink[]>

	/**
	 * Get character link by character ID
	 * @returns Character link or null if not found
	 */
	getCharacterLinkByCharacterId(characterId: number): Promise<CharacterLink | null>

	/**
	 * Set a character as the primary character for a root user
	 * @throws {Error} If character not found or doesn't belong to user
	 */
	setPrimaryCharacter(rootUserId: string, characterId: number): Promise<void>

	/**
	 * Delete a character link
	 * @throws {Error} If link not found
	 */
	deleteCharacterLink(characterId: number): Promise<void>

	/**
	 * Search for characters by name
	 */
	searchCharactersByName(query: string): Promise<
		Array<{
			rootUserId: string
			characterId: number
			characterName: string
		}>
	>

	/**
	 * Create a link between a root user and a secondary OAuth provider
	 * @throws {Error} If provider account already linked or user already has this provider
	 */
	createProviderLink(
		rootUserId: string,
		provider: string,
		providerUserId: string,
		providerUsername: string
	): Promise<ProviderLink>

	/**
	 * Get all provider links for a root user
	 */
	getProviderLinksByRootUser(rootUserId: string): Promise<ProviderLink[]>

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
