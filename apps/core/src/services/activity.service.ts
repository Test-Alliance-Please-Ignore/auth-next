import { userActivityLog } from '../db/schema'

import type { createDb } from '../db'
import type { ActivityAction, RequestMetadata } from '../types/user'

/**
 * Activity Service
 *
 * Handles logging of user activity and actions for audit trail and security.
 */
export class ActivityService {
	constructor(private db: ReturnType<typeof createDb>) {}

	/**
	 * Log a user activity
	 */
	async logActivity(
		action: ActivityAction,
		userId: string | null,
		metadata?: RequestMetadata & {
			characterId?: string
			success?: boolean
			error?: string
			[key: string]: unknown
		}
	): Promise<void> {
		await this.db.insert(userActivityLog).values({
			userId,
			action,
			metadata: metadata || {},
		})
	}

	/**
	 * Log login activity
	 */
	async logLogin(userId: string, characterId: string, metadata: RequestMetadata): Promise<void> {
		await this.logActivity('login', userId, {
			...metadata,
			characterId,
			success: true,
		})
	}

	/**
	 * Log failed login activity
	 */
	async logLoginFailed(characterId: string, error: string, metadata: RequestMetadata) {
		await this.logActivity('login', null, {
			...metadata,
			characterId,
			success: false,
			error,
		})
	}

	/**
	 * Log logout activity
	 */
	async logLogout(userId: string, metadata: RequestMetadata): Promise<void> {
		await this.logActivity('logout', userId, {
			...metadata,
			success: true,
		})
	}

	/**
	 * Log character linked activity
	 */
	async logCharacterLinked(
		userId: string,
		characterId: string,
		metadata: RequestMetadata
	): Promise<void> {
		await this.logActivity('character_linked', userId, {
			...metadata,
			characterId,
			success: true,
		})
	}

	/**
	 * Log character unlinked activity
	 */
	async logCharacterUnlinked(
		userId: string,
		characterId: string,
		metadata: RequestMetadata
	): Promise<void> {
		await this.logActivity('character_unlinked', userId, {
			...metadata,
			characterId,
			success: true,
		})
	}

	/**
	 * Log primary character changed activity
	 */
	async logPrimaryCharacterChanged(
		userId: string,
		oldCharacterId: string,
		newCharacterId: string,
		metadata: RequestMetadata
	): Promise<void> {
		await this.logActivity('character_primary_changed', userId, {
			...metadata,
			oldCharacterId,
			newCharacterId,
			success: true,
		})
	}

	/**
	 * Log role granted activity
	 */
	async logRoleGranted(
		userId: string,
		role: string,
		grantedBy: string,
		metadata: RequestMetadata
	): Promise<void> {
		await this.logActivity('role_granted', userId, {
			...metadata,
			role,
			grantedBy,
			success: true,
		})
	}

	/**
	 * Log role revoked activity
	 */
	async logRoleRevoked(
		userId: string,
		role: string,
		revokedBy: string,
		metadata: RequestMetadata
	): Promise<void> {
		await this.logActivity('role_revoked', userId, {
			...metadata,
			role,
			revokedBy,
			success: true,
		})
	}

	/**
	 * Log preferences updated activity
	 */
	async logPreferencesUpdated(userId: string, metadata: RequestMetadata): Promise<void> {
		await this.logActivity('preferences_updated', userId, {
			...metadata,
			success: true,
		})
	}
}
