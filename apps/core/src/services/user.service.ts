import { and, asc, eq } from '@repo/db-utils'
import { logger, toErrorLogDetails } from '@repo/hono-helpers'

import { userCharacters, userPreferences, users } from '../db/schema'

import type {
	CreateUserOptions,
	LinkCharacterOptions,
	UserCharacterDTO,
	UserPreferencesDTO,
	UserProfileDTO,
} from '@repo/core'
import type { createDb } from '../db'

/**
 * Thrown when a character cannot be claimed because it is already attached to an account.
 *
 * Distinct from a generic failure so callers can answer a losing race with a 409 while still
 * letting real faults (a database outage, say) surface as 5xx and reach error reporting.
 */
export class CharacterAlreadyClaimedError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'CharacterAlreadyClaimedError'
	}
}

/**
 * User Service
 *
 * Handles user CRUD operations, character linking, and user profile management.
 */
export class UserService {
	constructor(private db: ReturnType<typeof createDb>) {}

	/**
	 * Create a new user with their main character
	 */
	async createUser(options: CreateUserOptions): Promise<UserProfileDTO> {
		const { characterOwnerHash, characterId, characterName } = options

		// Check if user already exists
		const existingUser = await this.db.query.users.findFirst({
			where: eq(users.mainCharacterId, characterId),
		})

		if (existingUser) {
			throw new CharacterAlreadyClaimedError('User already exists with this character as main')
		}

		// Check if character is already linked to another user
		const existingCharacter = await this.db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, characterId),
		})

		if (existingCharacter) {
			throw new CharacterAlreadyClaimedError('Character is already linked to another user')
		}

		// Create user
		const [user] = await this.db
			.insert(users)
			.values({
				mainCharacterId: characterId,
			})
			.returning()

		if (!user) {
			throw new Error('Failed to create user')
		}

		// Link character as primary (token is valid since this is called from auth flow)
		await this.db.insert(userCharacters).values({
			userId: user.id,
			characterOwnerHash,
			characterId,
			characterName,
			is_primary: true,
			hasValidToken: true,
		})

		// Create default preferences
		await this.db.insert(userPreferences).values({
			userId: user.id,
			preferences: {},
		})

		// Return full user profile
		return this.getUserProfile(user.id)
	}

	/**
	 * Get user by ID
	 */
	async getUserById(userId: string): Promise<UserProfileDTO | null> {
		const user = await this.db.query.users.findFirst({
			where: eq(users.id, userId),
		})

		if (!user) {
			return null
		}

		return this.getUserProfile(userId)
	}

	/**
	 * Get user by character ID
	 */
	async getUserByCharacterId(characterId: string): Promise<UserProfileDTO | null> {
		const character = await this.db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, characterId),
		})

		if (!character) {
			return null
		}

		return this.getUserProfile(character.userId)
	}

	/**
	 * Fetch the raw ownership record for a linked character.
	 *
	 * Deliberately does not go through getUserProfile(): that hides soft-deleted characters,
	 * and a character that was unlinked and later transferred must still be recognisable as
	 * transferred. Returns the stored owner hash so callers can compare it against the one
	 * EVE SSO just handed us.
	 */
	async getCharacterOwnership(
		characterId: string
	): Promise<{ userId: string; characterOwnerHash: string } | null> {
		const character = await this.db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, characterId),
			columns: { userId: true, characterOwnerHash: true },
		})

		return character ?? null
	}

	/**
	 * Record the real CCP owner hash for a character that does not have one yet.
	 *
	 * Only for adopting a placeholder written by an admin-driven import, where no real hash was
	 * ever known. Callers must confirm the stored value is a placeholder first — overwriting a
	 * genuine hash would erase the only evidence that a character changed hands.
	 */
	async adoptCharacterOwnerHash(characterId: string, characterOwnerHash: string): Promise<void> {
		await this.db
			.update(userCharacters)
			.set({ characterOwnerHash, updatedAt: new Date() })
			.where(eq(userCharacters.characterId, characterId))
	}

	/**
	 * Get full user profile with characters and preferences
	 * Optimized to fetch all data in parallel rather than sequentially
	 */
	async getUserProfile(
		userId: string,
		options?: { includeDeleted?: boolean }
	): Promise<UserProfileDTO> {
		const includeDeleted = options?.includeDeleted === true
		const characterWhere = includeDeleted
			? eq(userCharacters.userId, userId)
			: and(eq(userCharacters.userId, userId), eq(userCharacters.isDeleted, false))

		// Preferences are optional profile metadata. Keep their failure isolated so a
		// transient preferences query does not prevent session authentication.
		const preferencesPromise = this.db.query.userPreferences
			.findFirst({
				where: eq(userPreferences.userId, userId),
			})
			.catch((error) => {
				logger.warn('[UserService] Preferences query failed; using defaults', {
					userId,
					...toErrorLogDetails(error),
				})
				return null
			})

		// Execute all profile queries in parallel for better performance.
		let user, characters, preferences
		try {
			;[user, characters, preferences] = await Promise.all([
				this.db.query.users.findFirst({
					where: eq(users.id, userId),
				}),
				this.db.query.userCharacters.findMany({
					where: characterWhere,
					orderBy: [asc(userCharacters.linkedAt)],
					columns: {
						id: true,
						userId: true,
						characterOwnerHash: true,
						characterId: true,
						characterName: true,
						is_primary: true,
						hasValidToken: true,
						isDeleted: true,
						linkedAt: true,
					},
				}),
				preferencesPromise,
			])
		} catch (error) {
			logger.error('[UserService] Database query failed', {
				userId,
				...toErrorLogDetails(error),
			})
			throw error
		}

		if (!user) {
			logger.error('[UserService] User not found', { userId })
			throw new Error('User not found')
		}

		const activeCharacters = includeDeleted
			? characters
			: characters.filter((char) => !char.isDeleted)

		const charactersDTO: UserCharacterDTO[] = activeCharacters.map((char) => ({
			id: char.id,
			characterOwnerHash: char.characterOwnerHash,
			characterId: char.characterId,
			characterName: char.characterName,
			is_primary: char.is_primary,
			hasValidToken: char.hasValidToken ?? false,
			linkedAt: char.linkedAt,
		}))

		const preferencesDTO: UserPreferencesDTO = preferences?.preferences || {}

		return {
			id: user.id,
			mainCharacterId: user.mainCharacterId,
			discordUserId: user.discordUserId || null,
			characters: charactersDTO,
			is_admin: user.is_admin,
			preferences: preferencesDTO,
			legacyAuthUserId: user.legacyAuthUserId || null,
			legacyAuthUserUsername: user.legacyAuthUserUsername || null,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		}
	}

	/**
	 * Link an additional character to a user
	 */
	async linkCharacter(options: LinkCharacterOptions): Promise<UserCharacterDTO> {
		const { userId, characterOwnerHash, characterId, characterName } = options

		// Verify user exists
		const user = await this.db.query.users.findFirst({
			where: eq(users.id, userId),
		})

		if (!user) {
			throw new Error('User not found')
		}

		// Check if character is already linked to any user
		const existingCharacter = await this.db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, characterId),
		})

		if (existingCharacter) {
			// If already linked to the same user, update and return existing record
			if (existingCharacter.userId === userId) {
				const [updatedCharacter] = await this.db
					.update(userCharacters)
					.set({
						characterOwnerHash,
						characterName,
						hasValidToken: true,
						updatedAt: new Date(),
					})
					.where(eq(userCharacters.id, existingCharacter.id))
					.returning()

				return {
					id: updatedCharacter.id,
					characterOwnerHash: updatedCharacter.characterOwnerHash,
					characterId: updatedCharacter.characterId,
					characterName: updatedCharacter.characterName,
					is_primary: updatedCharacter.is_primary,
					hasValidToken: updatedCharacter.hasValidToken ?? false,
					linkedAt: updatedCharacter.linkedAt,
				}
			}

			// Character linked to different user
			throw new Error('Character is already linked to a different user')
		}

		// Link character (not as primary, but token is valid since this is from auth flow)
		const [linkedCharacter] = await this.db
			.insert(userCharacters)
			.values({
				userId,
				characterOwnerHash,
				characterId,
				characterName,
				is_primary: false,
				hasValidToken: true,
			})
			.returning()

		if (!linkedCharacter) {
			throw new Error('Failed to link character')
		}

		return {
			id: linkedCharacter.id,
			characterOwnerHash: linkedCharacter.characterOwnerHash,
			characterId: linkedCharacter.characterId,
			characterName: linkedCharacter.characterName,
			is_primary: linkedCharacter.is_primary,
			hasValidToken: linkedCharacter.hasValidToken ?? false,
			linkedAt: linkedCharacter.linkedAt,
		}
	}

	/**
	 * Unlink a character from a user (cannot unlink primary character)
	 */
	async unlinkCharacter(userId: string, characterId: string): Promise<boolean> {
		// Find the character
		const character = await this.db.query.userCharacters.findFirst({
			where: and(eq(userCharacters.userId, userId), eq(userCharacters.characterId, characterId)),
		})

		if (!character) {
			return false
		}

		// Cannot unlink primary character
		if (character.is_primary) {
			throw new Error('Cannot unlink primary character. Set another character as primary first.')
		}

		// Delete character link
		const result = await this.db
			.delete(userCharacters)
			.where(eq(userCharacters.id, character.id))
			.returning()

		return result.length > 0
	}

	/**
	 * Set a character as primary (and unset the current primary)
	 */
	async setPrimaryCharacter(userId: string, characterId: string): Promise<boolean> {
		// Find the character to set as primary
		const newPrimaryChar = await this.db.query.userCharacters.findFirst({
			where: and(eq(userCharacters.userId, userId), eq(userCharacters.characterId, characterId)),
		})

		if (!newPrimaryChar) {
			throw new Error('Character not found')
		}

		// Unset current primary
		await this.db
			.update(userCharacters)
			.set({ is_primary: false })
			.where(and(eq(userCharacters.userId, userId), eq(userCharacters.is_primary, true)))

		// Set new primary
		await this.db
			.update(userCharacters)
			.set({ is_primary: true })
			.where(eq(userCharacters.id, newPrimaryChar.id))

		// Update user's mainCharacterId
		await this.db
			.update(users)
			.set({
				mainCharacterId: characterId,
				updatedAt: new Date(),
			})
			.where(eq(users.id, userId))

		return true
	}

	/**
	 * Update user preferences
	 */
	async updatePreferences(
		userId: string,
		preferences: UserPreferencesDTO
	): Promise<UserPreferencesDTO> {
		// Check if preferences exist
		const existing = await this.db.query.userPreferences.findFirst({
			where: eq(userPreferences.userId, userId),
		})

		if (existing) {
			// Update existing
			await this.db
				.update(userPreferences)
				.set({
					preferences,
					updatedAt: new Date(),
				})
				.where(eq(userPreferences.userId, userId))
		} else {
			// Create new
			await this.db.insert(userPreferences).values({
				userId,
				preferences,
			})
		}

		return preferences
	}

	/**
	 * Update legacy auth information for a user
	 * Validates no duplicate links and updates user record
	 */
	async updateLegacyAuthInfo(
		userId: string,
		legacyId: string,
		legacyUsername: string
	): Promise<void> {
		// Validate user exists
		const user = await this.db.query.users.findFirst({
			where: eq(users.id, userId),
		})

		if (!user) {
			throw new Error('User not found')
		}

		// Check if current user already has legacy auth linked
		if (user.legacyAuthUserId) {
			throw new Error('User already has a legacy account linked')
		}

		// Check for duplicate legacyAuthUserId across all users
		const existingUserWithLegacyId = await this.db.query.users.findFirst({
			where: eq(users.legacyAuthUserId, legacyId),
		})

		if (existingUserWithLegacyId) {
			throw new Error('This legacy account is already linked to another user')
		}

		// Update user record with legacy auth fields
		await this.db
			.update(users)
			.set({
				legacyAuthUserId: legacyId,
				legacyAuthUserUsername: legacyUsername,
				legacyAuthUserEmailHash: null,
				updatedAt: new Date(),
			})
			.where(eq(users.id, userId))
	}
}
