import { eq } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { oauthStates, users } from '../db/schema'

import type { DiscordProfile } from '@repo/discord'
import type { Env } from '../context'

/**
 * Discord linking service
 *
 * Handles Discord account linking via service binding to Discord worker.
 */

/**
 * Start Discord linking flow (PKCE)
 * @param env - Worker environment
 * @param userId - Core user ID
 * @returns OAuth state for CSRF protection
 */
export async function startLinkFlow(env: Env, userId: string): Promise<string> {
	const db = createDb(env.DATABASE_URL)

	// Generate OAuth state
	const state = crypto.randomUUID()
	const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

	// Store OAuth state in database
	await db.insert(oauthStates).values({
		state,
		flowType: 'discord',
		userId,
		expiresAt,
	})

	return state
}

/**
 * Handle Discord tokens from client (PKCE flow)
 * @param env - Worker environment
 * @param sessionUserId - User ID from session (authenticated request)
 * @param accessToken - Discord access token from client
 * @param refreshToken - Discord refresh token from client
 * @param expiresIn - Token expiration in seconds
 * @param scope - OAuth scopes granted
 * @param state - OAuth state parameter
 * @returns Result with success status
 */
export async function handleTokens(
	env: Env,
	sessionUserId: string,
	accessToken: string,
	refreshToken: string,
	expiresIn: number,
	scope: string,
	state: string
): Promise<{
	success: boolean
	error?: string
}> {
	const db = createDb(env.DATABASE_URL)

	// Validate OAuth state
	const oauthState = await db.query.oauthStates.findFirst({
		where: eq(oauthStates.state, state),
	})

	if (!oauthState) {
		return {
			success: false,
			error: 'Invalid OAuth state',
		}
	}

	// Check if state is expired
	if (oauthState.expiresAt < new Date()) {
		await db.delete(oauthStates).where(eq(oauthStates.state, state))
		return {
			success: false,
			error: 'OAuth state expired',
		}
	}

	// Check if this is a Discord flow
	if (oauthState.flowType !== 'discord') {
		return {
			success: false,
			error: 'Invalid flow type',
		}
	}

	// Get user ID from state
	const coreUserId = oauthState.userId
	if (!coreUserId) {
		return {
			success: false,
			error: 'No user ID in OAuth state',
		}
	}

	// SECURITY: Verify session user matches state user (prevents account takeover)
	if (sessionUserId !== coreUserId) {
		return {
			success: false,
			error: 'Session mismatch - you can only link Discord to your own account',
		}
	}

	try {
		// Get user info from Discord using the access token
		const userInfoResponse = await fetch('https://discord.com/api/users/@me', {
			headers: {
				'Authorization': `Bearer ${accessToken}`,
				'User-Agent': 'DiscordBot (https://pleaseignore.app, 1.0.0)',
			},
		})

		if (!userInfoResponse.ok) {
			throw new Error(`Failed to get user info: ${await userInfoResponse.text()}`)
		}

		const userInfo = await userInfoResponse.json<{
			id: string
			username: string
			discriminator: string
		}>()

		logger.info('Got Discord user info', { discordUserId: userInfo.id, username: userInfo.username })

		// Call Discord worker to store tokens
		const scopes = scope ? scope.split(' ') : []
		const expiresAt = new Date(Date.now() + expiresIn * 1000)

		const response = await env.DISCORD.fetch('http://discord/discord/auth/store-tokens', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				userId: userInfo.id,
				username: userInfo.username,
				discriminator: userInfo.discriminator,
				scopes,
				accessToken,
				refreshToken,
				expiresAt: expiresAt.toISOString(),
				coreUserId,
			}),
		})

		if (!response.ok) {
			const error = await response.text()
			return {
				success: false,
				error: `Failed to store tokens: ${error}`,
			}
		}

		// Update user record with Discord user ID
		logger.info('Updating user with Discord ID', { coreUserId, discordUserId: userInfo.id })

		const updateResult = await db
			.update(users)
			.set({
				discordUserId: userInfo.id,
				updatedAt: new Date(),
			})
			.where(eq(users.id, coreUserId))
			.returning()

		logger.info('User update complete', {
			updated: updateResult.length > 0,
			discordUserId: updateResult[0]?.discordUserId,
		})

		// Clean up OAuth state
		await db.delete(oauthStates).where(eq(oauthStates.state, state))

		return { success: true }
	} catch (error) {
		logger.error('Error handling tokens:', error)
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		}
	}
}

/**
 * Get Discord profile for a user
 * @param env - Worker environment
 * @param userId - Core user ID
 * @returns Discord profile or null
 */
export async function getProfile(env: Env, userId: string): Promise<DiscordProfile | null> {
	const response = await env.DISCORD.fetch(`http://discord/discord/profile/${userId}`, {
		method: 'GET',
	})

	if (!response.ok) {
		if (response.status === 404) {
			return null
		}
		throw new Error(`Failed to get Discord profile: ${response.statusText}`)
	}

	return response.json() as Promise<DiscordProfile>
}

/**
 * Refresh Discord OAuth token for a user
 * @param env - Worker environment
 * @param userId - Core user ID
 * @returns Success status
 */
export async function refreshToken(env: Env, userId: string): Promise<boolean> {
	const response = await env.DISCORD.fetch(`http://discord/discord/refresh/${userId}`, {
		method: 'POST',
	})

	if (!response.ok) {
		return false
	}

	const result = (await response.json()) as { success: boolean }
	return result.success
}
