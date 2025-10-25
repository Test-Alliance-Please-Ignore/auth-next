import { Hono } from 'hono'

import { logger } from '@repo/hono-helpers'

import { requireAuth } from '../middleware/session'
import * as discordService from '../services/discord.service'

import type { App } from '../context'

/**
 * Discord routes
 *
 * Handles Discord account linking for authenticated users.
 */
const discord = new Hono<App>()

/**
 * Start Discord linking flow (PKCE)
 * POST /api/discord/link/start
 * Requires authentication
 * Returns: { state: string } - state parameter for CSRF protection
 */
discord.post('/link/start', requireAuth(), async (c) => {
	const user = c.get('user')!

	// Check if user already has Discord linked
	if (user.discord) {
		return c.json(
			{
				error: 'Discord account already linked',
			},
			400
		)
	}

	try {
		const state = await discordService.startLinkFlow(c.env, user.id)

		return c.json({ state })
	} catch (error) {
		logger.error('Error starting Discord link flow:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to start Discord linking',
			},
			500
		)
	}
})

/**
 * Handle Discord OAuth tokens from client (PKCE flow)
 * POST /api/discord/callback/tokens
 * Requires authentication
 * Body: { accessToken, refreshToken, expiresIn, scope, state }
 * The client exchanges the code for tokens directly with Discord,
 * then sends the tokens here for validation and storage.
 */
discord.post('/callback/tokens', requireAuth(), async (c) => {
	const user = c.get('user')!

	try {
		const body = await c.req.json<{
			accessToken: string
			refreshToken: string
			expiresIn: number
			scope: string
			state: string
		}>()

		const { accessToken, refreshToken, expiresIn, scope, state } = body

		if (!accessToken || !state) {
			return c.json({ error: 'Missing required parameters' }, 400)
		}

		logger.info('Received tokens from client', { userId: user.id, state, scope })

		// Handle the tokens (validate state and store)
		const result = await discordService.handleTokens(
			c.env,
			user.id,
			accessToken,
			refreshToken,
			expiresIn,
			scope,
			state
		)

		logger.info('Token handling result', { success: result.success, error: result.error })

		if (!result.success) {
			return c.json({ error: result.error || 'Failed to link Discord' }, 400)
		}

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error handling Discord tokens:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to handle Discord tokens',
			},
			500
		)
	}
})

/**
 * Get current user's Discord profile
 * GET /api/discord/profile
 * Requires authentication
 * Returns: { userId: string, username: string, discriminator: string, scopes: string[] } | null
 */
discord.get('/profile', requireAuth(), async (c) => {
	const user = c.get('user')!

	try {
		const profile = await discordService.getProfile(c.env, user.id)

		if (!profile) {
			return c.json({ error: 'Discord profile not found' }, 404)
		}

		return c.json(profile)
	} catch (error) {
		logger.error('Error getting Discord profile:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to get Discord profile',
			},
			500
		)
	}
})

/**
 * Refresh Discord OAuth token
 * POST /api/discord/refresh
 * Requires authentication
 * Returns: { success: boolean }
 */
discord.post('/refresh', requireAuth(), async (c) => {
	const user = c.get('user')!

	try {
		const success = await discordService.refreshToken(c.env, user.id)

		return c.json({ success })
	} catch (error) {
		logger.error('Error refreshing Discord token:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to refresh Discord token',
			},
			500
		)
	}
})

/**
 * Join user to corporation Discord servers
 * POST /api/discord/join-servers
 * Requires authentication
 *
 * Automatically joins the authenticated user to Discord servers for all
 * managed corporations they are a member of (if auto-invite is enabled).
 *
 * Returns: {
 *   results: Array<{
 *     guildId: string,
 *     guildName: string,
 *     corporationName: string,
 *     success: boolean,
 *     errorMessage?: string,
 *     alreadyMember?: boolean
 *   }>,
 *   totalInvited: number,
 *   totalFailed: number
 * }
 */
discord.post('/join-servers', requireAuth(), async (c) => {
	const user = c.get('user')!

	try {
		const result = await discordService.joinUserToCorporationServers(c.env, user.id)

		return c.json(result)
	} catch (error) {
		logger.error('Error joining Discord servers:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to join Discord servers',
			},
			500
		)
	}
})

export default discord
