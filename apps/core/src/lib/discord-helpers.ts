import * as discordService from '../services/discord.service'

import type { Context } from 'hono'
import type { App } from '../context'

/**
 * Discord status information
 */
export interface DiscordStatus {
	userId: string
	username: string
	discriminator: string
	authRevoked: boolean
	authRevokedAt: Date | null
	lastSuccessfulAuth: Date | null
}

/**
 * Lazy-load Discord status for the current user
 *
 * Only call this in routes that actually need Discord status information.
 * This avoids fetching Discord status on every request, improving performance.
 *
 * @param c - Hono context
 * @returns Discord status or null if not linked or error occurs
 *
 * @example
 * ```typescript
 * // In a route that needs Discord status
 * const discordStatus = await getDiscordStatus(c)
 * if (discordStatus) {
 *   return c.json({ discord: discordStatus })
 * }
 * ```
 */
export async function getDiscordStatus(c: Context<App>): Promise<DiscordStatus | null> {
	const user = c.get('user')

	// User not authenticated or no Discord linked
	if (!user?.discordUserId) {
		return null
	}

	try {
		const status = await discordService.getUserStatus(c.env, user.id)
		if (status) {
			return {
				userId: status.userId,
				username: status.username,
				discriminator: status.discriminator,
				authRevoked: status.authRevoked,
				authRevokedAt: status.authRevokedAt,
				lastSuccessfulAuth: status.lastSuccessfulAuth,
			}
		}
	} catch (error) {
		// Log but don't throw - graceful degradation
		console.error('Error loading Discord status:', error)
	}

	return null
}
