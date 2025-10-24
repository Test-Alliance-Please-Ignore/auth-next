import type {
	ActivityLogFilters,
	ActivityLogResult,
	AdminAction,
	AdminAuditLogEntry,
	CharacterDetails,
	DeleteCharacterResult,
	DeleteUserResult,
	SearchUsersParams,
	SearchUsersResult,
	TransferCharacterResult,
	UserDetails,
} from '@repo/admin'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'

import type { schema } from '../db'

import type { DbClient } from '@repo/db-utils'

/**
 * Admin service - Business logic for administrative operations
 *
 * This service handles all admin operations including:
 * - User deletion
 * - Character ownership transfer
 * - Character deletion
 * - User/character search and lookup
 * - Activity log queries
 */
export class AdminService {
	constructor(
		private db: DbClient<typeof schema>,
		private eveTokenStore: EveTokenStore,
		private eveCharacterData: EveCharacterData
	) {}

	/**
	 * Delete a user and all associated data
	 */
	async deleteUser(userId: string, adminUserId: string): Promise<DeleteUserResult> {
		const { users, userCharacters } = await import('../db/schema')
		const { eq } = await import('@repo/db-utils')

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
		for (const characterId of characterIds) {
			try {
				const success = await this.eveTokenStore.revokeToken(characterId)
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

		// 5. Log admin action
		await this.logAdminAction(adminUserId, 'admin_user_deleted', {
			targetUserId: userId,
			characterIds,
			tokensRevoked,
			success: true,
		})

		// 6. Return result
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
		newUserId: string,
		adminUserId: string
	): Promise<TransferCharacterResult> {
		const { users, userCharacters } = await import('../db/schema')
		const { eq } = await import('@repo/db-utils')

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
		try {
			tokensRevoked = await this.eveTokenStore.revokeToken(characterId)
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

		// 7. Log admin action
		await this.logAdminAction(adminUserId, 'admin_character_transferred', {
			targetCharacterId: characterId,
			targetUserId: newUserId,
			oldUserId,
			tokensRevoked,
			success: true,
		})

		// 8. Return result
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
	async deleteCharacter(characterId: string, adminUserId: string): Promise<DeleteCharacterResult> {
		const { userCharacters } = await import('../db/schema')
		const { eq } = await import('@repo/db-utils')

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
		try {
			tokensRevoked = await this.eveTokenStore.revokeToken(characterId)
		} catch (error) {
			console.error(`Failed to revoke token for character ${characterId}:`, error)
		}

		// 4. Delete character link
		await this.db.delete(userCharacters).where(eq(userCharacters.characterId, characterId))

		// 5. Log admin action
		await this.logAdminAction(adminUserId, 'admin_character_deleted', {
			targetCharacterId: characterId,
			targetUserId: userId,
			tokensRevoked,
			success: true,
		})

		// 6. Return result
		return {
			success: true,
			characterId,
			userId,
			tokensRevoked,
		}
	}

	/**
	 * Search users with pagination
	 */
	async searchUsers(params: SearchUsersParams, adminUserId: string): Promise<SearchUsersResult> {
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
		const totalQuery = this.db.select({ count: sql<number>`count(distinct ${users.id})` }).from(users)

		if (whereCondition) {
			totalQuery
				.leftJoin(userCharacters, eq(users.mainCharacterId, userCharacters.characterId))
				.where(whereCondition)
		}

		const totalResult = await totalQuery
		const total = Number(totalResult[0]?.count ?? 0)

		// Log admin view action
		await this.logAdminAction(adminUserId, 'admin_user_viewed', {
			search: params.search,
			resultCount: userSummaries.length,
		})

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
	async getUserDetails(userId: string, adminUserId: string): Promise<UserDetails | null> {
		const { users, userCharacters } = await import('../db/schema')
		const { eq } = await import('@repo/db-utils')

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

		// 3. Build character summaries
		// Note: hasValidToken check would require calling the token store
		// For now, we'll set it to false and can enhance later if needed
		const characterSummaries = chars.map((char) => ({
			characterId: char.characterId,
			characterName: char.characterName,
			characterOwnerHash: char.characterOwnerHash,
			is_primary: char.is_primary,
			linkedAt: char.linkedAt,
			hasValidToken: false, // TODO: Could implement token validation if needed
		}))

		// 4. Log admin view action
		await this.logAdminAction(adminUserId, 'admin_user_viewed', {
			targetUserId: userId,
		})

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
	 * Get detailed character information with ownership
	 */
	async getCharacterDetails(characterId: string, adminUserId: string): Promise<CharacterDetails | null> {
		const { userCharacters } = await import('../db/schema')
		const { eq } = await import('@repo/db-utils')

		// 1. Query character ownership info
		const character = await this.db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, characterId),
		})

		// If character not linked to any user, owner will be null
		const owner = character
			? {
					userId: character.userId,
					isPrimary: character.is_primary,
					linkedAt: character.linkedAt,
				}
			: null

		// 2. Get public character data from EVE Character Data DO
		const publicInfo = await this.eveCharacterData.getCharacterInfo(characterId)

		// 3. If no data found at all, return null
		if (!publicInfo && !character) {
			return null
		}

		// 4. Log admin view action
		await this.logAdminAction(adminUserId, 'admin_character_viewed', {
			targetCharacterId: characterId,
		})

		// 5. Return character details
		return {
			characterId,
			characterName: character?.characterName ?? publicInfo?.name ?? 'Unknown',
			owner,
			publicInfo: publicInfo
				? {
						corporationId: publicInfo.corporationId?.toString(),
						corporationName: publicInfo.corporationName,
						allianceId: publicInfo.allianceId?.toString(),
						allianceName: publicInfo.allianceName,
						securityStatus: publicInfo.securityStatus,
						birthday: publicInfo.birthday ? new Date(publicInfo.birthday) : undefined,
					}
				: {},
			hasValidToken: false, // TODO: Could implement token validation if needed
			lastUpdated: publicInfo?.updatedAt ?? null,
		}
	}

	/**
	 * Get admin activity log with filters
	 */
	async getActivityLog(filters: ActivityLogFilters, adminUserId: string): Promise<ActivityLogResult> {
		const { adminAuditLog } = await import('../db/schema')
		const { eq, and, desc, sql } = await import('@repo/db-utils')

		const limit = filters.limit ?? 50
		const offset = filters.offset ?? 0

		// Build where conditions
		const conditions = []

		if (filters.action) {
			conditions.push(eq(adminAuditLog.action, filters.action))
		}

		if (filters.adminUserId) {
			conditions.push(eq(adminAuditLog.adminUserId, filters.adminUserId))
		}

		const whereCondition = conditions.length > 0 ? and(...conditions) : undefined

		// Query logs with filters and pagination
		let logsQuery = this.db
			.select()
			.from(adminAuditLog)
			.orderBy(desc(adminAuditLog.timestamp))
			.limit(limit)
			.offset(offset)

		if (whereCondition) {
			logsQuery = logsQuery.where(whereCondition) as typeof logsQuery
		}

		const logs = await logsQuery

		// Get total count for pagination
		let countQuery = this.db.select({ count: sql<number>`count(*)` }).from(adminAuditLog)

		if (whereCondition) {
			countQuery = countQuery.where(whereCondition) as typeof countQuery
		}

		const countResult = await countQuery
		const total = Number(countResult[0]?.count ?? 0)

		// Cast logs to proper type (action field needs to be AdminAction type)
		const typedLogs: AdminAuditLogEntry[] = logs.map((log) => ({
			...log,
			action: log.action as AdminAction,
		}))

		// Return activity log result
		return {
			logs: typedLogs,
			total,
			limit,
			offset,
		}
	}

	/**
	 * Log an admin action to the audit log
	 * Helper method for recording admin operations
	 */
	private async logAdminAction(
		adminUserId: string,
		action: string,
		metadata: {
			targetUserId?: string
			targetCharacterId?: string
			ip?: string
			userAgent?: string
			[key: string]: unknown
		}
	): Promise<void> {
		const { adminAuditLog } = await import('../db/schema')

		await this.db.insert(adminAuditLog).values({
			adminUserId,
			action,
			targetUserId: metadata.targetUserId ?? null,
			targetCharacterId: metadata.targetCharacterId ?? null,
			metadata,
			ip: metadata.ip ?? null,
			userAgent: metadata.userAgent ?? null,
		})
	}
}
