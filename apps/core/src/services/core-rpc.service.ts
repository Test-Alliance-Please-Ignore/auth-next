import { and, desc, eq, gt, ilike, inArray, or, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { userCharacters, users } from '../db/schema'
import { validateAndSyncCharacterTokenValidity } from '../lib/token-validity'
import * as discordService from '../services/discord.service'

import type { SQL } from 'drizzle-orm'
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
import type { Discord } from '@repo/discord'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Groups } from '@repo/groups'
import type { Hr } from '@repo/hr'
import type { Env } from '../context'
import type { DbClient, schema } from '../db'

/**
 * Core RPC Service - Business logic for user/character management operations
 *
 * This service is called by the admin worker via RPC to perform operations on core data.
 * It has direct access to the core database and EVE Token Store DO.
 */
export class CoreRpcService {
	constructor(
		private db: DbClient<typeof schema>,
		private env: Env
	) {}

	/**
	 * Search users with pagination
	 */
	async searchUsers(params: SearchUsersParams): Promise<SearchUsersResult> {
		const limit = params.limit ?? 50
		const offset = params.offset ?? 0
		const rawSearch = params.search?.trim() ?? ''
		const search = rawSearch.length > 0 ? rawSearch : null
		const searchLike = search ? `%${search}%` : null
		const lowerSearch = search?.toLowerCase() ?? null
		const isSearchUuid =
			search !== null &&
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search)
		const isSearchNumeric = search !== null && /^\d+$/.test(search)
		const discordUsernameMatchedCoreUserIds = new Set<string>()
		if (search) {
			try {
				const discordStub = getStub<Discord>(this.env.DISCORD, 'default')
				const discordMatches = await discordStub.searchCoreUsersByUsername(search, 200)
				for (const match of discordMatches) {
					discordUsernameMatchedCoreUserIds.add(match.coreUserId)
				}
			} catch (error) {
				console.error('[CoreRpcService.searchUsers] Discord username search failed', {
					search,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		let whereCondition: SQL<unknown> | undefined

		if (search && searchLike) {
			const conditions = [
				ilike(users.legacyAuthUserUsername, searchLike),
				eq(users.discordUserId, search),
				sql<boolean>`exists (
					select 1
					from user_characters uc
					where uc.user_id = ${users.id}
					and (
						uc.character_name ilike ${searchLike}
						${isSearchNumeric ? sql`or uc.character_id = ${search}` : sql``}
					)
				)`,
			]

			if (isSearchUuid) {
				conditions.push(eq(users.id, search))
			}
			if (discordUsernameMatchedCoreUserIds.size > 0) {
				conditions.push(inArray(users.id, Array.from(discordUsernameMatchedCoreUserIds)))
			}

			whereCondition = or(...conditions)
		}
		if (params.isAdmin !== undefined) {
			const adminWhere = eq(users.is_admin, params.isAdmin)
			whereCondition = whereCondition ? and(whereCondition, adminWhere) : adminWhere
		}

		// Get users page
		const usersQuery = this.db
			.select({
				id: users.id,
				mainCharacterId: users.mainCharacterId,
				is_admin: users.is_admin,
				discordUserId: users.discordUserId,
				legacyAuthUserUsername: users.legacyAuthUserUsername,
				createdAt: users.createdAt,
				updatedAt: users.updatedAt,
				mainCharacterName: userCharacters.characterName,
			})
			.from(users)
			.leftJoin(userCharacters, eq(users.mainCharacterId, userCharacters.characterId))

		if (whereCondition) {
			usersQuery.where(whereCondition)
		}

		const paginatedUsers = await usersQuery
			.orderBy(desc(users.updatedAt), desc(users.createdAt))
			.limit(limit)
			.offset(offset)

		const pageUserIds = paginatedUsers.map((user) => user.id)

		const characterCountsByUserId = new Map<string, number>()
		if (pageUserIds.length > 0) {
			const characterCounts = await this.db
				.select({
					userId: userCharacters.userId,
					count: sql<number>`count(*)`,
				})
				.from(userCharacters)
				.where(inArray(userCharacters.userId, pageUserIds))
				.groupBy(userCharacters.userId)

			for (const row of characterCounts) {
				characterCountsByUserId.set(row.userId, Number(row.count))
			}
		}

		const matchedCharacterByUserId = new Map<
			string,
			{ characterId: string; characterName: string }
		>()
		const discordUsernameByUserId = new Map<string, string>()
		if (search && pageUserIds.length > 0) {
			const pageCharacters = await this.db.query.userCharacters.findMany({
				where: inArray(userCharacters.userId, pageUserIds),
				columns: {
					userId: true,
					characterId: true,
					characterName: true,
					is_primary: true,
				},
			})

			const byUser = new Map<string, typeof pageCharacters>()
			for (const character of pageCharacters) {
				if (!byUser.has(character.userId)) {
					byUser.set(character.userId, [])
				}
				byUser.get(character.userId)!.push(character)
			}

			for (const [userId, characters] of byUser) {
				const scored = characters
					.filter((character) => {
						if (isSearchNumeric && character.characterId === search) {
							return true
						}
						return character.characterName.toLowerCase().includes(lowerSearch ?? '')
					})
					.map((character) => {
						const lowerName = character.characterName.toLowerCase()
						const score = (() => {
							if (isSearchNumeric && character.characterId === search) return 400
							if (lowerName === lowerSearch) return 300
							if (lowerSearch && lowerName.startsWith(lowerSearch)) return 200
							if (lowerSearch && lowerName.includes(lowerSearch)) return 100
							return 0
						})()
						return { character, score }
					})
					.filter((entry) => entry.score > 0)
					.sort((a, b) => {
						if (b.score !== a.score) return b.score - a.score
						if (a.character.is_primary !== b.character.is_primary) {
							return a.character.is_primary ? -1 : 1
						}
						return a.character.characterName.localeCompare(b.character.characterName)
					})

				const matched = scored[0]?.character
				if (matched) {
					matchedCharacterByUserId.set(userId, {
						characterId: matched.characterId,
						characterName: matched.characterName,
					})
				}
			}
		}

		if (pageUserIds.length > 0) {
			try {
				const discordStub = getStub<Discord>(this.env.DISCORD, 'default')
				const statuses = await Promise.all(
					paginatedUsers.map(async (user) => {
						if (!user.discordUserId) {
							return { userId: user.id, username: null }
						}
						try {
							const status = await discordStub.getDiscordUserStatus(user.id)
							return { userId: user.id, username: status?.username ?? null }
						} catch {
							return { userId: user.id, username: null }
						}
					})
				)
				for (const status of statuses) {
					if (status.username) {
						discordUsernameByUserId.set(status.userId, status.username)
					}
				}
			} catch (error) {
				console.error('[CoreRpcService.searchUsers] Discord status lookup failed', {
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		const userSummaries = paginatedUsers.map((user) => {
			const matchedCharacter = matchedCharacterByUserId.get(user.id) ?? null
			const matchedBy: SearchUsersResult['users'][number]['matchedBy'] = (() => {
				if (!search) return null
				if (isSearchUuid && user.id === search) return 'user_id'
				if (user.discordUserId && user.discordUserId === search) return 'discord_user_id'
				if (discordUsernameMatchedCoreUserIds.has(user.id)) {
					return 'discord_username'
				}
				if (matchedCharacter) {
					if (isSearchNumeric && matchedCharacter.characterId === search) {
						return 'character_id'
					}
					if (matchedCharacter.characterId === user.mainCharacterId) {
						return 'main_character_name'
					}
					return 'character_name'
				}
				if (
					user.legacyAuthUserUsername &&
					lowerSearch &&
					user.legacyAuthUserUsername.toLowerCase().includes(lowerSearch)
				) {
					return 'legacy_auth_username'
				}
				return null
			})()

			return {
				id: user.id,
				mainCharacterId: user.mainCharacterId,
				mainCharacterName: user.mainCharacterName,
				characterCount: characterCountsByUserId.get(user.id) ?? 0,
				is_admin: user.is_admin,
				discordUserId: user.discordUserId,
				discordUsername: discordUsernameByUserId.get(user.id) ?? null,
				matchedCharacterId: matchedCharacter?.characterId ?? null,
				matchedCharacterName: matchedCharacter?.characterName ?? null,
				matchedBy,
				createdAt: user.createdAt,
				updatedAt: user.updatedAt,
			}
		})

		// Get total count for pagination
		let totalQuery = this.db.select({ count: sql<number>`count(*)` }).from(users)

		if (whereCondition) {
			totalQuery = totalQuery.where(whereCondition) as typeof totalQuery
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
		const eveTokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		// 4. Get HR stub for blacklist status check
		const hrStub = getStub<Hr>(this.env.HR, 'default')
		const groupsStub = getStub<Groups>(this.env.GROUPS, 'default')

		// 5. Bulk check blacklist status for all characters
		const characterIds = chars.map((c) => c.characterId)
		const blacklistStatuses =
			characterIds.length > 0 ? await hrStub.checkCharactersBlacklisted(characterIds) : {}

		// 5.5 Fetch group memberships for admin visibility.
		let groupMemberships: UserDetails['groupMemberships'] = []
		try {
			const memberships = await groupsStub.getUserMemberships(userId)
			groupMemberships = memberships.map((membership) => ({
				groupId: membership.groupId,
				groupName: membership.groupName,
				membershipLevel: membership.isOwner ? 'owner' : membership.isAdmin ? 'admin' : 'member',
				joinedAt: membership.joinedAt,
			}))
		} catch (error) {
			console.error(`Failed to load groups for user ${userId}:`, error)
		}

		// 6. Build character summaries with token validation and blacklist status
		const characterSummaries = await Promise.all(
			chars.map(async (char) => {
				let hasValidToken = char.hasValidToken === true
				try {
					const tokenStatus = await validateAndSyncCharacterTokenValidity({
						db: this.db,
						tokenStore: eveTokenStore,
						characterId: char.characterId,
						previousHasValidToken: char.hasValidToken ?? null,
					})
					hasValidToken = tokenStatus.nextHasValidToken === true
				} catch (error) {
					console.error(`Failed to check token for character ${char.characterId}:`, error)
				}

				return {
					characterId: char.characterId,
					characterName: char.characterName,
					characterOwnerHash: char.characterOwnerHash,
					corporationId: char.corporationId,
					corporationName: char.corporationName,
					is_primary: char.is_primary,
					linkedAt: char.linkedAt,
					hasValidToken,
					isBlacklisted: blacklistStatuses[char.characterId] || false,
				}
			})
		)

		// 7. Get Discord status if linked
		let discordStatus = null
		if (user.discordUserId) {
			try {
				const discordStub = getStub<Discord>(this.env.DISCORD, 'default')
				const status = await discordStub.getDiscordUserStatus(userId)
				if (status) {
					discordStatus = {
						userId: status.userId,
						username: status.username,
						discriminator: status.discriminator,
						authRevoked: status.authRevoked,
						authRevokedAt: status.authRevokedAt,
						lastSuccessfulAuth: status.lastSuccessfulAuth,
					}
				}
			} catch (error) {
				console.error('Failed to load Discord status:', error)
			}
		}

		// 8. Return user details
		return {
			id: user.id,
			mainCharacterId: user.mainCharacterId,
			is_admin: user.is_admin,
			discordUserId: user.discordUserId,
			discord: discordStatus,
			characters: characterSummaries,
			groupMemberships,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		}
	}

	/**
	 * Delete a user and all associated data
	 */
	async deleteUser(userId: string): Promise<DeleteUserResult> {
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
		const eveTokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

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
		const eveTokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

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
		const eveTokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

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

	/**
	 * Get all linked character IDs for a user.
	 */
	async getUserCharacterIds(userId: string): Promise<string[]> {
		const characters = await this.db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
			columns: {
				characterId: true,
			},
		})

		return characters.map((character) => character.characterId)
	}

	/**
	 * Get user batches for the daily character data sync, grouped by user ID.
	 */
	async getUsersNeedingCharacterDataSync(): Promise<{
		userBatches: Array<{ userId: string; characterIds: string[] }>
		unownedCharacterIds: string[]
	}> {
		const eveTokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const dueCharacterIds = await eveTokenStore.getCharactersNeedingDataSync()

		if (dueCharacterIds.length === 0) {
			return { userBatches: [], unownedCharacterIds: [] }
		}

		const dueCharacterOwners = await this.db.query.userCharacters.findMany({
			where: inArray(userCharacters.characterId, dueCharacterIds),
			columns: {
				userId: true,
				characterId: true,
			},
		})

		const dueCharacterIndex = new Map(dueCharacterIds.map((characterId, index) => [characterId, index]))
		const userOrder = new Map<string, number>()
		const dueUserIds = new Set<string>()

		for (const row of dueCharacterOwners) {
			dueUserIds.add(row.userId)
			const existingOrder = userOrder.get(row.userId)
			const dueIndex = dueCharacterIndex.get(row.characterId) ?? Number.MAX_SAFE_INTEGER
			if (existingOrder === undefined || dueIndex < existingOrder) {
				userOrder.set(row.userId, dueIndex)
			}
		}

		const ownedCharacterIdSet = new Set(dueCharacterOwners.map((row) => row.characterId))
		const unownedCharacterIds = dueCharacterIds.filter((characterId) => !ownedCharacterIdSet.has(characterId))

		if (dueUserIds.size === 0) {
			return { userBatches: [], unownedCharacterIds }
		}

		const allUserCharacters = await this.db.query.userCharacters.findMany({
			where: inArray(userCharacters.userId, Array.from(dueUserIds)),
			columns: {
				userId: true,
				characterId: true,
			},
		})

		const characterIdsByUserId = new Map<string, Set<string>>()
		for (const row of allUserCharacters) {
			const bucket = characterIdsByUserId.get(row.userId) ?? new Set<string>()
			bucket.add(row.characterId)
			characterIdsByUserId.set(row.userId, bucket)
		}

		return {
			userBatches: Array.from(dueUserIds)
				.sort((a, b) => (userOrder.get(a) ?? 0) - (userOrder.get(b) ?? 0))
				.map((userId) => ({
					userId,
					characterIds: Array.from(characterIdsByUserId.get(userId) ?? []),
				})),
			unownedCharacterIds,
		}
	}

	/**
	 * Get corporations that should be included in background refresh
	 */
	async getCorporationsForBackgroundRefresh(): Promise<
		Array<{ corporationId: string; name: string }>
	> {
		const { managedCorporations } = await import('../db/schema')

		const corporations = await this.db.query.managedCorporations.findMany({
			where: and(
				eq(managedCorporations.includeInBackgroundRefresh, true),
				eq(managedCorporations.isActive, true),
				eq(managedCorporations.isVerified, true),
				gt(managedCorporations.healthyDirectorCount, 0)
			),
			columns: {
				corporationId: true,
				name: true,
			},
		})

		return corporations.map((c) => ({
			corporationId: c.corporationId,
			name: c.name,
		}))
	}

	/**
	 * Update the last sync timestamp for a corporation
	 */
	async updateCorporationLastSync(corporationId: string): Promise<void> {
		const { managedCorporations } = await import('../db/schema')

		const now = new Date()
		await this.db
			.update(managedCorporations)
			.set({
				lastSync: now,
				updatedAt: now,
			})
			.where(eq(managedCorporations.corporationId, corporationId))
	}

	async updateCorporationAuthHealth(
		corporationId: string,
		input: {
			healthyDirectorCount: number
			isVerified: boolean
			lastVerified?: string | null
		}
	): Promise<void> {
		const { managedCorporations } = await import('../db/schema')
		const lastVerified = input.lastVerified ? new Date(input.lastVerified) : new Date()
		await this.db
			.update(managedCorporations)
			.set({
				healthyDirectorCount: Math.max(0, Math.floor(input.healthyDirectorCount)),
				isVerified: input.isVerified,
				lastVerified,
				updatedAt: new Date(),
			})
			.where(eq(managedCorporations.corporationId, corporationId))
	}

	/**
	 * Get users that have Discord linked and need refresh
	 * Used by the orchestrator worker to refresh Discord access
	 *
	 * Returns users where:
	 * - Discord is linked (discordUserId is not null)
	 * - Never been refreshed (lastDiscordRefresh is null) OR
	 * - Last refresh was more than 30 minutes ago
	 *
	 * @param limit - Maximum number of users to return (default: 50)
	 * @param refreshIntervalMinutes - Minimum minutes between refreshes (default: 30)
	 * @returns Array of users with Discord linked that need refresh
	 */
	async getUsersForDiscordRefresh(
		limit = 50,
		refreshIntervalMinutes = 30
	): Promise<
		Array<{
			userId: string
			discordUserId: string
			lastDiscordRefresh: Date | null
		}>
	> {
		const usersWithDiscord = await this.db
			.select({
				userId: users.id,
				discordUserId: users.discordUserId,
				lastDiscordRefresh: users.lastDiscordRefresh,
			})
			.from(users)
			.where(
				and(
					sql`${users.discordUserId} IS NOT NULL`,
					sql`(${users.lastDiscordRefresh} IS NULL OR ${users.lastDiscordRefresh} < NOW() - INTERVAL '${sql.raw(refreshIntervalMinutes.toString())} minutes')`
				)
			)
			.orderBy(sql`${users.lastDiscordRefresh} ASC NULLS FIRST`)
			.limit(limit)

		return usersWithDiscord.map((u) => ({
			userId: u.userId,
			discordUserId: u.discordUserId!,
			lastDiscordRefresh: u.lastDiscordRefresh,
		}))
	}

	/**
	 * Log user activity for audit trail
	 *
	 * @param userId - User ID
	 * @param action - Action description
	 * @param metadata - Additional metadata (stored as JSONB)
	 */
	async logUserActivity(
		userId: string,
		action: string,
		metadata?: Record<string, any>
	): Promise<void> {
		const { userActivityLog } = await import('../db/schema')

		await this.db.insert(userActivityLog).values({
			userId,
			action,
			metadata: metadata ?? undefined,
		})
	}

	/**
	 * Update the last Discord refresh timestamp for a user
	 *
	 * @param userId - User ID
	 */
	async updateUserDiscordRefreshTimestamp(userId: string): Promise<void> {
		const now = new Date()
		await this.db
			.update(users)
			.set({
				lastDiscordRefresh: now,
				updatedAt: now,
			})
			.where(eq(users.id, userId))
	}

	/**
	 * Sync Discord access for a user
	 * - Invites user to servers they should be in
	 * - Updates roles based on corporation/group memberships
	 * - Applies auto-apply roles
	 * - Updates nicknames if enabled
	 *
	 * @param userId - User ID
	 * @returns Sync result with statistics
	 */
	async syncUserDiscordAccess(userId: string): Promise<{
		results: Array<{
			guildId: string
			guildName: string
			corporationName?: string
			groupName?: string
			success: boolean
			errorMessage?: string
			alreadyMember?: boolean
			type?: 'corporation' | 'group'
			operation?: 'invite' | 'update' | 'revoke-ban'
		}>
		totalInvited: number
		totalUpdated: number
		totalFailed: number
	}> {
		return await discordService.syncUserDiscordAccess(this.env, userId)
	}

	/**
	 * Get user's main character name by user ID
	 *
	 * @param userId - User ID
	 * @returns Main character name, or null if user not found
	 */
	async getUserMainCharacterName(userId: string): Promise<string | null> {
		const user = await this.db.query.users.findFirst({
			where: eq(users.id, userId),
		})

		if (!user) {
			return null
		}

		const mainCharacter = await this.db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, user.mainCharacterId),
		})

		return mainCharacter?.characterName ?? null
	}

	/**
	 * Get user's main character identity by user ID.
	 *
	 * @param userId - User ID
	 * @returns Main character id/name, or null if user/character not found
	 */
	async getUserMainCharacter(
		userId: string,
	): Promise<{ characterId: string; characterName: string } | null> {
		const user = await this.db.query.users.findFirst({
			where: eq(users.id, userId),
		})

		if (!user) {
			return null
		}

		const mainCharacter = await this.db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, user.mainCharacterId),
		})

		if (!mainCharacter) {
			return null
		}

		return {
			characterId: mainCharacter.characterId,
			characterName: mainCharacter.characterName,
		}
	}
}
