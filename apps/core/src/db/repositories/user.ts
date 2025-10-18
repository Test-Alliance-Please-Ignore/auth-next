import { eq, and, or, sql } from '@repo/db-utils'
import type { CoreDb } from '../client'
import { users, accountLinks, characterLinks, providerLinks } from '../schema'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

export type User = InferSelectModel<typeof users>
export type NewUser = InferInsertModel<typeof users>
export type AccountLink = InferSelectModel<typeof accountLinks>
export type NewAccountLink = InferInsertModel<typeof accountLinks>
export type CharacterLink = InferSelectModel<typeof characterLinks>
export type NewCharacterLink = InferInsertModel<typeof characterLinks>
export type ProviderLink = InferSelectModel<typeof providerLinks>
export type NewProviderLink = InferInsertModel<typeof providerLinks>

export class UserRepository {
	constructor(private db: CoreDb) {}

	// ============================================================================
	// User Management
	// ============================================================================

	/**
	 * Create a new user
	 */
	async createUser(data: NewUser): Promise<User> {
		const [user] = await this.db
			.insert(users)
			.values(data)
			.returning()

		return user
	}

	/**
	 * Get user by ID
	 */
	async getUserById(userId: string): Promise<User | null> {
		const [user] = await this.db
			.select()
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)

		return user || null
	}

	/**
	 * Get user by provider credentials
	 */
	async getUserByProvider(provider: string, providerUserId: string): Promise<User | null> {
		const [user] = await this.db
			.select()
			.from(users)
			.where(
				and(
					eq(users.provider, provider),
					eq(users.providerUserId, providerUserId)
				)
			)
			.limit(1)

		return user || null
	}

	/**
	 * Get user by email
	 */
	async getUserByEmail(email: string): Promise<User | null> {
		const [user] = await this.db
			.select()
			.from(users)
			.where(eq(users.email, email))
			.limit(1)

		return user || null
	}

	/**
	 * Get user by owner hash
	 */
	async getUserByOwnerHash(ownerHash: string): Promise<User | null> {
		const [user] = await this.db
			.select()
			.from(users)
			.where(eq(users.ownerHash, ownerHash))
			.limit(1)

		return user || null
	}

	/**
	 * Update user
	 */
	async updateUser(userId: string, data: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User> {
		const [updated] = await this.db
			.update(users)
			.set({
				...data,
				updatedAt: new Date()
			})
			.where(eq(users.id, userId))
			.returning()

		return updated
	}

	/**
	 * Delete user (cascades to all related data)
	 */
	async deleteUser(userId: string): Promise<void> {
		await this.db
			.delete(users)
			.where(eq(users.id, userId))
	}

	// ============================================================================
	// Account Linking
	// ============================================================================

	/**
	 * Link legacy account to user
	 */
	async linkLegacyAccount(data: NewAccountLink): Promise<AccountLink> {
		const [link] = await this.db
			.insert(accountLinks)
			.values(data)
			.returning()

		return link
	}

	/**
	 * Get account link by user
	 */
	async getAccountLinkByUser(userId: string): Promise<AccountLink | null> {
		const [link] = await this.db
			.select()
			.from(accountLinks)
			.where(eq(accountLinks.userId, userId))
			.limit(1)

		return link || null
	}

	/**
	 * Get account link by legacy credentials
	 */
	async getAccountLinkByLegacy(legacySystem: string, legacyUserId: string): Promise<AccountLink | null> {
		const [link] = await this.db
			.select()
			.from(accountLinks)
			.where(
				and(
					eq(accountLinks.legacySystem, legacySystem),
					eq(accountLinks.legacyUserId, legacyUserId)
				)
			)
			.limit(1)

		return link || null
	}

	/**
	 * Update account link
	 */
	async updateAccountLink(
		linkId: string,
		data: Partial<Omit<AccountLink, 'id' | 'linkedAt'>>
	): Promise<AccountLink> {
		const [updated] = await this.db
			.update(accountLinks)
			.set({
				...data,
				updatedAt: new Date()
			})
			.where(eq(accountLinks.id, linkId))
			.returning()

		return updated
	}

	// ============================================================================
	// Character Linking
	// ============================================================================

	/**
	 * Link EVE character to user
	 */
	async linkCharacter(data: NewCharacterLink): Promise<CharacterLink> {
		// If this is being set as primary, unset any existing primary
		if (data.isPrimary) {
			await this.db
				.update(characterLinks)
				.set({ isPrimary: false, updatedAt: new Date() })
				.where(
					and(
						eq(characterLinks.userId, data.userId),
						eq(characterLinks.isPrimary, true)
					)
				)
		}

		const [link] = await this.db
			.insert(characterLinks)
			.values(data)
			.returning()

		return link
	}

	/**
	 * Get character links for user
	 */
	async getUserCharacters(userId: string): Promise<CharacterLink[]> {
		return this.db
			.select()
			.from(characterLinks)
			.where(eq(characterLinks.userId, userId))
			.orderBy(characterLinks.isPrimary, characterLinks.linkedAt)
	}

	/**
	 * Get character link by character ID
	 */
	async getCharacterLink(characterId: number): Promise<CharacterLink | null> {
		const [link] = await this.db
			.select()
			.from(characterLinks)
			.where(eq(characterLinks.characterId, characterId))
			.limit(1)

		return link || null
	}

	/**
	 * Set primary character for user
	 */
	async setPrimaryCharacter(userId: string, characterId: number): Promise<void> {
		// Unset all primary flags for user
		await this.db
			.update(characterLinks)
			.set({ isPrimary: false, updatedAt: new Date() })
			.where(eq(characterLinks.userId, userId))

		// Set the new primary
		await this.db
			.update(characterLinks)
			.set({ isPrimary: true, updatedAt: new Date() })
			.where(
				and(
					eq(characterLinks.userId, userId),
					eq(characterLinks.characterId, characterId)
				)
			)
	}

	/**
	 * Unlink character from user
	 */
	async unlinkCharacter(characterId: number): Promise<void> {
		await this.db
			.delete(characterLinks)
			.where(eq(characterLinks.characterId, characterId))
	}

	// ============================================================================
	// Provider Linking
	// ============================================================================

	/**
	 * Link provider account to user
	 */
	async linkProvider(data: NewProviderLink): Promise<ProviderLink> {
		const [link] = await this.db
			.insert(providerLinks)
			.values(data)
			.returning()

		return link
	}

	/**
	 * Get provider links for user
	 */
	async getUserProviders(userId: string): Promise<ProviderLink[]> {
		return this.db
			.select()
			.from(providerLinks)
			.where(eq(providerLinks.userId, userId))
			.orderBy(providerLinks.linkedAt)
	}

	/**
	 * Get provider link
	 */
	async getProviderLink(provider: string, providerUserId: string): Promise<ProviderLink | null> {
		const [link] = await this.db
			.select()
			.from(providerLinks)
			.where(
				and(
					eq(providerLinks.provider, provider),
					eq(providerLinks.providerUserId, providerUserId)
				)
			)
			.limit(1)

		return link || null
	}

	/**
	 * Unlink provider from user
	 */
	async unlinkProvider(linkId: string): Promise<void> {
		await this.db
			.delete(providerLinks)
			.where(eq(providerLinks.id, linkId))
	}

	// ============================================================================
	// Complex Queries
	// ============================================================================

	/**
	 * Get user with all linked data
	 */
	async getUserWithLinks(userId: string) {
		const user = await this.getUserById(userId)
		if (!user) return null

		const [accountLink, characters, providers] = await Promise.all([
			this.getAccountLinkByUser(userId),
			this.getUserCharacters(userId),
			this.getUserProviders(userId)
		])

		return {
			...user,
			accountLink,
			characters,
			providers
		}
	}

	/**
	 * Find or create user from provider data
	 */
	async findOrCreateUserFromProvider(
		provider: string,
		providerUserId: string,
		providerData: {
			email?: string
			name?: string
			username?: string
		}
	): Promise<User> {
		// Try to find existing user
		let user = await this.getUserByProvider(provider, providerUserId)
		if (user) return user

		// Check if there's a user with this email
		if (providerData.email) {
			user = await this.getUserByEmail(providerData.email)
			if (user) {
				// Link this provider to existing user
				await this.linkProvider({
					userId: user.id,
					provider,
					providerUserId,
					providerUsername: providerData.username
				})
				return user
			}
		}

		// Create new user
		return this.createUser({
			provider,
			providerUserId,
			email: providerData.email,
			name: providerData.name
		})
	}
}