import { and, eq } from '@repo/db-utils'

import { userCharacters, userPreferences, users } from '../db/schema'

import type { createDb } from '../db'
import type {
	CreateUserOptions,
	LinkCharacterOptions,
	UserCharacterDTO,
	UserPreferencesDTO,
	UserProfileDTO,
} from '../types/user'

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
			throw new Error('User already exists with this character as main')
		}

		// Check if character is already linked to another user
		const existingCharacter = await this.db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, characterId),
		})

		if (existingCharacter) {
			throw new Error('Character is already linked to another user')
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
	 * Get full user profile with characters and preferences
	 */
	async getUserProfile(userId: string): Promise<UserProfileDTO> {
		const user = await this.db.query.users.findFirst({
			where: eq(users.id, userId),
			with: {
				characters: {
					columns: {
						id: true,
						userId: true,
						characterOwnerHash: true,
						characterId: true,
						characterName: true,
						is_primary: true,
						hasValidToken: true,
						linkedAt: true,
					},
				},
				preferences: true,
			},
		})

		if (!user) {
			throw new Error('User not found')
		}

		const charactersDTO: UserCharacterDTO[] = user.characters.map((char) => ({
			id: char.id,
			characterOwnerHash: char.characterOwnerHash,
			characterId: char.characterId,
			characterName: char.characterName,
			is_primary: char.is_primary,
			hasValidToken: char.hasValidToken ?? false,
			linkedAt: char.linkedAt,
		}))

		const preferencesDTO: UserPreferencesDTO = user.preferences?.preferences || {}

		return {
			id: user.id,
			mainCharacterId: user.mainCharacterId,
			discordUserId: user.discordUserId || null,
			characters: charactersDTO,
			is_admin: user.is_admin,
			preferences: preferencesDTO,
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
}
