/**
 * Admin Worker - RPC-based administrative operations
 *
 * This worker extends WorkerEntrypoint and exposes RPC methods for:
 * - User management (deletion)
 * - Character management (ownership transfer, deletion)
 * - User/character search and lookup
 * - Admin activity audit log
 *
 * Not exposed via HTTP - only callable from other workers (primarily core worker)
 */

import { WorkerEntrypoint } from 'cloudflare:workers'

import type {
	ActivityLogFilters,
	ActivityLogResult,
	AdminWorker as IAdminWorker,
	CharacterDetails,
	DeleteCharacterResult,
	DeleteUserResult,
	SearchUsersParams,
	SearchUsersResult,
	TransferCharacterResult,
	UserDetails,
} from '@repo/admin'
import { getStub } from '@repo/do-utils'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'

import type { Env } from './context'
import { createDb } from './db'
import { AdminService } from './services/admin.service'

/**
 * Admin Worker Entry Point
 *
 * Implements the AdminWorker RPC interface defined in @repo/admin
 */
export default class AdminWorker extends WorkerEntrypoint<Env> implements IAdminWorker {
	/**
	 * Get an instance of AdminService with initialized dependencies
	 */
	private getAdminService(): AdminService {
		const db = createDb(this.env.DATABASE_URL)
		const eveTokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const eveCharacterData = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, 'default')

		return new AdminService(db, eveTokenStore, eveCharacterData)
	}

	/**
	 * Delete a user and all associated data
	 */
	async deleteUser(userId: string, adminUserId: string): Promise<DeleteUserResult> {
		const service = this.getAdminService()
		return await service.deleteUser(userId, adminUserId)
	}

	/**
	 * Transfer character ownership from one user to another
	 */
	async transferCharacterOwnership(
		characterId: string,
		newUserId: string,
		adminUserId: string
	): Promise<TransferCharacterResult> {
		const service = this.getAdminService()
		return await service.transferCharacterOwnership(characterId, newUserId, adminUserId)
	}

	/**
	 * Delete/unlink a character from its owner
	 */
	async deleteCharacter(characterId: string, adminUserId: string): Promise<DeleteCharacterResult> {
		const service = this.getAdminService()
		return await service.deleteCharacter(characterId, adminUserId)
	}

	/**
	 * Search users with pagination
	 */
	async searchUsers(params: SearchUsersParams, adminUserId: string): Promise<SearchUsersResult> {
		const service = this.getAdminService()
		return await service.searchUsers(params, adminUserId)
	}

	/**
	 * Get detailed user information
	 */
	async getUserDetails(userId: string, adminUserId: string): Promise<UserDetails | null> {
		const service = this.getAdminService()
		return await service.getUserDetails(userId, adminUserId)
	}

	/**
	 * Get detailed character information with ownership
	 */
	async getCharacterDetails(characterId: string, adminUserId: string): Promise<CharacterDetails | null> {
		const service = this.getAdminService()
		return await service.getCharacterDetails(characterId, adminUserId)
	}

	/**
	 * Get admin activity log with filters
	 */
	async getActivityLog(filters: ActivityLogFilters, adminUserId: string): Promise<ActivityLogResult> {
		const service = this.getAdminService()
		return await service.getActivityLog(filters, adminUserId)
	}
}
