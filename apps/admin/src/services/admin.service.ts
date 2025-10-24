import type {
	ActivityLogFilters,
	ActivityLogResult,
	AdminAction,
	AdminAuditLogEntry,
	CharacterDetails,
	CoreWorker,
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
 *
 * It delegates user/character data operations to the core worker via RPC
 * and handles audit logging in its own database.
 */
export class AdminService {
	constructor(
		private db: DbClient<typeof schema>,
		private eveTokenStore: EveTokenStore,
		private eveCharacterData: EveCharacterData,
		private coreWorker: CoreWorker
	) {}

	/**
	 * Delete a user and all associated data
	 */
	async deleteUser(userId: string, adminUserId: string): Promise<DeleteUserResult> {
		// 1. Delegate to core worker for user deletion
		const result = await this.coreWorker.deleteUser(userId)

		// 2. Log admin action
		await this.logAdminAction(adminUserId, 'admin_user_deleted', {
			targetUserId: userId,
			characterIds: result.deletedCharacterIds,
			tokensRevoked: result.tokensRevoked,
			success: result.success,
		})

		// 3. Return result
		return result
	}

	/**
	 * Transfer character ownership from one user to another
	 */
	async transferCharacterOwnership(
		characterId: string,
		newUserId: string,
		adminUserId: string
	): Promise<TransferCharacterResult> {
		// 1. Delegate to core worker for character transfer
		const result = await this.coreWorker.transferCharacterOwnership(characterId, newUserId)

		// 2. Log admin action
		await this.logAdminAction(adminUserId, 'admin_character_transferred', {
			targetCharacterId: characterId,
			targetUserId: newUserId,
			oldUserId: result.oldUserId,
			tokensRevoked: result.tokensRevoked,
			success: result.success,
		})

		// 3. Return result
		return result
	}

	/**
	 * Delete/unlink a character from its owner
	 */
	async deleteCharacter(characterId: string, adminUserId: string): Promise<DeleteCharacterResult> {
		// 1. Delegate to core worker for character deletion
		const result = await this.coreWorker.deleteCharacter(characterId)

		// 2. Log admin action
		await this.logAdminAction(adminUserId, 'admin_character_deleted', {
			targetCharacterId: characterId,
			targetUserId: result.userId,
			tokensRevoked: result.tokensRevoked,
			success: result.success,
		})

		// 3. Return result
		return result
	}

	/**
	 * Search users with pagination
	 */
	async searchUsers(params: SearchUsersParams, adminUserId: string): Promise<SearchUsersResult> {
		// 1. Delegate to core worker for user search
		const result = await this.coreWorker.searchUsers(params)

		// 2. Log admin view action
		await this.logAdminAction(adminUserId, 'admin_user_viewed', {
			search: params.search,
			resultCount: result.users.length,
		})

		// 3. Return result
		return result
	}

	/**
	 * Get detailed user information
	 */
	async getUserDetails(userId: string, adminUserId: string): Promise<UserDetails | null> {
		// 1. Delegate to core worker for user details
		const userDetails = await this.coreWorker.getUserDetails(userId)

		if (!userDetails) {
			return null
		}

		// 2. Log admin view action
		await this.logAdminAction(adminUserId, 'admin_user_viewed', {
			targetUserId: userId,
		})

		// 3. Return user details
		return userDetails
	}

	/**
	 * Get detailed character information with ownership
	 */
	async getCharacterDetails(characterId: string, adminUserId: string): Promise<CharacterDetails | null> {
		// 1. Get character ownership from core worker
		const owner = await this.coreWorker.getCharacterOwnership(characterId)

		// 2. Get public character data from EVE Character Data DO
		const publicInfo = await this.eveCharacterData.getCharacterInfo(characterId)

		// 3. If no data found at all, return null
		if (!publicInfo && !owner) {
			return null
		}

		// 4. Log admin view action
		await this.logAdminAction(adminUserId, 'admin_character_viewed', {
			targetCharacterId: characterId,
		})

		// 5. Return character details
		return {
			characterId,
			characterName: publicInfo?.name ?? 'Unknown',
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
		const { adminOperationsLog } = await import('../db/schema')
		const { eq, and, desc, sql } = await import('@repo/db-utils')

		const limit = filters.limit ?? 50
		const offset = filters.offset ?? 0

		// Build where conditions
		const conditions = []

		if (filters.action) {
			conditions.push(eq(adminOperationsLog.action, filters.action))
		}

		if (filters.adminUserId) {
			conditions.push(eq(adminOperationsLog.adminUserId, filters.adminUserId))
		}

		const whereCondition = conditions.length > 0 ? and(...conditions) : undefined

		// Query logs with filters and pagination
		let logsQuery = this.db
			.select()
			.from(adminOperationsLog)
			.orderBy(desc(adminOperationsLog.timestamp))
			.limit(limit)
			.offset(offset)

		if (whereCondition) {
			logsQuery = logsQuery.where(whereCondition) as typeof logsQuery
		}

		const logs = await logsQuery

		// Get total count for pagination
		let countQuery = this.db.select({ count: sql<number>`count(*)` }).from(adminOperationsLog)

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
		const { adminOperationsLog } = await import('../db/schema')

		await this.db.insert(adminOperationsLog).values({
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
