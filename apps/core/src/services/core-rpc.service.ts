import type {
	CharacterDetails,
	CharacterOwnerInfo,
	DeleteCharacterResult,
	DeleteUserResult,
	SearchUsersParams,
	SearchUsersResult,
	TransferCharacterResult,
	UserDetails,
} from '@repo/admin'
import type { DbClient, eq, ilike, sql } from '@repo/db-utils'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { schema } from '../db'

/**
 * Core RPC Service - Business logic for user/character management operations
 *
 * This service is called by the admin worker via RPC to perform operations on core data.
 * It has direct access to the core database and EVE Token Store DO.
 */
export class CoreRpcService {
	constructor(
		private db: DbClient<typeof schema>,
		private eveTokenStoreNamespace: DurableObjectNamespace
	) {}

	/**
	 * Search users with pagination
	 */
	async searchUsers(params: SearchUsersParams): Promise<SearchUsersResult> {
		const { users, userCharacters } = await import('../db/schema')
		const { eq, ilike, sql } = await import('@repo/db-utils')

		const limit = params.limit ?? 50
		const offset = params.offset ?? 0

		// Build base query
		let whereCondition = undefined

		// If search provided, filter by character name
		if (params.search) {
			whereCondition = ilike(userCharacters.characterName, `%${params.search}%`)
		}

		// Get users with character count
		const usersQuery = this.db
			.select({
				id: users.id,
				mainCharacterId: users.mainCharacterId,
				is_admin: users.is_admin,
				createdAt: users.createdAt,
				updatedAt: users.updatedAt,
				mainCharacterName: userCharacters.characterName,
			})
			.from(users)
			.leftJoin(userCharacters, eq(users.mainCharacterId, userCharacters.characterId))

		// Apply search filter if provided
		if (whereCondition) {
			usersQuery.where(whereCondition)
		}

		// Add pagination
		const paginatedUsers = await usersQuery.limit(limit).offset(offset)

		// Get character counts for each user
		const userSummaries = await Promise.all(
			paginatedUsers.map(async (user) => {
				const charCount = await this.db
					.select({ count: sql<number>`count(*)` })
					.from(userCharacters)
					.where(eq(userCharacters.userId, user.id))

				return {
					id: user.id,
					mainCharacterId: user.mainCharacterId,
					mainCharacterName: user.mainCharacterName,
					characterCount: Number(charCount[0]?.count ?? 0),
					is_admin: user.is_admin,
					createdAt: user.createdAt,
					updatedAt: user.updatedAt,
				}
			})
		)

		// Get total count for pagination
		const totalQuery = this.db
			.select({ count: sql<number>`count(distinct ${users.id})` })
			.from(users)

		if (whereCondition) {
			totalQuery
				.leftJoin(userCharacters, eq(users.mainCharacterId, userCharacters.characterId))
				.where(whereCondition)
		}

		const totalResult = await totalQuery
		const total = Number(totalResult[0]?.count ?? 0)

		return {
			users: userSummaries,
			total,
			limit,
			offset,
		}
	}

	/**
	 * Get detailed user information
	 */
	async getUserDetails(userId: string): Promise<UserDetails | null> {
		const { users, userCharacters } = await import('../db/schema')
		const { eq } = await import('@repo/db-utils')
		const { getStub } = await import('@repo/do-utils')

		// 1. Query user
		const user = await this.db.query.users.findFirst({
			where: eq(users.id, userId),
		})

		if (!user) {
			return null
		}

		// 2. Query all user's characters
		const chars = await this.db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
		})

		// 3. Get EVE Token Store stub for token validation
		const eveTokenStore = getStub<EveTokenStore>(this.eveTokenStoreNamespace, 'default')

		// 4. Build character summaries with token validation
		const characterSummaries = await Promise.all(
			chars.map(async (char) => {
				// Check token validity
				let hasValidToken = false
				try {
					const tokenInfo = await eveTokenStore.getTokenInfo(char.characterId)
					hasValidToken = !!tokenInfo && !tokenInfo.isExpired
				} catch (error) {
					console.error(`Failed to check token for character ${char.characterId}:`, error)
				}

				return {
					characterId: char.characterId,
					characterName: char.characterName,
					characterOwnerHash: char.characterOwnerHash,
					is_primary: char.is_primary,
					linkedAt: char.linkedAt,
					hasValidToken,
				}
			})
		)

		// 5. Return user details
		return {
			id: user.id,
			mainCharacterId: user.mainCharacterId,
			is_admin: user.is_admin,
			discordUserId: user.discordUserId,
			characters: characterSummaries,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		}
	}

	/**
	 * Delete a user and all associated data
	 */
	async deleteUser(userId: string): Promise<DeleteUserResult> {
		const { users, userCharacters } = await import('../db/schema')
		const { eq } = await import('@repo/db-utils')
		const { getStub } = await import('@repo/do-utils')

		// 1. Verify user exists
		const user = await this.db.query.users.findFirst({
			where: eq(users.id, userId),
		})

		if (!user) {
			throw new Error('User not found')
		}

		// 2. Get all user's characters
		const chars = await this.db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
		})

		const characterIds = chars.map((c) => c.characterId)

		// 3. Revoke all ESI tokens for user's characters
		let tokensRevoked = 0
		const eveTokenStore = getStub<EveTokenStore>(this.eveTokenStoreNamespace, 'default')

		for (const characterId of characterIds) {
			try {
				const success = await eveTokenStore.revokeToken(characterId)
				if (success) {
					tokensRevoked++
				}
			} catch (error) {
				// Log failure but continue - we don't want token issues to block deletion
				console.error(`Failed to revoke token for character ${characterId}:`, error)
			}
		}

		// 4. Delete user (CASCADE handles userCharacters, userSessions, userPreferences)
		await this.db.delete(users).where(eq(users.id, userId))

		// 5. Return result
		return {
			success: true,
			deletedUserId: userId,
			deletedCharacterIds: characterIds,
			tokensRevoked,
		}
	}

	/**
	 * Transfer character ownership from one user to another
	 */
	async transferCharacterOwnership(
		characterId: string,
		newUserId: string
	): Promise<TransferCharacterResult> {
		const { users, userCharacters } = await import('../db/schema')
		const { eq } = await import('@repo/db-utils')
		const { getStub } = await import('@repo/do-utils')

		// 1. Find current character owner
		const character = await this.db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, characterId),
		})

		if (!character) {
			throw new Error('Character not found')
		}

		const oldUserId = character.userId

		// 2. Verify target user exists
		const newUser = await this.db.query.users.findFirst({
			where: eq(users.id, newUserId),
		})

		if (!newUser) {
			throw new Error('Target user not found')
		}

		// 3. Prevent transferring to same user (idempotent check)
		if (oldUserId === newUserId) {
			throw new Error('Character is already owned by target user')
		}

		// 4. Check if this is the user's only character
		const userCharCount = await this.db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, oldUserId),
		})

		if (userCharCount.length === 1) {
			throw new Error("Cannot transfer user's only character. Delete user instead.")
		}

		// 5. Revoke ESI token (security critical - log failure but continue)
		let tokensRevoked = false
		const eveTokenStore = getStub<EveTokenStore>(this.eveTokenStoreNamespace, 'default')

		try {
			tokensRevoked = await eveTokenStore.revokeToken(characterId)
		} catch (error) {
			console.error(`Failed to revoke token for character ${characterId}:`, error)
		}

		// 6. Transfer character to new user
		await this.db
			.update(userCharacters)
			.set({
				userId: newUserId,
				is_primary: false, // Never make it primary automatically
				updatedAt: new Date(),
			})
			.where(eq(userCharacters.characterId, characterId))

		// 7. Return result
		return {
			success: true,
			characterId,
			oldUserId,
			newUserId,
			tokensRevoked,
		}
	}

	/**
	 * Delete/unlink a character from its owner
	 */
	async deleteCharacter(characterId: string): Promise<DeleteCharacterResult> {
		const { userCharacters } = await import('../db/schema')
		const { eq } = await import('@repo/db-utils')
		const { getStub } = await import('@repo/do-utils')

		// 1. Find character
		const character = await this.db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, characterId),
		})

		if (!character) {
			throw new Error('Character not found')
		}

		const userId = character.userId

		// 2. Check if this is the user's only character
		const userCharCount = await this.db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
		})

		if (userCharCount.length === 1) {
			throw new Error("Cannot delete user's only character. Delete user instead.")
		}

		// 3. Revoke ESI token (security critical - log failure but continue)
		let tokensRevoked = false
		const eveTokenStore = getStub<EveTokenStore>(this.eveTokenStoreNamespace, 'default')

		try {
			tokensRevoked = await eveTokenStore.revokeToken(characterId)
		} catch (error) {
			console.error(`Failed to revoke token for character ${characterId}:`, error)
		}

		// 4. Delete character link
		await this.db.delete(userCharacters).where(eq(userCharacters.characterId, characterId))

		// 5. Return result
		return {
			success: true,
			characterId,
			userId,
			tokensRevoked,
		}
	}

	/**
	 * Get character ownership information
	 */
	async getCharacterOwnership(characterId: string): Promise<CharacterOwnerInfo | null> {
		const { userCharacters } = await import('../db/schema')
		const { eq } = await import('@repo/db-utils')

		// Query character ownership info
		const character = await this.db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, characterId),
		})

		if (!character) {
			return null
		}

		return {
			userId: character.userId,
			isPrimary: character.is_primary,
			linkedAt: character.linkedAt,
		}
	}
}
