import { userActivityLog } from '../db/schema'

import type { ActivityAction, RequestMetadata } from '../types/user'
import type { createDb } from '../db'

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
			characterOwnerHash?: string
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
	async logLogin(
		userId: string,
		characterOwnerHash: string,
		metadata: RequestMetadata
	): Promise<void> {
		await this.logActivity('login', userId, {
			...metadata,
			characterOwnerHash,
			success: true,
		})
	}

	/**
	 * Log failed login activity
	 */
	async logLoginFailed(characterOwnerHash: string, error: string, metadata: RequestMetadata) {
		await this.logActivity('login', null, {
			...metadata,
			characterOwnerHash,
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
		characterOwnerHash: string,
		metadata: RequestMetadata
	): Promise<void> {
		await this.logActivity('character_linked', userId, {
			...metadata,
			characterOwnerHash,
			success: true,
		})
	}

	/**
	 * Log character unlinked activity
	 */
	async logCharacterUnlinked(
		userId: string,
		characterOwnerHash: string,
		metadata: RequestMetadata
	): Promise<void> {
		await this.logActivity('character_unlinked', userId, {
			...metadata,
			characterOwnerHash,
			success: true,
		})
	}

	/**
	 * Log primary character changed activity
	 */
	async logPrimaryCharacterChanged(
		userId: string,
		oldCharacterOwnerHash: string,
		newCharacterOwnerHash: string,
		metadata: RequestMetadata
	): Promise<void> {
		await this.logActivity('character_primary_changed', userId, {
			...metadata,
			oldCharacterOwnerHash,
			newCharacterOwnerHash,
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
