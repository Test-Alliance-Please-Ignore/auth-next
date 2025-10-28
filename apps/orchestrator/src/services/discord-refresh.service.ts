import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { Discord } from '@repo/discord'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Env } from '../context'

/**
 * Expected server access for a user
 */
export interface ExpectedServerAccess {
	guildId: string
	guildName?: string
	roleIds: string[]
}

/**
 * Result of Discord refresh operation
 */
export interface DiscordRefreshResult {
	success: boolean
	userId: string
	tokenRefreshed: boolean
	serversJoined: number
	rolesUpdated: number
	errors: string[]
	authRevoked: boolean
}

/**
 * Discord Refresh Service
 *
 * Handles the business logic for refreshing Discord access for users:
 * - Refreshing OAuth tokens
 * - Calculating expected server memberships based on corporation configuration
 * - Re-inviting users to Discord servers
 * - Updating roles based on corporation assignments
 */
export class DiscordRefreshService {
	private discordStub: Discord

	constructor(private env: Env) {
		this.discordStub = getStub<Discord>(env.DISCORD, 'default')
	}

	/**
	 * Perform a complete Discord refresh for a user
	 *
	 * @param userId - Core user ID
	 * @param discordUserId - Discord user ID
	 * @returns Refresh result with details
	 */
	async refreshUserDiscordAccess(
		userId: string,
		discordUserId: string
	): Promise<DiscordRefreshResult> {
		const result: DiscordRefreshResult = {
			success: true,
			userId,
			tokenRefreshed: false,
			serversJoined: 0,
			rolesUpdated: 0,
			errors: [],
			authRevoked: false,
		}

		try {
			// Step 1: Check Discord user status
			const status = await this.discordStub.getDiscordUserStatus(userId)
			if (!status) {
				result.success = false
				result.errors.push('Discord user status not found')
				return result
			}

			if (status.authRevoked) {
				result.success = false
				result.authRevoked = true
				result.errors.push('Discord authorization has been revoked')
				return result
			}

			// Step 2: Refresh OAuth token
			try {
				const tokenRefreshed = await this.discordStub.refreshTokenByCoreUserId(userId)
				result.tokenRefreshed = tokenRefreshed
				logger.info('[DiscordRefresh] Token refresh result', { userId, tokenRefreshed })
			} catch (error) {
				// Token refresh failures may indicate revoked auth
				logger.error('[DiscordRefresh] Failed to refresh token', { userId, error })
				result.errors.push(`Token refresh failed: ${error instanceof Error ? error.message : String(error)}`)
				// Don't mark as complete failure yet - check if it's a revocation
				if (error instanceof Error && error.message.includes('revoked')) {
					result.authRevoked = true
					result.success = false
					return result
				}
			}

			// Step 3: Calculate expected server access
			const expectedAccess = await this.calculateExpectedServerAccess(userId)
			logger.info('[DiscordRefresh] Expected server access', {
				userId,
				serverCount: expectedAccess.length,
			})

			// Step 4: Sync server access
			if (expectedAccess.length > 0) {
				const syncResult = await this.syncServerAccess(userId, expectedAccess)
				result.serversJoined = syncResult.serversJoined
				result.rolesUpdated = syncResult.rolesUpdated
				result.errors.push(...syncResult.errors)

				if (syncResult.errors.length > 0) {
					result.success = false
				}
			}

			return result
		} catch (error) {
			logger.error('[DiscordRefresh] Unexpected error during refresh', { userId, error })
			result.success = false
			result.errors.push(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`)
			return result
		}
	}

	/**
	 * Calculate which Discord servers and roles a user should have access to
	 * based on their corporation memberships
	 *
	 * @param userId - Core user ID
	 * @returns Array of expected server access configurations
	 */
	private async calculateExpectedServerAccess(userId: string): Promise<ExpectedServerAccess[]> {
		// TODO: Implement logic to query user's corporation memberships
		// and map them to Discord server configurations
		//
		// This will require:
		// 1. Getting user's characters
		// 2. For each character, getting their corporation
		// 3. Querying corporationDiscordServers for each corporation
		// 4. Querying corporationDiscordServerRoles for role assignments
		// 5. Building ExpectedServerAccess objects
		//
		// For now, returning empty array (no servers)
		// This will be implemented in a follow-up task

		logger.info('[DiscordRefresh] calculateExpectedServerAccess placeholder', { userId })
		return []
	}

	/**
	 * Sync user's Discord server access to match expected configuration
	 *
	 * @param userId - Core user ID
	 * @param expectedAccess - Expected server access configurations
	 * @returns Sync result with counts and errors
	 */
	private async syncServerAccess(
		userId: string,
		expectedAccess: ExpectedServerAccess[]
	): Promise<{
		serversJoined: number
		rolesUpdated: number
		errors: string[]
	}> {
		const result = {
			serversJoined: 0,
			rolesUpdated: 0,
			errors: [] as string[],
		}

		try {
			// Prepare join requests with roles
			const joinRequests = expectedAccess.map((access) => ({
				guildId: access.guildId,
				roleIds: access.roleIds,
			}))

			// Execute join requests
			const joinResults = await this.discordStub.joinUserToServersWithRoles(userId, joinRequests)

			for (const joinResult of joinResults) {
				if (joinResult.success) {
					result.serversJoined++
					if (joinResult.alreadyMember) {
						// User was already a member, so we likely just updated roles
						result.rolesUpdated++
					}
					logger.info('[DiscordRefresh] Successfully joined/updated server', {
						userId,
						guildId: joinResult.guildId,
						alreadyMember: joinResult.alreadyMember,
					})
				} else {
					const errorMsg = `Failed to join ${joinResult.guildId}: ${joinResult.errorMessage || 'Unknown error'}`
					result.errors.push(errorMsg)
					logger.warn('[DiscordRefresh] Failed to join server', {
						userId,
						guildId: joinResult.guildId,
						error: joinResult.errorMessage,
					})
				}
			}
		} catch (error) {
			const errorMsg = `Server sync failed: ${error instanceof Error ? error.message : String(error)}`
			result.errors.push(errorMsg)
			logger.error('[DiscordRefresh] Server sync error', { userId, error })
		}

		return result
	}
}
