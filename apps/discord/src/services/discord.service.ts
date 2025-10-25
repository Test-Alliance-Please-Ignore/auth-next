import { getStub } from '@repo/do-utils'

import type { Discord } from '@repo/discord'
import type { Env } from '../context'

/**
 * Discord service
 *
 * Wraps Durable Object calls for Discord OAuth operations.
 */

/**
 * Get Discord profile for a core user
 * @param env - Worker environment
 * @param coreUserId - Core user ID
 * @returns Discord profile or null
 */
export async function getProfile(env: Env, coreUserId: string) {
	const stub = getStub<Discord>(env.DISCORD, 'default')
	return stub.getProfileByCoreUserId(coreUserId)
}

/**
 * Refresh Discord OAuth token for a core user
 * @param env - Worker environment
 * @param coreUserId - Core user ID
 * @returns Success status
 */
export async function refreshToken(env: Env, coreUserId: string) {
	const stub = getStub<Discord>(env.DISCORD, 'default')
	return stub.refreshTokenByCoreUserId(coreUserId)
}

/**
 * Store Discord tokens (PKCE flow)
 * @param env - Worker environment
 * @param userId - Discord user ID
 * @param username - Discord username
 * @param discriminator - Discord discriminator
 * @param scopes - OAuth scopes
 * @param accessToken - Access token
 * @param refreshToken - Refresh token
 * @param expiresAt - Expiration date
 * @param coreUserId - Core user ID
 * @returns Success status
 */
export async function storeTokens(
	env: Env,
	userId: string,
	username: string,
	discriminator: string,
	scopes: string[],
	accessToken: string,
	refreshToken: string,
	expiresAt: Date,
	coreUserId: string
): Promise<boolean> {
	const stub = getStub<Discord>(env.DISCORD, 'default')
	return stub.storeTokensDirect(userId, username, discriminator, scopes, accessToken, refreshToken, expiresAt, coreUserId)
}
